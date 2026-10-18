import type { BunSqlClient } from "../bun-env";
import { activityEmail, chatMessageEmail } from "./email-templates";
import { enqueueEmail } from "./mailer";

export interface ActivityEvent {
  workspaceId: string;
  boardId: string | null;
  cardId?: string | null;
  actorId: string;
  action: string;
  payload?: Record<string, unknown>;
  /** Text posted as a `task_event` message to the board room (RD p.9). */
  eventText?: string;
}

/**
 * Writes the activity row and mirrors it into the board chat room. Workspace
 * level events (no board) are posted as `system` messages to the general room.
 * Must run inside the caller's transaction.
 */
export async function recordActivity(
  tx: BunSqlClient,
  ev: ActivityEvent,
): Promise<void> {
  if (ev.boardId) {
    await tx`
      INSERT INTO activities (board_id, card_id, actor_id, action, payload)
      VALUES (${ev.boardId}, ${ev.cardId ?? null}, ${ev.actorId}, ${ev.action},
              ${JSON.stringify(ev.payload || {})}::jsonb)
    `;
  }
  if (!ev.eventText) return;

  const [room] = ev.boardId
    ? await tx<{ id: string }>`SELECT id FROM rooms WHERE board_id = ${ev.boardId} LIMIT 1`
    : await tx<{ id: string }>`
        SELECT id FROM rooms
        WHERE workspace_id = ${ev.workspaceId} AND type = 'group'
        ORDER BY created_at ASC LIMIT 1
      `;
  if (!room) return;
  await tx`
    INSERT INTO messages (room_id, sender_id, type, content, card_id)
    VALUES (${room.id}, ${ev.boardId ? ev.actorId : null},
            ${ev.boardId ? "task_event" : "system"}, ${ev.eventText}, ${ev.cardId ?? null})
  `;
}

export async function createNotifications(
  sql: BunSqlClient,
  userIds: string[],
  type: string,
  refType: "card" | "message" | "room" | "workspace",
  refId: string,
): Promise<void> {
  for (const userId of new Set(userIds)) {
    await sql`
      INSERT INTO notifications (user_id, type, ref_type, ref_id)
      VALUES (${userId}, ${type}, ${refType}, ${refId})
    `;
  }
}

export function deepLink(
  origin: string,
  params: Record<string, string | null | undefined>,
): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${origin.replace(/\/+$/, "")}/${qs ? `?${qs}` : ""}`;
}

interface Recipient {
  id: string;
  name: string;
  email: string;
  notify_chat_email: boolean;
  notify_mention_email: boolean;
  notify_activity_email: boolean;
}

/**
 * Emails every workspace member who can see the affected board (private
 * boards: board members only), except the actor, honouring both the
 * workspace switch and each user's own "email aktivitas" preference.
 */
export async function notifyActivity(
  sql: BunSqlClient,
  origin: string,
  ev: ActivityEvent,
  opts: { onlyUserIds?: string[]; excludeUserIds?: string[]; includeActor?: boolean } = {},
): Promise<number> {
  const [ws] = await sql<{ name: string; email_activity_enabled: boolean }>`
    SELECT name, email_activity_enabled FROM workspaces WHERE id = ${ev.workspaceId}
  `;
  if (!ws || !ws.email_activity_enabled) return 0;

  const [board] = ev.boardId
    ? await sql<{ name: string; visibility: string }>`
        SELECT name, visibility FROM boards WHERE id = ${ev.boardId}
      `
    : [];
  const [card] = ev.cardId
    ? await sql<{ title: string }>`SELECT title FROM cards WHERE id = ${ev.cardId}`
    : [];
  const [actor] = await sql<{ name: string }>`SELECT name FROM users WHERE id = ${ev.actorId}`;

  let recipients = await sql<Recipient & { board_member: boolean }>`
    SELECT u.id, u.name, u.email, u.notify_chat_email, u.notify_mention_email,
           u.notify_activity_email,
           EXISTS (
             SELECT 1 FROM board_members bm
             WHERE bm.board_id = ${ev.boardId} AND bm.user_id = u.id
           ) AS board_member
    FROM workspace_members wm
    INNER JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = ${ev.workspaceId} AND u.is_active = true
  `;
  if (board?.visibility === "private") {
    recipients = recipients.filter((r) => r.board_member);
  }
  if (opts.onlyUserIds) {
    const only = new Set(opts.onlyUserIds);
    recipients = recipients.filter((r) => only.has(r.id));
  }
  if (opts.excludeUserIds?.length) {
    const excluded = new Set(opts.excludeUserIds);
    recipients = recipients.filter((r) => !excluded.has(r.id));
  }

  const url = deepLink(origin, {
    workspace: ev.workspaceId,
    board: ev.boardId,
    card: ev.cardId,
  });
  let sent = 0;
  for (const r of recipients) {
    if (!opts.includeActor && r.id === ev.actorId) continue;
    if (!r.notify_activity_email) continue;
    const mail = activityEmail({
      action: ev.action,
      actorName: actor?.name || "Seseorang",
      recipientName: r.name,
      workspaceName: ws.name,
      boardName: board?.name,
      cardTitle: card?.title,
      payload: ev.payload || {},
      url,
    });
    enqueueEmail({ to: r.email, subject: mail.subject, html: mail.html });
    sent += 1;
  }
  return sent;
}

/**
 * Chat fan-out: mentions always notify in-app and email when the user allows
 * mention emails; every other message emails room members only when both the
 * workspace "email chat" switch and the user's "email semua pesan chat"
 * preference are on and the room is not muted.
 */
export async function notifyChatMessage(
  sql: BunSqlClient,
  origin: string,
  messageId: string,
): Promise<{ emailed: string[]; mentioned: string[] }> {
  const [msg] = await sql<{
    id: string;
    room_id: string;
    sender_id: string;
    content: string | null;
    type: string;
    sender_name: string;
    room_name: string | null;
    room_type: string;
    workspace_id: string;
    workspace_name: string;
    email_chat_enabled: boolean;
  }>`
    SELECT m.id, m.room_id, m.sender_id, m.content, m.type, u.name AS sender_name,
           r.name AS room_name, r.type AS room_type, r.workspace_id,
           w.name AS workspace_name, w.email_chat_enabled
    FROM messages m
    INNER JOIN users u ON u.id = m.sender_id
    INNER JOIN rooms r ON r.id = m.room_id
    INNER JOIN workspaces w ON w.id = r.workspace_id
    WHERE m.id = ${messageId}
  `;
  if (!msg) return { emailed: [], mentioned: [] };

  const members = await sql<Recipient & { muted: boolean; mentioned: boolean }>`
    SELECT u.id, u.name, u.email, u.notify_chat_email, u.notify_mention_email,
           u.notify_activity_email,
           (rm.muted_until IS NOT NULL AND rm.muted_until > now()) AS muted,
           EXISTS (
             SELECT 1 FROM message_mentions mm
             WHERE mm.message_id = ${messageId} AND mm.user_id = u.id
           ) AS mentioned
    FROM room_members rm
    INNER JOIN users u ON u.id = rm.user_id
    WHERE rm.room_id = ${msg.room_id} AND u.is_active = true AND u.id <> ${msg.sender_id}
  `;

  const isDirect = msg.room_type === "direct";
  const url = deepLink(origin, { workspace: msg.workspace_id, room: msg.room_id });
  const emailed: string[] = [];
  const mentioned = members.filter((m) => m.mentioned).map((m) => m.id);

  await createNotifications(sql, mentioned, "mention", "message", msg.id);
  if (isDirect) {
    await createNotifications(
      sql,
      members.filter((m) => !m.mentioned).map((m) => m.id),
      "new_message",
      "message",
      msg.id,
    );
  }

  const content =
    msg.type === "text" ? msg.content || "" : `[${msg.type === "image" ? "Gambar" : "File"}] ${msg.content || ""}`;
  for (const m of members) {
    const shouldEmail = m.mentioned
      ? m.notify_mention_email
      : msg.email_chat_enabled && m.notify_chat_email && !m.muted;
    if (!shouldEmail) continue;
    const mail = chatMessageEmail({
      recipientName: m.name,
      senderName: msg.sender_name,
      roomName: isDirect ? msg.sender_name : msg.room_name || "chat",
      workspaceName: msg.workspace_name,
      content,
      mentioned: m.mentioned,
      isDirect,
      url,
    });
    enqueueEmail({ to: m.email, subject: mail.subject, html: mail.html });
    emailed.push(m.id);
  }
  return { emailed, mentioned };
}

/**
 * Notifies assignees of cards due within 24 hours (RD notification type
 * `due_soon`). Each card/user pair is notified at most once per due date.
 */
export async function scanDueSoon(
  sql: BunSqlClient,
  origin: string,
): Promise<string[]> {
  const rows = await sql<{
    card_id: string;
    user_id: string;
    board_id: string;
    workspace_id: string;
    due_at: string;
  }>`
    SELECT c.id AS card_id, ca.user_id, c.board_id, b.workspace_id, c.due_at::text AS due_at
    FROM cards c
    INNER JOIN card_assignees ca ON ca.card_id = c.id
    INNER JOIN boards b ON b.id = c.board_id
    WHERE c.archived_at IS NULL AND b.archived_at IS NULL
      AND c.completed_at IS NULL
      AND c.due_at IS NOT NULL
      AND c.due_at > now() AND c.due_at <= now() + interval '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = ca.user_id AND n.type = 'due_soon'
          AND n.ref_id = c.id AND n.created_at >= c.due_at - interval '24 hours'
      )
  `;
  const workspaces = new Set<string>();
  for (const r of rows) {
    await createNotifications(sql, [r.user_id], "due_soon", "card", r.card_id);
    await notifyActivity(
      sql,
      origin,
      {
        workspaceId: r.workspace_id,
        boardId: r.board_id,
        cardId: r.card_id,
        actorId: r.user_id,
        action: "due_soon",
        payload: { due_at: r.due_at },
      },
      { onlyUserIds: [r.user_id], includeActor: true },
    );
    workspaces.add(r.workspace_id);
  }
  return [...workspaces];
}
