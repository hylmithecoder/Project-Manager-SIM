import type { BunSqlClient } from "../bun-env";
import { toMeDto, type AuthUserRow } from "../auth/auth";
import { getSmtpConfig } from "../services/smtp";
import type {
  ActivityDto,
  AttachmentDto,
  BoardDto,
  CardDto,
  ChecklistDto,
  ChecklistItemDto,
  DevAccountDto,
  DevConsoleDto,
  DevWorkspaceDto,
  InvitationDto,
  LabelDto,
  ListDto,
  MessageDto,
  NotificationDto,
  RoomDto,
  SmtpStatusDto,
  UserDto,
  WorkspaceDto,
  WorkspaceMemberDto,
  WorkspaceRole,
  WorkspaceSnapshot,
} from "./protocol";

const MESSAGES_PER_ROOM = 200;

export function smtpStatus(): SmtpStatusDto {
  const c = getSmtpConfig();
  return {
    ok: c.enabled,
    message: c.enabled
      ? `Layanan SMTP aktif (${c.host}:${c.port})`
      : "Layanan SMTP dinonaktifkan (SMTP_ENABLED=false)",
    host: c.host,
    port: c.port,
    user: c.user,
    enabled: c.enabled,
  };
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export async function listMyWorkspaces(
  sql: BunSqlClient,
  userId: string,
): Promise<WorkspaceDto[]> {
  return sql<WorkspaceDto>`
    SELECT w.id, w.name, w.slug, w.owner_id, wm.role AS my_role,
           w.email_chat_enabled, w.email_activity_enabled
    FROM workspace_members wm
    INNER JOIN workspaces w ON w.id = wm.workspace_id
    WHERE wm.user_id = ${userId}
    ORDER BY w.created_at ASC
  `;
}

/** Notification titles are resolved server-side so the bell needs no joins. */
async function loadNotifications(
  sql: BunSqlClient,
  userId: string,
): Promise<NotificationDto[]> {
  return sql<NotificationDto>`
    SELECT n.id, n.user_id, n.type, n.ref_type, n.ref_id, n.is_read,
           n.created_at::text AS created_at,
           CASE
             WHEN n.type = 'mention' THEN COALESCE(su.name, 'Seseorang') || ' menyebut Anda: ' || LEFT(COALESCE(m.content, ''), 80)
             WHEN n.type = 'new_message' THEN 'Pesan baru dari ' || COALESCE(su.name, 'Seseorang') || ': ' || LEFT(COALESCE(m.content, ''), 80)
             WHEN n.type = 'assigned' THEN 'Anda ditugaskan pada card "' || COALESCE(c.title, '-') || '"'
             WHEN n.type = 'due_soon' THEN 'Deadline dekat: "' || COALESCE(c.title, '-') || '"'
             WHEN n.type = 'member_joined' THEN 'Anggota baru bergabung ke ' || COALESCE(w.name, 'workspace')
             ELSE n.type
           END AS title
    FROM notifications n
    LEFT JOIN messages m ON n.ref_type = 'message' AND m.id = n.ref_id
    LEFT JOIN users su ON su.id = m.sender_id
    LEFT JOIN cards c ON n.ref_type = 'card' AND c.id = n.ref_id
    LEFT JOIN workspaces w ON n.ref_type = 'workspace' AND w.id = n.ref_id
    WHERE n.user_id = ${userId}
    ORDER BY n.created_at DESC
    LIMIT 50
  `;
}

function emptySnapshot(
  user: AuthUserRow,
  workspaces: WorkspaceDto[],
): WorkspaceSnapshot {
  return {
    me: toMeDto(user),
    workspaces,
    active_workspace_id: null,
    users: [],
    workspace_members: [],
    invitations: [],
    boards: [],
    lists: [],
    labels: [],
    cards: [],
    rooms: [],
    messages: [],
    activities: [],
    notifications: [],
  };
}

/**
 * Builds the snapshot a single user is allowed to see: only workspaces they
 * belong to, only boards they can access, only rooms they are a member of.
 * Developers get the account console instead of any workspace content.
 */
export async function buildSnapshot(
  sql: BunSqlClient,
  user: AuthUserRow,
  requestedWorkspaceId: string | null,
  online: ReadonlySet<string>,
): Promise<WorkspaceSnapshot> {
  if (user.platform_role === "developer") {
    const snap = emptySnapshot(user, []);
    snap.dev = await buildDevConsole(sql, online);
    snap.smtp_status = snap.dev.smtp_status;
    return snap;
  }

  const workspaces = await listMyWorkspaces(sql, user.id);
  const active =
    workspaces.find((w) => w.id === requestedWorkspaceId) || workspaces[0];
  const snap = emptySnapshot(user, workspaces);
  snap.notifications = await loadNotifications(sql, user.id);
  if (!active) return snap;

  const wsId = active.id;
  const uid = user.id;
  const isManager = active.my_role === "owner" || active.my_role === "admin";
  snap.active_workspace_id = wsId;

  snap.workspace_members = await sql<WorkspaceMemberDto>`
    SELECT wm.workspace_id, wm.user_id, wm.role, wm.joined_at::text AS joined_at,
           u.name AS user_name, u.email AS user_email, u.avatar_url
    FROM workspace_members wm
    INNER JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = ${wsId}
    ORDER BY CASE wm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'member' THEN 3 ELSE 4 END,
             wm.joined_at ASC
  `;

  const users = await sql<Omit<UserDto, "online">>`
    SELECT u.id, u.name, u.email, u.phone, u.avatar_url, u.last_seen_at::text AS last_seen_at
    FROM users u
    INNER JOIN workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = ${wsId}
    ORDER BY u.name ASC
  `;
  snap.users = users.map((u) => ({ ...u, online: online.has(u.id) }));

  if (isManager) {
    snap.invitations = await sql<InvitationDto>`
      SELECT t.id, t.email, t.role, t.workspace_id, u.name AS created_by_name,
             t.created_at::text AS created_at, t.expires_at::text AS expires_at
      FROM account_tokens t
      LEFT JOIN users u ON u.id = t.created_by
      WHERE t.workspace_id = ${wsId} AND t.purpose = 'invite'
        AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > now()
      ORDER BY t.created_at DESC
    `;
    snap.smtp_status = smtpStatus();
  }

  // --- Boards visible to this user ---
  const boardRows = await sql<Omit<BoardDto, "member_ids">>`
    SELECT b.id, b.workspace_id, b.name, b.visibility, b.created_by,
           b.archived_at::text AS archived_at, r.id AS room_id
    FROM boards b
    LEFT JOIN rooms r ON r.board_id = b.id
    WHERE b.workspace_id = ${wsId} AND b.archived_at IS NULL
      AND (
        b.visibility = 'workspace'
        OR EXISTS (SELECT 1 FROM board_members bm WHERE bm.board_id = b.id AND bm.user_id = ${uid})
      )
    ORDER BY b.created_at ASC
  `;
  const boardIds = new Set(boardRows.map((b) => b.id));
  const boardMembers = groupBy(
    await sql<{ board_id: string; user_id: string }>`
      SELECT bm.board_id, bm.user_id FROM board_members bm
      INNER JOIN boards b ON b.id = bm.board_id
      WHERE b.workspace_id = ${wsId}
    `,
    (r) => r.board_id,
  );
  snap.boards = boardRows.map((b) => ({
    ...b,
    member_ids: (boardMembers.get(b.id) || []).map((m) => m.user_id),
  }));

  snap.lists = (
    await sql<ListDto>`
      SELECT l.id, l.board_id, l.name, l.position::float8 AS position, l.archived_at::text AS archived_at
      FROM lists l INNER JOIN boards b ON b.id = l.board_id
      WHERE b.workspace_id = ${wsId} AND l.archived_at IS NULL
      ORDER BY l.position ASC, l.name ASC
    `
  ).filter((l) => boardIds.has(l.board_id));

  snap.labels = (
    await sql<LabelDto>`
      SELECT lb.id, lb.board_id, lb.name, lb.color
      FROM labels lb INNER JOIN boards b ON b.id = lb.board_id
      WHERE b.workspace_id = ${wsId}
      ORDER BY lb.name ASC
    `
  ).filter((l) => boardIds.has(l.board_id));

  const rawCards = (
    await sql<
      Omit<CardDto, "assignee_ids" | "label_ids" | "checklists" | "checklist_items" | "attachments">
    >`
      SELECT c.id, c.list_id, c.board_id, c.title, c.description,
             c.position::float8 AS position, c.due_at::text AS due_at,
             c.completed_at::text AS completed_at, c.created_by, c.source_message_id,
             c.archived_at::text AS archived_at, c.created_at::text AS created_at,
             r.id AS room_id
      FROM cards c
      INNER JOIN boards b ON b.id = c.board_id
      INNER JOIN lists l ON l.id = c.list_id AND l.archived_at IS NULL
      LEFT JOIN rooms r ON r.card_id = c.id
      WHERE b.workspace_id = ${wsId} AND c.archived_at IS NULL
      ORDER BY c.position ASC, c.created_at ASC
    `
  ).filter((c) => boardIds.has(c.board_id));

  const assignees = groupBy(
    await sql<{ card_id: string; user_id: string }>`
      SELECT ca.card_id, ca.user_id FROM card_assignees ca
      INNER JOIN cards c ON c.id = ca.card_id
      INNER JOIN boards b ON b.id = c.board_id
      WHERE b.workspace_id = ${wsId}
    `,
    (r) => r.card_id,
  );
  const cardLabels = groupBy(
    await sql<{ card_id: string; label_id: string }>`
      SELECT cl.card_id, cl.label_id FROM card_labels cl
      INNER JOIN cards c ON c.id = cl.card_id
      INNER JOIN boards b ON b.id = c.board_id
      WHERE b.workspace_id = ${wsId}
    `,
    (r) => r.card_id,
  );
  const checklistRows = await sql<Omit<ChecklistDto, "items">>`
    SELECT ch.id, ch.card_id, ch.title, ch.position::float8 AS position
    FROM checklists ch
    INNER JOIN cards c ON c.id = ch.card_id
    INNER JOIN boards b ON b.id = c.board_id
    WHERE b.workspace_id = ${wsId}
    ORDER BY ch.position ASC
  `;
  const itemsByChecklist = groupBy(
    await sql<ChecklistItemDto>`
      SELECT ci.id, ci.checklist_id, ch.card_id, ci.content, ci.is_done, ci.assignee_id,
             ci.due_at::text AS due_at, ci.position::float8 AS position
      FROM checklist_items ci
      INNER JOIN checklists ch ON ch.id = ci.checklist_id
      INNER JOIN cards c ON c.id = ch.card_id
      INNER JOIN boards b ON b.id = c.board_id
      WHERE b.workspace_id = ${wsId}
      ORDER BY ci.position ASC
    `,
    (r) => r.checklist_id,
  );
  const checklistsByCard = groupBy(
    checklistRows.map((ch) => ({ ...ch, items: itemsByChecklist.get(ch.id) || [] })),
    (ch) => ch.card_id,
  );
  const attachmentRows = await sql<AttachmentDto>`
    SELECT a.id, a.uploader_id, a.card_id, a.message_id, a.file_url, a.file_name,
           a.mime_type, a.size_bytes::float8 AS size_bytes, a.created_at::text AS created_at
    FROM attachments a
    LEFT JOIN cards c ON c.id = a.card_id
    LEFT JOIN boards b ON b.id = c.board_id
    LEFT JOIN messages m ON m.id = a.message_id
    LEFT JOIN rooms r ON r.id = m.room_id
    WHERE b.workspace_id = ${wsId} OR r.workspace_id = ${wsId}
    ORDER BY a.created_at ASC
  `;
  const cardAttachments = groupBy(
    attachmentRows.filter((a) => a.card_id),
    (a) => a.card_id,
  );
  const messageAttachments = groupBy(
    attachmentRows.filter((a) => a.message_id),
    (a) => a.message_id,
  );

  snap.cards = rawCards.map((c) => {
    const checklists = checklistsByCard.get(c.id) || [];
    return {
      ...c,
      assignee_ids: (assignees.get(c.id) || []).map((a) => a.user_id),
      label_ids: (cardLabels.get(c.id) || []).map((l) => l.label_id),
      checklists,
      checklist_items: checklists.flatMap((ch) => ch.items),
      attachments: cardAttachments.get(c.id) || [],
    };
  });

  // --- Rooms this user is a member of ---
  const roomRows = await sql<Omit<RoomDto, "member_ids" | "admin_ids">>`
    SELECT r.id, r.workspace_id, r.type, r.name, r.board_id, r.card_id,
           r.only_admins_can_send, r.created_by,
           me.role AS my_role, me.muted_until::text AS muted_until,
           (
             SELECT COUNT(*)::int FROM messages m
             WHERE m.room_id = r.id AND m.deleted_at IS NULL
               AND (m.sender_id IS NULL OR m.sender_id <> ${uid})
               AND m.created_at > COALESCE(
                 (SELECT lm.created_at FROM messages lm WHERE lm.id = me.last_read_message_id),
                 me.joined_at - interval '1 second'
               )
           ) AS unread_count,
           (SELECT MAX(m.created_at)::text FROM messages m WHERE m.room_id = r.id) AS last_message_at
    FROM rooms r
    INNER JOIN room_members me ON me.room_id = r.id AND me.user_id = ${uid}
    WHERE r.workspace_id = ${wsId}
    ORDER BY CASE r.type WHEN 'group' THEN 1 WHEN 'board' THEN 2 WHEN 'card' THEN 3 ELSE 4 END,
             r.created_at ASC
  `;
  const visibleRooms = roomRows.filter(
    (r) => !r.board_id || boardIds.has(r.board_id),
  );
  const roomIds = new Set(visibleRooms.map((r) => r.id));
  const roomMembers = groupBy(
    await sql<{ room_id: string; user_id: string; role: string }>`
      SELECT rm.room_id, rm.user_id, rm.role FROM room_members rm
      INNER JOIN rooms r ON r.id = rm.room_id
      WHERE r.workspace_id = ${wsId}
    `,
    (r) => r.room_id,
  );
  snap.rooms = visibleRooms.map((r) => {
    const members = roomMembers.get(r.id) || [];
    return {
      ...r,
      member_ids: members.map((m) => m.user_id),
      admin_ids: members.filter((m) => m.role === "admin").map((m) => m.user_id),
    };
  });

  // --- Messages (latest N per visible room) ---
  type MessageRow = Omit<
    MessageDto,
    "reactions" | "mention_ids" | "delivered_to" | "read_by" | "attachments"
  >;
  const rawMessages: MessageRow[] = (
    await sql<MessageRow & { rn: number }>`
      SELECT * FROM (
        SELECT m.id, m.room_id, m.sender_id, u.name AS sender_name, m.type,
               CASE WHEN m.deleted_at IS NOT NULL THEN 'Pesan ini telah dihapus' ELSE m.content END AS content,
               m.reply_to_id, m.card_id, c.title AS card_title,
               m.edited_at::text AS edited_at, m.deleted_at::text AS deleted_at,
               m.created_at::text AS created_at,
               ROW_NUMBER() OVER (PARTITION BY m.room_id ORDER BY m.created_at DESC) AS rn
        FROM messages m
        INNER JOIN rooms r ON r.id = m.room_id
        LEFT JOIN users u ON u.id = m.sender_id
        LEFT JOIN cards c ON c.id = m.card_id
        WHERE r.workspace_id = ${wsId}
      ) t
      WHERE t.rn <= ${MESSAGES_PER_ROOM}
      ORDER BY t.created_at ASC
    `
  )
    .filter((m) => roomIds.has(m.room_id))
    .map((row) => {
      const m: MessageRow & { rn?: number } = { ...row };
      delete m.rn;
      return m;
    });

  const reactions = groupBy(
    await sql<{ message_id: string; user_id: string; emoji: string }>`
      SELECT mr.message_id, mr.user_id, mr.emoji FROM message_reactions mr
      INNER JOIN messages m ON m.id = mr.message_id
      INNER JOIN rooms r ON r.id = m.room_id
      WHERE r.workspace_id = ${wsId}
    `,
    (r) => r.message_id,
  );
  const mentions = groupBy(
    await sql<{ message_id: string; user_id: string }>`
      SELECT mm.message_id, mm.user_id FROM message_mentions mm
      INNER JOIN messages m ON m.id = mm.message_id
      INNER JOIN rooms r ON r.id = m.room_id
      WHERE r.workspace_id = ${wsId}
    `,
    (r) => r.message_id,
  );
  const receipts = groupBy(
    await sql<{ message_id: string; user_id: string; delivered: boolean; read: boolean }>`
      SELECT mr.message_id, mr.user_id, (mr.delivered_at IS NOT NULL) AS delivered,
             (mr.read_at IS NOT NULL) AS read
      FROM message_receipts mr
      INNER JOIN messages m ON m.id = mr.message_id
      INNER JOIN rooms r ON r.id = m.room_id
      WHERE r.workspace_id = ${wsId} AND m.sender_id = ${uid}
    `,
    (r) => r.message_id,
  );

  snap.messages = rawMessages.map((m) => {
    const rc = (receipts.get(m.id) || []).filter((r) => r.user_id !== m.sender_id);
    return {
      ...m,
      reactions: reactions.get(m.id) || [],
      mention_ids: (mentions.get(m.id) || []).map((x) => x.user_id),
      delivered_to: rc.filter((r) => r.delivered || r.read).map((r) => r.user_id),
      read_by: rc.filter((r) => r.read).map((r) => r.user_id),
      attachments: m.deleted_at ? [] : messageAttachments.get(m.id) || [],
    };
  });

  snap.activities = (
    await sql<ActivityDto>`
      SELECT a.id, a.board_id, a.card_id, a.actor_id, u.name AS actor_name, a.action,
             a.payload, a.created_at::text AS created_at
      FROM activities a
      INNER JOIN users u ON u.id = a.actor_id
      INNER JOIN boards b ON b.id = a.board_id
      WHERE b.workspace_id = ${wsId}
      ORDER BY a.created_at DESC
      LIMIT 100
    `
  ).filter((a) => boardIds.has(a.board_id));

  return snap;
}

/** Account-level data only: no boards, cards, rooms or messages. */
export async function buildDevConsole(
  sql: BunSqlClient,
  online: ReadonlySet<string>,
): Promise<DevConsoleDto> {
  const accounts = await sql<Omit<DevAccountDto, "memberships" | "online">>`
    SELECT id, name, email, platform_role, is_active, created_at::text AS created_at,
           last_seen_at::text AS last_seen_at
    FROM users
    ORDER BY platform_role DESC, created_at ASC
  `;
  const memberships = groupBy(
    await sql<{ user_id: string; workspace_id: string; workspace_name: string; role: WorkspaceRole }>`
      SELECT wm.user_id, wm.workspace_id, w.name AS workspace_name, wm.role
      FROM workspace_members wm INNER JOIN workspaces w ON w.id = wm.workspace_id
      ORDER BY w.name ASC
    `,
    (r) => r.user_id,
  );
  const workspaces = await sql<DevWorkspaceDto>`
    SELECT w.id, w.name, w.slug, w.owner_id, u.name AS owner_name, u.email AS owner_email,
           (SELECT COUNT(*)::int FROM workspace_members wm WHERE wm.workspace_id = w.id) AS member_count,
           w.created_at::text AS created_at
    FROM workspaces w
    LEFT JOIN users u ON u.id = w.owner_id
    ORDER BY w.created_at ASC
  `;
  const pending_tokens = await sql<InvitationDto>`
    SELECT t.id, t.email, t.role, t.workspace_id, u.name AS created_by_name,
           t.created_at::text AS created_at, t.expires_at::text AS expires_at
    FROM account_tokens t
    LEFT JOIN users u ON u.id = t.created_by
    WHERE t.purpose = 'invite' AND t.role IN ('owner', 'admin')
      AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > now()
    ORDER BY t.created_at DESC
  `;
  return {
    accounts: accounts.map((a) => ({
      ...a,
      online: online.has(a.id),
      memberships: (memberships.get(a.id) || []).map((m) => ({
        workspace_id: m.workspace_id,
        workspace_name: m.workspace_name,
        role: m.role,
      })),
    })),
    workspaces,
    pending_tokens,
    smtp_status: smtpStatus(),
  };
}
