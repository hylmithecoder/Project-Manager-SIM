import type { BunSqlClient } from "../../bun-env";
import {
  createNotifications,
  notifyActivity,
  notifyChatMessage,
  recordActivity,
  type ActivityEvent,
} from "../../services/notify";
import { deleteUpload, saveUpload } from "../../services/uploads";
import type { ActionContext, ActionResult } from "../context";
import {
  MANAGER_ROLES,
  PermissionError,
  WRITER_ROLES,
  getWorkspaceRole,
  isBoardMember,
  optionalId,
  requireBoardAccess,
  requireCardAccess,
  requireRoomMember,
  requireWorkspaceRole,
  str,
  userName,
} from "../context";

/** Parses an optional ISO date; "" / null clears it. */
function parseDue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new Error("Format tanggal deadline tidak valid");
  return d.toISOString();
}

async function emailActivity(
  ctx: ActionContext,
  ev: ActivityEvent,
  opts?: Parameters<typeof notifyActivity>[3],
) {
  await notifyActivity(ctx.sql, ctx.origin, ev, opts);
}

/** Position between neighbours so drag & drop never renumbers a whole list. */
async function positionAt(
  sql: BunSqlClient,
  listId: string,
  excludeCardId: string | null,
  index: number | null,
): Promise<number> {
  const siblings = await sql<{ id: string; position: number }>`
    SELECT id, position::float8 AS position FROM cards
    WHERE list_id = ${listId} AND archived_at IS NULL
    ORDER BY position ASC, created_at ASC
  `;
  const list = siblings.filter((s) => s.id !== excludeCardId);
  const idx = index === null ? list.length : Math.max(0, Math.min(index, list.length));
  const prev = list[idx - 1]?.position;
  const next = list[idx]?.position;
  if (prev === undefined && next === undefined) return 1000;
  if (prev === undefined) return next! / 2;
  if (next === undefined) return prev + 1000;
  return (prev + next) / 2;
}

async function boardRoomId(sql: BunSqlClient, boardId: string): Promise<string | null> {
  const [room] = await sql<{ id: string }>`SELECT id FROM rooms WHERE board_id = ${boardId}`;
  return room?.id ?? null;
}

/** Keeps board room membership in sync with who can see the board. */
async function syncBoardRoomMembers(
  tx: BunSqlClient,
  boardId: string,
): Promise<void> {
  const [board] = await tx<{ workspace_id: string; visibility: string }>`
    SELECT workspace_id, visibility FROM boards WHERE id = ${boardId}
  `;
  const roomId = await boardRoomId(tx, boardId);
  if (!board || !roomId) return;
  const allowed =
    board.visibility === "workspace"
      ? await tx<{ user_id: string; role: string }>`
          SELECT user_id, role FROM workspace_members WHERE workspace_id = ${board.workspace_id}
        `
      : await tx<{ user_id: string; role: string }>`
          SELECT bm.user_id, wm.role FROM board_members bm
          INNER JOIN workspace_members wm ON wm.user_id = bm.user_id AND wm.workspace_id = ${board.workspace_id}
          WHERE bm.board_id = ${boardId}
        `;
  const allowedIds = new Set(allowed.map((a) => a.user_id));
  const current = await tx<{ user_id: string }>`SELECT user_id FROM room_members WHERE room_id = ${roomId}`;
  for (const c of current) {
    if (!allowedIds.has(c.user_id)) {
      await tx`DELETE FROM room_members WHERE room_id = ${roomId} AND user_id = ${c.user_id}`;
    }
  }
  for (const a of allowed) {
    await tx`
      INSERT INTO room_members (room_id, user_id, role)
      VALUES (${roomId}, ${a.user_id}, ${a.role === "owner" || a.role === "admin" ? "admin" : "member"})
      ON CONFLICT (room_id, user_id) DO NOTHING
    `;
  }
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export async function createBoard(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const workspaceId = str(payload.workspace_id) || ctx.activeWorkspaceId || "";
  const { user } = await requireWorkspaceRole(ctx, workspaceId, WRITER_ROLES);
  const name = str(payload.name);
  if (!name) throw new Error("Nama board wajib diisi");
  const visibility = payload.visibility === "private" ? "private" : "workspace";

  const created = await ctx.sql.begin(async (tx) => {
    const [board] = await tx<{ id: string; name: string }>`
      INSERT INTO boards (workspace_id, name, visibility, created_by)
      VALUES (${workspaceId}, ${name.slice(0, 100)}, ${visibility}, ${user.id})
      RETURNING id, name
    `;
    await tx`INSERT INTO board_members (board_id, user_id, role) VALUES (${board.id}, ${user.id}, 'admin')`;
    const [room] = await tx<{ id: string }>`
      INSERT INTO rooms (workspace_id, type, name, board_id, only_admins_can_send, created_by)
      VALUES (${workspaceId}, 'board', ${`Diskusi ${name}`.slice(0, 100)}, ${board.id}, false, ${user.id})
      RETURNING id
    `;
    await tx`
      INSERT INTO lists (board_id, name, position)
      VALUES (${board.id}, 'To Do', 1000), (${board.id}, 'Doing', 2000), (${board.id}, 'Done', 3000)
    `;
    await syncBoardRoomMembers(tx, board.id);
    await tx`UPDATE room_members SET role = 'admin' WHERE room_id = ${room.id} AND user_id = ${user.id}`;
    await recordActivity(tx, {
      workspaceId,
      boardId: board.id,
      actorId: user.id,
      action: "board_created",
      payload: { board_name: board.name, visibility },
      eventText: `${user.name} membuat board "${board.name}"`,
    });
    return { ...board, room_id: room.id };
  });

  await emailActivity(ctx, {
    workspaceId,
    boardId: created.id,
    actorId: user.id,
    action: "board_created",
    payload: { visibility },
  });
  return { result: created, workspaceIds: [workspaceId] };
}

export async function updateBoard(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, board } = await requireBoardAccess(ctx, str(payload.board_id), { manage: true });
  const name = str(payload.name) || board.name;
  const visibility =
    payload.visibility === "private" || payload.visibility === "workspace"
      ? payload.visibility
      : board.visibility;
  await ctx.sql.begin(async (tx) => {
    await tx`UPDATE boards SET name = ${name.slice(0, 100)}, visibility = ${visibility} WHERE id = ${board.id}`;
    if (name !== board.name) {
      await tx`UPDATE rooms SET name = ${`Diskusi ${name}`.slice(0, 100)} WHERE board_id = ${board.id}`;
    }
    if (visibility !== board.visibility) await syncBoardRoomMembers(tx, board.id);
    await recordActivity(tx, {
      workspaceId: board.workspace_id,
      boardId: board.id,
      actorId: user.id,
      action: "board_updated",
      payload: { name, visibility },
    });
  });
  await emailActivity(ctx, {
    workspaceId: board.workspace_id,
    boardId: board.id,
    actorId: user.id,
    action: "board_updated",
    payload: { visibility },
  });
  return { result: { id: board.id, name, visibility }, workspaceIds: [board.workspace_id] };
}

export async function archiveBoard(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, board } = await requireBoardAccess(ctx, str(payload.board_id), { manage: true });
  // Email before archiving so recipients are resolved against the live board.
  await emailActivity(ctx, {
    workspaceId: board.workspace_id,
    boardId: board.id,
    actorId: user.id,
    action: "board_archived",
  });
  await ctx.sql.begin(async (tx) => {
    await tx`UPDATE boards SET archived_at = now() WHERE id = ${board.id}`;
    await recordActivity(tx, {
      workspaceId: board.workspace_id,
      boardId: board.id,
      actorId: user.id,
      action: "board_archived",
    });
  });
  return { result: { id: board.id }, workspaceIds: [board.workspace_id] };
}

export async function toggleBoardMember(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, board } = await requireBoardAccess(ctx, str(payload.board_id), { manage: true });
  const targetId = str(payload.user_id);
  if (!(await getWorkspaceRole(ctx.sql, board.workspace_id, targetId))) {
    throw new Error("Pengguna bukan anggota workspace");
  }
  if (targetId === board.created_by) throw new Error("Pembuat board tidak dapat dikeluarkan");
  const wasMember = await isBoardMember(ctx.sql, board.id, targetId);
  const memberName = await userName(ctx.sql, targetId);
  const action = wasMember ? "board_member_removed" : "board_member_added";
  await ctx.sql.begin(async (tx) => {
    if (wasMember) {
      await tx`DELETE FROM board_members WHERE board_id = ${board.id} AND user_id = ${targetId}`;
    } else {
      await tx`INSERT INTO board_members (board_id, user_id, role) VALUES (${board.id}, ${targetId}, 'member')`;
    }
    await syncBoardRoomMembers(tx, board.id);
    await recordActivity(tx, {
      workspaceId: board.workspace_id,
      boardId: board.id,
      actorId: user.id,
      action,
      payload: { member_name: memberName },
      eventText: `${user.name} ${wasMember ? "mengeluarkan" : "menambahkan"} ${memberName} ${wasMember ? "dari" : "ke"} board`,
    });
  });
  await emailActivity(ctx, {
    workspaceId: board.workspace_id,
    boardId: board.id,
    actorId: user.id,
    action,
    payload: { member_name: memberName },
  });
  return { result: { board_id: board.id, user_id: targetId, member: !wasMember }, workspaceIds: [board.workspace_id] };
}

// ---------------------------------------------------------------------------
// Lists & labels
// ---------------------------------------------------------------------------

async function loadList(sql: BunSqlClient, listId: string) {
  if (!listId) throw new Error("list_id diperlukan");
  const [list] = await sql<{ id: string; board_id: string; name: string; position: number }>`
    SELECT id, board_id, name, position::float8 AS position FROM lists
    WHERE id = ${listId} AND archived_at IS NULL
  `;
  if (!list) throw new Error("Kolom list tidak ditemukan");
  return list;
}

export async function createList(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, board } = await requireBoardAccess(ctx, str(payload.board_id), { write: true });
  const name = str(payload.name);
  if (!name) throw new Error("Nama kolom wajib diisi");
  const list = await ctx.sql.begin(async (tx) => {
    const [maxPos] = await tx<{ max_pos: number }>`
      SELECT COALESCE(MAX(position), 0)::float8 AS max_pos FROM lists
      WHERE board_id = ${board.id} AND archived_at IS NULL
    `;
    const [created] = await tx<{ id: string; name: string }>`
      INSERT INTO lists (board_id, name, position)
      VALUES (${board.id}, ${name.slice(0, 100)}, ${(maxPos?.max_pos || 0) + 1000})
      RETURNING id, board_id, name, position::float8 AS position
    `;
    await recordActivity(tx, {
      workspaceId: board.workspace_id,
      boardId: board.id,
      actorId: user.id,
      action: "list_created",
      payload: { list_name: created.name },
      eventText: `${user.name} menambahkan kolom "${created.name}"`,
    });
    return created;
  });
  await emailActivity(ctx, {
    workspaceId: board.workspace_id,
    boardId: board.id,
    actorId: user.id,
    action: "list_created",
    payload: { list_name: list.name },
  });
  return { result: list, workspaceIds: [board.workspace_id] };
}

export async function renameList(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const list = await loadList(ctx.sql, str(payload.list_id));
  const { user, board } = await requireBoardAccess(ctx, list.board_id, { write: true });
  const name = str(payload.name);
  if (!name) throw new Error("Nama kolom wajib diisi");
  await ctx.sql.begin(async (tx) => {
    await tx`UPDATE lists SET name = ${name.slice(0, 100)} WHERE id = ${list.id}`;
    await recordActivity(tx, {
      workspaceId: board.workspace_id,
      boardId: board.id,
      actorId: user.id,
      action: "list_renamed",
      payload: { list_name: name, old_name: list.name },
    });
  });
  await emailActivity(ctx, {
    workspaceId: board.workspace_id,
    boardId: board.id,
    actorId: user.id,
    action: "list_renamed",
    payload: { list_name: name, old_name: list.name },
  });
  return { result: { id: list.id, name }, workspaceIds: [board.workspace_id] };
}

export async function moveList(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const list = await loadList(ctx.sql, str(payload.list_id));
  const { board } = await requireBoardAccess(ctx, list.board_id, { write: true });
  const direction = Number(payload.direction) < 0 ? -1 : 1;
  const lists = await ctx.sql<{ id: string; position: number }>`
    SELECT id, position::float8 AS position FROM lists
    WHERE board_id = ${board.id} AND archived_at IS NULL
    ORDER BY position ASC, name ASC
  `;
  const idx = lists.findIndex((l) => l.id === list.id);
  const swap = lists[idx + direction];
  if (!swap) return { result: { id: list.id, moved: false } };
  await ctx.sql.begin(async (tx) => {
    await tx`UPDATE lists SET position = ${swap.position} WHERE id = ${list.id}`;
    await tx`UPDATE lists SET position = ${lists[idx].position} WHERE id = ${swap.id}`;
  });
  return { result: { id: list.id, moved: true }, workspaceIds: [board.workspace_id] };
}

export async function archiveList(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const list = await loadList(ctx.sql, str(payload.list_id));
  const { user, board } = await requireBoardAccess(ctx, list.board_id, { write: true });
  await ctx.sql.begin(async (tx) => {
    await tx`UPDATE lists SET archived_at = now() WHERE id = ${list.id}`;
    await recordActivity(tx, {
      workspaceId: board.workspace_id,
      boardId: board.id,
      actorId: user.id,
      action: "list_archived",
      payload: { list_name: list.name },
      eventText: `${user.name} mengarsipkan kolom "${list.name}"`,
    });
  });
  await emailActivity(ctx, {
    workspaceId: board.workspace_id,
    boardId: board.id,
    actorId: user.id,
    action: "list_archived",
    payload: { list_name: list.name },
  });
  return { result: { id: list.id }, workspaceIds: [board.workspace_id] };
}

export async function createLabel(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { board } = await requireBoardAccess(ctx, str(payload.board_id), { write: true });
  const name = str(payload.name);
  const color = /^#[0-9a-f]{6}$/i.test(str(payload.color)) ? str(payload.color) : "#3b63d6";
  if (!name) throw new Error("Nama label wajib diisi");
  const [label] = await ctx.sql`
    INSERT INTO labels (board_id, name, color) VALUES (${board.id}, ${name.slice(0, 100)}, ${color})
    RETURNING id, board_id, name, color
  `;
  return { result: label, workspaceIds: [board.workspace_id] };
}

export async function deleteLabel(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const [label] = await ctx.sql<{ id: string; board_id: string }>`
    SELECT id, board_id FROM labels WHERE id = ${str(payload.label_id)}
  `;
  if (!label) throw new Error("Label tidak ditemukan");
  const { board } = await requireBoardAccess(ctx, label.board_id, { write: true });
  await ctx.sql`DELETE FROM labels WHERE id = ${label.id}`;
  return { result: { id: label.id }, workspaceIds: [board.workspace_id] };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

async function assertAssignable(ctx: ActionContext, boardId: string, workspaceId: string, userId: string) {
  if (!(await getWorkspaceRole(ctx.sql, workspaceId, userId))) {
    throw new Error("Penerima tugas harus anggota workspace");
  }
  const [board] = await ctx.sql<{ visibility: string }>`SELECT visibility FROM boards WHERE id = ${boardId}`;
  if (board?.visibility === "private" && !(await isBoardMember(ctx.sql, boardId, userId))) {
    throw new Error("Penerima tugas harus anggota board privat ini");
  }
}

async function notifyAssigned(
  ctx: ActionContext,
  workspaceId: string,
  boardId: string,
  cardId: string,
  actorId: string,
  assigneeIds: string[],
  dueAt: string | null,
) {
  const targets = assigneeIds.filter((id) => id !== actorId);
  await createNotifications(ctx.sql, targets, "assigned", "card", cardId);
  for (const assigneeId of targets) {
    await emailActivity(
      ctx,
      {
        workspaceId,
        boardId,
        cardId,
        actorId,
        action: "card_assigned",
        payload: { assignee_name: await userName(ctx.sql, assigneeId), due_at: dueAt },
      },
      { onlyUserIds: [assigneeId] },
    );
  }
}

export async function createCard(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const list = await loadList(ctx.sql, str(payload.list_id));
  const { user, board } = await requireBoardAccess(ctx, list.board_id, { write: true });
  const title = str(payload.title);
  if (!title) throw new Error("Judul card wajib diisi");
  const description = str(payload.description) || null;
  const dueAt = parseDue(payload.due_at);
  const assigneeIds = [
    ...new Set(
      (Array.isArray(payload.assignee_ids) ? payload.assignee_ids : [payload.assignee_id])
        .filter((v): v is string => typeof v === "string" && Boolean(v)),
    ),
  ];
  for (const id of assigneeIds) await assertAssignable(ctx, board.id, board.workspace_id, id);
  const labelIds = (Array.isArray(payload.label_ids) ? payload.label_ids : [payload.label_id]).filter(
    (v): v is string => typeof v === "string" && Boolean(v),
  );

  const card = await ctx.sql.begin(async (tx) => {
    const position = await positionAt(tx, list.id, null, null);
    const [created] = await tx<{ id: string; title: string; list_id: string }>`
      INSERT INTO cards (list_id, board_id, title, description, position, due_at, created_by)
      VALUES (${list.id}, ${board.id}, ${title.slice(0, 255)}, ${description}, ${position}, ${dueAt}, ${user.id})
      RETURNING id, title, list_id
    `;
    for (const id of assigneeIds) {
      await tx`INSERT INTO card_assignees (card_id, user_id) VALUES (${created.id}, ${id}) ON CONFLICT DO NOTHING`;
    }
    for (const id of labelIds) {
      await tx`
        INSERT INTO card_labels (card_id, label_id)
        SELECT ${created.id}, id FROM labels WHERE id = ${id} AND board_id = ${board.id}
        ON CONFLICT DO NOTHING
      `;
    }
    await recordActivity(tx, {
      workspaceId: board.workspace_id,
      boardId: board.id,
      cardId: created.id,
      actorId: user.id,
      action: "card_created",
      payload: { list_name: list.name },
      eventText: `${user.name} menambahkan card "${created.title}" ke kolom ${list.name}`,
    });
    return created;
  });

  await emailActivity(ctx, {
    workspaceId: board.workspace_id,
    boardId: board.id,
    cardId: card.id,
    actorId: user.id,
    action: "card_created",
    payload: { list_name: list.name, description },
  });
  await notifyAssigned(ctx, board.workspace_id, board.id, card.id, user.id, assigneeIds, dueAt);
  return { result: card, workspaceIds: [board.workspace_id] };
}

export async function updateCard(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, board, card } = await requireCardAccess(ctx, str(payload.card_id));
  const [existing] = await ctx.sql<{ title: string; description: string | null }>`
    SELECT title, description FROM cards WHERE id = ${card.id}
  `;
  const title = str(payload.title) || existing.title;
  const description =
    payload.description === undefined ? existing.description : str(payload.description) || null;
  const dueChanged = payload.due_at !== undefined;
  const dueAt = dueChanged ? parseDue(payload.due_at) : card.due_at;
  const completed = typeof payload.completed === "boolean" ? payload.completed : null;

  const events: ActivityEvent[] = [];
  const base = { workspaceId: board.workspace_id, boardId: board.id, cardId: card.id, actorId: user.id };
  const changes: string[] = [];
  if (title !== existing.title) changes.push(`judul → "${title}"`);
  if (description !== existing.description) changes.push("deskripsi");
  if (changes.length) {
    events.push({ ...base, action: "card_updated", payload: { changes: changes.join(", ") } });
  }
  const oldDue = card.due_at ? new Date(card.due_at).toISOString() : null;
  if (dueChanged && dueAt !== oldDue) {
    events.push({
      ...base,
      action: "due_changed",
      payload: { due_at: dueAt },
      eventText: `${user.name} ${dueAt ? "mengatur deadline" : "menghapus deadline"} card "${title}"`,
    });
  }
  if (completed !== null && completed !== Boolean(card.completed_at)) {
    events.push({
      ...base,
      action: completed ? "card_completed" : "card_reopened",
      eventText: `${user.name} menandai card "${title}" sebagai ${completed ? "selesai" : "belum selesai"}`,
    });
  }

  await ctx.sql.begin(async (tx) => {
    await tx`
      UPDATE cards SET
        title = ${title.slice(0, 255)},
        description = ${description},
        due_at = ${dueAt},
        completed_at = CASE
          WHEN ${completed === true} THEN COALESCE(completed_at, now())
          WHEN ${completed === false} THEN NULL
          ELSE completed_at
        END
      WHERE id = ${card.id}
    `;
    for (const ev of events) await recordActivity(tx, ev);
  });
  for (const ev of events) await emailActivity(ctx, ev);
  return { result: { id: card.id, title, description, due_at: dueAt }, workspaceIds: [board.workspace_id] };
}

export async function moveCard(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, board, card } = await requireCardAccess(ctx, str(payload.card_id));
  const target = await loadList(ctx.sql, str(payload.target_list_id));
  if (target.board_id !== board.id) throw new Error("Card hanya bisa dipindah di board yang sama");
  const index =
    typeof payload.target_index === "number" && Number.isFinite(payload.target_index)
      ? Math.floor(payload.target_index)
      : null;
  const [from] = await ctx.sql<{ name: string }>`SELECT name FROM lists WHERE id = ${card.list_id}`;
  const listChanged = target.id !== card.list_id;
  const isDone = target.name.trim().toLowerCase() === "done";
  const ev: ActivityEvent = {
    workspaceId: board.workspace_id,
    boardId: board.id,
    cardId: card.id,
    actorId: user.id,
    action: "card_moved",
    payload: { from_list_id: card.list_id, from_list: from?.name || "", to_list_id: target.id, to_list: target.name },
    eventText: `${user.name} memindahkan card "${card.title}" dari ${from?.name || "-"} ke ${target.name}`,
  };

  const moved = await ctx.sql.begin(async (tx) => {
    const position = await positionAt(tx, target.id, card.id, index);
    const [updated] = await tx<{ id: string; list_id: string; position: number }>`
      UPDATE cards SET
        list_id = ${target.id},
        position = ${position},
        completed_at = CASE WHEN ${listChanged && isDone} THEN COALESCE(completed_at, now()) ELSE completed_at END
      WHERE id = ${card.id}
      RETURNING id, list_id, position::float8 AS position
    `;
    if (listChanged) await recordActivity(tx, ev);
    return updated;
  });
  if (listChanged) await emailActivity(ctx, ev);
  return { result: moved, workspaceIds: [board.workspace_id] };
}

export async function archiveCard(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, board, card } = await requireCardAccess(ctx, str(payload.card_id));
  const ev: ActivityEvent = {
    workspaceId: board.workspace_id,
    boardId: board.id,
    cardId: card.id,
    actorId: user.id,
    action: "card_archived",
    eventText: `${user.name} mengarsipkan card "${card.title}"`,
  };
  await emailActivity(ctx, ev);
  await ctx.sql.begin(async (tx) => {
    await tx`UPDATE cards SET archived_at = now() WHERE id = ${card.id}`;
    await recordActivity(tx, ev);
  });
  return { result: { id: card.id }, workspaceIds: [board.workspace_id] };
}

export async function cardFromMessage(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const messageId = str(payload.message_id);
  const [msg] = await ctx.sql<{ id: string; room_id: string; content: string | null; sender_id: string | null }>`
    SELECT id, room_id, content, sender_id FROM messages WHERE id = ${messageId} AND deleted_at IS NULL
  `;
  if (!msg) throw new Error("Pesan sumber tidak ditemukan");
  await requireRoomMember(ctx, msg.room_id);
  const list = await loadList(ctx.sql, str(payload.list_id));
  const { user, board } = await requireBoardAccess(ctx, list.board_id, { write: true });
  const title = str(payload.title) || (msg.content || "Task dari Chat").slice(0, 120);

  const card = await ctx.sql.begin(async (tx) => {
    const position = await positionAt(tx, list.id, null, null);
    const [created] = await tx<{ id: string; title: string; list_id: string; source_message_id: string }>`
      INSERT INTO cards (list_id, board_id, title, description, position, created_by, source_message_id)
      VALUES (${list.id}, ${board.id}, ${title.slice(0, 255)}, ${msg.content}, ${position}, ${user.id}, ${msg.id})
      RETURNING id, title, list_id, source_message_id
    `;
    await tx`UPDATE messages SET card_id = ${created.id} WHERE id = ${msg.id}`;
    if (msg.sender_id) {
      const role = await getWorkspaceRole(tx, board.workspace_id, msg.sender_id);
      if (role) {
        await tx`INSERT INTO card_assignees (card_id, user_id) VALUES (${created.id}, ${msg.sender_id}) ON CONFLICT DO NOTHING`;
      }
    }
    await recordActivity(tx, {
      workspaceId: board.workspace_id,
      boardId: board.id,
      cardId: created.id,
      actorId: user.id,
      action: "card_created_from_message",
      payload: { source_message_id: msg.id },
      eventText: `${user.name} membuat card "${created.title}" langsung dari pesan chat`,
    });
    return created;
  });
  await emailActivity(ctx, {
    workspaceId: board.workspace_id,
    boardId: board.id,
    cardId: card.id,
    actorId: user.id,
    action: "card_created_from_message",
    payload: { message_content: msg.content },
  });
  if (msg.sender_id) {
    await notifyAssigned(ctx, board.workspace_id, board.id, card.id, user.id, [msg.sender_id], null);
  }
  return { result: card, workspaceIds: [board.workspace_id] };
}

export async function toggleAssignee(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, board, card } = await requireCardAccess(ctx, str(payload.card_id));
  const targetId = str(payload.user_id);
  await assertAssignable(ctx, board.id, board.workspace_id, targetId);
  const existing = await ctx.sql`SELECT 1 FROM card_assignees WHERE card_id = ${card.id} AND user_id = ${targetId}`;
  const assigned = existing.length === 0;
  const name = await userName(ctx.sql, targetId);
  await ctx.sql.begin(async (tx) => {
    if (assigned) {
      await tx`INSERT INTO card_assignees (card_id, user_id) VALUES (${card.id}, ${targetId})`;
    } else {
      await tx`DELETE FROM card_assignees WHERE card_id = ${card.id} AND user_id = ${targetId}`;
    }
    await recordActivity(tx, {
      workspaceId: board.workspace_id,
      boardId: board.id,
      cardId: card.id,
      actorId: user.id,
      action: assigned ? "card_assigned" : "card_unassigned",
      payload: { assignee_id: targetId, assignee_name: name },
      eventText: assigned
        ? `${user.name} menugaskan ${name} pada card "${card.title}"`
        : `${user.name} melepas ${name} dari card "${card.title}"`,
    });
  });
  if (assigned) {
    await notifyAssigned(ctx, board.workspace_id, board.id, card.id, user.id, [targetId], card.due_at);
    // Everyone else on the board gets the regular activity email.
    await emailActivity(
      ctx,
      {
        workspaceId: board.workspace_id,
        boardId: board.id,
        cardId: card.id,
        actorId: user.id,
        action: "card_assigned",
        payload: { assignee_name: name, due_at: card.due_at },
      },
      { excludeUserIds: [targetId] },
    );
  } else {
    await emailActivity(ctx, {
      workspaceId: board.workspace_id,
      boardId: board.id,
      cardId: card.id,
      actorId: user.id,
      action: "card_unassigned",
      payload: { assignee_name: name },
    });
  }
  return { result: { card_id: card.id, user_id: targetId, assigned }, workspaceIds: [board.workspace_id] };
}

export async function toggleLabel(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, board, card } = await requireCardAccess(ctx, str(payload.card_id));
  const [label] = await ctx.sql<{ id: string; name: string }>`
    SELECT id, name FROM labels WHERE id = ${str(payload.label_id)} AND board_id = ${board.id}
  `;
  if (!label) throw new Error("Label tidak ditemukan di board ini");
  const existing = await ctx.sql`SELECT 1 FROM card_labels WHERE card_id = ${card.id} AND label_id = ${label.id}`;
  const added = existing.length === 0;
  if (added) {
    await ctx.sql`INSERT INTO card_labels (card_id, label_id) VALUES (${card.id}, ${label.id})`;
  } else {
    await ctx.sql`DELETE FROM card_labels WHERE card_id = ${card.id} AND label_id = ${label.id}`;
  }
  const ev: ActivityEvent = {
    workspaceId: board.workspace_id,
    boardId: board.id,
    cardId: card.id,
    actorId: user.id,
    action: "label_changed",
    payload: { label_name: label.name, added },
  };
  await recordActivity(ctx.sql, ev);
  await emailActivity(ctx, ev);
  return { result: { card_id: card.id, label_id: label.id, added }, workspaceIds: [board.workspace_id] };
}

/** Card thread room (rooms.type = 'card', RD p.6). */
export async function openCardRoom(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, board, card } = await requireCardAccess(ctx, str(payload.card_id), { write: false });
  const roomId = await ctx.sql.begin(async (tx) => {
    let [room] = await tx<{ id: string }>`SELECT id FROM rooms WHERE card_id = ${card.id}`;
    if (!room) {
      [room] = await tx<{ id: string }>`
        INSERT INTO rooms (workspace_id, type, name, card_id, only_admins_can_send, created_by)
        VALUES (${board.workspace_id}, 'card', ${`Thread: ${card.title}`.slice(0, 100)}, ${card.id}, false, ${user.id})
        RETURNING id
      `;
      const participants = await tx<{ user_id: string }>`
        SELECT user_id FROM card_assignees WHERE card_id = ${card.id}
        UNION SELECT created_by FROM cards WHERE id = ${card.id}
      `;
      for (const p of participants) {
        if (await getWorkspaceRole(tx, board.workspace_id, p.user_id)) {
          await tx`
            INSERT INTO room_members (room_id, user_id, role) VALUES (${room.id}, ${p.user_id}, 'member')
            ON CONFLICT DO NOTHING
          `;
        }
      }
    }
    await tx`
      INSERT INTO room_members (room_id, user_id, role) VALUES (${room.id}, ${user.id}, 'member')
      ON CONFLICT DO NOTHING
    `;
    return room.id;
  });
  return { result: { room_id: roomId, card_id: card.id }, workspaceIds: [board.workspace_id] };
}

// ---------------------------------------------------------------------------
// Checklists
// ---------------------------------------------------------------------------

async function checklistProgress(sql: BunSqlClient, cardId: string): Promise<string> {
  const [row] = await sql<{ done: number; total: number }>`
    SELECT COUNT(*) FILTER (WHERE ci.is_done)::int AS done, COUNT(*)::int AS total
    FROM checklist_items ci INNER JOIN checklists ch ON ch.id = ci.checklist_id
    WHERE ch.card_id = ${cardId}
  `;
  return `${row?.done ?? 0}/${row?.total ?? 0}`;
}

export async function createChecklist(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { user, board, card } = await requireCardAccess(ctx, str(payload.card_id));
  const title = str(payload.title) || "Checklist";
  const [checklist] = await ctx.sql<{ id: string }>`
    INSERT INTO checklists (card_id, title, position)
    VALUES (
      ${card.id}, ${title.slice(0, 255)},
      (SELECT COALESCE(MAX(position), 0) + 1000 FROM checklists WHERE card_id = ${card.id})
    )
    RETURNING id
  `;
  const ev: ActivityEvent = {
    workspaceId: board.workspace_id,
    boardId: board.id,
    cardId: card.id,
    actorId: user.id,
    action: "checklist_created",
    payload: { checklist_title: title },
  };
  await recordActivity(ctx.sql, ev);
  await emailActivity(ctx, ev);
  return { result: { id: checklist.id, title }, workspaceIds: [board.workspace_id] };
}

async function loadChecklist(ctx: ActionContext, checklistId: string) {
  const [ch] = await ctx.sql<{ id: string; card_id: string; title: string }>`
    SELECT id, card_id, title FROM checklists WHERE id = ${checklistId}
  `;
  if (!ch) throw new Error("Checklist tidak ditemukan");
  return { ch, ...(await requireCardAccess(ctx, ch.card_id)) };
}

export async function deleteChecklist(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { ch, board } = await loadChecklist(ctx, str(payload.checklist_id));
  await ctx.sql`DELETE FROM checklists WHERE id = ${ch.id}`;
  return { result: { id: ch.id }, workspaceIds: [board.workspace_id] };
}

export async function addChecklistItem(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  let checklistId = str(payload.checklist_id);
  if (!checklistId) {
    // Backwards compatible: card_id only -> first checklist (auto-created).
    const { card } = await requireCardAccess(ctx, str(payload.card_id));
    const [first] = await ctx.sql<{ id: string }>`
      SELECT id FROM checklists WHERE card_id = ${card.id} ORDER BY position ASC LIMIT 1
    `;
    checklistId =
      first?.id ??
      (
        await ctx.sql<{ id: string }>`
          INSERT INTO checklists (card_id, title, position) VALUES (${card.id}, 'Checklist Tugas', 1000) RETURNING id
        `
      )[0].id;
  }
  const { ch, user, board, card } = await loadChecklist(ctx, checklistId);
  const content = str(payload.content);
  if (!content) throw new Error("Isi checklist wajib diisi");
  const assigneeId = optionalId(payload.assignee_id);
  if (assigneeId) await assertAssignable(ctx, board.id, board.workspace_id, assigneeId);
  const dueAt = parseDue(payload.due_at);
  const [item] = await ctx.sql`
    INSERT INTO checklist_items (checklist_id, content, is_done, assignee_id, due_at, position)
    VALUES (
      ${ch.id}, ${content}, false, ${assigneeId}, ${dueAt},
      (SELECT COALESCE(MAX(position), 0) + 1000 FROM checklist_items WHERE checklist_id = ${ch.id})
    )
    RETURNING id, checklist_id, content, is_done
  `;
  const ev: ActivityEvent = {
    workspaceId: board.workspace_id,
    boardId: board.id,
    cardId: card.id,
    actorId: user.id,
    action: "checklist_item_added",
    payload: { content },
  };
  await recordActivity(ctx.sql, ev);
  await emailActivity(ctx, ev);
  return { result: item, workspaceIds: [board.workspace_id] };
}

async function loadItem(ctx: ActionContext, itemId: string) {
  const [item] = await ctx.sql<{ id: string; checklist_id: string; content: string; is_done: boolean }>`
    SELECT id, checklist_id, content, is_done FROM checklist_items WHERE id = ${itemId}
  `;
  if (!item) throw new Error("Item checklist tidak ditemukan");
  return { item, ...(await loadChecklist(ctx, item.checklist_id)) };
}

export async function updateChecklistItem(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { item, board } = await loadItem(ctx, str(payload.item_id));
  const content = str(payload.content) || item.content;
  const assigneeId = payload.assignee_id === undefined ? undefined : optionalId(payload.assignee_id);
  if (assigneeId) await assertAssignable(ctx, board.id, board.workspace_id, assigneeId);
  await ctx.sql`
    UPDATE checklist_items SET
      content = ${content},
      assignee_id = CASE WHEN ${assigneeId !== undefined} THEN ${assigneeId ?? null}::uuid ELSE assignee_id END,
      due_at = CASE WHEN ${payload.due_at !== undefined} THEN ${parseDue(payload.due_at)}::timestamptz ELSE due_at END
    WHERE id = ${item.id}
  `;
  return { result: { id: item.id }, workspaceIds: [board.workspace_id] };
}

export async function toggleChecklistItem(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { item, user, board, card } = await loadItem(ctx, str(payload.item_id));
  const [updated] = await ctx.sql<{ id: string; is_done: boolean }>`
    UPDATE checklist_items SET is_done = NOT is_done WHERE id = ${item.id} RETURNING id, is_done
  `;
  const ev: ActivityEvent = {
    workspaceId: board.workspace_id,
    boardId: board.id,
    cardId: card.id,
    actorId: user.id,
    action: updated.is_done ? "checklist_item_done" : "checklist_item_undone",
    payload: { content: item.content, progress: await checklistProgress(ctx.sql, card.id) },
  };
  await recordActivity(ctx.sql, ev);
  await emailActivity(ctx, ev);
  return { result: updated, workspaceIds: [board.workspace_id] };
}

export async function deleteChecklistItem(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { item, board } = await loadItem(ctx, str(payload.item_id));
  await ctx.sql`DELETE FROM checklist_items WHERE id = ${item.id}`;
  return { result: { id: item.id }, workspaceIds: [board.workspace_id] };
}

// ---------------------------------------------------------------------------
// Attachments (card or chat message, RD p.8 XOR check)
// ---------------------------------------------------------------------------

export async function uploadAttachment(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const cardId = optionalId(payload.card_id);
  const roomId = optionalId(payload.room_id);
  if (Boolean(cardId) === Boolean(roomId)) throw new Error("Pilih tepat satu: card_id atau room_id");
  const mime = str(payload.mime_type) || "application/octet-stream";
  const base64 = typeof payload.data_base64 === "string" ? payload.data_base64 : "";

  if (cardId) {
    const { user, board, card } = await requireCardAccess(ctx, cardId);
    const file = await saveUpload({ fileName: str(payload.file_name), base64 });
    await ctx.sql`
      INSERT INTO attachments (id, uploader_id, card_id, message_id, file_url, file_name, mime_type, size_bytes)
      VALUES (${file.id}, ${user.id}, ${card.id}, NULL, ${file.url}, ${file.fileName}, ${mime.slice(0, 100)}, ${file.size})
    `;
    const ev: ActivityEvent = {
      workspaceId: board.workspace_id,
      boardId: board.id,
      cardId: card.id,
      actorId: user.id,
      action: "attachment_added",
      payload: { file_name: file.fileName, size_bytes: file.size },
      eventText: `${user.name} melampirkan "${file.fileName}" pada card "${card.title}"`,
    };
    await recordActivity(ctx.sql, ev);
    await emailActivity(ctx, ev);
    return { result: { id: file.id, url: file.url }, workspaceIds: [board.workspace_id] };
  }

  const { user, role, room, roomRole } = await requireRoomMember(ctx, roomId!);
  if (room.only_admins_can_send && roomRole !== "admin" && !MANAGER_ROLES.includes(role)) {
    throw new PermissionError("Hanya admin yang dapat mengirim pesan di ruang ini");
  }
  const file = await saveUpload({ fileName: str(payload.file_name), base64 });
  const type = mime.startsWith("image/") ? "image" : "file";
  const messageId = await ctx.sql.begin(async (tx) => {
    const [msg] = await tx<{ id: string }>`
      INSERT INTO messages (room_id, sender_id, type, content)
      VALUES (${room.id}, ${user.id}, ${type}, ${str(payload.content) || file.fileName})
      RETURNING id
    `;
    await tx`
      INSERT INTO attachments (id, uploader_id, card_id, message_id, file_url, file_name, mime_type, size_bytes)
      VALUES (${file.id}, ${user.id}, NULL, ${msg.id}, ${file.url}, ${file.fileName}, ${mime.slice(0, 100)}, ${file.size})
    `;
    await tx`
      INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at)
      VALUES (${msg.id}, ${user.id}, now(), now())
    `;
    await tx`UPDATE room_members SET last_read_message_id = ${msg.id} WHERE room_id = ${room.id} AND user_id = ${user.id}`;
    return msg.id;
  });
  await notifyChatMessage(ctx.sql, ctx.origin, messageId);
  return { result: { id: file.id, url: file.url, message_id: messageId }, workspaceIds: [room.workspace_id] };
}

export async function deleteAttachment(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const [att] = await ctx.sql<{
    id: string;
    uploader_id: string;
    card_id: string | null;
    message_id: string | null;
    file_url: string;
  }>`
    SELECT id, uploader_id, card_id, message_id, file_url FROM attachments WHERE id = ${str(payload.attachment_id)}
  `;
  if (!att) throw new Error("Lampiran tidak ditemukan");
  let workspaceId: string;
  let role: string;
  let userId: string;
  if (att.card_id) {
    const access = await requireCardAccess(ctx, att.card_id);
    workspaceId = access.board.workspace_id;
    role = access.role;
    userId = access.user.id;
  } else {
    const [m] = await ctx.sql<{ room_id: string }>`SELECT room_id FROM messages WHERE id = ${att.message_id}`;
    const access = await requireRoomMember(ctx, m.room_id);
    workspaceId = access.room.workspace_id;
    role = access.role;
    userId = access.user.id;
  }
  if (att.uploader_id !== userId && !MANAGER_ROLES.includes(role as never)) {
    throw new PermissionError("Hanya pengunggah atau admin yang dapat menghapus lampiran");
  }
  await ctx.sql`DELETE FROM attachments WHERE id = ${att.id}`;
  if (att.message_id) {
    await ctx.sql`UPDATE messages SET deleted_at = now() WHERE id = ${att.message_id}`;
  }
  await deleteUpload(att.file_url);
  return { result: { id: att.id }, workspaceIds: [workspaceId] };
}
