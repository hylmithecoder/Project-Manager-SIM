import type { BunSqlClient } from "../bun-env";
import { closeSql, ensureDatabaseExists, getSql } from "./postgre";

export const SCHEMA_TABLES = [
  "users",
  "workspaces",
  "workspace_members",
  "boards",
  "board_members",
  "lists",
  "cards",
  "card_assignees",
  "labels",
  "card_labels",
  "checklists",
  "checklist_items",
  "rooms",
  "room_members",
  "messages",
  "message_receipts",
  "message_mentions",
  "message_reactions",
  "attachments",
  "activities",
  "notifications",
] as const;

// Supporting tables outside the ERD: authentication sessions and one-time
// account tokens (workspace invitations + password resets).
export const SUPPORT_TABLES = ["sessions", "account_tokens"] as const;

const ENUM_STATEMENTS = [
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspace_role') THEN
      CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'member', 'guest');
    END IF;
  END $$;`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'board_visibility') THEN
      CREATE TYPE board_visibility AS ENUM ('private', 'workspace');
    END IF;
  END $$;`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'board_role') THEN
      CREATE TYPE board_role AS ENUM ('admin', 'member', 'observer');
    END IF;
  END $$;`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'room_type') THEN
      CREATE TYPE room_type AS ENUM ('group', 'direct', 'board', 'card');
    END IF;
  END $$;`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'room_role') THEN
      CREATE TYPE room_role AS ENUM ('admin', 'member');
    END IF;
  END $$;`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_type') THEN
      CREATE TYPE message_type AS ENUM ('text', 'image', 'file', 'voice', 'system', 'task_event');
    END IF;
  END $$;`,
];

const TABLE_STATEMENTS = [
  // --- 1. Entitas Inti ---
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(100) NOT NULL,
    email varchar(255) NOT NULL UNIQUE,
    phone varchar(20) UNIQUE NULL,
    password_hash text NOT NULL,
    avatar_url text NULL,
    last_seen_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(100) NOT NULL,
    slug varchar(100) NOT NULL UNIQUE,
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role workspace_role NOT NULL DEFAULT 'member',
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
  );`,

  // --- 2. Entitas Modul Task Board ---
  `CREATE TABLE IF NOT EXISTS boards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name varchar(100) NOT NULL,
    visibility board_visibility NOT NULL DEFAULT 'workspace',
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    archived_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE TABLE IF NOT EXISTS board_members (
    board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role board_role NOT NULL DEFAULT 'member',
    PRIMARY KEY (board_id, user_id)
  );`,
  `CREATE TABLE IF NOT EXISTS lists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name varchar(100) NOT NULL,
    position numeric NOT NULL DEFAULT 0,
    archived_at timestamptz NULL
  );`,
  `CREATE TABLE IF NOT EXISTS cards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title varchar(255) NOT NULL,
    description text NULL,
    position numeric NOT NULL DEFAULT 0,
    due_at timestamptz NULL,
    completed_at timestamptz NULL,
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    source_message_id uuid NULL,
    archived_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE TABLE IF NOT EXISTS card_assignees (
    card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, user_id)
  );`,
  `CREATE TABLE IF NOT EXISTS labels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name varchar(100) NOT NULL,
    color varchar(50) NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS card_labels (
    card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    label_id uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, label_id)
  );`,
  `CREATE TABLE IF NOT EXISTS checklists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    title varchar(255) NOT NULL,
    position numeric NOT NULL DEFAULT 0
  );`,
  `CREATE TABLE IF NOT EXISTS checklist_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_id uuid NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
    content text NOT NULL,
    is_done boolean NOT NULL DEFAULT false,
    assignee_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
    due_at timestamptz NULL,
    position numeric NOT NULL DEFAULT 0
  );`,

  // --- 3. Entitas Modul Chat Grup ---
  `CREATE TABLE IF NOT EXISTS rooms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    type room_type NOT NULL,
    name varchar(100) NULL,
    avatar_url text NULL,
    board_id uuid UNIQUE NULL REFERENCES boards(id) ON DELETE CASCADE,
    card_id uuid UNIQUE NULL REFERENCES cards(id) ON DELETE CASCADE,
    only_admins_can_send boolean NOT NULL DEFAULT false,
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE TABLE IF NOT EXISTS room_members (
    room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role room_role NOT NULL DEFAULT 'member',
    last_read_message_id uuid NULL,
    muted_until timestamptz NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, user_id)
  );`,
  `CREATE TABLE IF NOT EXISTS messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    sender_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
    type message_type NOT NULL DEFAULT 'text',
    content text NULL,
    reply_to_id uuid NULL REFERENCES messages(id) ON DELETE SET NULL,
    card_id uuid NULL REFERENCES cards(id) ON DELETE SET NULL,
    edited_at timestamptz NULL,
    deleted_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE TABLE IF NOT EXISTS message_receipts (
    message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delivered_at timestamptz NULL,
    read_at timestamptz NULL,
    PRIMARY KEY (message_id, user_id)
  );`,
  `CREATE TABLE IF NOT EXISTS message_mentions (
    message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, user_id)
  );`,
  `CREATE TABLE IF NOT EXISTS message_reactions (
    message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji varchar(32) NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  );`,

  // --- 4. Entitas Lintas Modul ---
  `CREATE TABLE IF NOT EXISTS attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    uploader_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id uuid NULL REFERENCES cards(id) ON DELETE CASCADE,
    message_id uuid NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_url text NOT NULL,
    file_name varchar(255) NOT NULL,
    mime_type varchar(100) NOT NULL,
    size_bytes bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_attachments_card_or_message_xor CHECK (
      (card_id IS NOT NULL AND message_id IS NULL) OR
      (card_id IS NULL AND message_id IS NOT NULL)
    )
  );`,
  `CREATE TABLE IF NOT EXISTS activities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    card_id uuid NULL REFERENCES cards(id) ON DELETE SET NULL,
    actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action varchar(50) NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type varchar(50) NOT NULL,
    ref_type varchar(20) NOT NULL,
    ref_id uuid NOT NULL,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
];

// Circular foreign keys resolved after both `cards`, `room_members`, and `messages` exist (PDF Page 11)
const CIRCULAR_FK_STATEMENTS = [
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_cards_source_message_id'
    ) THEN
      ALTER TABLE cards
        ADD CONSTRAINT fk_cards_source_message_id
        FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE SET NULL;
    END IF;
  END $$;`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_room_members_last_read_message_id'
    ) THEN
      ALTER TABLE room_members
        ADD CONSTRAINT fk_room_members_last_read_message_id
        FOREIGN KEY (last_read_message_id) REFERENCES messages(id) ON DELETE SET NULL;
    END IF;
  END $$;`,
];

// Additive, idempotent migrations for auth, platform roles, and email
// notification preferences. Safe to re-run against existing databases.
const AUTH_AND_PREFERENCE_STATEMENTS = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role varchar(20) NOT NULL DEFAULT 'user';`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_chat_email boolean NOT NULL DEFAULT true;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_mention_email boolean NOT NULL DEFAULT true;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_activity_email boolean NOT NULL DEFAULT true;`,
  `ALTER TABLE workspaces ALTER COLUMN owner_id DROP NOT NULL;`,
  `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS email_chat_enabled boolean NOT NULL DEFAULT true;`,
  `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS email_activity_enabled boolean NOT NULL DEFAULT true;`,
  `ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS due_at timestamptz NULL;`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS account_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash text NOT NULL UNIQUE,
    purpose varchar(20) NOT NULL CHECK (purpose IN ('invite', 'reset')),
    email varchar(255) NOT NULL,
    user_id uuid NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id uuid NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    role workspace_role NULL,
    created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at timestamptz NULL,
    revoked_at timestamptz NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_account_tokens_workspace ON account_tokens (workspace_id, purpose);`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);`,
  // Early seeds stored theme token names; labels now always hold hex colors.
  `UPDATE labels SET color = CASE color
     WHEN 'danger' THEN '#e5534b' WHEN 'primary' THEN '#3b63d6' WHEN 'success' THEN '#2fa36b'
     ELSE '#3b63d6' END
   WHERE color !~ '^#[0-9a-fA-F]{6}$';`,
];

// Indexes specified in PDF Page 10
const INDEX_STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages (room_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_cards_list_position ON cards (list_id, position);`,
  `CREATE INDEX IF NOT EXISTS idx_message_receipts_user_read ON message_receipts (user_id, read_at);`,
];

export async function migrateSchema(
  customSql?: BunSqlClient,
): Promise<{ tables: readonly string[]; databaseCreated?: boolean }> {
  let databaseCreated = false;
  if (!customSql) {
    const dbCheck = await ensureDatabaseExists();
    databaseCreated = dbCheck.created;
  }

  const sql = customSql || getSql();
  await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  for (const stmt of ENUM_STATEMENTS) {
    await sql.unsafe(stmt);
  }

  for (const stmt of TABLE_STATEMENTS) {
    await sql.unsafe(stmt);
  }

  for (const stmt of CIRCULAR_FK_STATEMENTS) {
    await sql.unsafe(stmt);
  }

  for (const stmt of INDEX_STATEMENTS) {
    await sql.unsafe(stmt);
  }

  for (const stmt of AUTH_AND_PREFERENCE_STATEMENTS) {
    await sql.unsafe(stmt);
  }

  return { tables: SCHEMA_TABLES, databaseCreated };
}

if (import.meta.main) {
  void (async () => {
    try {
      const res = await migrateSchema();
      console.log(
        `[db:setup] Database ready (created=${Boolean(res.databaseCreated)}). Migrated ${res.tables.length} tables.`,
      );
    } finally {
      await closeSql();
    }
  })();
}
