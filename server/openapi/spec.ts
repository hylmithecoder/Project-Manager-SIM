import type { WsAction } from "../ws/protocol";
import { ACTION_DOCS } from "./catalog";
import { httpPathForAction } from "./docs";
import { COMPONENT_SCHEMAS, s } from "./schema";

/** Intro markdown; examples use the base URL the spec is served from. */
const introFor = (baseUrl: string) => `
API untuk **Project Manager Workspace** (task board + chat grup terintegrasi). Ditujukan untuk klien mobile (Expo / React Native) dan web.

## Dua cara memanggil API

| Metode | HTTP (gateway) | WebSocket |
|---|---|---|
| Endpoint | \`POST /api/v1/{grup}/{aksi}\` | \`wss://<host>/ws\` |
| Auth | Header \`Authorization: Bearer <token>\` | Kirim aksi \`auth:resume\` setelah connect |
| Workspace aktif | Header \`X-Workspace-Id\` | Aksi \`workspace:select\` |
| Realtime | ❌ | ✅ snapshot terbaru di-push setiap ada perubahan |

Setiap aksi WebSocket \`grup:aksi\` tersedia sebagai HTTP \`POST /api/v1/grup/aksi\` dengan **body = payload** yang sama.
Rekomendasi untuk Expo: pakai **WebSocket** untuk data realtime (board & chat), HTTP boleh dipakai untuk login/form/upload.

Response HTTP sukses: \`{ "ok": true, "action": "...", "data": ... }\` · gagal: \`{ "ok": false, "error": "pesan" }\`
dengan status **400** (validasi), **401** (belum login / token kedaluwarsa), **403** (peran tidak berizin), **404** (aksi tidak dikenal).

## Alur autentikasi

1. \`auth:login\` (email + password) → \`{ token, me }\`. Simpan token di \`expo-secure-store\`. Token berlaku 30 hari.
2. Setiap buka app / reconnect WebSocket: \`auth:resume { token }\`. Jika gagal → hapus token → layar login.
3. Akun baru **hanya lewat undangan email**. Link email berbentuk \`https://<web>/?invite=<token>\`
   (reset password: \`?reset=<token>\`). Di mobile: \`invite:lookup\` → tampilkan form → \`invite:accept\`.
   Jika \`existing_user=false\` minta nama + password; jika \`true\` cukup password.
4. Event WebSocket \`session:revoked\` = akun dinonaktifkan/dihapus/password diganti → logout.

## Peran

- **developer** (platform): kelola akun & workspace perusahaan (\`dev:*\`). Tidak pernah menerima isi workspace.
- **owner** (pemimpin perusahaan) / **admin**: kelola anggota, undangan, izin ruang, saklar email workspace.
- **member**: board, card, checklist, chat. **guest**: hanya lihat board & chat.

## Protokol WebSocket

\`\`\`jsonc
// client → server
{ "id": "uuid-buatan-client", "action": "message:send", "payload": { "room_id": "...", "content": "Halo @semua" } }
// server → client (balasan untuk id yang sama)
{ "id": "uuid-buatan-client", "type": "response", "ok": true, "action": "message:send", "data": { ... } }
// server → client (push realtime, juga setelah aksi user lain)
{ "type": "event", "event": "message:send", "data": { ... }, "snapshot": { /* WorkspaceSnapshot */ }, "timestamp": "..." }
\`\`\`

- Setelah connect server mengirim \`{ "type":"event","event":"state:init","data":{"authenticated":false} }\` (tanpa snapshot).
- Setiap event yang membawa \`snapshot\` → **ganti seluruh state** dengan snapshot itu (sudah di-scope sesuai hak akses user).
- Event \`presence\` = status online berubah (snapshot ikut dikirim).
- Reconnect dengan backoff (1s, 2s, 4s ... maks 10s) lalu \`auth:resume\` + \`workspace:select\` lagi.

### Contoh Expo

\`\`\`ts
const BASE = "${baseUrl}";
const ws = new WebSocket(BASE.replace(/^http/, "ws") + "/ws");
const pending = new Map<string, (msg: any) => void>();
const call = (action: string, payload = {}) => new Promise<any>((resolve, reject) => {
  const id = Math.random().toString(36).slice(2);
  pending.set(id, (m) => (m.ok ? resolve(m.data) : reject(new Error(m.error))));
  ws.send(JSON.stringify({ id, action, payload }));
});
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.type === "response") { pending.get(m.id)?.(m); pending.delete(m.id); }
  else if (m.event === "session:revoked") { /* logout */ }
  else if (m.snapshot) { setSnapshot(m.snapshot); }
};
ws.onopen = async () => { const token = await SecureStore.getItemAsync("token"); if (token) await call("auth:resume", { token }); };

// HTTP
const res = await fetch(BASE + "/api/v1/card/create", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, "X-Workspace-Id": workspaceId },
  body: JSON.stringify({ list_id, title: "Cek stok gudang" }),
}).then((r) => r.json());
\`\`\`

## File & gambar

\`attachment.file_url\` adalah path relatif (\`/uploads/<id>/<nama>\`) → tampilkan dengan \`BASE + file_url\`.
Upload lewat \`attachment:upload\` dengan isi file base64 (maks 8 MB).

## Notifikasi email

Server mengirim email (Gmail) untuk setiap aktivitas workspace dan setiap pesan chat (dengan/tanpa tag), sesuai
\`account:update_preferences\` user dan \`workspace:update_settings\` admin. Kolom **Email** di tiap endpoint menjelaskan email yang dipicu.
`;

export function buildOpenApiSpec(serverUrl: string) {
  const paths: Record<string, unknown> = {
    "/health": {
      get: {
        tags: ["Sistem"],
        operationId: "health",
        summary: "Cek server hidup",
        security: [],
        responses: { 200: { description: "OK", content: { "application/json": { schema: s.any() } } } },
      },
    },
    "/api/snapshot": {
      get: {
        tags: ["Workspace"],
        operationId: "getSnapshot",
        summary: "Snapshot lengkap user (HTTP)",
        parameters: [
          { name: "workspace_id", in: "query", required: false, schema: s.uuid(), description: "Workspace aktif; default workspace pertama" },
        ],
        responses: {
          200: {
            description: "OK",
            content: { "application/json": { schema: s.obj({ ok: s.bool(), data: s.ref("WorkspaceSnapshot") }) } },
          },
          401: { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/uploads/{id}/{name}": {
      get: {
        tags: ["Sistem"],
        operationId: "downloadUpload",
        summary: "Unduh lampiran",
        security: [],
        parameters: [
          { name: "id", in: "path", required: true, schema: s.uuid() },
          { name: "name", in: "path", required: true, schema: s.str() },
        ],
        responses: { 200: { description: "Isi file" }, 404: { description: "Tidak ditemukan" } },
      },
    },
    "/ws": {
      get: {
        tags: ["Sistem"],
        operationId: "websocket",
        summary: "WebSocket realtime (upgrade)",
        description:
          "Bukan endpoint REST. Hubungkan dengan `new WebSocket('wss://<host>/ws')`. Semua aksi di dokumen ini bisa dikirim sebagai `{ id, action, payload }`.",
        security: [],
        responses: { 101: { description: "Switching Protocols" } },
      },
    },
  };

  for (const [action, doc] of Object.entries(ACTION_DOCS) as [WsAction, (typeof ACTION_DOCS)[WsAction]][]) {
    const notes = [
      doc.description,
      `**WebSocket:** \`{ "action": "${action}", "payload": { ... } }\``,
      doc.roles ? `**Peran:** ${doc.roles}` : null,
      doc.emails ? `**Email:** ${doc.emails}` : null,
    ].filter(Boolean);
    paths[httpPathForAction(action)] = {
      post: {
        operationId: action.replace(/[:]/g, "_"),
        tags: [doc.tag],
        summary: doc.summary,
        description: notes.join("\n\n"),
        security: doc.public ? [] : [{ bearerAuth: [] }],
        "x-websocket-action": action,
        parameters: doc.public
          ? []
          : [{ $ref: "#/components/parameters/WorkspaceHeader" }],
        requestBody: {
          required: Boolean(doc.body && (doc.body as { required?: string[] }).required?.length),
          content: { "application/json": { schema: doc.body ?? s.obj({}) } },
        },
        responses: {
          200: {
            description: "Sukses",
            content: {
              "application/json": {
                schema: s.obj({ ok: { const: true }, action: { const: action }, data: doc.response ?? s.any() }, ["ok", "data"]),
              },
            },
          },
          400: { $ref: "#/components/responses/BadRequest" },
          ...(doc.public ? {} : { 401: { $ref: "#/components/responses/Unauthorized" }, 403: { $ref: "#/components/responses/Forbidden" } }),
        },
      },
    };
  }

  const errorResponse = (description: string) => ({
    description,
    content: { "application/json": { schema: s.ref("Error") } },
  });

  return {
    openapi: "3.1.0",
    info: {
      title: "Project Manager Workspace API",
      version: "1.0.0",
      description: introFor(serverUrl).trim(),
    },
    servers: [{ url: serverUrl, description: "Server ini" }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "Auth", description: "Login, undangan, reset password (sebagian publik)" },
      { name: "Akun", description: "Profil, password, preferensi email" },
      { name: "Workspace", description: "Snapshot, anggota, undangan, pengaturan" },
      { name: "Board", description: "Board, kolom (list), label" },
      { name: "Card", description: "Card, penugasan, checklist, lampiran" },
      { name: "Chat", description: "Ruang, pesan, mention, reaksi, tanda baca, notifikasi" },
      { name: "Developer", description: "Konsol developer platform (manajemen akun)" },
      { name: "Sistem", description: "Health, file, WebSocket" },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Session token dari auth:login / invite:accept / password:reset" },
      },
      parameters: {
        WorkspaceHeader: {
          name: "X-Workspace-Id",
          in: "header",
          required: false,
          schema: s.uuid(),
          description: "Workspace aktif untuk aksi yang tidak menyertakan workspace_id (dan untuk state:init).",
        },
      },
      responses: {
        BadRequest: errorResponse("Validasi gagal / data tidak ditemukan"),
        Unauthorized: errorResponse("Belum login atau token tidak berlaku"),
        Forbidden: errorResponse("Peran tidak memiliki izin / bukan anggota"),
      },
      schemas: COMPONENT_SCHEMAS,
    },
  };
}
