import { describe, expect, test } from "bun:test";
import { resolveWsUrl } from "../../lib/ws-url";
import nextConfig from "../../next.config";
import { getAllowedOrigins, resolvePublicOrigin } from "../index";
import {
  activityEmail,
  chatMessageEmail,
  escapeHtml,
  invitationEmail,
  welcomeEmail,
} from "../services/email-templates";
import { dotStuff, encodeHeaderValue } from "../services/smtp";
import { resolveMentions } from "../ws/actions/chat";
import { ACTION_HANDLERS, PUBLIC_ACTIONS } from "../ws/handlers";
import { ACTION_DOCS } from "../openapi/catalog";
import { actionFromHttpPath, httpPathForAction } from "../openapi/docs";
import { buildOpenApiSpec } from "../openapi/spec";

describe("WebSocket URL + dev proxy contract", () => {
  test("browser always connects to same-origin /ws (wss on https)", () => {
    expect(
      resolveWsUrl({ protocol: "https:", host: "projectmanager.edge.autosmartparking.com", search: "" }),
    ).toBe("wss://projectmanager.edge.autosmartparking.com/ws");
    expect(resolveWsUrl({ protocol: "http:", host: "localhost:3000", search: "" })).toBe(
      "ws://localhost:3000/ws",
    );
    expect(resolveWsUrl({ protocol: "http:", host: "x", search: "?ws=ws://y:1/ws" })).toBe("ws://y:1/ws");
  });

  test("next dev rewrites /ws, /api and /uploads to the Bun backend", async () => {
    const rewrites = await (nextConfig.rewrites as () => Promise<{ beforeFiles: { source: string; destination: string }[] }>)();
    const map = Object.fromEntries(rewrites.beforeFiles.map((r) => [r.source, r.destination]));
    expect(map["/ws"]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/ws$/);
    expect(map["/api/:path*"]).toContain("/api/:path*");
    expect(map["/uploads/:path*"]).toContain("/uploads/:path*");
  });

  test("email link origin only trusts allowlisted origins", () => {
    process.env.APP_PUBLIC_URL = "https://pm.example.test";
    const allowed = getAllowedOrigins(5790);
    const req = (headers: Record<string, string>) => new Request("http://internal/ws", { headers });
    expect(resolvePublicOrigin(req({ origin: "https://pm.example.test" }), allowed)).toBe("https://pm.example.test");
    expect(resolvePublicOrigin(req({ origin: "https://evil.example", host: "evil.example" }), allowed)).toBe(
      "https://pm.example.test",
    );
    expect(resolvePublicOrigin(req({ host: "localhost:3000" }), allowed)).toBe("http://localhost:3000");
  });
});

describe("Action registry", () => {
  test("only login/recovery actions are public", () => {
    expect([...PUBLIC_ACTIONS].sort()).toEqual(
      ["auth:login", "auth:resume", "invite:accept", "invite:lookup", "password:reset", "password:reset_request"].sort(),
    );
    expect(typeof ACTION_HANDLERS["dev:create_workspace"]).toBe("function");
    expect(typeof ACTION_HANDLERS["card:toggle_assignee"]).toBe("function");
  });
});

describe("Chat mentions", () => {
  const members = [
    { id: "a", name: "Bu Bos", email: "boss@x.test" },
    { id: "b", name: "Sari Staff", email: "sari@x.test" },
    { id: "c", name: "Sarinah", email: "nah@x.test" },
  ];
  test("matches full name, first name and email local part, not prefixes", () => {
    expect(resolveMentions("tolong @bu bos cek", members)).toEqual(["a"]);
    expect(resolveMentions("@sari ayo", members)).toEqual(["b"]);
    expect(resolveMentions("hai @nah", members)).toEqual(["c"]);
    expect(resolveMentions("tanpa tag", members)).toEqual([]);
  });
  test("@semua mentions everyone except the sender", () => {
    expect(resolveMentions("@semua rapat", members, [], "a").sort()).toEqual(["b", "c"]);
  });
});

describe("Email templates", () => {
  test("escapes user content", () => {
    expect(escapeHtml(`<script>"x"</script>`)).toBe("&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
    const mail = chatMessageEmail({
      recipientName: "A",
      senderName: "<b>Eve</b>",
      roomName: "umum",
      workspaceName: "W",
      content: "<img src=x onerror=alert(1)>",
      mentioned: false,
      isDirect: false,
      url: "https://pm.example.test/?room=1",
    });
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).toContain("&lt;img src=x");
  });

  test("each feature has its own subject and badge", () => {
    const base = { actorName: "Ani", recipientName: "Budi", workspaceName: "PT X", boardName: "Ops", cardTitle: "Stok", url: "u" };
    const subjects = new Set(
      [
        "card_created",
        "card_moved",
        "card_completed",
        "card_assigned",
        "due_changed",
        "checklist_item_done",
        "list_created",
        "board_created",
        "member_joined",
        "member_role_changed",
        "attachment_added",
        "due_soon",
      ].map((action) => activityEmail({ ...base, action, payload: { to_list: "Done", from_list: "Doing" } }).subject),
    );
    expect(subjects.size).toBe(12);
    expect(activityEmail({ ...base, action: "card_moved", payload: { from_list: "A", to_list: "B" } }).html).toContain(
      "Card Dipindah",
    );
  });

  test("invitation and welcome emails describe the create-account flow", () => {
    const inv = invitationEmail({
      inviterName: "Bos",
      workspaceName: "PT X",
      role: "member",
      acceptUrl: "https://pm.example.test/?invite=abc",
      existingUser: false,
      expiresAt: new Date().toISOString(),
    });
    expect(inv.html).toContain("Buat Akun &amp; Bergabung");
    expect(inv.html).toContain("?invite=abc");
    const welcome = welcomeEmail({ name: "Sari", workspaceName: "PT X", role: "member", loginUrl: "u", newAccount: true });
    expect(welcome.html).toContain("Sekarang Anda bisa masuk ke workspace kerja Anda");
  });

  test("SMTP helpers encode UTF-8 subjects and dot-stuff bodies", () => {
    expect(encodeHeaderValue("Hello")).toBe("Hello");
    expect(encodeHeaderValue("Undangan “PT”")).toMatch(/^=\?UTF-8\?B\?/);
    expect(dotStuff("a\n.b\nc")).toBe("a\r\n..b\r\nc");
  });
});

describe("OpenAPI spec", () => {
  test("documents every action exactly once with matching public flags", () => {
    expect(Object.keys(ACTION_DOCS).sort()).toEqual(Object.keys(ACTION_HANDLERS).sort());
    for (const [action, doc] of Object.entries(ACTION_DOCS)) {
      expect(Boolean(doc.public)).toBe(PUBLIC_ACTIONS.has(action as never));
    }
  });

  test("maps actions to /api/v1/{group}/{name} and back", () => {
    expect(httpPathForAction("card:toggle_assignee")).toBe("/api/v1/card/toggle_assignee");
    expect(actionFromHttpPath("/api/v1/card/toggle_assignee")).toBe("card:toggle_assignee");
    expect(actionFromHttpPath("/api/v1/card/nope")).toBeNull();
    expect(actionFromHttpPath("/api/v1/card")).toBeNull();
    expect(actionFromHttpPath("/api/v1/__proto__/x")).toBeNull();
  });

  test("builds a 3.1 document whose $refs all resolve", () => {
    const spec = buildOpenApiSpec("https://pm.example.test");
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.servers[0].url).toBe("https://pm.example.test");
    const paths = spec.paths as Record<string, Record<string, { security?: unknown[] }>>;
    expect(paths["/api/v1/auth/login"].post.security).toEqual([]);
    expect(paths["/api/v1/card/create"].post.security).toEqual([{ bearerAuth: [] }]);
    const refs = [...JSON.stringify(spec).matchAll(/"\$ref":"#\/components\/(\w+)\/(\w+)"/g)];
    expect(refs.length).toBeGreaterThan(50);
    const components = spec.components as unknown as Record<string, Record<string, unknown>>;
    for (const [, kind, name] of refs) expect(components[kind][name]).toBeDefined();
  });
});
