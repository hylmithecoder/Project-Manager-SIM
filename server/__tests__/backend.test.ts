import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BunServer } from "../bun-env";
import { closeSql, ensureDatabaseExists, getSql } from "../database/postgre";
import { migrateSchema, SCHEMA_TABLES } from "../database/scheme";
import { SEED_IDS, seedDatabase } from "../database/seeder";
import { startServer, type WsClientData } from "../index";
import type {
  WsBroadcastEvent,
  WsRequestMessage,
  WsResponseMessage,
} from "../ws/protocol";

describe("PostgreSQL ERD Schema, Seeder & Bun WebSocket CRUD Server", () => {
  let server: BunServer<WsClientData>;
  let wsUrl = "";
  let httpBaseUrl = "";
  let tempStaticDir = "";

  beforeAll(async () => {
    await ensureDatabaseExists();
    const sql = getSql();
    await migrateSchema(sql);
    await seedDatabase(sql);

    tempStaticDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-static-"));
    fs.writeFileSync(
      path.join(tempStaticDir, "index.html"),
      "<!doctype html><html><body>Task Board Static Build</body></html>",
    );

    server = await startServer({
      hostname: "127.0.0.1",
      port: 0,
      sql,
      autoMigrateAndSeed: false,
      staticDir: tempStaticDir,
    });
    wsUrl = `ws://127.0.0.1:${server.port}/ws`;
    httpBaseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    if (server) {
      server.stop(true);
    }
    if (tempStaticDir) {
      fs.rmSync(tempStaticDir, { recursive: true, force: true });
    }
    await closeSql();
  });

  test("creates all 21 ERD tables and enforces attachments XOR CHECK constraint", async () => {
    const sql = getSql();
    const rows = await sql<{ table_name: string }>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `;
    const tableNames = rows.map((r) => r.table_name);

    for (const expectedTable of SCHEMA_TABLES) {
      expect(tableNames).toContain(expectedTable);
    }

    const constraints = await sql<{ conname: string }>`
      SELECT conname
      FROM pg_constraint
      WHERE conname = 'chk_attachments_card_or_message_xor'
    `;
    expect(constraints.length).toBe(1);

    let checkConstraintTriggered = false;
    try {
      await sql.unsafe(
        `INSERT INTO attachments (uploader_id, card_id, message_id, file_url, file_name, mime_type, size_bytes)
         VALUES ($1, NULL, NULL, '/invalid', 'invalid.txt', 'text/plain', 10)`,
        [SEED_IDS.users.hylmi],
      );
    } catch {
      checkConstraintTriggered = true;
    }
    expect(checkConstraintTriggered).toBe(true);
  });

  test("exposes /health, /api/snapshot, and static frontend HTML on GET /", async () => {
    const healthRes = await fetch(`${httpBaseUrl}/health`);
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as { ok: boolean };
    expect(healthJson.ok).toBe(true);

    const snapRes = await fetch(`${httpBaseUrl}/api/snapshot`);
    expect(snapRes.status).toBe(200);
    const snapJson = (await snapRes.json()) as {
      ok: boolean;
      data: { users: unknown[]; boards: unknown[]; cards: unknown[] };
    };
    expect(snapJson.ok).toBe(true);
    expect(snapJson.data.users.length).toBeGreaterThanOrEqual(3);
    expect(snapJson.data.boards.length).toBeGreaterThanOrEqual(1);
    expect(snapJson.data.cards.length).toBeGreaterThanOrEqual(3);

    const rootRes = await fetch(`${httpBaseUrl}/`);
    expect(rootRes.status).toBe(200);
    const rootHtml = await rootRes.text();
    expect(rootHtml).toContain("Task Board Static Build");
  });

  test("performs WebSocket CRUD (card:create, card:move, message:send, card:from_message) and emits task_event messages", async () => {
    const ws = new WebSocket(wsUrl);

    const sendRequest = <T = Record<string, unknown>>(
      req: WsRequestMessage,
    ): Promise<WsResponseMessage<T>> =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Timeout waiting for ${req.action}`)),
          15000,
        );
        const listener = (evt: MessageEvent) => {
          const parsed = JSON.parse(String(evt.data)) as
            | WsResponseMessage<T>
            | WsBroadcastEvent;
          if ("id" in parsed && parsed.id === req.id) {
            clearTimeout(timeout);
            ws.removeEventListener("message", listener);
            resolve(parsed);
          }
        };
        ws.addEventListener("message", listener);
        ws.send(JSON.stringify(req));
      });

    const initEvent = await new Promise<WsBroadcastEvent>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timeout waiting for initial snapshot")),
        5000,
      );
      ws.onmessage = (evt) => {
        const parsed = JSON.parse(String(evt.data)) as WsBroadcastEvent;
        if (parsed.type === "event" && parsed.event === "state:init") {
          clearTimeout(timeout);
          resolve(parsed);
        }
      };
    });

    expect(initEvent.snapshot.boards.length).toBeGreaterThanOrEqual(1);

    const createCardRes = await sendRequest<{ id: string; title: string }>({
      id: "req-card-create",
      action: "card:create",
      payload: {
        board_id: SEED_IDS.board,
        list_id: SEED_IDS.lists.todo,
        title: "Card Uji WebSocket",
        description: "Dibuat lewat test WebSocket",
      },
    });
    expect(createCardRes.ok).toBe(true);
    const createdCardId = createCardRes.data?.id;
    expect(createdCardId).toBeDefined();

    const moveRes = await sendRequest<{ id: string; list_id: string }>({
      id: "req-card-move",
      action: "card:move",
      payload: {
        card_id: createdCardId,
        target_list_id: SEED_IDS.lists.doing,
      },
    });
    expect(moveRes.ok).toBe(true);
    expect(moveRes.data?.list_id).toBe(SEED_IDS.lists.doing);

    const msgRes = await sendRequest<{ id: string; content: string }>({
      id: "req-msg-send",
      action: "message:send",
      payload: {
        room_id: SEED_IDS.rooms.boardRoom,
        content: "Tolong buatkan fitur export laporan mingguan",
      },
    });
    expect(msgRes.ok).toBe(true);
    const sentMsgId = msgRes.data?.id;
    expect(sentMsgId).toBeDefined();

    const fromMsgRes = await sendRequest<{
      id: string;
      source_message_id: string;
    }>({
      id: "req-card-from-msg",
      action: "card:from_message",
      payload: {
        message_id: sentMsgId,
        board_id: SEED_IDS.board,
        list_id: SEED_IDS.lists.todo,
      },
    });
    expect(fromMsgRes.ok).toBe(true);
    expect(fromMsgRes.data?.source_message_id).toBe(sentMsgId);

    const sql = getSql();
    if (createdCardId) {
      await sql`DELETE FROM cards WHERE id = ${createdCardId}`;
    }
    if (fromMsgRes.data?.id) {
      await sql`DELETE FROM cards WHERE id = ${fromMsgRes.data.id}`;
    }
    if (sentMsgId) {
      await sql`DELETE FROM messages WHERE id = ${sentMsgId}`;
    }
    await sql`
      DELETE FROM messages
      WHERE type = 'task_event'
        AND (
          content LIKE '%Card Uji WebSocket%'
          OR content LIKE '%Tolong buatkan fitur export laporan mingguan%'
        )
    `;

    // 4. Invite a new user via email (creates user as regular member if non-existent)
    const testInviteEmail = `invitee_${Date.now()}@gmail.com`;
    const inviteRes = await sendRequest<{
      user_id: string;
      email: string;
      name: string;
      role: string;
      is_new_user: boolean;
    }>({
      id: "req-invite-member",
      action: "workspace:invite_member",
      payload: {
        workspace_id: SEED_IDS.workspace,
        email: testInviteEmail,
        name: "Anggota Baru Dari Gmail",
        role: "member",
      },
    });
    expect(inviteRes.ok).toBe(true);
    expect(inviteRes.data?.is_new_user).toBe(true);
    expect(inviteRes.data?.role).toBe("member");

    // Verify user exists in database and in workspace_members
    const [invitedDbUser] = await sql<{ id: string; email: string }>`
      SELECT id, email FROM users WHERE LOWER(email) = ${testInviteEmail}
    `;
    expect(invitedDbUser).toBeDefined();
    expect(invitedDbUser.email).toBe(testInviteEmail);

    const [memberDbRow] = await sql<{ role: string }>`
      SELECT role FROM workspace_members
      WHERE workspace_id = ${SEED_IDS.workspace} AND user_id = ${invitedDbUser.id}
    `;
    expect(memberDbRow.role).toBe("member");

    // 5. Admin updates member role
    const updateRoleRes = await sendRequest<{ role: string }>({
      id: "req-update-role",
      action: "admin:update_member_role",
      payload: {
        workspace_id: SEED_IDS.workspace,
        user_id: invitedDbUser.id,
        role: "admin",
      },
    });
    expect(updateRoleRes.ok).toBe(true);
    expect(updateRoleRes.data?.role).toBe("admin");

    // 6. Admin toggles room permission only_admins_can_send
    const togglePermRes = await sendRequest<{ only_admins_can_send: boolean }>({
      id: "req-toggle-perm",
      action: "admin:toggle_room_permission",
      payload: {
        room_id: SEED_IDS.rooms.boardRoom,
        only_admins_can_send: true,
      },
    });
    expect(togglePermRes.ok).toBe(true);
    expect(togglePermRes.data?.only_admins_can_send).toBe(true);

    // Reset room permission back to false
    await sendRequest({
      id: "req-reset-perm",
      action: "admin:toggle_room_permission",
      payload: {
        room_id: SEED_IDS.rooms.boardRoom,
        only_admins_can_send: false,
      },
    });

    // Cleanup invited user
    await sql`DELETE FROM workspace_members WHERE user_id = ${invitedDbUser.id}`;
    await sql`DELETE FROM room_members WHERE user_id = ${invitedDbUser.id}`;
    await sql`DELETE FROM users WHERE id = ${invitedDbUser.id}`;

    await new Promise<void>((resolve) => {
      ws.onclose = () => resolve();
      ws.close();
    });
  }, 25000);
});
