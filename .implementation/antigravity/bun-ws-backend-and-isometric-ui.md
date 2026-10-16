# Implementation Note: Bun Native Backend (PostgreSQL ERD + WebSocket CRUD) & Next.js Clean Isometric UI

## 1. Overview
Implemented the full PostgreSQL schema (21 UUID tables across Core, Task Board, Group Chat, and Cross-Module entities), idempotent database seeder, native `Bun.serve` HTTP + WebSocket CRUD server, Next.js Clean Isometric UI frontend, concurrent dev runner (`server/dev.ts`), and a single self-contained binary (`build/projectmanager`) that embeds all Next.js frontend assets directly inside the executable.

## 2. Database & Seeder Contract (`Bun.SQL`)
- **Connection Manager ([server/database/postgre.ts](file:///home/hylmi/Hylmi/project/projectmanager/server/database/postgre.ts))**:
  - Connects to `127.0.0.1:5432` as `dokku` (`ohmypc`) using Bun's built-in `Bun.SQL` driver.
  - `ensureDatabaseExists()` connects to administrative DB `postgres` and executes `CREATE DATABASE "projectmanager"` if it does not yet exist.
- **Schema Migration ([server/database/scheme.ts](file:///home/hylmi/Hylmi/project/projectmanager/server/database/scheme.ts))**:
  - Creates 6 PostgreSQL ENUM types (`workspace_role`, `board_visibility`, `board_role`, `room_type`, `room_role`, `message_type`) and all 21 tables from `RD Sistem Task Board + Chat Grup Terintegrasi.pdf`.
  - Resolves circular foreign keys (`cards.source_message_id -> messages.id` and `room_members.last_read_message_id -> messages.id`) via `ALTER TABLE` after table creation.
  - Enforces `chk_attachments_card_or_message_xor` on `attachments` and creates indexes `idx_messages_room_created`, `idx_cards_list_position`, and `idx_message_receipts_user_read`.
- **Seeder ([server/database/seeder.ts](file:///home/hylmi/Hylmi/project/projectmanager/server/database/seeder.ts))**:
  - Populates deterministic initial records across all 21 tables (`bun run db:seed`).

## 3. Bun Server, Next.js & Single Embedded Binary Contract
- **Concurrent Development Mode ([server/dev.ts](file:///home/hylmi/Hylmi/project/projectmanager/server/dev.ts))**:
  - `bun run dev` (or `make run`) spawns both `bun --watch run server/index.ts` (`:5790`) and `next dev` (`:3000`) concurrently and handles `SIGINT`/`SIGTERM` cleanly.
- **Self-Contained Single Binary (`build/projectmanager`, [server/scripts/embed-static.ts](file:///home/hylmi/Hylmi/project/projectmanager/server/scripts/embed-static.ts), [server/embedded-assets.ts](file:///home/hylmi/Hylmi/project/projectmanager/server/embedded-assets.ts), [Makefile](file:///home/hylmi/Hylmi/project/projectmanager/Makefile))**:
  - `bun run build:bin` (or `make build`) runs:
    1. `STATIC_EXPORT=true next build` (producing static HTML/CSS/JS/fonts in `out/`)
    2. `bun run server/scripts/embed-static.ts` (embedding all 33 files from `out/` directly into [server/embedded-assets.ts](file:///home/hylmi/Hylmi/project/projectmanager/server/embedded-assets.ts))
    3. `bun build --compile --minify --bytecode server/index.ts --outfile build/projectmanager`
  - Running `./build/projectmanager` (even outside the repository without `out/` or `node_modules/`) serves all embedded Next.js frontend assets directly from memory alongside `/ws` WebSocket CRUD, `/health`, and `/api/snapshot` inside a **single executable binary** on port `5790`.
- **WebSocket CRUD Actions ([server/ws/handlers.ts](file:///home/hylmi/Hylmi/project/projectmanager/server/ws/handlers.ts))**:
  - `state:init`, `board:create`, `board:update`, `board:delete`, `list:create`, `list:update`, `list:delete`, `card:create`, `card:update`, `card:move`, `card:delete`, `card:from_message`, `checklist:add_item`, `checklist:toggle_item`, `checklist:delete_item`, `room:create`, `message:send`, `message:update`, `message:delete`, `message:react`, `message:mark_read`.
  - Every card mutation automatically logs an `activities` entry and emits a `messages` row with `type = 'task_event'` to the board's integrated chat room (`rooms.board_id`).
  - Client-side WebSocket messages use a resilient UUID generator with an RFC4122 v4 fallback ([components/board-chat-workspace.tsx](file:///home/hylmi/Hylmi/project/projectmanager/components/board-chat-workspace.tsx)) so button clicks succeed even when accessed via non-secure origins (`http://0.0.0.0:5790` or direct LAN IPs where `window.crypto.randomUUID` is disabled by the browser).
