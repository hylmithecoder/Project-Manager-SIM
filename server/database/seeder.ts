import type { BunSqlClient } from "../bun-env";
import { closeSql, getSql } from "./postgre";
import { migrateSchema } from "./scheme";

export const SEED_IDS = {
  users: {
    hylmi: "11111111-1111-4111-8111-111111111101",
    nadia: "11111111-1111-4111-8111-111111111102",
    raka: "11111111-1111-4111-8111-111111111103",
  },
  workspace: "22222222-2222-4222-8222-222222222201",
  board: "33333333-3333-4333-8333-333333333301",
  lists: {
    todo: "44444444-4444-4444-8444-444444444401",
    doing: "44444444-4444-4444-8444-444444444402",
    done: "44444444-4444-4444-8444-444444444403",
  },
  labels: {
    urgent: "55555555-5555-4555-8555-555555555501",
    backend: "55555555-5555-4555-8555-555555555502",
    uiux: "55555555-5555-4555-8555-555555555503",
  },
  cards: {
    schema: "66666666-6666-4666-8666-666666666601",
    websocket: "66666666-6666-4666-8666-666666666602",
    isometricUi: "66666666-6666-4666-8666-666666666603",
  },
  checklists: {
    schemaChecklist: "77777777-7777-4777-8777-777777777701",
    wsChecklist: "77777777-7777-4777-8777-777777777702",
  },
  checklistItems: {
    item1: "77777777-7777-4777-8777-777777777801",
    item2: "77777777-7777-4777-8777-777777777802",
    item3: "77777777-7777-4777-8777-777777777803",
    item4: "77777777-7777-4777-8777-777777777804",
  },
  rooms: {
    boardRoom: "88888888-8888-4888-8888-888888888801",
    groupRoom: "88888888-8888-4888-8888-888888888802",
    cardRoom: "88888888-8888-4888-8888-888888888803",
  },
  messages: {
    msgSourceForCard: "99999999-9999-4999-8999-999999999901",
    msgTaskEvent: "99999999-9999-4999-8999-999999999902",
    msgReply: "99999999-9999-4999-8999-999999999903",
    msgGroupHello: "99999999-9999-4999-8999-999999999904",
  },
  attachments: {
    cardAttachment: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
    msgAttachment: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02",
  },
  activities: {
    actCreated: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
    actMoved: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02",
  },
  notifications: {
    notifAssigned: "cccccccc-cccc-4ccc-8ccc-cccccccccc01",
    notifMention: "cccccccc-cccc-4ccc-8ccc-cccccccccc02",
  },
} as const;

export async function seedDatabase(
  customSql?: BunSqlClient,
): Promise<{ seeded: boolean }> {
  const sql = customSql || getSql();
  await migrateSchema(sql);

  const defaultPassHash = await Bun.password.hash("password123");

  await sql.begin(async (tx) => {
    // 1. users
    await tx`
      INSERT INTO users (id, name, email, phone, password_hash, avatar_url, last_seen_at)
      VALUES
        (${SEED_IDS.users.hylmi}, 'Hylmi Mahdi', 'hylmi@autosmartparking.com', '+6281234567801', ${defaultPassHash}, null, now()),
        (${SEED_IDS.users.nadia}, 'Nadia Putri', 'nadia@autosmartparking.com', '+6281234567802', ${defaultPassHash}, null, now()),
        (${SEED_IDS.users.raka}, 'Raka Pratama', 'raka@autosmartparking.com', '+6281234567803', ${defaultPassHash}, null, now())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        last_seen_at = now()
    `;

    // 2. workspaces
    await tx`
      INSERT INTO workspaces (id, name, slug, owner_id)
      VALUES (
        ${SEED_IDS.workspace},
        'Auto Smart Workspace',
        'auto-smart-workspace',
        ${SEED_IDS.users.hylmi}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug
    `;

    // 3. workspace_members
    await tx`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES
        (${SEED_IDS.workspace}, ${SEED_IDS.users.hylmi}, 'owner'),
        (${SEED_IDS.workspace}, ${SEED_IDS.users.nadia}, 'admin'),
        (${SEED_IDS.workspace}, ${SEED_IDS.users.raka}, 'member')
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET
        role = EXCLUDED.role
    `;

    // 4. boards
    await tx`
      INSERT INTO boards (id, workspace_id, name, visibility, created_by)
      VALUES (
        ${SEED_IDS.board},
        ${SEED_IDS.workspace},
        'Sprint Task Board & Chat Terintegrasi',
        'workspace',
        ${SEED_IDS.users.hylmi}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name
    `;

    // 5. board_members
    await tx`
      INSERT INTO board_members (board_id, user_id, role)
      VALUES
        (${SEED_IDS.board}, ${SEED_IDS.users.hylmi}, 'admin'),
        (${SEED_IDS.board}, ${SEED_IDS.users.nadia}, 'member'),
        (${SEED_IDS.board}, ${SEED_IDS.users.raka}, 'member')
      ON CONFLICT (board_id, user_id) DO UPDATE SET
        role = EXCLUDED.role
    `;

    // 6. lists
    await tx`
      INSERT INTO lists (id, board_id, name, position)
      VALUES
        (${SEED_IDS.lists.todo}, ${SEED_IDS.board}, 'To Do', 1000),
        (${SEED_IDS.lists.doing}, ${SEED_IDS.board}, 'Doing', 2000),
        (${SEED_IDS.lists.done}, ${SEED_IDS.board}, 'Done', 3000)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        position = EXCLUDED.position
    `;

    // 7. labels
    await tx`
      INSERT INTO labels (id, board_id, name, color)
      VALUES
        (${SEED_IDS.labels.urgent}, ${SEED_IDS.board}, 'Prioritas', 'danger'),
        (${SEED_IDS.labels.backend}, ${SEED_IDS.board}, 'Bun Backend', 'primary'),
        (${SEED_IDS.labels.uiux}, ${SEED_IDS.board}, 'Isometric UI', 'success')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        color = EXCLUDED.color
    `;

    // 8. cards (source_message_id updated after messages are inserted)
    await tx`
      INSERT INTO cards (id, list_id, board_id, title, description, position, due_at, completed_at, created_by)
      VALUES
        (
          ${SEED_IDS.cards.schema},
          ${SEED_IDS.lists.done},
          ${SEED_IDS.board},
          'Skema PostgreSQL 21 Tabel & Seeder',
          'Implementasi seluruh tabel Inti, Task Board, Chat Grup, dan Lintas Modul sesuai dokumen ERD.',
          1000,
          now() + interval '1 day',
          now(),
          ${SEED_IDS.users.hylmi}
        ),
        (
          ${SEED_IDS.cards.websocket},
          ${SEED_IDS.lists.doing},
          ${SEED_IDS.board},
          'Realtime WebSocket CRUD Server (Bun.serve)',
          'Sinkronisasi otomatis perubahan list/card ke room chat board melalui pesan task_event.',
          1000,
          now() + interval '2 days',
          null,
          ${SEED_IDS.users.nadia}
        ),
        (
          ${SEED_IDS.cards.isometricUi},
          ${SEED_IDS.lists.todo},
          ${SEED_IDS.board},
          'Desain Clean Isometric UI Next.js + Tema Parking',
          'Menggunakan token CSS variables, font Plus Jakarta Sans, dan ilustrasi flat isometrik.',
          1000,
          now() + interval '3 days',
          null,
          ${SEED_IDS.users.raka}
        )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description
    `;

    // 9. card_assignees
    await tx`
      INSERT INTO card_assignees (card_id, user_id)
      VALUES
        (${SEED_IDS.cards.schema}, ${SEED_IDS.users.hylmi}),
        (${SEED_IDS.cards.websocket}, ${SEED_IDS.users.nadia}),
        (${SEED_IDS.cards.websocket}, ${SEED_IDS.users.hylmi}),
        (${SEED_IDS.cards.isometricUi}, ${SEED_IDS.users.raka})
      ON CONFLICT (card_id, user_id) DO NOTHING
    `;

    // 10. card_labels
    await tx`
      INSERT INTO card_labels (card_id, label_id)
      VALUES
        (${SEED_IDS.cards.schema}, ${SEED_IDS.labels.backend}),
        (${SEED_IDS.cards.websocket}, ${SEED_IDS.labels.urgent}),
        (${SEED_IDS.cards.websocket}, ${SEED_IDS.labels.backend}),
        (${SEED_IDS.cards.isometricUi}, ${SEED_IDS.labels.uiux})
      ON CONFLICT (card_id, label_id) DO NOTHING
    `;

    // 11. checklists
    await tx`
      INSERT INTO checklists (id, card_id, title, position)
      VALUES
        (${SEED_IDS.checklists.schemaChecklist}, ${SEED_IDS.cards.schema}, 'Validasi Skema ERD', 1000),
        (${SEED_IDS.checklists.wsChecklist}, ${SEED_IDS.cards.websocket}, 'Checklist Endpoint WebSocket', 1000)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title
    `;

    // 12. checklist_items
    await tx`
      INSERT INTO checklist_items (id, checklist_id, content, is_done, assignee_id, position)
      VALUES
        (${SEED_IDS.checklistItems.item1}, ${SEED_IDS.checklists.schemaChecklist}, 'Relasi melingkar cards.source_message_id <-> messages.card_id', true, ${SEED_IDS.users.hylmi}, 1000),
        (${SEED_IDS.checklistItems.item2}, ${SEED_IDS.checklists.schemaChecklist}, 'Constraint CHECK eksklusif pada tabel attachments', true, ${SEED_IDS.users.hylmi}, 2000),
        (${SEED_IDS.checklistItems.item3}, ${SEED_IDS.checklists.wsChecklist}, 'Broadcast perubahan card & list ke semua klien', true, ${SEED_IDS.users.nadia}, 1000),
        (${SEED_IDS.checklistItems.item4}, ${SEED_IDS.checklists.wsChecklist}, 'Konversi pesan chat langsung menjadi card task', false, ${SEED_IDS.users.raka}, 2000)
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        is_done = EXCLUDED.is_done
    `;

    // 13. rooms (board room, general group room, and card room)
    await tx`
      INSERT INTO rooms (id, workspace_id, type, name, board_id, card_id, only_admins_can_send, created_by)
      VALUES
        (
          ${SEED_IDS.rooms.boardRoom},
          ${SEED_IDS.workspace},
          'board',
          'Diskusi Board Sprint',
          ${SEED_IDS.board},
          null,
          false,
          ${SEED_IDS.users.hylmi}
        ),
        (
          ${SEED_IDS.rooms.groupRoom},
          ${SEED_IDS.workspace},
          'group',
          'Grup Tim Engineering',
          null,
          null,
          false,
          ${SEED_IDS.users.hylmi}
        ),
        (
          ${SEED_IDS.rooms.cardRoom},
          ${SEED_IDS.workspace},
          'card',
          'Thread Card: WebSocket CRUD',
          null,
          ${SEED_IDS.cards.websocket},
          false,
          ${SEED_IDS.users.nadia}
        )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name
    `;

    // 14. messages
    await tx`
      INSERT INTO messages (id, room_id, sender_id, type, content, reply_to_id, card_id)
      VALUES
        (
          ${SEED_IDS.messages.msgSourceForCard},
          ${SEED_IDS.rooms.boardRoom},
          ${SEED_IDS.users.raka},
          'text',
          'Tolong sekalian terapkan gaya Clean Isometric UI dengan dukungan tema biru default & kuning parking ya!',
          null,
          ${SEED_IDS.cards.isometricUi}
        ),
        (
          ${SEED_IDS.messages.msgTaskEvent},
          ${SEED_IDS.rooms.boardRoom},
          ${SEED_IDS.users.hylmi},
          'task_event',
          'Hylmi Mahdi menyelesaikan card "Skema PostgreSQL 21 Tabel & Seeder" di kolom Done',
          null,
          ${SEED_IDS.cards.schema}
        ),
        (
          ${SEED_IDS.messages.msgReply},
          ${SEED_IDS.rooms.boardRoom},
          ${SEED_IDS.users.nadia},
          'text',
          'Siap! Pesan di atas sudah aku jadikan Card di kolom To Do dan dihubungkan lewat source_message_id.',
          ${SEED_IDS.messages.msgSourceForCard},
          ${SEED_IDS.cards.isometricUi}
        ),
        (
          ${SEED_IDS.messages.msgGroupHello},
          ${SEED_IDS.rooms.groupRoom},
          ${SEED_IDS.users.hylmi},
          'text',
          'Selamat datang di ruang chat grup terintegrasi! Semua operasi CRUD berjalan real-time lewat Bun WebSocket.',
          null,
          null
        )
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content
    `;

    // Link circular FK: cards.source_message_id -> messages.id
    await tx`
      UPDATE cards
      SET source_message_id = ${SEED_IDS.messages.msgSourceForCard}
      WHERE id = ${SEED_IDS.cards.isometricUi}
    `;

    // 15. room_members (with last_read_message_id)
    await tx`
      INSERT INTO room_members (room_id, user_id, role, last_read_message_id)
      VALUES
        (${SEED_IDS.rooms.boardRoom}, ${SEED_IDS.users.hylmi}, 'admin', ${SEED_IDS.messages.msgReply}),
        (${SEED_IDS.rooms.boardRoom}, ${SEED_IDS.users.nadia}, 'member', ${SEED_IDS.messages.msgReply}),
        (${SEED_IDS.rooms.boardRoom}, ${SEED_IDS.users.raka}, 'member', ${SEED_IDS.messages.msgTaskEvent}),
        (${SEED_IDS.rooms.groupRoom}, ${SEED_IDS.users.hylmi}, 'admin', ${SEED_IDS.messages.msgGroupHello}),
        (${SEED_IDS.rooms.groupRoom}, ${SEED_IDS.users.nadia}, 'member', ${SEED_IDS.messages.msgGroupHello}),
        (${SEED_IDS.rooms.groupRoom}, ${SEED_IDS.users.raka}, 'member', null),
        (${SEED_IDS.rooms.cardRoom}, ${SEED_IDS.users.nadia}, 'admin', null),
        (${SEED_IDS.rooms.cardRoom}, ${SEED_IDS.users.hylmi}, 'member', null)
      ON CONFLICT (room_id, user_id) DO UPDATE SET
        last_read_message_id = EXCLUDED.last_read_message_id
    `;

    // 16. message_receipts
    await tx`
      INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at)
      VALUES
        (${SEED_IDS.messages.msgSourceForCard}, ${SEED_IDS.users.hylmi}, now(), now()),
        (${SEED_IDS.messages.msgSourceForCard}, ${SEED_IDS.users.nadia}, now(), now()),
        (${SEED_IDS.messages.msgTaskEvent}, ${SEED_IDS.users.nadia}, now(), now()),
        (${SEED_IDS.messages.msgReply}, ${SEED_IDS.users.raka}, now(), null)
      ON CONFLICT (message_id, user_id) DO NOTHING
    `;

    // 17. message_mentions
    await tx`
      INSERT INTO message_mentions (message_id, user_id)
      VALUES
        (${SEED_IDS.messages.msgReply}, ${SEED_IDS.users.raka})
      ON CONFLICT (message_id, user_id) DO NOTHING
    `;

    // 18. message_reactions
    await tx`
      INSERT INTO message_reactions (message_id, user_id, emoji)
      VALUES
        (${SEED_IDS.messages.msgTaskEvent}, ${SEED_IDS.users.nadia}, '🚀'),
        (${SEED_IDS.messages.msgReply}, ${SEED_IDS.users.hylmi}, '👍')
      ON CONFLICT (message_id, user_id, emoji) DO NOTHING
    `;

    // 19. attachments (satisfies CHECK xor between card_id and message_id)
    await tx`
      INSERT INTO attachments (id, uploader_id, card_id, message_id, file_url, file_name, mime_type, size_bytes)
      VALUES
        (
          ${SEED_IDS.attachments.cardAttachment},
          ${SEED_IDS.users.hylmi},
          ${SEED_IDS.cards.schema},
          null,
          '/RD Sistem Task Board + Chat Grup Terintegrasi.pdf',
          'RD Sistem Task Board + Chat Grup Terintegrasi.pdf',
          'application/pdf',
          491708
        ),
        (
          ${SEED_IDS.attachments.msgAttachment},
          ${SEED_IDS.users.raka},
          null,
          ${SEED_IDS.messages.msgSourceForCard},
          '/skill/next-js-clean-isometric-ui/SKILL.md',
          'SKILL.md',
          'text/markdown',
          10948
        )
      ON CONFLICT (id) DO NOTHING
    `;

    // 20. activities
    await tx`
      INSERT INTO activities (id, board_id, card_id, actor_id, action, payload)
      VALUES
        (
          ${SEED_IDS.activities.actCreated},
          ${SEED_IDS.board},
          ${SEED_IDS.cards.isometricUi},
          ${SEED_IDS.users.nadia},
          'card_created_from_message',
          ${JSON.stringify({
            list_name: "To Do",
            source_message_id: SEED_IDS.messages.msgSourceForCard,
          })}::jsonb
        ),
        (
          ${SEED_IDS.activities.actMoved},
          ${SEED_IDS.board},
          ${SEED_IDS.cards.schema},
          ${SEED_IDS.users.hylmi},
          'card_completed',
          ${JSON.stringify({
            from_list: "Doing",
            to_list: "Done",
          })}::jsonb
        )
      ON CONFLICT (id) DO NOTHING
    `;

    // 21. notifications
    await tx`
      INSERT INTO notifications (id, user_id, type, ref_type, ref_id, is_read)
      VALUES
        (
          ${SEED_IDS.notifications.notifAssigned},
          ${SEED_IDS.users.raka},
          'assigned',
          'card',
          ${SEED_IDS.cards.isometricUi},
          false
        ),
        (
          ${SEED_IDS.notifications.notifMention},
          ${SEED_IDS.users.raka},
          'mention',
          'message',
          ${SEED_IDS.messages.msgReply},
          false
        )
      ON CONFLICT (id) DO NOTHING
    `;
  });

  return { seeded: true };
}

if (import.meta.main) {
  void (async () => {
    try {
      const result = await seedDatabase();
      console.log(`[db:seed] Seed completed (seeded=${result.seeded}).`);
    } finally {
      await closeSql();
    }
  })();
}
