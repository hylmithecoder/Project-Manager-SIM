import { notifyActivity, notifyChatMessage } from "../../services/notify";
import type { ActionContext, ActionResult } from "../context";
import {
  MANAGER_ROLES,
  PermissionError,
  WRITER_ROLES,
  getWorkspaceRole,
  optionalId,
  requireRoomMember,
  requireUser,
  requireWorkspaceRole,
  str,
} from "../context";

const MAX_MESSAGE_LENGTH = 4000;

/**
 * Resolves mentions from explicit ids plus "@Nama Lengkap", "@namadepan",
 * "@email-local-part" and "@semua"/"@all" in the text. Only room members can
 * be mentioned.
 */
export function resolveMentions(
  content: string,
  members: { id: string; name: string; email: string }[],
  explicitIds: string[] = [],
  senderId?: string,
): string[] {
  const text = content.toLowerCase();
  const ids = new Set(explicitIds.filter((id) => members.some((m) => m.id === id)));
  const everyone = /(^|\s)@(semua|all|everyone)\b/.test(text);
  for (const m of members) {
    const name = m.name.toLowerCase();
    const first = name.split(/\s+/)[0];
    const local = m.email.toLowerCase().split("@")[0];
    const hit = (token: string) => {
      if (!token) return false;
      const idx = text.indexOf(`@${token}`);
      if (idx < 0) return false;
      const after = text.charAt(idx + token.length + 1);
      return !after || !/[a-z0-9_]/.test(after);
    };
    if (everyone || hit(name) || hit(first) || hit(local)) ids.add(m.id);
  }
  if (senderId) ids.delete(senderId);
  return [...ids];
}

async function assertMembers(ctx: ActionContext, workspaceId: string, ids: string[]) {
  for (const id of ids) {
    if (!(await getWorkspaceRole(ctx.sql, workspaceId, id))) {
      throw new Error("Semua anggota ruang chat harus anggota workspace");
    }
  }
}

function idList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === "string" && Boolean(v)))]
    : [];
}

export async function createRoom(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const workspaceId = str(payload.workspace_id) || ctx.activeWorkspaceId || "";
  const { user } = await requireWorkspaceRole(ctx, workspaceId, WRITER_ROLES);
  const name = str(payload.name);
  if (!name) throw new Error("Nama ruang chat wajib diisi");
  const memberIds = idList(payload.member_ids).filter((id) => id !== user.id);
  await assertMembers(ctx, workspaceId, memberIds);

  const room = await ctx.sql.begin(async (tx) => {
    const [created] = await tx<{ id: string; name: string }>`
      INSERT INTO rooms (workspace_id, type, name, only_admins_can_send, created_by)
      VALUES (${workspaceId}, 'group', ${name.slice(0, 100)}, false, ${user.id})
      RETURNING id, name
    `;
    await tx`INSERT INTO room_members (room_id, user_id, role) VALUES (${created.id}, ${user.id}, 'admin')`;
    for (const id of memberIds) {
      await tx`INSERT INTO room_members (room_id, user_id, role) VALUES (${created.id}, ${id}, 'member') ON CONFLICT DO NOTHING`;
    }
    await tx`
      INSERT INTO messages (room_id, sender_id, type, content)
      VALUES (${created.id}, NULL, 'system', ${`${user.name} membuat ruang chat "${created.name}"`})
    `;
    return created;
  });
  await notifyActivity(
    ctx.sql,
    ctx.origin,
    { workspaceId, boardId: null, actorId: user.id, action: "room_created", payload: { room_name: room.name } },
    { onlyUserIds: memberIds },
  );
  return { result: room, workspaceIds: [workspaceId] };
}

export async function openDirectRoom(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const workspaceId = str(payload.workspace_id) || ctx.activeWorkspaceId || "";
  const { user } = await requireWorkspaceRole(ctx, workspaceId);
  const otherId = str(payload.user_id);
  if (!otherId || otherId === user.id) throw new Error("Pilih anggota lain untuk pesan langsung");
  await assertMembers(ctx, workspaceId, [otherId]);

  const roomId = await ctx.sql.begin(async (tx) => {
    const [existing] = await tx<{ id: string }>`
      SELECT r.id FROM rooms r
      WHERE r.workspace_id = ${workspaceId} AND r.type = 'direct'
        AND EXISTS (SELECT 1 FROM room_members a WHERE a.room_id = r.id AND a.user_id = ${user.id})
        AND EXISTS (SELECT 1 FROM room_members b WHERE b.room_id = r.id AND b.user_id = ${otherId})
        AND (SELECT COUNT(*) FROM room_members c WHERE c.room_id = r.id) = 2
      LIMIT 1
    `;
    if (existing) return existing.id;
    const [room] = await tx<{ id: string }>`
      INSERT INTO rooms (workspace_id, type, name, only_admins_can_send, created_by)
      VALUES (${workspaceId}, 'direct', NULL, false, ${user.id})
      RETURNING id
    `;
    await tx`
      INSERT INTO room_members (room_id, user_id, role)
      VALUES (${room.id}, ${user.id}, 'member'), (${room.id}, ${otherId}, 'member')
    `;
    return room.id;
  });
  return { result: { room_id: roomId }, workspaceIds: [workspaceId] };
}

export async function addRoomMembers(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, role, room, roomRole } = await requireRoomMember(ctx, str(payload.room_id));
  if (room.type !== "group" && room.type !== "card") {
    throw new Error("Anggota hanya bisa ditambahkan ke ruang grup atau thread card");
  }
  if (roomRole !== "admin" && !MANAGER_ROLES.includes(role)) {
    throw new PermissionError("Hanya admin ruang chat yang dapat menambah anggota");
  }
  const ids = idList(payload.member_ids);
  await assertMembers(ctx, room.workspace_id, ids);
  for (const id of ids) {
    await ctx.sql`INSERT INTO room_members (room_id, user_id, role) VALUES (${room.id}, ${id}, 'member') ON CONFLICT DO NOTHING`;
  }
  await notifyActivity(
    ctx.sql,
    ctx.origin,
    {
      workspaceId: room.workspace_id,
      boardId: null,
      actorId: user.id,
      action: "room_created",
      payload: { room_name: room.name || "chat" },
    },
    { onlyUserIds: ids },
  );
  return { result: { room_id: room.id, added: ids }, workspaceIds: [room.workspace_id] };
}

export async function leaveRoom(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, room } = await requireRoomMember(ctx, str(payload.room_id));
  if (room.type === "board") throw new Error("Ruang board mengikuti keanggotaan board");
  await ctx.sql`DELETE FROM room_members WHERE room_id = ${room.id} AND user_id = ${user.id}`;
  return { result: { room_id: room.id }, workspaceIds: [room.workspace_id] };
}

export async function muteRoom(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, room } = await requireRoomMember(ctx, str(payload.room_id));
  const minutes = Number(payload.minutes);
  const until = Number.isFinite(minutes) && minutes > 0 ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
  await ctx.sql`UPDATE room_members SET muted_until = ${until} WHERE room_id = ${room.id} AND user_id = ${user.id}`;
  return { result: { room_id: room.id, muted_until: until }, userIds: [user.id] };
}

export async function sendMessage(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, role, room, roomRole } = await requireRoomMember(ctx, str(payload.room_id));
  if (room.only_admins_can_send && roomRole !== "admin" && !MANAGER_ROLES.includes(role)) {
    throw new PermissionError("Hanya admin yang dapat mengirim pesan di ruang ini");
  }
  const content = str(payload.content);
  if (!content) throw new Error("Pesan tidak boleh kosong");
  if (content.length > MAX_MESSAGE_LENGTH) throw new Error("Pesan terlalu panjang");
  const replyToId = optionalId(payload.reply_to_id);
  if (replyToId) {
    const ok = await ctx.sql`SELECT 1 FROM messages WHERE id = ${replyToId} AND room_id = ${room.id}`;
    if (ok.length === 0) throw new Error("Pesan yang dibalas tidak ditemukan");
  }
  const cardId = optionalId(payload.card_id);
  if (cardId) {
    const ok = await ctx.sql`
      SELECT 1 FROM cards c INNER JOIN boards b ON b.id = c.board_id
      WHERE c.id = ${cardId} AND b.workspace_id = ${room.workspace_id}
    `;
    if (ok.length === 0) throw new Error("Card rujukan tidak ditemukan");
  }

  const members = await ctx.sql<{ id: string; name: string; email: string }>`
    SELECT u.id, u.name, u.email FROM room_members rm
    INNER JOIN users u ON u.id = rm.user_id WHERE rm.room_id = ${room.id}
  `;
  const mentionIds = resolveMentions(content, members, idList(payload.mention_ids), user.id);

  const msg = await ctx.sql.begin(async (tx) => {
    const [created] = await tx<{ id: string; room_id: string; sender_id: string; content: string; created_at: string }>`
      INSERT INTO messages (room_id, sender_id, type, content, reply_to_id, card_id)
      VALUES (${room.id}, ${user.id}, 'text', ${content}, ${replyToId}, ${cardId})
      RETURNING id, room_id, sender_id, content, card_id, created_at::text AS created_at
    `;
    for (const id of mentionIds) {
      await tx`INSERT INTO message_mentions (message_id, user_id) VALUES (${created.id}, ${id})`;
    }
    await tx`
      INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at)
      VALUES (${created.id}, ${user.id}, now(), now())
    `;
    // Delivered tick for members connected right now.
    for (const m of members) {
      if (m.id !== user.id && ctx.onlineUserIds.has(m.id)) {
        await tx`
          INSERT INTO message_receipts (message_id, user_id, delivered_at)
          VALUES (${created.id}, ${m.id}, now()) ON CONFLICT DO NOTHING
        `;
      }
    }
    await tx`UPDATE room_members SET last_read_message_id = ${created.id} WHERE room_id = ${room.id} AND user_id = ${user.id}`;
    return created;
  });

  const fanout = await notifyChatMessage(ctx.sql, ctx.origin, msg.id);
  return {
    result: { ...msg, mention_ids: mentionIds, emailed: fanout.emailed.length },
    workspaceIds: [room.workspace_id],
  };
}

async function loadOwnMessage(ctx: ActionContext, messageId: string) {
  const [msg] = await ctx.sql<{ id: string; room_id: string; sender_id: string | null; type: string; deleted_at: string | null }>`
    SELECT id, room_id, sender_id, type, deleted_at::text AS deleted_at FROM messages WHERE id = ${messageId}
  `;
  if (!msg) throw new Error("Pesan tidak ditemukan");
  const access = await requireRoomMember(ctx, msg.room_id);
  return { msg, ...access };
}

export async function updateMessage(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { msg, user, room } = await loadOwnMessage(ctx, str(payload.message_id));
  if (msg.sender_id !== user.id) throw new PermissionError("Anda hanya dapat mengedit pesan sendiri");
  if (msg.deleted_at || msg.type !== "text") throw new Error("Pesan ini tidak dapat diedit");
  const content = str(payload.content);
  if (!content) throw new Error("Pesan tidak boleh kosong");
  const [updated] = await ctx.sql`
    UPDATE messages SET content = ${content.slice(0, MAX_MESSAGE_LENGTH)}, edited_at = now()
    WHERE id = ${msg.id}
    RETURNING id, content, edited_at::text AS edited_at
  `;
  return { result: updated, workspaceIds: [room.workspace_id] };
}

export async function deleteMessage(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { msg, user, role, roomRole, room } = await loadOwnMessage(ctx, str(payload.message_id));
  const canModerate = roomRole === "admin" || MANAGER_ROLES.includes(role);
  if (msg.sender_id !== user.id && !canModerate) {
    throw new PermissionError("Anda hanya dapat menghapus pesan sendiri");
  }
  const [deleted] = await ctx.sql`
    UPDATE messages SET deleted_at = now() WHERE id = ${msg.id}
    RETURNING id, deleted_at::text AS deleted_at
  `;
  return { result: deleted, workspaceIds: [room.workspace_id] };
}

export async function reactMessage(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { msg, user, room } = await loadOwnMessage(ctx, str(payload.message_id));
  const emoji = str(payload.emoji).slice(0, 32) || "👍";
  const existing = await ctx.sql`
    SELECT 1 FROM message_reactions WHERE message_id = ${msg.id} AND user_id = ${user.id} AND emoji = ${emoji}
  `;
  if (existing.length > 0) {
    await ctx.sql`DELETE FROM message_reactions WHERE message_id = ${msg.id} AND user_id = ${user.id} AND emoji = ${emoji}`;
  } else {
    await ctx.sql`INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (${msg.id}, ${user.id}, ${emoji})`;
  }
  return {
    result: { message_id: msg.id, emoji, active: existing.length === 0 },
    workspaceIds: [room.workspace_id],
  };
}

/** Marks everything in the room as read (blue ticks for senders). */
export async function markRoomRead(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, room } = await requireRoomMember(ctx, str(payload.room_id));
  const [latest] = await ctx.sql<{ id: string }>`
    SELECT id FROM messages WHERE room_id = ${room.id} ORDER BY created_at DESC LIMIT 1
  `;
  if (!latest) return { result: { room_id: room.id, changed: false } };
  const changed = await ctx.sql.begin(async (tx) => {
    const receipts = await tx`
      INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at)
      SELECT m.id, ${user.id}, now(), now() FROM messages m
      WHERE m.room_id = ${room.id} AND (m.sender_id IS NULL OR m.sender_id <> ${user.id})
      ON CONFLICT (message_id, user_id) DO UPDATE
        SET read_at = COALESCE(message_receipts.read_at, now()),
            delivered_at = COALESCE(message_receipts.delivered_at, now())
        WHERE message_receipts.read_at IS NULL
      RETURNING message_id
    `;
    const pointer = await tx`
      UPDATE room_members SET last_read_message_id = ${latest.id}
      WHERE room_id = ${room.id} AND user_id = ${user.id}
        AND last_read_message_id IS DISTINCT FROM ${latest.id}
      RETURNING room_id
    `;
    await tx`
      UPDATE notifications SET is_read = true
      WHERE user_id = ${user.id} AND is_read = false AND ref_type = 'message'
        AND ref_id IN (SELECT id FROM messages WHERE room_id = ${room.id})
    `;
    return receipts.length > 0 || pointer.length > 0;
  });
  return {
    result: { room_id: room.id, message_id: latest.id, changed },
    workspaceIds: changed ? [room.workspace_id] : undefined,
  };
}

export async function markNotificationsRead(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const user = requireUser(ctx);
  const id = optionalId(payload.notification_id);
  if (id) {
    await ctx.sql`UPDATE notifications SET is_read = true WHERE id = ${id} AND user_id = ${user.id}`;
  } else {
    await ctx.sql`UPDATE notifications SET is_read = true WHERE user_id = ${user.id} AND is_read = false`;
  }
  return { result: { ok: true }, userIds: [user.id] };
}

