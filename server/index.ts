import path from "node:path";
import type { BunServer, BunSqlClient } from "./bun-env";
import { ensureDatabaseExists, getSql } from "./database/postgre";
import { migrateSchema } from "./database/scheme";
import { seedDatabase } from "./database/seeder";
import { EMBEDDED_ASSETS } from "./embedded-assets";
import { fetchWorkspaceSnapshot, handleWsAction } from "./ws/handlers";
import type {
  WsBroadcastEvent,
  WsRequestMessage,
  WsResponseMessage,
} from "./ws/protocol";

export interface WsClientData {
  clientId: string;
  connectedAt: number;
}

const GLOBAL_TOPIC = "workspace:global";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const decodedAssetCache = new Map<
  string,
  { mime: string; bytes: Uint8Array }
>();

function tryServeEmbeddedAsset(pathname: string): Response | null {
  const cleanPath =
    pathname === "/" ? "/index.html" : pathname.replace(/\/+$/, "");

  const keysToTry = [
    cleanPath,
    `${cleanPath}.html`,
    `${cleanPath}/index.html`,
  ];

  for (const key of keysToTry) {
    let cached = decodedAssetCache.get(key);
    if (!cached) {
      const entry = EMBEDDED_ASSETS[key];
      if (entry) {
        cached = {
          mime: entry.mime,
          bytes: new Uint8Array(Buffer.from(entry.base64, "base64")),
        };
        decodedAssetCache.set(key, cached);
      }
    }

    if (cached) {
      return new Response(cached.bytes as unknown as BodyInit, {
        headers: {
          "Content-Type": cached.mime,
          "Cache-Control": key.startsWith("/_next/static/")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        },
      });
    }
  }

  return null;
}

async function tryServeStaticFrontend(
  pathname: string,
  staticDir?: string,
  preferDiskDir = false,
): Promise<Response | null> {
  if (!preferDiskDir) {
    const embeddedRes = tryServeEmbeddedAsset(pathname);
    if (embeddedRes) return embeddedRes;
  }

  if (staticDir) {
    const normalizedRoot = path.resolve(staticDir);
    const cleanRel =
      pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");

    const candidates = [
      path.resolve(normalizedRoot, cleanRel),
      path.resolve(normalizedRoot, `${cleanRel}.html`),
      path.resolve(normalizedRoot, cleanRel, "index.html"),
    ];

    for (const candidate of candidates) {
      if (!candidate.startsWith(normalizedRoot)) continue;
      const f = Bun.file(candidate);
      if (await f.exists()) {
        return new Response(f as unknown as BodyInit, {
          headers: {
            "Content-Type": f.type || "application/octet-stream",
          },
        });
      }
    }
  }

  if (preferDiskDir) {
    return tryServeEmbeddedAsset(pathname);
  }

  return null;
}

export async function startServer(options?: {
  hostname?: string;
  port?: number;
  sql?: BunSqlClient;
  autoMigrateAndSeed?: boolean;
  staticDir?: string;
}): Promise<BunServer<WsClientData>> {
  const hostname =
    options?.hostname ?? process.env.APP_SERVER_HOST ?? "0.0.0.0";
  const port =
    options?.port ?? Number(process.env.APP_SERVER_PORT || 5790);
  const sql = options?.sql ?? getSql();
  const hasExplicitStaticDir = Boolean(options?.staticDir);
  const staticDir =
    options?.staticDir ??
    process.env.STATIC_WEB_DIR ??
    path.resolve(process.cwd(), "out");

  if (options?.autoMigrateAndSeed !== false) {
    await ensureDatabaseExists();
    await migrateSchema(sql);
    const existingUsers = await sql<{ count: number }>`
      SELECT COUNT(*)::int AS count FROM users
    `;
    if ((existingUsers[0]?.count ?? 0) === 0) {
      await seedDatabase(sql);
    }
  }

  const server = Bun.serve<WsClientData>({
    hostname,
    port,
    async fetch(req, srv) {
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        const upgraded = srv.upgrade(req, {
          data: {
            clientId: crypto.randomUUID(),
            connectedAt: Date.now(),
          },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }

      if (url.pathname === "/health") {
        return Response.json(
          {
            ok: true,
            service: "projectmanager-bun-ws",
            embeddedAssets: Object.keys(EMBEDDED_ASSETS).length,
            wsEndpoint: `ws://${hostname === "0.0.0.0" ? "localhost" : hostname}:${srv.port}/ws`,
          },
          { headers: CORS_HEADERS },
        );
      }

      if (url.pathname === "/api/snapshot" && req.method === "GET") {
        const snapshot = await fetchWorkspaceSnapshot(sql);
        return Response.json(
          { ok: true, data: snapshot },
          { headers: CORS_HEADERS },
        );
      }

      if (req.method === "GET" || req.method === "HEAD") {
        const staticRes = await tryServeStaticFrontend(
          url.pathname,
          staticDir,
          hasExplicitStaticDir,
        );
        if (staticRes) return staticRes;
      }

      return Response.json(
        {
          ok: false,
          error: "Not Found",
          endpoints: ["/health", "/api/snapshot", "/ws"],
        },
        { status: 404, headers: CORS_HEADERS },
      );
    },
    websocket: {
      async open(ws) {
        ws.subscribe(GLOBAL_TOPIC);
        try {
          const snapshot = await fetchWorkspaceSnapshot(sql);
          const initEvent: WsBroadcastEvent = {
            type: "event",
            event: "state:init",
            data: { clientId: ws.data.clientId },
            snapshot,
            timestamp: new Date().toISOString(),
          };
          ws.send(JSON.stringify(initEvent));
        } catch (err) {
          console.error("[ws:open] Failed to send initial snapshot:", err);
        }
      },
      async message(ws, raw) {
        let parsed: WsRequestMessage;
        try {
          const text = typeof raw === "string" ? raw : raw.toString("utf8");
          parsed = JSON.parse(text) as WsRequestMessage;
        } catch {
          const badReq: WsResponseMessage = {
            id: "unknown",
            type: "response",
            ok: false,
            action: "state:init",
            error: "Invalid JSON message format",
          };
          ws.send(JSON.stringify(badReq));
          return;
        }

        const reqId = parsed.id || crypto.randomUUID();
        const action = parsed.action;

        try {
          const { mutated, result } = await handleWsAction(
            sql,
            action,
            parsed.payload || {},
          );

          const response: WsResponseMessage = {
            id: reqId,
            type: "response",
            ok: true,
            action,
            data: result,
          };
          ws.send(JSON.stringify(response));

          if (mutated) {
            const snapshot = await fetchWorkspaceSnapshot(sql);
            const broadcastPayload: WsBroadcastEvent = {
              type: "event",
              event: action,
              data: result,
              snapshot,
              timestamp: new Date().toISOString(),
            };
            server.publish(GLOBAL_TOPIC, JSON.stringify(broadcastPayload));
          }
        } catch (err) {
          const errorMsg =
            err instanceof Error ? err.message : "Unknown error occurred";
          const errResponse: WsResponseMessage = {
            id: reqId,
            type: "response",
            ok: false,
            action,
            error: errorMsg,
          };
          ws.send(JSON.stringify(errResponse));
        }
      },
      close(ws) {
        ws.unsubscribe(GLOBAL_TOPIC);
      },
    },
  });

  return server;
}

if (import.meta.main) {
  void (async () => {
    const srv = await startServer();
    console.log(
      `[bun-server] Listening on http://${srv.hostname}:${srv.port} (WebSocket: ws://localhost:${srv.port}/ws, embeddedAssets=${Object.keys(EMBEDDED_ASSETS).length})`,
    );
  })();
}
