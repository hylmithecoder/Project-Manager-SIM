import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BunServer, BunSqlClient } from "../bun-env";
import { createSqlClient, ensureDatabaseExists } from "../database/postgre";
import { SCHEMA_TABLES, SUPPORT_TABLES, migrateSchema } from "../database/scheme";
import { SEED_IDS, seedDatabase } from "../database/seeder";
import { startServer, type WsClientData } from "../index";
import { flushEmailQueue, setMailTransport } from "../services/mailer";
import type { SendEmailOptions } from "../services/smtp";
import type {
  WorkspaceSnapshot,
  WsAction,
  WsBroadcastEvent,
  WsResponseMessage,
} from "../ws/protocol";

// Isolated database: the suite drops and recreates its schema every run.
const TEST_DB = process.env.TEST_DB_NAME || "projectmanager_test";
process.env.DEV_ACCOUNT_EMAIL = "developer@test.local";
process.env.DEV_ACCOUNT_PASSWORD = "developer-secret";
process.env.APP_PUBLIC_URL = "https://pm.example.test";

const outbox: SendEmailOptions[] = [];

class TestClient {
  ws: WebSocket;
  snapshot: WorkspaceSnapshot | null = null;
  events: WsBroadcastEvent[] = [];
  private seq = 0;
  ready: Promise<void>;

  constructor(url: string, origin?: string) {
    this.ws = new WebSocket(url, origin ? { headers: { Origin: origin } } as never : undefined);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("ws error"));
    });
    this.ws.addEventListener("message", (evt) => {
      const msg = JSON.parse(String((evt as MessageEvent).data));
      if (msg.type === "event") {
        this.events.push(msg);
        if (msg.snapshot) this.snapshot = msg.snapshot;
      }
    });
  }

  request<T = Record<string, unknown>>(action: WsAction, payload: Record<string, unknown> = {}) {
    const id = `req-${++this.seq}`;
    return new Promise<WsResponseMessage<T>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timeout ${action}`)), 15000);
      const listener = (evt: Event) => {
        const msg = JSON.parse(String((evt as MessageEvent).data));
        if (msg.type === "response" && msg.id === id) {
          clearTimeout(timeout);
          this.ws.removeEventListener("message", listener);
          // Give the follow-up snapshot broadcast a moment to arrive.
          setTimeout(() => resolve(msg), 60);
        }
      };
      this.ws.addEventListener("message", listener);
      this.ws.send(JSON.stringify({ id, action, payload }));
    });
  }

  async ok<T = Record<string, unknown>>(action: WsAction, payload: Record<string, unknown> = {}) {
    const res = await this.request<T>(action, payload);
    if (!res.ok) throw new Error(`${action} failed: ${res.error}`);
    return res.data as T;
  }

  close() {
    this.ws.close();
  }
}

function tokenFrom(mail: SendEmailOptions | undefined, param: "invite" | "reset"): string {
  const match = mail?.html.match(new RegExp(`[?&]${param}=([A-Za-z0-9_-]+)`));
  if (!match) throw new Error(`No ${param} link in email "${mail?.subject}"`);
  return match[1];
}

async function drainOutbox() {
  await new Promise((r) => setTimeout(r, 50));
  await flushEmailQueue();
  return outbox.splice(0, outbox.length);
}

describe("Task Board + Chat backend: auth, roles, privacy, notifications", () => {
  let sql: BunSqlClient;
  let server: BunServer<WsClientData>;
  let wsUrl = "";
  let httpBaseUrl = "";
  let tempStaticDir = "";
  const clients: TestClient[] = [];
  const connect = async (origin?: string) => {
    const c = new TestClient(wsUrl, origin);
    clients.push(c);
    await c.ready;
    return c;
  };
  const loginAs = async (email: string, password: string) => {
    const c = await connect();
    await c.ok("auth:login", { email, password });
    return c;
  };

  beforeAll(async () => {
    await ensureDatabaseExists(TEST_DB);
    sql = createSqlClient(TEST_DB);
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    await sql.unsafe("DROP TYPE IF EXISTS workspace_role, board_visibility, board_role, room_type, room_role, message_type CASCADE");
    await migrateSchema(sql);
    await seedDatabase(sql);
    setMailTransport(async (mail) => {
      outbox.push(mail);
      return { ok: true };
    });

    tempStaticDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-static-"));
    fs.writeFileSync(path.join(tempStaticDir, "index.html"), "<!doctype html><html><body>Task Board Static Build</body></html>");
    server = await startServer({
      hostname: "127.0.0.1",
      port: 0,
      sql,
      autoMigrateAndSeed: false,
      staticDir: tempStaticDir,
      dueSoonIntervalMs: 0,
    });
    wsUrl = `ws://127.0.0.1:${server.port}/ws`;
    httpBaseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    for (const c of clients) c.close();
    server?.stop(true);
    setMailTransport(null);
    if (tempStaticDir) fs.rmSync(tempStaticDir, { recursive: true, force: true });
    await sql?.close();
  });

  test("migrates the 21 ERD tables plus auth support tables and keeps the attachments XOR check", async () => {
    const rows = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `;
    const names = rows.map((r) => r.table_name);
    for (const t of [...SCHEMA_TABLES, ...SUPPORT_TABLES]) expect(names).toContain(t);

    let rejected = false;
    try {
      await sql.unsafe(
        `INSERT INTO attachments (uploader_id, card_id, message_id, file_url, file_name, mime_type, size_bytes)
         VALUES ($1, NULL, NULL, '/x', 'x.txt', 'text/plain', 1)`,
        [SEED_IDS.users.hylmi],
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  test("HTTP: /health public, /api/snapshot requires a session token, static UI served", async () => {
    expect((await fetch(`${httpBaseUrl}/health`)).status).toBe(200);
    expect((await fetch(`${httpBaseUrl}/api/snapshot`)).status).toBe(401);

    const c = await connect();
    const { token } = await c.ok<{ token: string }>("auth:login", {
      email: "hylmi@autosmartparking.com",
      password: "password123",
    });
    const snap = await fetch(`${httpBaseUrl}/api/snapshot`, { headers: { Authorization: `Bearer ${token}` } });
    expect(snap.status).toBe(200);
    const body = (await snap.json()) as { data: WorkspaceSnapshot };
    expect(body.data.boards.length).toBeGreaterThanOrEqual(1);

    expect(await (await fetch(`${httpBaseUrl}/`)).text()).toContain("Task Board Static Build");
  });

  test("unauthenticated sockets get no data and cannot run workspace actions", async () => {
    const c = await connect();
    await new Promise((r) => setTimeout(r, 50));
    expect(c.snapshot).toBeNull();
    const res = await c.request("card:create", { list_id: SEED_IDS.lists.todo, title: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/login/i);

    const bad = await c.request("auth:login", { email: "hylmi@autosmartparking.com", password: "wrong" });
    expect(bad.ok).toBe(false);
  });

  test("login + resume bind the socket and return a snapshot scoped to the member", async () => {
    const c = await connect();
    const { token } = await c.ok<{ token: string }>("auth:login", {
      email: "raka@autosmartparking.com",
      password: "password123",
    });
    expect(c.snapshot?.me.email).toBe("raka@autosmartparking.com");
    expect(c.snapshot?.workspaces[0].my_role).toBe("member");
    expect(c.snapshot?.dev).toBeUndefined();

    const c2 = await connect();
    await c2.ok("auth:resume", { token });
    expect(c2.snapshot?.me.id).toBe(SEED_IDS.users.raka);

    await c2.ok("auth:logout");
    const again = await (await connect()).request("auth:resume", { token });
    expect(again.ok).toBe(false);
  });

  test("developer manages accounts but cannot open private workspace content", async () => {
    const dev = await loginAs("developer@test.local", "developer-secret");
    const snap = dev.snapshot!;
    expect(snap.me.platform_role).toBe("developer");
    expect(snap.dev?.accounts.length).toBeGreaterThanOrEqual(4);
    expect(snap.dev?.workspaces.some((w) => w.id === SEED_IDS.workspace)).toBe(true);
    expect(snap.boards).toHaveLength(0);
    expect(snap.messages).toHaveLength(0);
    expect(snap.rooms).toHaveLength(0);

    for (const [action, payload] of [
      ["workspace:select", { workspace_id: SEED_IDS.workspace }],
      ["board:create", { workspace_id: SEED_IDS.workspace, name: "Intip" }],
      ["message:send", { room_id: SEED_IDS.rooms.groupRoom, content: "halo" }],
      ["workspace:invite_member", { workspace_id: SEED_IDS.workspace, email: "x@y.test" }],
    ] as const) {
      const res = await dev.request(action, payload);
      expect(res.ok).toBe(false);
    }

    // Regular users can not use the developer console.
    const owner = await loginAs("hylmi@autosmartparking.com", "password123");
    expect((await owner.request("dev:create_workspace", { name: "X", admin_email: "a@b.test" })).ok).toBe(false);
  });

  test("developer onboards a company: owner invite -> create account form -> welcome + accepted emails", async () => {
    await drainOutbox();
    const dev = await loginAs("developer@test.local", "developer-secret");
    const created = await dev.ok<{ workspace_id: string }>("dev:create_workspace", {
      name: "PT Maju Jaya",
      admin_email: "Boss@MajuJaya.test",
    });
    let mails = await drainOutbox();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("boss@majujaya.test");
    expect(mails[0].subject).toContain("PT Maju Jaya");
    expect(mails[0].html).toMatch(/https?:\/\/[^"]+\/\?invite=/);
    const inviteToken = tokenFrom(mails[0], "invite");

    // No account exists until the invitee fills the form.
    expect(await sql`SELECT 1 FROM users WHERE email = 'boss@majujaya.test'`).toHaveLength(0);

    const guest = await connect();
    const lookup = await guest.ok<{ existing_user: boolean; role: string; workspace_name: string }>(
      "invite:lookup",
      { token: inviteToken },
    );
    expect(lookup.existing_user).toBe(false);
    expect(lookup.role).toBe("owner");
    expect(lookup.workspace_name).toBe("PT Maju Jaya");

    const short = await guest.request("invite:accept", { token: inviteToken, name: "Bu Bos", password: "123" });
    expect(short.ok).toBe(false);

    await guest.ok("invite:accept", { token: inviteToken, name: "Bu Bos", password: "rahasia-kuat" });
    expect(guest.snapshot?.active_workspace_id).toBe(created.workspace_id);
    expect(guest.snapshot?.workspaces[0].my_role).toBe("owner");
    expect(guest.snapshot?.rooms.some((r) => r.name === "Umum")).toBe(true);

    mails = await drainOutbox();
    const welcome = mails.find((m) => m.to === "boss@majujaya.test");
    const accepted = mails.find((m) => m.to === "developer@test.local");
    expect(welcome?.subject).toMatch(/akun Anda berhasil dibuat/i);
    expect(welcome?.html).toContain("bisa masuk ke workspace kerja Anda");
    expect(accepted?.subject).toContain("Bu Bos telah menerima undangan");

    // Token is single use.
    expect((await guest.request("invite:accept", { token: inviteToken, name: "x", password: "rahasia-kuat" })).ok).toBe(false);

    const [ws] = await sql<{ owner_id: string }>`SELECT owner_id FROM workspaces WHERE id = ${created.workspace_id}`;
    expect(ws.owner_id).toBe(guest.snapshot?.me.id);
  });

  test("owner invites a member; member can not invite; chat email preferences are honoured", async () => {
    await drainOutbox();
    const owner = await loginAs("boss@majujaya.test", "rahasia-kuat");
    const wsId = owner.snapshot!.active_workspace_id!;
    await owner.ok("workspace:invite_member", { workspace_id: wsId, email: "staff@majujaya.test", role: "member" });
    const invite = (await drainOutbox()).find((m) => m.to === "staff@majujaya.test");
    const staff = await connect();
    await staff.ok("invite:accept", { token: tokenFrom(invite, "invite"), name: "Sari Staff", password: "staff-pass-1" });
    let mails = await drainOutbox();
    expect(mails.find((m) => m.to === "staff@majujaya.test")?.subject).toMatch(/akun Anda berhasil dibuat/i);
    expect(mails.find((m) => m.to === "boss@majujaya.test")?.subject).toContain("Sari Staff telah menerima undangan");

    const denied = await staff.request("workspace:invite_member", { workspace_id: wsId, email: "z@majujaya.test" });
    expect(denied.ok).toBe(false);

    const general = staff.snapshot!.rooms.find((r) => r.name === "Umum")!;
    // 1) Untagged message -> owner gets the chat email (default on).
    await staff.ok("message:send", { room_id: general.id, content: "Selamat pagi tim" });
    mails = await drainOutbox();
    const chatMail = mails.find((m) => m.to === "boss@majujaya.test");
    expect(chatMail?.subject).toContain("Pesan baru dari Sari Staff");
    expect(chatMail?.html).toContain("Selamat pagi tim");

    // 2) Owner disables "all chat" emails -> untagged messages stop.
    await owner.ok("account:update_preferences", { notify_chat_email: false });
    await staff.ok("message:send", { room_id: general.id, content: "Pesan tanpa tag" });
    expect((await drainOutbox()).filter((m) => m.to === "boss@majujaya.test")).toHaveLength(0);

    // 3) Mentions still arrive (separate preference) + in-app notification.
    const sent = await staff.ok<{ mention_ids: string[] }>("message:send", {
      room_id: general.id,
      content: "Tolong cek @Bu Bos",
    });
    expect(sent.mention_ids).toContain(owner.snapshot!.me.id);
    mails = await drainOutbox();
    expect(mails.find((m) => m.to === "boss@majujaya.test")?.subject).toContain("menyebut Anda");
    expect(owner.snapshot!.notifications.some((n) => n.type === "mention")).toBe(true);

    // 4) Workspace-level switch disables chat emails for everyone.
    await owner.ok("account:update_preferences", { notify_chat_email: true });
    await owner.ok("workspace:update_settings", { workspace_id: wsId, email_chat_enabled: false });
    await drainOutbox();
    await staff.ok("message:send", { room_id: general.id, content: "Diam-diam" });
    expect((await drainOutbox()).filter((m) => m.to === "boss@majujaya.test")).toHaveLength(0);
    await owner.ok("workspace:update_settings", { workspace_id: wsId, email_chat_enabled: true });

    // Read receipts: owner opens the room -> staff sees read_by.
    await owner.ok("message:mark_read", { room_id: general.id });
    await new Promise((r) => setTimeout(r, 100));
    const last = staff.snapshot!.messages.filter((m) => m.room_id === general.id && m.sender_id === staff.snapshot!.me.id).at(-1);
    expect(last?.read_by).toContain(owner.snapshot!.me.id);
  }, 30000);

  test("task board activity sends feature-specific emails and respects privacy across workspaces", async () => {
    await drainOutbox();
    const owner = await loginAs("boss@majujaya.test", "rahasia-kuat");
    const staff = await loginAs("staff@majujaya.test", "staff-pass-1");
    const wsId = owner.snapshot!.active_workspace_id!;
    const staffId = staff.snapshot!.me.id;

    const board = await owner.ok<{ id: string }>("board:create", { workspace_id: wsId, name: "Proyek Gudang" });
    let mails = await drainOutbox();
    expect(mails.find((m) => m.to === "staff@majujaya.test")?.subject).toContain("Board baru: Proyek Gudang");

    const todo = owner.snapshot!.lists.find((l) => l.board_id === board.id && l.name === "To Do")!;
    const doing = owner.snapshot!.lists.find((l) => l.board_id === board.id && l.name === "Doing")!;
    const card = await owner.ok<{ id: string }>("card:create", {
      list_id: todo.id,
      title: "Hitung stok",
      assignee_ids: [staffId],
      due_at: new Date(Date.now() + 3 * 3600_000).toISOString(),
    });
    mails = (await drainOutbox()).filter((m) => m.to === "staff@majujaya.test");
    expect(mails.some((m) => m.subject.includes('Card baru: "Hitung stok"'))).toBe(true);
    expect(mails.some((m) => m.subject.includes("Tugas untuk Sari Staff"))).toBe(true);
    expect(staff.snapshot!.notifications.some((n) => n.type === "assigned")).toBe(true);

    await staff.ok("card:move", { card_id: card.id, target_list_id: doing.id, target_index: 0 });
    mails = await drainOutbox();
    expect(mails.find((m) => m.to === "boss@majujaya.test")?.subject).toContain("dipindah ke Doing");
    // The actor never emails themselves.
    expect(mails.filter((m) => m.to === "staff@majujaya.test")).toHaveLength(0);

    const checklist = await staff.ok<{ id: string }>("checklist:create", { card_id: card.id, title: "Langkah" });
    const item = await staff.ok<{ id: string }>("checklist:add_item", { checklist_id: checklist.id, content: "Rak A" });
    await staff.ok("checklist:toggle_item", { item_id: item.id });
    mails = await drainOutbox();
    expect(mails.some((m) => m.subject.includes('Checklist "Rak A" selesai'))).toBe(true);

    // The task event is mirrored into the board chat room.
    const boardRoom = owner.snapshot!.rooms.find((r) => r.board_id === board.id)!;
    expect(owner.snapshot!.messages.some((m) => m.room_id === boardRoom.id && m.type === "task_event")).toBe(true);

    // Users of another company can not touch this workspace.
    const outsider = await loginAs("raka@autosmartparking.com", "password123");
    expect(outsider.snapshot!.workspaces.some((w) => w.id === wsId)).toBe(false);
    expect((await outsider.request("message:send", { room_id: boardRoom.id, content: "intip" })).ok).toBe(false);
    expect((await outsider.request("card:update", { card_id: card.id, title: "hack" })).ok).toBe(false);

    // Private board: hidden from workspace members who are not board members.
    const secret = await owner.ok<{ id: string }>("board:create", {
      workspace_id: wsId,
      name: "Rahasia Direksi",
      visibility: "private",
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(staff.snapshot!.boards.some((b) => b.id === secret.id)).toBe(false);
    expect((await staff.request("list:create", { board_id: secret.id, name: "x" })).ok).toBe(false);

    // Due-soon reminders are emailed once to the assignee.
    const { scanDueSoon } = await import("../services/notify");
    await drainOutbox();
    await scanDueSoon(sql, "https://pm.example.test");
    await scanDueSoon(sql, "https://pm.example.test");
    mails = (await drainOutbox()).filter((m) => m.subject.includes("Pengingat"));
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("staff@majujaya.test");
  }, 30000);

  test("password reset by email and developer account deactivation", async () => {
    await drainOutbox();
    const anon = await connect();
    // Unknown emails get the same answer (no account enumeration).
    expect((await anon.request("password:reset_request", { email: "nobody@x.test" })).ok).toBe(true);
    await anon.ok("password:reset_request", { email: "staff@majujaya.test" });
    const mails = await drainOutbox();
    expect(mails).toHaveLength(1);
    await anon.ok("password:reset", { token: tokenFrom(mails[0], "reset"), password: "staff-pass-2" });
    expect((await (await connect()).request("auth:login", { email: "staff@majujaya.test", password: "staff-pass-1" })).ok).toBe(false);
    const staff = await loginAs("staff@majujaya.test", "staff-pass-2");

    const dev = await loginAs("developer@test.local", "developer-secret");
    await dev.ok("dev:set_user_active", { user_id: staff.snapshot!.me.id, active: false });
    await new Promise((r) => setTimeout(r, 100));
    expect(staff.events.some((e) => e.event === "session:revoked")).toBe(true);
    const blocked = await (await connect()).request("auth:login", { email: "staff@majujaya.test", password: "staff-pass-2" });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/dinonaktifkan/);
    await dev.ok("dev:set_user_active", { user_id: staff.snapshot!.me.id, active: true });
  }, 30000);

  test("email links ignore untrusted Origin headers (no reset-link poisoning)", async () => {
    await drainOutbox();
    const evil = await connect("https://evil.example");
    await evil.ok("password:reset_request", { email: "boss@majujaya.test" });
    const [mail] = await drainOutbox();
    // Falls back to the trusted request host (here 127.0.0.1) or APP_PUBLIC_URL.
    expect(mail.html).toMatch(/href="(https:\/\/pm\.example\.test|http:\/\/127\.0\.0\.1:\d+)\/\?reset=/);
    expect(mail.html).not.toContain("evil.example");
  });
  test("developer edits and permanently deletes accounts without losing company data", async () => {
    await drainOutbox();
    const dev = await loginAs("developer@test.local", "developer-secret");
    const staffAcc = dev.snapshot!.dev!.accounts.find((a) => a.email === "staff@majujaya.test")!;
    const bossAcc = dev.snapshot!.dev!.accounts.find((a) => a.email === "boss@majujaya.test")!;

    // Regular users can not edit/delete accounts; developers can not be edited from the console.
    const owner = await loginAs("boss@majujaya.test", "rahasia-kuat");
    expect((await owner.request("dev:update_user", { user_id: staffAcc.id, name: "X" })).ok).toBe(false);
    const devId = dev.snapshot!.me.id;
    expect((await dev.request("dev:delete_user", { user_id: devId, confirm_email: "developer@test.local" })).ok).toBe(false);

    // Edit: duplicate email rejected, valid change notifies old + new address.
    expect((await dev.request("dev:update_user", { user_id: staffAcc.id, email: "boss@majujaya.test" })).ok).toBe(false);
    await dev.ok("dev:update_user", { user_id: staffAcc.id, name: "Sari Gudang", email: "sari@majujaya.test" });
    const mails = await drainOutbox();
    expect(mails.map((m) => m.to).sort()).toEqual(["sari@majujaya.test", "staff@majujaya.test"]);
    expect(dev.snapshot!.dev!.accounts.find((a) => a.id === staffAcc.id)?.name).toBe("Sari Gudang");
    const staff = await loginAs("sari@majujaya.test", "staff-pass-2");
    expect(staff.snapshot!.me.name).toBe("Sari Gudang");

    // Delete requires typing the email.
    expect((await dev.request("dev:delete_user", { user_id: bossAcc.id, confirm_email: "salah@x.test" })).ok).toBe(false);
    const wsId = bossAcc.memberships[0].workspace_id;
    const [boardsBefore] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM boards WHERE workspace_id = ${wsId}`;
    await dev.ok("dev:delete_user", { user_id: bossAcc.id, confirm_email: "BOSS@majujaya.test" });
    await new Promise((r) => setTimeout(r, 100));

    expect(owner.events.some((e) => e.event === "session:revoked")).toBe(true);
    expect(await sql`SELECT 1 FROM users WHERE id = ${bossAcc.id}`).toHaveLength(0);
    const [ws] = await sql<{ owner_id: string | null }>`SELECT owner_id FROM workspaces WHERE id = ${wsId}`;
    expect(ws.owner_id).toBeNull();
    const [boardsAfter] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM boards WHERE workspace_id = ${wsId}`;
    expect(boardsAfter.n).toBe(boardsBefore.n);
    const reassigned = await sql<{ created_by: string }>`SELECT created_by FROM boards WHERE workspace_id = ${wsId}`;
    expect(reassigned.every((b) => b.created_by === staffAcc.id)).toBe(true);
    expect(dev.snapshot!.dev!.accounts.some((a) => a.id === bossAcc.id)).toBe(false);
  }, 30000);
  test("HTTP gateway + public docs: /docs, /openapi.json, POST /api/v1/{group}/{action}", async () => {
    const docs = await fetch(`${httpBaseUrl}/docs`);
    expect(docs.status).toBe(200);
    expect(await docs.text()).toContain("/openapi.json");
    const spec = (await (await fetch(`${httpBaseUrl}/openapi.json`)).json()) as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/api/v1/message/send"]).toBeDefined();

    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${httpBaseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });

    expect((await post("/api/v1/card/create", { list_id: SEED_IDS.lists.todo, title: "x" })).status).toBe(401);
    expect((await post("/api/v1/card/unknown", {})).status).toBe(404);
    expect((await fetch(`${httpBaseUrl}/api/v1/auth/login`)).status).toBe(405);
    expect((await post("/api/v1/auth/login", { email: "raka@autosmartparking.com", password: "salah" })).status).toBe(400);

    const login = (await (await post("/api/v1/auth/login", { email: "raka@autosmartparking.com", password: "password123" })).json()) as {
      ok: boolean;
      data: { token: string };
    };
    expect(login.ok).toBe(true);
    const auth = { Authorization: `Bearer ${login.data.token}`, "X-Workspace-Id": SEED_IDS.workspace };

    const snap = (await (await post("/api/v1/state/init", {}, auth)).json()) as { data: WorkspaceSnapshot };
    expect(snap.data.active_workspace_id).toBe(SEED_IDS.workspace);

    // Member (raka) may not invite -> 403; WebSocket clients receive HTTP-made changes in realtime.
    expect((await post("/api/v1/workspace/invite_member", { email: "a@b.test" }, auth)).status).toBe(403);
    const watcher = await loginAs("hylmi@autosmartparking.com", "password123");
    const before = watcher.events.length;
    const sent = await post("/api/v1/message/send", { room_id: SEED_IDS.rooms.groupRoom, content: "Halo dari Expo" }, auth);
    expect(sent.status).toBe(200);
    await new Promise((r) => setTimeout(r, 150));
    expect(watcher.events.length).toBeGreaterThan(before);
    expect(watcher.snapshot!.messages.some((m) => m.content === "Halo dari Expo")).toBe(true);

    expect((await post("/api/v1/auth/logout", {}, auth)).status).toBe(200);
    expect((await post("/api/v1/state/init", {}, auth)).status).toBe(401);
    await drainOutbox();
  }, 30000);
});
