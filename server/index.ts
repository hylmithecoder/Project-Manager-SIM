import path from "node:path";
import type { BunServer, BunServerWebSocket, BunSqlClient } from "./bun-env";
import { ensureDeveloperAccount, loadAuthUser, resolveSession, type AuthUserRow } from "./auth/auth";
import { ensureDatabaseExists, getSql } from "./database/postgre";
import { migrateSchema } from "./database/scheme";
import { seedDatabase } from "./database/seeder";
import { EMBEDDED_ASSETS } from "./embedded-assets";
import { scanDueSoon } from "./services/notify";
import { resolveUploadPath } from "./services/uploads";
import { buildOpenApiSpec } from "./openapi/spec";
import { actionFromHttpPath, renderDocsHtml } from "./openapi/docs";
import { AuthRequiredError, PermissionError, type ActionContext, type ActionResult } from "./ws/context";
import { PUBLIC_ACTIONS, handleWsAction } from "./ws/handlers";
import type {
  WsAction,
  WsBroadcastEvent,
  WsRequestMessage,
  WsResponseMessage,
} from "./ws/protocol";
import { buildSnapshot } from "./ws/snapshot";

export interface WsClientData {
  clientId: string;
  connectedAt: number;
  /** Public origin used for links in emails (validated against allowlist). */
  origin: string;
  user: AuthUserRow | null;
  token: string | null;
  workspaceId: string | null;
}

type Client = BunServerWebSocket<WsClientData>;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Workspace-Id",
};

function originOf(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(
      value.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://"),
    );
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Origins allowed to appear in email links. Configured through APP_PUBLIC_URL,
 * PUBLIC_ORIGINS (comma separated) and NEXT_PUBLIC_WS_URL, plus localhost.
 * Untrusted Origin headers are ignored so password-reset / invite links can
 * not be poisoned to point at another host.
 */
export function getAllowedOrigins(port: number): string[] {
  const configured = [
    process.env.APP_PUBLIC_URL,
    ...(process.env.PUBLIC_ORIGINS || "").split(","),
    process.env.NEXT_PUBLIC_WS_URL,
  ]
    .map((v) => originOf(v?.trim()))
    .filter((v): v is string => Boolean(v));
  const local = [3000, port].flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]);
  return [...new Set([...configured, ...local])];
}

export function resolvePublicOrigin(req: Request, allowed: string[]): string {
  const candidates = [
    req.headers.get("origin"),
    (() => {
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
      const proto = req.headers.get("x-forwarded-proto") || "http";
      return host ? `${proto}://${host}` : null;
    })(),
  ];
  for (const c of candidates) {
    const o = originOf(c);
    if (o && allowed.includes(o)) return o;
  }
  return allowed[0];
}

const decodedAssetCache = new Map<string, { mime: string; bytes: Uint8Array }>();

function tryServeEmbeddedAsset(pathname: string): Response | null {
  const cleanPath = pathname === "/" ? "/index.html" : pathname.replace(/\/+$/, "");
  for (const key of [cleanPath, `${cleanPath}.html`, `${cleanPath}/index.html`]) {
    let cached = decodedAssetCache.get(key);
    if (!cached) {
      const entry = EMBEDDED_ASSETS[key];
      if (entry) {
        cached = { mime: entry.mime, bytes: new Uint8Array(Buffer.from(entry.base64, "base64")) };
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
    const cleanRel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    for (const candidate of [
      path.resolve(normalizedRoot, cleanRel),
      path.resolve(normalizedRoot, `${cleanRel}.html`),
      path.resolve(normalizedRoot, cleanRel, "index.html"),
    ]) {
      if (!candidate.startsWith(normalizedRoot)) continue;
      const f = Bun.file(candidate);
      if (await f.exists()) {
        return new Response(f as unknown as BodyInit, {
          headers: { "Content-Type": f.type || "application/octet-stream" },
        });
      }
    }
  }
  return preferDiskDir ? tryServeEmbeddedAsset(pathname) : null;
}

function send(ws: Client, payload: unknown) {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // socket already closed
  }
}

export async function startServer(options?: {
  hostname?: string;
  port?: number;
  sql?: BunSqlClient;
  autoMigrateAndSeed?: boolean;
  staticDir?: string;
  /** Interval for the due-soon reminder scan; 0 disables it. */
  dueSoonIntervalMs?: number;
}): Promise<BunServer<WsClientData>> {
  const hostname = options?.hostname ?? process.env.APP_SERVER_HOST ?? "0.0.0.0";
  const port = options?.port ?? Number(process.env.APP_SERVER_PORT || 5790);
  const sql = options?.sql ?? getSql();
  const hasExplicitStaticDir = Boolean(options?.staticDir);
  const staticDir = options?.staticDir ?? process.env.STATIC_WEB_DIR ?? path.resolve(process.cwd(), "out");

  if (options?.autoMigrateAndSeed !== false) {
    await ensureDatabaseExists();
    await migrateSchema(sql);
    const [existingUsers] = await sql<{ count: number }>`SELECT COUNT(*)::int AS count FROM users`;
    if ((existingUsers?.count ?? 0) === 0) await seedDatabase(sql);
  }
  const devAccount = await ensureDeveloperAccount(sql);
  if (devAccount.created) {
    console.log(
      `[auth] Developer account created: ${devAccount.email} (password from DEV_ACCOUNT_PASSWORD, default "developer123" — change it).`,
    );
  }

  const clients = new Set<Client>();
  const onlineUserIds = () => {
    const ids = new Set<string>();
    for (const c of clients) if (c.data.user) ids.add(c.data.user.id);
    return ids;
  };
  let allowedOrigins = getAllowedOrigins(port);

  async function pushSnapshot(
    ws: Client,
    event: WsAction | "presence",
    data: unknown,
    cache?: Map<string, string>,
  ) {
    const user = ws.data.user;
    if (!user) return;
    try {
      const key = `${user.id}:${ws.data.workspaceId ?? ""}`;
      let snapshotJson = cache?.get(key);
      if (!snapshotJson) {
        const snapshot = await buildSnapshot(sql, user, ws.data.workspaceId, onlineUserIds());
        ws.data.workspaceId = snapshot.active_workspace_id;
        snapshotJson = JSON.stringify(snapshot);
        cache?.set(key, snapshotJson);
      }
      // Splice the cached JSON so concurrent users share one serialisation.
      ws.send(
        `{"type":"event","event":${JSON.stringify(event)},"data":${JSON.stringify(data ?? null)},"timestamp":${JSON.stringify(new Date().toISOString())},"snapshot":${snapshotJson}}`,
      );
    } catch (err) {
      console.error("[ws] Failed to push snapshot:", err);
    }
  }

  async function membersOf(workspaceIds: string[]): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const wsId of new Set(workspaceIds)) {
      const rows = await sql<{ user_id: string }>`
        SELECT user_id FROM workspace_members WHERE workspace_id = ${wsId}
      `;
      for (const r of rows) ids.add(r.user_id);
    }
    return ids;
  }

  async function broadcast(
    caller: Client | null,
    event: WsAction | "presence",
    data: unknown,
    res: Pick<ActionResult, "workspaceIds" | "userIds" | "platform">,
  ) {
    const targets = new Set<Client>();
    if (caller?.data.user) targets.add(caller);
    const userIds = new Set(res.userIds || []);
    if (res.workspaceIds?.length) {
      for (const id of await membersOf(res.workspaceIds)) userIds.add(id);
    }
    for (const c of clients) {
      const u = c.data.user;
      if (!u) continue;
      if (userIds.has(u.id)) targets.add(c);
      if (res.platform && u.platform_role === "developer") targets.add(c);
    }
    const cache = new Map<string, string>();
    for (const c of targets) await pushSnapshot(c, event, data, cache);
  }

  async function presenceChanged(userId: string) {
    const rows = await sql<{ workspace_id: string }>`
      SELECT workspace_id FROM workspace_members WHERE user_id = ${userId}
    `;
    await broadcast(null, "presence", { user_id: userId }, {
      workspaceIds: rows.map((r) => r.workspace_id),
      platform: true,
    });
  }

  /** Shared by WebSocket and HTTP gateway: session revocation + scoped broadcasts. */
  async function applySideEffects(caller: Client | null, action: WsAction, res: ActionResult) {
    if (res.revokeUserIds?.length) {
      const revoked = new Set(res.revokeUserIds);
      for (const c of clients) {
        if (c === caller || !c.data.user || !revoked.has(c.data.user.id)) continue;
        c.data.user = null;
        c.data.token = null;
        send(c, { type: "event", event: "session:revoked", data: null, timestamp: new Date().toISOString() });
      }
    }
    // Keep in-memory users (name, email, preferences) fresh after profile edits.
    if (res.userIds?.length) {
      const ids = new Set(res.userIds);
      for (const c of clients) {
        if (c.data.user && ids.has(c.data.user.id)) {
          const fresh = await loadAuthUser(sql, c.data.user.id);
          if (fresh) c.data.user = fresh;
        }
      }
    }
    const needsSelfRefresh = Boolean(caller && (res.auth || res.selectWorkspaceId !== undefined));
    if (needsSelfRefresh || res.workspaceIds?.length || res.userIds?.length || res.platform) {
      await broadcast(caller, action, res.result, res);
    }
  }

  /**
   * Stateless HTTP gateway for mobile clients: POST /api/v1/{group}/{name}
   * runs the same handler as the WebSocket action "{group}:{name}".
   */
  async function handleHttpAction(req: Request, action: WsAction): Promise<Response> {
    const json = (status: number, body: unknown) =>
      Response.json(body, { status, headers: CORS_HEADERS });
    let payload: Record<string, unknown> = {};
    try {
      const text = await req.text();
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
    } catch {
      return json(400, { ok: false, error: "Body harus berupa objek JSON" });
    }
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || null;
    const user = token ? await resolveSession(sql, token) : null;
    if (token && !user && !PUBLIC_ACTIONS.has(action)) {
      return json(401, { ok: false, error: "Sesi tidak valid atau sudah berakhir" });
    }
    const ctx: ActionContext = {
      sql,
      user,
      sessionToken: user ? token : null,
      activeWorkspaceId: req.headers.get("x-workspace-id") || null,
      origin: resolvePublicOrigin(req, allowedOrigins),
      onlineUserIds: onlineUserIds(),
    };
    try {
      const res = await handleWsAction(ctx, action, payload);
      await applySideEffects(null, action, res);
      return json(200, { ok: true, action, data: res.result });
    } catch (err) {
      const error = err instanceof Error ? err.message : "Terjadi kesalahan";
      const status = err instanceof AuthRequiredError ? 401 : err instanceof PermissionError ? 403 : 400;
      if (status === 400) console.error(`[http:${action}]`, error);
      return json(status, { ok: false, action, error });
    }
  }

  function isOnlyConnection(userId: string, except: Client) {
    for (const c of clients) if (c !== except && c.data.user?.id === userId) return false;
    return true;
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
            origin: resolvePublicOrigin(req, allowedOrigins),
            user: null,
            token: null,
            workspaceId: null,
          },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400, headers: CORS_HEADERS });
      }

      if (url.pathname === "/openapi.json") {
        return Response.json(buildOpenApiSpec(resolvePublicOrigin(req, allowedOrigins)), { headers: CORS_HEADERS });
      }
      if (url.pathname === "/docs" || url.pathname === "/docs/") {
        return new Response(renderDocsHtml(), {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
        });
      }

      if (url.pathname.startsWith("/api/v1/")) {
        const action = actionFromHttpPath(url.pathname);
        if (!action) return Response.json({ ok: false, error: "Aksi tidak dikenal" }, { status: 404, headers: CORS_HEADERS });
        if (req.method !== "POST") {
          return Response.json({ ok: false, error: "Gunakan POST" }, { status: 405, headers: { ...CORS_HEADERS, Allow: "POST" } });
        }
        return handleHttpAction(req, action);
      }

      if (url.pathname === "/health") {
        return Response.json(
          {
            ok: true,
            service: "projectmanager-bun-ws",
            embeddedAssets: Object.keys(EMBEDDED_ASSETS).length,
            wsPath: "/ws",
            connectedClients: clients.size,
          },
          { headers: CORS_HEADERS },
        );
      }

      if (url.pathname === "/api/snapshot" && req.method === "GET") {
        const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
        const user = await resolveSession(sql, token);
        if (!user) {
          return Response.json(
            { ok: false, error: "Unauthorized" },
            { status: 401, headers: CORS_HEADERS },
          );
        }
        const snapshot = await buildSnapshot(sql, user, url.searchParams.get("workspace_id"), onlineUserIds());
        return Response.json({ ok: true, data: snapshot }, { headers: CORS_HEADERS });
      }

      if (url.pathname.startsWith("/uploads/") && (req.method === "GET" || req.method === "HEAD")) {
        const filePath = resolveUploadPath(url.pathname);
        const file = filePath ? Bun.file(filePath) : null;
        if (file && (await file.exists())) {
          return new Response(file as unknown as BodyInit, {
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "Cache-Control": "private, max-age=86400",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
            },
          });
        }
        return new Response("Not Found", { status: 404 });
      }

      if (req.method === "GET" || req.method === "HEAD") {
        const staticRes = await tryServeStaticFrontend(url.pathname, staticDir, hasExplicitStaticDir);
        if (staticRes) return staticRes;
      }

      return Response.json(
        { ok: false, error: "Not Found", endpoints: ["/health", "/docs", "/openapi.json", "/api/snapshot", "/api/v1/{group}/{action}", "/ws", "/uploads/:id/:name"] },
        { status: 404, headers: CORS_HEADERS },
      );
    },
    websocket: {
      open(ws) {
        clients.add(ws);
        const hello: WsBroadcastEvent = {
          type: "event",
          event: "state:init",
          data: { clientId: ws.data.clientId, authenticated: false },
          timestamp: new Date().toISOString(),
        };
        send(ws, hello);
      },
      async message(ws, raw) {
        let parsed: WsRequestMessage;
        try {
          parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")) as WsRequestMessage;
        } catch {
          send(ws, {
            id: "unknown",
            type: "response",
            ok: false,
            action: "state:init",
            error: "Format pesan JSON tidak valid",
          } satisfies WsResponseMessage);
          return;
        }

        const reqId = parsed.id || crypto.randomUUID();
        const action = parsed.action;
        const wasOnline = ws.data.user?.id ?? null;
        const ctx: ActionContext = {
          sql,
          user: ws.data.user,
          sessionToken: ws.data.token,
          activeWorkspaceId: ws.data.workspaceId,
          origin: ws.data.origin,
          onlineUserIds: onlineUserIds(),
        };

        try {
          const res = await handleWsAction(ctx, action, parsed.payload || {});

          if (res.auth && "logout" in res.auth) {
            ws.data.user = null;
            ws.data.token = null;
            ws.data.workspaceId = null;
          } else if (res.auth) {
            ws.data.user = res.auth.user;
            ws.data.token = res.auth.token;
          }
          if (res.selectWorkspaceId !== undefined) ws.data.workspaceId = res.selectWorkspaceId;

          send(ws, { id: reqId, type: "response", ok: true, action, data: res.result } satisfies WsResponseMessage);
          await applySideEffects(ws, action, res);

          const nowOnline = ws.data.user?.id ?? null;
          if (wasOnline !== nowOnline) {
            if (nowOnline && isOnlyConnection(nowOnline, ws)) await presenceChanged(nowOnline);
            if (wasOnline && isOnlyConnection(wasOnline, ws)) await presenceChanged(wasOnline);
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Terjadi kesalahan";
          if (!(err instanceof PermissionError)) {
            console.error(`[ws:${action}]`, errorMsg);
          }
          send(ws, { id: reqId, type: "response", ok: false, action, error: errorMsg } satisfies WsResponseMessage);
        }
      },
      async close(ws) {
        clients.delete(ws);
        const user = ws.data.user;
        if (user) {
          await sql`UPDATE users SET last_seen_at = now() WHERE id = ${user.id}`.catch(() => undefined);
          let stillOnline = false;
          for (const c of clients) if (c.data.user?.id === user.id) stillOnline = true;
          if (!stillOnline) await presenceChanged(user.id).catch(() => undefined);
        }
      },
    },
  });

  // Port 0 (tests) resolves to a real port only after listen.
  allowedOrigins = getAllowedOrigins(server.port);

  const dueSoonInterval = options?.dueSoonIntervalMs ?? Number(process.env.DUE_SOON_SCAN_MS || 10 * 60_000);
  if (dueSoonInterval > 0) {
    const timer = setInterval(async () => {
      try {
        const workspaces = await scanDueSoon(sql, allowedOrigins[0]);
        if (workspaces.length) await broadcast(null, "presence", null, { workspaceIds: workspaces });
      } catch (err) {
        console.error("[due-soon] scan failed:", err);
      }
    }, dueSoonInterval);
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  return server;
}

if (import.meta.main) {
  void (async () => {
    const srv = await startServer();
    console.log(
      `[bun-server] Listening on http://${srv.hostname}:${srv.port} (WebSocket path /ws, embeddedAssets=${Object.keys(EMBEDDED_ASSETS).length})`,
    );
  })();
}
