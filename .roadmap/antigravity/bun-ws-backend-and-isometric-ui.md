# Roadmap Note: Task Board + Chat Grup Terintegrasi

## Completed in Current Milestone
- [x] Automatic PostgreSQL database provisioning (`projectmanager`) via native `Bun.SQL`.
- [x] Full 21-table UUID schema, circular FKs, XOR attachment constraint, and performance indexes based on `RD Sistem Task Board + Chat Grup Terintegrasi.pdf`.
- [x] Idempotent seeder covering all 21 tables and cross-module relationships.
- [x] Real-time WebSocket CRUD server (`Bun.serve` on port `5790`) with automatic `task_event` emission to board chat rooms.
- [x] Clean Isometric UI Next.js foundation (`Plus Jakarta Sans`, semantic CSS tokens, `default` blue & `parking` yellow themes, isometric SVG illustration, and interactive WebSocket workspace).
- [x] Concurrent dev runner (`bun run dev` / `make run`) running both Bun server and Next.js frontend simultaneously.
- [x] Single-process low-memory binary build (`bun run build:bin` / `make build` -> `build/projectmanager`) serving static Next.js export (`out/`) + WebSocket CRUD from one compiled executable.

## Next Milestones
1. **Authentication & Session Guard**:
   - Add Google Sign-In / email-password session verification on WebSocket upgrade (`/ws?token=...`) mapped to `users`.
2. **Drag-and-Drop Fractional Indexing**:
   - Enhance `cards.position` and `lists.position` updates with pointer drag-and-drop and midpoint fractional indexing (`(prev + next) / 2`).
3. **File Upload Storage for Attachments**:
   - Add multipart/presigned upload endpoint backing the `attachments` table (`card_id` XOR `message_id`).
4. **Unread Badges & Push Notifications**:
   - Surface per-room unread counts using `message_receipts(user_id, read_at)` and `room_members.last_read_message_id`.
