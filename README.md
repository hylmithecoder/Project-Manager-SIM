# Project Manager Workspace — Task Board + Chat Grup Terintegrasi

Bun WebSocket backend (`server/`) + Next.js UI (`app/`, `components/`), PostgreSQL schema per
`RD Sistem Task Board + Chat Grup Terintegrasi.pdf`.

## Run

```bash
bun dev          # Bun backend :5790 (watch) + next dev :3000
bun test         # backend + unit tests (uses isolated DB "projectmanager_test")
make build       # static export + single binary build/projectmanager
```

## Ports, paths & proxy contract

| Path | Served by | Notes |
|---|---|---|
| `/ws` | Bun :5790 | All realtime actions. `next dev` proxies it (WebSocket upgrade) via `next.config.ts` rewrites. |
| `/api/snapshot` | Bun | `Authorization: Bearer <session token>` required. |
| `/uploads/<id>/<name>` | Bun | Card/chat attachments stored in `UPLOAD_DIR` (default `./uploads`). |
| `/health` | Bun | Liveness. |
| `/docs` | Bun (public) | API reference (Scalar) for the Expo/mobile client. |
| `/openapi.json` | Bun (public) | OpenAPI 3.1 spec, generated from `server/openapi/catalog.ts`. |
| `POST /api/v1/{group}/{action}` | Bun | HTTP gateway for every WebSocket action `group:action` (Bearer token, optional `X-Workspace-Id`). |
| everything else | `next dev` (:3000) in dev, Bun (embedded static export) in the binary | |

The browser always connects to **same-origin** `/ws` (`wss://` on https). A reverse proxy / tunnel only needs to
forward one origin to `:3000` (dev) or `:5790` (binary). Override for debugging with `?ws=wss://host/ws`.

## Roles & accounts

- **Developer** (platform): creates company workspaces and invites the company leader, invites admins,
  enables/disables accounts, sends password resets, checks SMTP. Cannot open workspace content.
  Created on startup from `DEV_ACCOUNT_EMAIL` / `DEV_ACCOUNT_PASSWORD`
  (default `developer@gmail.com` / `developer123` — **change it**).
- **Owner (pemimpin perusahaan) / Admin**: manage members, invitations, roles, room permissions, workspace email switches.
- **Member**: boards, cards, checklists, chat. **Guest**: read + chat.

Accounts are created only through invitation links (`/?invite=<token>`): the invitee fills name + password,
gets a welcome email, and the inviter gets an "invitation accepted" email. Password reset: `/?reset=<token>`.

## Environment

| Var | Purpose |
|---|---|
| `APP_SERVER_HOST`, `APP_SERVER_PORT` | Bun bind (default `0.0.0.0:5790`). |
| `BACKEND_ORIGIN` | Where `next dev` proxies `/ws` & co (default `http://127.0.0.1:$APP_SERVER_PORT`). |
| `ALLOWED_DEV_ORIGINS` | Extra hostnames allowed to use `next dev` (comma separated). |
| `APP_PUBLIC_URL`, `PUBLIC_ORIGINS`, `NEXT_PUBLIC_WS_URL` | Trusted public origins for links in emails. The browser Origin is used only if it is in this list (+ localhost). |
| `DATABASE_URL` / `DB_*` | PostgreSQL. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_ENABLED` | Gmail SMTP (587 STARTTLS / 465 TLS). With `SMTP_ENABLED=false` emails are logged and skipped. |
| `DEV_ACCOUNT_EMAIL`, `DEV_ACCOUNT_PASSWORD` | Platform developer account. |
| `UPLOAD_DIR`, `MAX_UPLOAD_BYTES` | Attachment storage (default 8 MB). |
| `DUE_SOON_SCAN_MS` | Due-soon reminder scan interval (default 10 min, `0` disables). |
| `APP_TIMEZONE` | Timezone for dates in emails (default `Asia/Jakarta`). |
| `TEST_DB_NAME` | Test database (default `projectmanager_test`, schema is dropped on every test run). |

## Email notifications

Every workspace activity (cards, checklists, lists, boards, members, rooms, deadlines) and every chat message
(tagged or not) is emailed with its own template. Users choose in **Pengaturan**: email semua pesan chat,
email saat di-tag, email aktivitas. Owners/admins can switch chat/activity email off for the whole workspace
in **Kelola Workspace**. Rooms can be muted.
