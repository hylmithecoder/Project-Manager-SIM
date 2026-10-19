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

## Login Google + OTP email

Users can choose **Masuk dengan Google**, select their Google account, then enter the 6-digit OTP
sent to the matching registered email address. A session is created only after OTP verification.
Existing password login remains available. Google login does not create accounts, accept invitations,
add workspace memberships, or change roles. The email must already belong to an active application
account; accept the workspace invitation first. Google subjects (`sub`) are linked only after the
first successful OTP verification. Conflicting subjects/email changes fail closed and need admin review.

Configuration on the **Bun backend**:

```env
GOOGLE_CLIENT_ID=123456789-example.apps.googleusercontent.com
```

Create an OAuth client of type **Web application** in Google Cloud, configure the consent screen,
and add each website to **Authorized JavaScript origins**, for example
`https://projectmanager.ilmeee.com`, `https://projectmanager.edge.autosmartparking.com`, and
`http://localhost:3000` for development. Use the actual ID from Google Cloud; the example is a
placeholder. No client secret or redirect callback URI is needed for this JavaScript credential
callback flow. See [Google's setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
If the consent app is in testing, add the required test accounts there as well.

Restart the backend after changing the client ID. It is read at runtime through
`auth:google_config`, so the static UI does not bake a client ID into its build. Without a valid
configuration the login screen explains that Google is unavailable and retains password login.
The browser loads Google's official `https://accounts.google.com/gsi/client` script only on login.
If a proxy adds CSP, allow Google's GIS script/frame/connect/style endpoints as described in the
setup guide. If FedCM is disabled, a restrictive COOP header may need `same-origin-allow-popups`.
Blocked scripts/popups should be retried after allowing Google; password login remains available.

OTP is sent by the application's configured SMTP sender to the verified Google account's email;
Google itself does not generate or send this application OTP. Ensure the existing `SMTP_*`
configuration works and `SMTP_ENABLED` is not `false`. Failed SMTP delivery rejects the challenge.
The code expires after 5 minutes, allows at most 5 attempts, and can be used once. Resend waits
60 seconds, with at most 5 sends per account per 15 minutes; a replacement invalidates the previous
challenge. The Google credential and raw challenge live only in page memory; reloading during OTP
verification requires choosing Google again (cooldown still applies). Never log/share credentials,
challenges, or codes. Database storage contains hashes, not raw OTPs/challenges/Google ID tokens.

Contract (same-origin `/ws`, Next dev :3000 → Bun :5790, existing `/api/:path*` proxy):

| WebSocket action | HTTP gateway | Purpose |
|---|---|---|
| `auth:google_config` | `POST /api/v1/auth/google_config` | Public `{ enabled, client_id }`. |
| `auth:google_start` | `POST /api/v1/auth/google_start` | `{ credential }` → `{ challenge, email, expires_at, resend_after_seconds }`; sends OTP, no session. Call again with a still-valid Google credential to resend. |
| `auth:google_verify` | `POST /api/v1/auth/google_verify` | `{ challenge, code }` → normal `{ token, me }`; authenticates the socket and sends its snapshot. |

All three pre-login actions are public but session/workspace access requires successful OTP.
Google signature, issuer, audience and expiry are verified server-side using Google's auth library.
Schema setup adds `google_identities` and `google_login_challenges` idempotently on normal Bun
startup (or `bun db:setup`). Rebuild static exports/embedded binaries with the usual build before
deploying this version; no additional port or proxy route is needed.

## Environment

| Var | Purpose |
|---|---|
| `APP_SERVER_HOST`, `APP_SERVER_PORT` | Bun bind (default `0.0.0.0:5790`). |
| `BACKEND_ORIGIN` | Where `next dev` proxies `/ws` & co (default `http://127.0.0.1:$APP_SERVER_PORT`). |
| `ALLOWED_DEV_ORIGINS` | Extra hostnames allowed to use `next dev` (comma separated). |
| `APP_PUBLIC_URL`, `PUBLIC_ORIGINS`, `NEXT_PUBLIC_WS_URL` | Trusted public origins for links in emails. The browser Origin is used only if it is in this list (+ localhost). |
| `DATABASE_URL` / `DB_*` | PostgreSQL. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_ENABLED` | Gmail SMTP (587 STARTTLS / 465 TLS). With `SMTP_ENABLED=false` emails are logged and skipped. |
| `GOOGLE_CLIENT_ID` | OAuth Web client ID for Google login + email OTP; configure matching Google Authorized JavaScript origins. No client secret. |
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

## Browser notifications

After signing in, the app requests notification permission automatically once per account/tab session.
If the browser requires a user gesture, an **Izinkan notifikasi browser** dialog offers a direct
**Izinkan notifikasi** button. Previously granted browser permission enables notifications for a new
account automatically. Choosing **Nanti saja** dismisses onboarding for that tab session; an explicit
disable in Settings remains disabled across sign-ins. Blocked permission shows site-setting recovery.
You can also open **Pengaturan → Notifikasi Browser → Aktifkan**, then allow the browser permission prompt.
Use **Kirim Notifikasi Uji** to check delivery. Requires HTTPS (or localhost), browser support,
site storage, and permission in both browser and operating-system notification settings.
If permission is blocked, allow Notifications in the browser's site settings and return to the page.
The preference is stored per account in this browser; email preferences and workspace email switches
do not disable browser notifications.

All activities handled by the existing activity notification pipeline (boards, lists, cards,
checklists, attachments, assignments, deadlines, members, workspace settings and room permissions),
plus new chat messages/mentions, send a live `notification:browser` event over authenticated `/ws`.
Payload: `{ id, title, body, url }`, where `url` is a relative workspace/card/room deep link.
Only authorized recipients receive it, including members currently viewing another workspace.
Private board membership and chat room membership are respected. Actors do not notify themselves
(except due-soon reminders). Muted rooms suppress ordinary messages; mentions still notify.
Failed actions do not deliver their collected browser events. Login, read receipts, presence,
initial snapshots, reconnects, and historical data do not generate browser alerts.

Keep an app tab open and connected, including in the background. These are live notifications:
closed tabs, suspended browsers, and disconnected clients do not receive/replay them; background
Web Push delivery is not configured. Multiple tabs coordinate using Web Locks and a bounded
shared event-ID cache; browsers without Web Locks use best-effort cache deduplication.
Clicking an alert focuses/opens the linked workspace page. `/notifications-sw.js` is served by
Next.js on `:3000` during development and included in the static export/embedded Bun binary on
`:5790`; it handles notification display/clicks only and does not cache API responses.
No new API route, port, proxy rewrite, database migration, SMTP or VAPID configuration is required.
Rebuild the binary with `make build` to include the updated UI and service worker.
