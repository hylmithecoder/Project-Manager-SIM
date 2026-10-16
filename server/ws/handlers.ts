import type { BunSqlClient } from "../bun-env";
import { SEED_IDS } from "../database/seeder";
import {
  getSmtpConfig,
  sendEmail,
  sendWorkspaceInvitationEmail,
  verifySmtpConnection,
} from "../services/smtp";
import type {
  ActivityDto,
  BoardDto,
  CardDto,
  ChecklistItemDto,
  LabelDto,
  ListDto,
  MessageDto,
  MessageReactionDto,
  NotificationDto,
  RoomDto,
  SmtpStatusDto,
  UserDto,
  WorkspaceDto,
  WorkspaceMemberDto,
  WorkspaceSnapshot,
  WsAction,
} from "./protocol";

export async function fetchWorkspaceSnapshot(
  sql: BunSqlClient,
): Promise<WorkspaceSnapshot> {
  const users = await sql<UserDto>`
    SELECT id, name, email, phone, avatar_url, last_seen_at::text AS last_seen_at
    FROM users
    ORDER BY created_at ASC
  `;

  const workspaces = await sql<WorkspaceDto>`
    SELECT id, name, slug, owner_id
    FROM workspaces
    ORDER BY created_at ASC
  `;

  const boards = await sql<BoardDto>`
    SELECT
      b.id,
      b.workspace_id,
      b.name,
      b.visibility,
      b.created_by,
      b.archived_at::text AS archived_at,
      r.id AS room_id
    FROM boards b
    LEFT JOIN rooms r ON r.board_id = b.id
    WHERE b.archived_at IS NULL
    ORDER BY b.created_at ASC
  `;

  const lists = await sql<ListDto>`
    SELECT
      id,
      board_id,
      name,
      position::float8 AS position,
      archived_at::text AS archived_at
    FROM lists
    WHERE archived_at IS NULL
    ORDER BY position ASC, name ASC
  `;

  const labels = await sql<LabelDto>`
    SELECT id, board_id, name, color
    FROM labels
    ORDER BY name ASC
  `;

  const rawCards = await sql<
    Omit<CardDto, "assignee_ids" | "label_ids" | "checklist_items">
  >`
    SELECT
      id,
      list_id,
      board_id,
      title,
      description,
      position::float8 AS position,
      due_at::text AS due_at,
      completed_at::text AS completed_at,
      created_by,
      source_message_id,
      archived_at::text AS archived_at,
      created_at::text AS created_at
    FROM cards
    WHERE archived_at IS NULL
    ORDER BY position ASC, created_at ASC
  `;

  const assignees = await sql<{ card_id: string; user_id: string }>`
    SELECT card_id, user_id FROM card_assignees
  `;

  const cardLabels = await sql<{ card_id: string; label_id: string }>`
    SELECT card_id, label_id FROM card_labels
  `;

  const checklistItems = await sql<ChecklistItemDto>`
    SELECT
      ci.id,
      ci.checklist_id,
      c.card_id,
      ci.content,
      ci.is_done,
      ci.assignee_id,
      ci.position::float8 AS position
    FROM checklist_items ci
    INNER JOIN checklists c ON c.id = ci.checklist_id
    ORDER BY ci.position ASC
  `;

  const cards: CardDto[] = rawCards.map((card) => ({
    ...card,
    assignee_ids: assignees
      .filter((a) => a.card_id === card.id)
      .map((a) => a.user_id),
    label_ids: cardLabels
      .filter((cl) => cl.card_id === card.id)
      .map((cl) => cl.label_id),
    checklist_items: checklistItems.filter((ci) => ci.card_id === card.id),
  }));

  const rooms = await sql<RoomDto>`
    SELECT
      id,
      workspace_id,
      type,
      name,
      board_id,
      card_id,
      only_admins_can_send,
      created_by
    FROM rooms
    ORDER BY created_at ASC
  `;

  const reactions = await sql<MessageReactionDto>`
    SELECT message_id, user_id, emoji
    FROM message_reactions
  `;

  const rawMessages = await sql<Omit<MessageDto, "reactions">>`
    SELECT
      m.id,
      m.room_id,
      m.sender_id,
      u.name AS sender_name,
      m.type,
      CASE
        WHEN m.deleted_at IS NOT NULL THEN 'Pesan ini telah dihapus'
        ELSE m.content
      END AS content,
      m.reply_to_id,
      m.card_id,
      c.title AS card_title,
      m.edited_at::text AS edited_at,
      m.deleted_at::text AS deleted_at,
      m.created_at::text AS created_at
    FROM messages m
    LEFT JOIN users u ON u.id = m.sender_id
    LEFT JOIN cards c ON c.id = m.card_id
    ORDER BY m.created_at ASC
  `;

  const messages: MessageDto[] = rawMessages.map((msg) => ({
    ...msg,
    reactions: reactions.filter((r) => r.message_id === msg.id),
  }));

  const activities = await sql<ActivityDto>`
    SELECT
      a.id,
      a.board_id,
      a.card_id,
      a.actor_id,
      u.name AS actor_name,
      a.action,
      a.payload,
      a.created_at::text AS created_at
    FROM activities a
    INNER JOIN users u ON u.id = a.actor_id
    ORDER BY a.created_at DESC
    LIMIT 30
  `;

  const notifications = await sql<NotificationDto>`
    SELECT
      id,
      user_id,
      type,
      ref_type,
      ref_id,
      is_read,
      created_at::text AS created_at
    FROM notifications
    ORDER BY created_at DESC
    LIMIT 30
  `;

  const workspace_members = await sql<WorkspaceMemberDto>`
    SELECT
      wm.workspace_id,
      wm.user_id,
      wm.role,
      wm.joined_at::text AS joined_at,
      u.name AS user_name,
      u.email AS user_email,
      u.avatar_url
    FROM workspace_members wm
    INNER JOIN users u ON u.id = wm.user_id
    ORDER BY
      CASE wm.role
        WHEN 'owner' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'member' THEN 3
        ELSE 4
      END ASC,
      wm.joined_at ASC
  `;

  const smtpConfig = getSmtpConfig();
  const smtp_status: SmtpStatusDto = {
    ok: smtpConfig.enabled,
    message: smtpConfig.enabled
      ? `Layanan SMTP Aktif (${smtpConfig.host}:${smtpConfig.port})`
      : "Layanan SMTP dinonaktifkan di .env",
    host: smtpConfig.host,
    port: smtpConfig.port,
    user: smtpConfig.user,
    enabled: smtpConfig.enabled,
  };

  return {
    users,
    workspaces,
    workspace_members,
    boards,
    lists,
    labels,
    cards,
    rooms,
    messages,
    activities,
    notifications,
    smtp_status,
  };
}

async function emitBoardTaskEvent(
  tx: BunSqlClient,
  params: {
    boardId: string;
    cardId: string | null;
    actorId: string;
    action: string;
    eventText: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await tx`
    INSERT INTO activities (board_id, card_id, actor_id, action, payload)
    VALUES (
      ${params.boardId},
      ${params.cardId},
      ${params.actorId},
      ${params.action},
      ${JSON.stringify(params.payload || {})}::jsonb
    )
  `;

  const boardRooms = await tx<{ id: string }>`
    SELECT id FROM rooms WHERE board_id = ${params.boardId} LIMIT 1
  `;

  if (boardRooms.length > 0) {
    await tx`
      INSERT INTO messages (room_id, sender_id, type, content, card_id)
      VALUES (
        ${boardRooms[0].id},
        ${params.actorId},
        'task_event',
        ${params.eventText},
        ${params.cardId}
      )
    `;
  }
}

export async function handleWsAction(
  sql: BunSqlClient,
  action: WsAction,
  payload: Record<string, unknown> = {},
): Promise<{ mutated: boolean; result: unknown }> {
  const defaultActorId =
    (typeof payload.actor_id === "string" && payload.actor_id) ||
    SEED_IDS.users.hylmi;

  switch (action) {
    case "state:init": {
      const snapshot = await fetchWorkspaceSnapshot(sql);
      return { mutated: false, result: snapshot };
    }

    case "board:create": {
      const name = String(payload.name || "").trim();
      if (!name) throw new Error("Board name is required");
      const workspaceId = String(payload.workspace_id || SEED_IDS.workspace);
      const visibility =
        payload.visibility === "private" ? "private" : "workspace";

      const created = await sql.begin(async (tx) => {
        const [board] = await tx<{ id: string; name: string }>`
          INSERT INTO boards (workspace_id, name, visibility, created_by)
          VALUES (${workspaceId}, ${name}, ${visibility}, ${defaultActorId})
          RETURNING id, name
        `;

        await tx`
          INSERT INTO board_members (board_id, user_id, role)
          VALUES (${board.id}, ${defaultActorId}, 'admin')
          ON CONFLICT DO NOTHING
        `;

        const [room] = await tx<{ id: string }>`
          INSERT INTO rooms (workspace_id, type, name, board_id, only_admins_can_send, created_by)
          VALUES (${workspaceId}, 'board', ${`Diskusi ${name}`}, ${board.id}, false, ${defaultActorId})
          RETURNING id
        `;

        await tx`
          INSERT INTO room_members (room_id, user_id, role)
          VALUES (${room.id}, ${defaultActorId}, 'admin')
          ON CONFLICT DO NOTHING
        `;

        await tx`
          INSERT INTO lists (board_id, name, position)
          VALUES
            (${board.id}, 'To Do', 1000),
            (${board.id}, 'Doing', 2000),
            (${board.id}, 'Done', 3000)
        `;

        return { ...board, room_id: room.id };
      });

      return { mutated: true, result: created };
    }

    case "board:update": {
      const boardId = String(payload.board_id || "");
      const name = String(payload.name || "").trim();
      if (!boardId || !name) {
        throw new Error("board_id and name are required");
      }
      const [updated] = await sql`
        UPDATE boards SET name = ${name} WHERE id = ${boardId} RETURNING id, name
      `;
      return { mutated: true, result: updated };
    }

    case "board:delete": {
      const boardId = String(payload.board_id || "");
      if (!boardId) throw new Error("board_id is required");
      await sql`
        UPDATE boards SET archived_at = now() WHERE id = ${boardId}
      `;
      return { mutated: true, result: { id: boardId } };
    }

    case "list:create": {
      const boardId = String(payload.board_id || SEED_IDS.board);
      const name = String(payload.name || "").trim();
      if (!name) throw new Error("List name is required");

      const [maxPos] = await sql<{ max_pos: number | null }>`
        SELECT COALESCE(MAX(position), 0)::float8 AS max_pos
        FROM lists
        WHERE board_id = ${boardId} AND archived_at IS NULL
      `;
      const position = (maxPos?.max_pos || 0) + 1000;

      const [list] = await sql`
        INSERT INTO lists (board_id, name, position)
        VALUES (${boardId}, ${name}, ${position})
        RETURNING id, board_id, name, position::float8 AS position
      `;
      return { mutated: true, result: list };
    }

    case "list:update": {
      const listId = String(payload.list_id || "");
      const name = String(payload.name || "").trim();
      if (!listId || !name) throw new Error("list_id and name are required");

      const [updated] = await sql`
        UPDATE lists
        SET name = ${name}
        WHERE id = ${listId}
        RETURNING id, board_id, name, position::float8 AS position
      `;
      return { mutated: true, result: updated };
    }

    case "list:delete": {
      const listId = String(payload.list_id || "");
      if (!listId) throw new Error("list_id is required");
      await sql`
        UPDATE lists SET archived_at = now() WHERE id = ${listId}
      `;
      return { mutated: true, result: { id: listId } };
    }

    case "card:create": {
      const listId = String(payload.list_id || "");
      const boardId = String(payload.board_id || SEED_IDS.board);
      const title = String(payload.title || "").trim();
      const description =
        typeof payload.description === "string" && payload.description.trim()
          ? payload.description.trim()
          : null;
      const labelId =
        typeof payload.label_id === "string" && payload.label_id
          ? payload.label_id
          : null;
      const assigneeId =
        typeof payload.assignee_id === "string" && payload.assignee_id
          ? payload.assignee_id
          : defaultActorId;

      if (!listId || !title) {
        throw new Error("list_id and title are required");
      }

      const created = await sql.begin(async (tx) => {
        const [maxPos] = await tx<{ max_pos: number | null }>`
          SELECT COALESCE(MAX(position), 0)::float8 AS max_pos
          FROM cards
          WHERE list_id = ${listId} AND archived_at IS NULL
        `;
        const position = (maxPos?.max_pos || 0) + 1000;

        const [listInfo] = await tx<{ name: string }>`
          SELECT name FROM lists WHERE id = ${listId}
        `;
        const [actorInfo] = await tx<{ name: string }>`
          SELECT name FROM users WHERE id = ${defaultActorId}
        `;

        const [card] = await tx<{ id: string; title: string; list_id: string }>`
          INSERT INTO cards (list_id, board_id, title, description, position, created_by)
          VALUES (${listId}, ${boardId}, ${title}, ${description}, ${position}, ${defaultActorId})
          RETURNING id, title, list_id
        `;

        await tx`
          INSERT INTO card_assignees (card_id, user_id)
          VALUES (${card.id}, ${assigneeId})
          ON CONFLICT DO NOTHING
        `;

        if (labelId) {
          await tx`
            INSERT INTO card_labels (card_id, label_id)
            VALUES (${card.id}, ${labelId})
            ON CONFLICT DO NOTHING
          `;
        }

        await emitBoardTaskEvent(tx, {
          boardId,
          cardId: card.id,
          actorId: defaultActorId,
          action: "card_created",
          eventText: `${actorInfo?.name || "User"} menambahkan card "${card.title}" ke kolom ${listInfo?.name || "List"}`,
          payload: { list_id: listId, list_name: listInfo?.name || "" },
        });

        return card;
      });

      return { mutated: true, result: created };
    }

    case "card:update": {
      const cardId = String(payload.card_id || "");
      if (!cardId) throw new Error("card_id is required");

      const updated = await sql.begin(async (tx) => {
        const [existing] = await tx<{
          id: string;
          board_id: string;
          title: string;
          description: string | null;
          completed_at: string | null;
        }>`
          SELECT id, board_id, title, description, completed_at::text AS completed_at
          FROM cards
          WHERE id = ${cardId}
        `;
        if (!existing) throw new Error("Card not found");

        const nextTitle =
          typeof payload.title === "string" && payload.title.trim()
            ? payload.title.trim()
            : existing.title;
        const nextDesc =
          payload.description !== undefined
            ? payload.description === null
              ? null
              : String(payload.description)
            : existing.description;
        const toggleCompleted =
          typeof payload.completed === "boolean" ? payload.completed : null;

        const [card] = await tx<{
          id: string;
          title: string;
          description: string | null;
          completed_at: string | null;
        }>`
          UPDATE cards
          SET
            title = ${nextTitle},
            description = ${nextDesc},
            completed_at = CASE
              WHEN ${toggleCompleted === true} THEN now()
              WHEN ${toggleCompleted === false} THEN NULL
              ELSE completed_at
            END
          WHERE id = ${cardId}
          RETURNING id, title, description, completed_at::text AS completed_at
        `;

        if (toggleCompleted !== null) {
          const [actorInfo] = await tx<{ name: string }>`
            SELECT name FROM users WHERE id = ${defaultActorId}
          `;
          await emitBoardTaskEvent(tx, {
            boardId: existing.board_id,
            cardId: card.id,
            actorId: defaultActorId,
            action: toggleCompleted ? "card_completed" : "card_reopened",
            eventText: `${actorInfo?.name || "User"} menandai card "${card.title}" sebagai ${toggleCompleted ? "selesai" : "belum selesai"}`,
            payload: { completed: toggleCompleted },
          });
        }

        return card;
      });

      return { mutated: true, result: updated };
    }

    case "card:move": {
      const cardId = String(payload.card_id || "");
      const targetListId = String(payload.target_list_id || "");
      if (!cardId || !targetListId) {
        throw new Error("card_id and target_list_id are required");
      }

      const moved = await sql.begin(async (tx) => {
        const [cardInfo] = await tx<{
          id: string;
          title: string;
          board_id: string;
          list_id: string;
        }>`
          SELECT id, title, board_id, list_id FROM cards WHERE id = ${cardId}
        `;
        if (!cardInfo) throw new Error("Card not found");

        const [fromList] = await tx<{ name: string }>`
          SELECT name FROM lists WHERE id = ${cardInfo.list_id}
        `;
        const [toList] = await tx<{ name: string }>`
          SELECT name FROM lists WHERE id = ${targetListId}
        `;
        const [actorInfo] = await tx<{ name: string }>`
          SELECT name FROM users WHERE id = ${defaultActorId}
        `;

        const [maxPos] = await tx<{ max_pos: number | null }>`
          SELECT COALESCE(MAX(position), 0)::float8 AS max_pos
          FROM cards
          WHERE list_id = ${targetListId} AND archived_at IS NULL
        `;
        const nextPosition = (maxPos?.max_pos || 0) + 1000;
        const isDoneList = (toList?.name || "").toLowerCase() === "done";

        const [updated] = await tx<{
          id: string;
          list_id: string;
          position: number;
        }>`
          UPDATE cards
          SET
            list_id = ${targetListId},
            position = ${nextPosition},
            completed_at = CASE WHEN ${isDoneList} THEN COALESCE(completed_at, now()) ELSE completed_at END
          WHERE id = ${cardId}
          RETURNING id, list_id, position::float8 AS position
        `;

        await emitBoardTaskEvent(tx, {
          boardId: cardInfo.board_id,
          cardId: cardInfo.id,
          actorId: defaultActorId,
          action: "card_moved",
          eventText: `${actorInfo?.name || "User"} memindahkan card "${cardInfo.title}" dari ${fromList?.name || "List"} ke ${toList?.name || "List"}`,
          payload: {
            from_list_id: cardInfo.list_id,
            from_list: fromList?.name || "",
            to_list_id: targetListId,
            to_list: toList?.name || "",
          },
        });

        return updated;
      });

      return { mutated: true, result: moved };
    }

    case "card:delete": {
      const cardId = String(payload.card_id || "");
      if (!cardId) throw new Error("card_id is required");

      await sql.begin(async (tx) => {
        const [cardInfo] = await tx<{
          id: string;
          title: string;
          board_id: string;
        }>`
          SELECT id, title, board_id FROM cards WHERE id = ${cardId}
        `;
        if (!cardInfo) return;

        const [actorInfo] = await tx<{ name: string }>`
          SELECT name FROM users WHERE id = ${defaultActorId}
        `;

        await tx`
          UPDATE cards SET archived_at = now() WHERE id = ${cardId}
        `;

        await emitBoardTaskEvent(tx, {
          boardId: cardInfo.board_id,
          cardId: cardInfo.id,
          actorId: defaultActorId,
          action: "card_archived",
          eventText: `${actorInfo?.name || "User"} mengarsipkan card "${cardInfo.title}"`,
        });
      });

      return { mutated: true, result: { id: cardId } };
    }

    case "card:from_message": {
      const messageId = String(payload.message_id || "");
      const listId = String(payload.list_id || SEED_IDS.lists.todo);
      const boardId = String(payload.board_id || SEED_IDS.board);
      if (!messageId) throw new Error("message_id is required");

      const createdCard = await sql.begin(async (tx) => {
        const [msg] = await tx<{
          id: string;
          content: string | null;
          sender_id: string | null;
        }>`
          SELECT id, content, sender_id FROM messages WHERE id = ${messageId}
        `;
        if (!msg) throw new Error("Source message not found");

        const rawTitle =
          typeof payload.title === "string" && payload.title.trim()
            ? payload.title.trim()
            : (msg.content || "Task dari Chat").slice(0, 120);

        const [maxPos] = await tx<{ max_pos: number | null }>`
          SELECT COALESCE(MAX(position), 0)::float8 AS max_pos
          FROM cards
          WHERE list_id = ${listId} AND archived_at IS NULL
        `;
        const nextPos = (maxPos?.max_pos || 0) + 1000;

        const [card] = await tx<{
          id: string;
          title: string;
          list_id: string;
          source_message_id: string;
        }>`
          INSERT INTO cards (
            list_id,
            board_id,
            title,
            description,
            position,
            created_by,
            source_message_id
          )
          VALUES (
            ${listId},
            ${boardId},
            ${rawTitle},
            ${msg.content},
            ${nextPos},
            ${defaultActorId},
            ${msg.id}
          )
          RETURNING id, title, list_id, source_message_id
        `;

        await tx`
          UPDATE messages SET card_id = ${card.id} WHERE id = ${msg.id}
        `;

        if (msg.sender_id) {
          await tx`
            INSERT INTO card_assignees (card_id, user_id)
            VALUES (${card.id}, ${msg.sender_id})
            ON CONFLICT DO NOTHING
          `;
        }

        const [actorInfo] = await tx<{ name: string }>`
          SELECT name FROM users WHERE id = ${defaultActorId}
        `;
        await emitBoardTaskEvent(tx, {
          boardId,
          cardId: card.id,
          actorId: defaultActorId,
          action: "card_created_from_message",
          eventText: `${actorInfo?.name || "User"} membuat card "${card.title}" langsung dari pesan chat`,
          payload: { source_message_id: msg.id },
        });

        return card;
      });

      return { mutated: true, result: createdCard };
    }

    case "checklist:add_item": {
      const cardId = String(payload.card_id || "");
      const content = String(payload.content || "").trim();
      if (!cardId || !content) {
        throw new Error("card_id and content are required");
      }

      const item = await sql.begin(async (tx) => {
        let [checklist] = await tx<{ id: string }>`
          SELECT id FROM checklists WHERE card_id = ${cardId} ORDER BY position ASC LIMIT 1
        `;
        if (!checklist) {
          [checklist] = await tx<{ id: string }>`
            INSERT INTO checklists (card_id, title, position)
            VALUES (${cardId}, 'Checklist Tugas', 1000)
            RETURNING id
          `;
        }

        const [maxPos] = await tx<{ max_pos: number | null }>`
          SELECT COALESCE(MAX(position), 0)::float8 AS max_pos
          FROM checklist_items
          WHERE checklist_id = ${checklist.id}
        `;

        const [createdItem] = await tx<{
          id: string;
          checklist_id: string;
          content: string;
          is_done: boolean;
        }>`
          INSERT INTO checklist_items (checklist_id, content, is_done, assignee_id, position)
          VALUES (${checklist.id}, ${content}, false, ${defaultActorId}, ${(maxPos?.max_pos || 0) + 1000})
          RETURNING id, checklist_id, content, is_done
        `;
        return createdItem;
      });

      return { mutated: true, result: item };
    }

    case "checklist:toggle_item": {
      const itemId = String(payload.item_id || "");
      if (!itemId) throw new Error("item_id is required");

      const [updated] = await sql<{
        id: string;
        is_done: boolean;
      }>`
        UPDATE checklist_items
        SET is_done = NOT is_done
        WHERE id = ${itemId}
        RETURNING id, is_done
      `;
      return { mutated: true, result: updated };
    }

    case "checklist:delete_item": {
      const itemId = String(payload.item_id || "");
      if (!itemId) throw new Error("item_id is required");
      await sql`
        DELETE FROM checklist_items WHERE id = ${itemId}
      `;
      return { mutated: true, result: { id: itemId } };
    }

    case "room:create": {
      const name = String(payload.name || "").trim();
      const workspaceId = String(payload.workspace_id || SEED_IDS.workspace);
      const roomType =
        payload.type === "direct" ||
        payload.type === "board" ||
        payload.type === "card"
          ? payload.type
          : "group";

      if (roomType !== "direct" && !name) {
        throw new Error("Room name is required");
      }

      const createdRoom = await sql.begin(async (tx) => {
        const [room] = await tx<RoomDto>`
          INSERT INTO rooms (workspace_id, type, name, only_admins_can_send, created_by)
          VALUES (${workspaceId}, ${roomType}, ${name || null}, false, ${defaultActorId})
          RETURNING id, workspace_id, type, name, board_id, card_id, only_admins_can_send, created_by
        `;

        const allUsers = await tx<{ id: string }>`SELECT id FROM users`;
        for (const u of allUsers) {
          await tx`
            INSERT INTO room_members (room_id, user_id, role)
            VALUES (${room.id}, ${u.id}, ${u.id === defaultActorId ? "admin" : "member"})
            ON CONFLICT DO NOTHING
          `;
        }

        return room;
      });

      return { mutated: true, result: createdRoom };
    }

    case "message:send": {
      const roomId = String(payload.room_id || "");
      const content = String(payload.content || "").trim();
      const cardId =
        typeof payload.card_id === "string" && payload.card_id
          ? payload.card_id
          : null;
      const replyToId =
        typeof payload.reply_to_id === "string" && payload.reply_to_id
          ? payload.reply_to_id
          : null;

      if (!roomId || !content) {
        throw new Error("room_id and content are required");
      }

      const createdMsg = await sql.begin(async (tx) => {
        const [msg] = await tx<{
          id: string;
          room_id: string;
          sender_id: string;
          content: string;
          card_id: string | null;
          created_at: string;
        }>`
          INSERT INTO messages (room_id, sender_id, type, content, reply_to_id, card_id)
          VALUES (${roomId}, ${defaultActorId}, 'text', ${content}, ${replyToId}, ${cardId})
          RETURNING id, room_id, sender_id, content, card_id, created_at::text AS created_at
        `;

        await tx`
          INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at)
          VALUES (${msg.id}, ${defaultActorId}, now(), now())
          ON CONFLICT DO NOTHING
        `;

        await tx`
          UPDATE room_members
          SET last_read_message_id = ${msg.id}
          WHERE room_id = ${roomId} AND user_id = ${defaultActorId}
        `;

        return msg;
      });

      return { mutated: true, result: createdMsg };
    }

    case "message:update": {
      const messageId = String(payload.message_id || "");
      const content = String(payload.content || "").trim();
      if (!messageId || !content) {
        throw new Error("message_id and content are required");
      }

      const [updated] = await sql`
        UPDATE messages
        SET content = ${content}, edited_at = now()
        WHERE id = ${messageId}
        RETURNING id, content, edited_at::text AS edited_at
      `;
      return { mutated: true, result: updated };
    }

    case "message:delete": {
      const messageId = String(payload.message_id || "");
      if (!messageId) throw new Error("message_id is required");

      const [deleted] = await sql`
        UPDATE messages
        SET deleted_at = now()
        WHERE id = ${messageId}
        RETURNING id, deleted_at::text AS deleted_at
      `;
      return { mutated: true, result: deleted };
    }

    case "message:react": {
      const messageId = String(payload.message_id || "");
      const emoji = String(payload.emoji || "👍").trim();
      if (!messageId || !emoji) {
        throw new Error("message_id and emoji are required");
      }

      const existing = await sql`
        SELECT 1 FROM message_reactions
        WHERE message_id = ${messageId} AND user_id = ${defaultActorId} AND emoji = ${emoji}
      `;

      if (existing.length > 0) {
        await sql`
          DELETE FROM message_reactions
          WHERE message_id = ${messageId} AND user_id = ${defaultActorId} AND emoji = ${emoji}
        `;
        return {
          mutated: true,
          result: { message_id: messageId, emoji, active: false },
        };
      }

      await sql`
        INSERT INTO message_reactions (message_id, user_id, emoji)
        VALUES (${messageId}, ${defaultActorId}, ${emoji})
        ON CONFLICT DO NOTHING
      `;
      return {
        mutated: true,
        result: { message_id: messageId, emoji, active: true },
      };
    }

    case "message:mark_read": {
      const roomId = String(payload.room_id || "");
      const messageId = String(payload.message_id || "");
      if (!roomId || !messageId) {
        throw new Error("room_id and message_id are required");
      }

      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at)
          VALUES (${messageId}, ${defaultActorId}, now(), now())
          ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = now()
        `;
        await tx`
          UPDATE room_members
          SET last_read_message_id = ${messageId}
          WHERE room_id = ${roomId} AND user_id = ${defaultActorId}
        `;
      });

      return {
        mutated: true,
        result: { room_id: roomId, message_id: messageId },
      };
    }

    case "workspace:invite_member": {
      const email = String(payload.email || "").trim().toLowerCase();
      const rawName = String(payload.name || "").trim();
      const name = rawName || email.split("@")[0] || "User Baru";
      const workspaceId = String(payload.workspace_id || SEED_IDS.workspace);
      const targetRole =
        payload.role === "admin"
          ? "admin"
          : payload.role === "guest"
            ? "guest"
            : "member";

      if (!email || !email.includes("@")) {
        throw new Error("Alamat email Gmail/email valid diperlukan");
      }

      const inviteResult = await sql.begin(async (tx) => {
        const [existingUser] = await tx<{ id: string; name: string; email: string }>`
          SELECT id, name, email FROM users WHERE LOWER(email) = ${email}
        `;

        let isNewUser = false;
        let finalUser = existingUser;

        if (!finalUser) {
          isNewUser = true;
          const defaultPassHash = await Bun.password.hash("password123");
          [finalUser] = await tx<{ id: string; name: string; email: string }>`
            INSERT INTO users (name, email, password_hash, last_seen_at)
            VALUES (${name}, ${email}, ${defaultPassHash}, now())
            RETURNING id, name, email
          `;
        }

        await tx`
          INSERT INTO workspace_members (workspace_id, user_id, role)
          VALUES (${workspaceId}, ${finalUser.id}, ${targetRole})
          ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
        `;

        const targetRooms = await tx<{ id: string }>`
          SELECT id FROM rooms WHERE workspace_id = ${workspaceId} AND type IN ('group', 'board')
        `;
        for (const r of targetRooms) {
          await tx`
            INSERT INTO room_members (room_id, user_id, role)
            VALUES (${r.id}, ${finalUser.id}, 'member')
            ON CONFLICT DO NOTHING
          `;
        }

        const [actorInfo] = await tx<{ name: string }>`
          SELECT name FROM users WHERE id = ${defaultActorId}
        `;
        const [wsInfo] = await tx<{ name: string }>`
          SELECT name FROM workspaces WHERE id = ${workspaceId}
        `;

        await tx`
          INSERT INTO activities (board_id, actor_id, action, payload)
          VALUES (
            ${SEED_IDS.board},
            ${defaultActorId},
            'member_invited',
            ${JSON.stringify({
              email,
              user_id: finalUser.id,
              role: targetRole,
              is_new_user: isNewUser,
            })}::jsonb
          )
        `;

        const boardRooms = await tx<{ id: string }>`
          SELECT id FROM rooms WHERE board_id = ${SEED_IDS.board} LIMIT 1
        `;
        if (boardRooms.length > 0) {
          await tx`
            INSERT INTO messages (room_id, sender_id, type, content)
            VALUES (
              ${boardRooms[0].id},
              ${defaultActorId},
              'task_event',
              ${`${actorInfo?.name || "Admin"} mengundang ${finalUser.name} (${email}) sebagai ${targetRole}`}
            )
          `;
        }

        return {
          user: finalUser,
          isNewUser,
          actorName: actorInfo?.name || "Admin",
          workspaceName: wsInfo?.name || "Auto Smart Workspace",
        };
      });

      let emailSent = false;
      let emailError: string | undefined;
      try {
        const host =
          process.env.APP_SERVER_HOST === "0.0.0.0"
            ? "localhost"
            : process.env.APP_SERVER_HOST || "localhost";
        const port = process.env.APP_SERVER_PORT || "5790";
        const envWs = process.env.NEXT_PUBLIC_WS_URL;
        let baseUrl = `http://${host}:${port}`;
        if (process.env.APP_PUBLIC_URL) {
          baseUrl = process.env.APP_PUBLIC_URL.replace(/\/+$/, "");
        } else if (envWs) {
          baseUrl = envWs
            .replace(/^wss:\/\//i, "https://")
            .replace(/^ws:\/\//i, "http://")
            .replace(/\/ws\/?$/i, "");
        }
        const joinUrl = `${baseUrl}/?join_email=${encodeURIComponent(email)}`;

        const sendRes = await sendWorkspaceInvitationEmail({
          toEmail: email,
          toName: inviteResult.user.name,
          inviterName: inviteResult.actorName,
          workspaceName: inviteResult.workspaceName,
          joinUrl,
        });
        emailSent = sendRes.ok;
        if (!sendRes.ok) emailError = sendRes.error;
      } catch (err) {
        emailError = err instanceof Error ? err.message : String(err);
      }

      return {
        mutated: true,
        result: {
          user_id: inviteResult.user.id,
          email: inviteResult.user.email,
          name: inviteResult.user.name,
          role: targetRole,
          is_new_user: inviteResult.isNewUser,
          email_sent: emailSent,
          email_error: emailError,
        },
      };
    }

    case "admin:update_member_role": {
      const workspaceId = String(payload.workspace_id || SEED_IDS.workspace);
      const userId = String(payload.user_id || "");
      const role = String(payload.role || "member") as
        | "owner"
        | "admin"
        | "member"
        | "guest";
      if (!userId) throw new Error("user_id is required");

      await sql`
        UPDATE workspace_members
        SET role = ${role}
        WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
      `;

      return {
        mutated: true,
        result: { workspace_id: workspaceId, user_id: userId, role },
      };
    }

    case "admin:toggle_room_permission": {
      const roomId = String(payload.room_id || "");
      const onlyAdmins = Boolean(payload.only_admins_can_send);
      if (!roomId) throw new Error("room_id is required");

      await sql`
        UPDATE rooms
        SET only_admins_can_send = ${onlyAdmins}
        WHERE id = ${roomId}
      `;

      return {
        mutated: true,
        result: { room_id: roomId, only_admins_can_send: onlyAdmins },
      };
    }

    case "smtp:status": {
      const status = await verifySmtpConnection();
      return { mutated: false, result: status };
    }

    case "smtp:test_send": {
      const to = String(payload.to || "").trim();
      if (!to || !to.includes("@")) {
        throw new Error("Alamat email tujuan tidak valid");
      }

      const sendRes = await sendEmail({
        to,
        subject: "Tes Pengiriman Email — Sistem Task Board & Chat Terintegrasi",
        html: `
          <div style="font-family: sans-serif; padding: 20px; color: #1b2440;">
            <h2 style="color: #3b63d6;">Tes Pengiriman Berhasil!</h2>
            <p>Halo, ini adalah email konfirmasi dari integrasi SMTP Auto Smart Parking.</p>
            <p>Waktu pengiriman: <strong>${new Date().toLocaleString("id-ID")}</strong></p>
          </div>
        `,
      });

      return { mutated: false, result: sendRes };
    }

    default:
      throw new Error(`Unsupported WebSocket action: ${String(action)}`);
  }
}
