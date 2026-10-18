import type { WsAction } from "../ws/protocol";
import { s, type Schema } from "./schema";

export interface ActionDoc {
  tag: string;
  summary: string;
  description?: string;
  /** Callable without a session (login & account recovery). */
  public?: boolean;
  /** Who may call it, shown in the docs. */
  roles?: string;
  body?: Schema;
  response?: Schema;
  /** Emails sent as a side effect (documentation only). */
  emails?: string;
}

const id = (what: string) => s.uuid(what);
const ok = s.obj({ ok: s.bool() });
const wsId = { workspace_id: id("Workspace. Opsional bila header X-Workspace-Id dikirim") };
const MEMBER = "owner, admin, member";
const ANY = "owner, admin, member, guest";
const MANAGER = "owner, admin";

/**
 * Every WebSocket/HTTP action. Typed as Record<WsAction, ...> so adding an
 * action without documenting it fails type-checking.
 */
export const ACTION_DOCS: Record<WsAction, ActionDoc> = {
  // ---------------------------------------------------------------- Auth
  "auth:login": {
    tag: "Auth",
    public: true,
    summary: "Login dengan email + password",
    description: "Mengembalikan session token (berlaku 30 hari). Pada WebSocket, socket langsung terikat ke user dan menerima snapshot.",
    body: s.obj({ email: s.email(), password: s.str() }, ["email", "password"]),
    response: s.ref("AuthResult"),
  },
  "auth:resume": {
    tag: "Auth",
    public: true,
    summary: "Pakai ulang session token",
    description: "Panggil setiap kali WebSocket (re)connect. Error berarti token kedaluwarsa/akun nonaktif → arahkan ke login.",
    body: s.obj({ token: s.str() }, ["token"]),
    response: s.ref("AuthResult"),
  },
  "auth:logout": { tag: "Auth", summary: "Logout & cabut session token saat ini", response: ok },
  "invite:lookup": {
    tag: "Auth",
    public: true,
    summary: "Cek token undangan / reset dari link email",
    description: "Token diambil dari link `?invite=<token>` atau `?reset=<token>`.",
    body: s.obj({ token: s.str() }, ["token"]),
    response: s.ref("InvitationLookup"),
  },
  "invite:accept": {
    tag: "Auth",
    public: true,
    summary: "Terima undangan (buat akun baru atau gabung dengan akun lama)",
    description: "Jika `existing_user=false` kirim `name` + `password` (min 8). Jika `true` cukup `password` akun tersebut. Token sekali pakai. Langsung login.",
    body: s.obj({ token: s.str(), name: s.str("Wajib untuk akun baru"), password: s.str() }, ["token", "password"]),
    response: s.obj({ token: s.str(), me: s.ref("Me"), workspace_id: s.uuid(), new_account: s.bool() }),
    emails: "Selamat datang → user baru; \"undangan diterima\" → pengundang; \"anggota baru\" → anggota lain",
  },
  "password:reset_request": {
    tag: "Auth",
    public: true,
    summary: "Kirim email tautan reset password",
    description: "Selalu sukses (tidak membocorkan apakah email terdaftar). Tautan berlaku 2 jam.",
    body: s.obj({ email: s.email() }, ["email"]),
    response: s.obj({ ok: s.bool(), message: s.str() }),
    emails: "Atur ulang password",
  },
  "password:reset": {
    tag: "Auth",
    public: true,
    summary: "Set password baru dari token reset",
    description: "Semua session lain dicabut; mengembalikan session baru.",
    body: s.obj({ token: s.str(), password: s.str("Min 8 karakter") }, ["token", "password"]),
    response: s.ref("AuthResult"),
  },
  "account:update_profile": {
    tag: "Akun",
    summary: "Ubah nama sendiri",
    body: s.obj({ name: s.str() }, ["name"]),
    response: s.obj({ name: s.str() }),
  },
  "account:change_password": {
    tag: "Akun",
    summary: "Ganti password (session lain dicabut)",
    body: s.obj({ current_password: s.str(), new_password: s.str() }, ["current_password", "new_password"]),
    response: ok,
  },
  "account:update_preferences": {
    tag: "Akun",
    summary: "Atur notifikasi email pribadi",
    description: "Kirim hanya field yang ingin diubah.",
    body: s.obj({ notify_chat_email: s.bool(), notify_mention_email: s.bool(), notify_activity_email: s.bool() }),
    response: s.obj({ notify_chat_email: s.bool(), notify_mention_email: s.bool(), notify_activity_email: s.bool() }),
  },

  // ---------------------------------------------------------------- Workspace
  "state:init": {
    tag: "Workspace",
    summary: "Ambil snapshot lengkap (workspace aktif)",
    description: "Sama dengan `GET /api/snapshot`. Lewat HTTP pilih workspace dengan header `X-Workspace-Id`.",
    roles: ANY,
    response: s.ref("WorkspaceSnapshot"),
  },
  "workspace:select": {
    tag: "Workspace",
    summary: "Pilih workspace aktif (WebSocket)",
    description: "Snapshot berikutnya untuk socket ini memakai workspace tersebut. Lewat HTTP cukup gunakan header `X-Workspace-Id`.",
    roles: ANY,
    body: s.obj({ workspace_id: s.uuid() }, ["workspace_id"]),
    response: s.obj({ workspace_id: s.uuid() }),
  },
  "workspace:update_settings": {
    tag: "Workspace",
    summary: "Ubah nama & saklar email workspace",
    roles: MANAGER,
    body: s.obj({ ...wsId, name: s.str(), email_chat_enabled: s.bool("Email untuk pesan chat tanpa tag"), email_activity_enabled: s.bool() }),
    response: s.any(),
    emails: "Pengaturan workspace diubah",
  },
  "workspace:invite_member": {
    tag: "Workspace",
    summary: "Undang anggota lewat email",
    description: "Tidak membuat akun. Penerima mendapat link `?invite=<token>` untuk membuat akun (lihat `invite:accept`).",
    roles: MANAGER,
    body: s.obj({ ...wsId, email: s.email(), role: s.enum(["admin", "member", "guest"]) }, ["email"]),
    response: s.obj({ invitation_id: s.uuid(), existing_user: s.bool(), expires_at: s.str(), email: s.email(), role: s.str() }),
    emails: "Undangan → penerima; \"anggota diundang\" → anggota workspace",
  },
  "workspace:remove_member": {
    tag: "Workspace",
    summary: "Keluarkan anggota",
    description: "Owner tidak bisa dikeluarkan; admin hanya bisa mengeluarkan member/guest.",
    roles: MANAGER,
    body: s.obj({ ...wsId, user_id: s.uuid() }, ["user_id"]),
    response: s.any(),
    emails: "Anggota dikeluarkan",
  },
  "invite:revoke": {
    tag: "Workspace",
    summary: "Batalkan undangan tertunda",
    roles: `${MANAGER}, developer`,
    body: s.obj({ invitation_id: s.uuid() }, ["invitation_id"]),
    response: s.obj({ id: s.uuid() }),
  },
  "invite:resend": {
    tag: "Workspace",
    summary: "Kirim ulang undangan (token baru)",
    roles: `${MANAGER}, developer`,
    body: s.obj({ invitation_id: s.uuid() }, ["invitation_id"]),
    response: s.any(),
    emails: "Undangan",
  },
  "admin:update_member_role": {
    tag: "Workspace",
    summary: "Ubah peran anggota",
    description: "Hanya owner yang bisa mengangkat admin. Peran owner tidak bisa diubah.",
    roles: MANAGER,
    body: s.obj({ ...wsId, user_id: s.uuid(), role: s.enum(["admin", "member", "guest"]) }, ["user_id", "role"]),
    response: s.any(),
    emails: "Peran diubah",
  },
  "admin:toggle_room_permission": {
    tag: "Chat",
    summary: "Atur ruang: hanya admin yang boleh kirim pesan",
    roles: `${MANAGER} atau admin ruang`,
    body: s.obj({ room_id: s.uuid(), only_admins_can_send: s.bool() }, ["room_id", "only_admins_can_send"]),
    response: s.any(),
    emails: "Izin ruang chat diubah → anggota ruang",
  },

  // ---------------------------------------------------------------- Board
  "board:create": {
    tag: "Board",
    summary: "Buat board (+ kolom To Do/Doing/Done + ruang diskusi)",
    roles: MEMBER,
    body: s.obj({ ...wsId, name: s.str(), visibility: s.enum(["workspace", "private"]) }, ["name"]),
    response: s.obj({ id: s.uuid(), name: s.str(), room_id: s.uuid() }),
    emails: "Board baru",
  },
  "board:update": {
    tag: "Board",
    summary: "Ubah nama / visibilitas board",
    roles: `${MANAGER} atau pembuat board`,
    body: s.obj({ board_id: s.uuid(), name: s.str(), visibility: s.enum(["workspace", "private"]) }, ["board_id"]),
    response: s.any(),
    emails: "Board diperbarui",
  },
  "board:delete": {
    tag: "Board",
    summary: "Arsipkan board",
    roles: `${MANAGER} atau pembuat board`,
    body: s.obj({ board_id: s.uuid() }, ["board_id"]),
    response: s.obj({ id: s.uuid() }),
    emails: "Board diarsipkan",
  },
  "board:toggle_member": {
    tag: "Board",
    summary: "Tambah/keluarkan anggota board (penting untuk board privat)",
    roles: `${MANAGER} atau pembuat board`,
    body: s.obj({ board_id: s.uuid(), user_id: s.uuid() }, ["board_id", "user_id"]),
    response: s.obj({ board_id: s.uuid(), user_id: s.uuid(), member: s.bool() }),
    emails: "Anggota board berubah",
  },
  "list:create": {
    tag: "Board",
    summary: "Tambah kolom",
    roles: MEMBER,
    body: s.obj({ board_id: s.uuid(), name: s.str() }, ["board_id", "name"]),
    response: s.ref("List"),
    emails: "Kolom baru",
  },
  "list:update": {
    tag: "Board",
    summary: "Ganti nama kolom",
    roles: MEMBER,
    body: s.obj({ list_id: s.uuid(), name: s.str() }, ["list_id", "name"]),
    response: s.any(),
    emails: "Kolom diubah",
  },
  "list:move": {
    tag: "Board",
    summary: "Geser kolom ke kiri (-1) / kanan (1)",
    roles: MEMBER,
    body: s.obj({ list_id: s.uuid(), direction: { type: "integer", enum: [-1, 1] } }, ["list_id", "direction"]),
    response: s.obj({ id: s.uuid(), moved: s.bool() }),
  },
  "list:delete": {
    tag: "Board",
    summary: "Arsipkan kolom",
    roles: MEMBER,
    body: s.obj({ list_id: s.uuid() }, ["list_id"]),
    response: s.obj({ id: s.uuid() }),
    emails: "Kolom diarsipkan",
  },
  "label:create": {
    tag: "Board",
    summary: "Buat label board",
    roles: MEMBER,
    body: s.obj({ board_id: s.uuid(), name: s.str(), color: s.str("Hex #RRGGBB") }, ["board_id", "name"]),
    response: s.ref("Label"),
  },
  "label:delete": {
    tag: "Board",
    summary: "Hapus label",
    roles: MEMBER,
    body: s.obj({ label_id: s.uuid() }, ["label_id"]),
    response: s.obj({ id: s.uuid() }),
  },

  // ---------------------------------------------------------------- Card
  "card:create": {
    tag: "Card",
    summary: "Buat card",
    roles: MEMBER,
    body: s.obj(
      {
        list_id: s.uuid(),
        title: s.str(),
        description: s.str(),
        due_at: s.dt("ISO 8601"),
        assignee_ids: s.arr(s.uuid()),
        label_ids: s.arr(s.uuid()),
      },
      ["list_id", "title"],
    ),
    response: s.obj({ id: s.uuid(), title: s.str(), list_id: s.uuid() }),
    emails: "Card baru → anggota board; Penugasan → assignee",
  },
  "card:update": {
    tag: "Card",
    summary: "Ubah judul/deskripsi/deadline/status selesai",
    description: "Kirim hanya field yang berubah. `due_at: null` menghapus deadline.",
    roles: MEMBER,
    body: s.obj({ card_id: s.uuid(), title: s.str(), description: s.nullable(s.str()), due_at: s.dt(), completed: s.bool() }, ["card_id"]),
    response: s.any(),
    emails: "Card diperbarui / Deadline / Tugas selesai / dibuka lagi",
  },
  "card:move": {
    tag: "Card",
    summary: "Pindah card (drag & drop)",
    description: "`target_index` = posisi tujuan (0-based) di list tujuan; kosong = paling bawah. List bernama \"Done\" otomatis menandai selesai.",
    roles: MEMBER,
    body: s.obj({ card_id: s.uuid(), target_list_id: s.uuid(), target_index: s.int() }, ["card_id", "target_list_id"]),
    response: s.obj({ id: s.uuid(), list_id: s.uuid(), position: s.num() }),
    emails: "Card dipindah (hanya jika pindah kolom)",
  },
  "card:delete": {
    tag: "Card",
    summary: "Arsipkan card",
    roles: MEMBER,
    body: s.obj({ card_id: s.uuid() }, ["card_id"]),
    response: s.obj({ id: s.uuid() }),
    emails: "Card diarsipkan",
  },
  "card:from_message": {
    tag: "Card",
    summary: "Jadikan pesan chat sebagai card",
    description: "Pengirim pesan otomatis ditugaskan.",
    roles: MEMBER,
    body: s.obj({ message_id: s.uuid(), list_id: s.uuid(), title: s.str() }, ["message_id", "list_id"]),
    response: s.obj({ id: s.uuid(), title: s.str(), list_id: s.uuid(), source_message_id: s.uuid() }),
    emails: "Card dari chat",
  },
  "card:toggle_assignee": {
    tag: "Card",
    summary: "Tugaskan / lepas anggota",
    roles: MEMBER,
    body: s.obj({ card_id: s.uuid(), user_id: s.uuid() }, ["card_id", "user_id"]),
    response: s.obj({ card_id: s.uuid(), user_id: s.uuid(), assigned: s.bool() }),
    emails: "Penugasan → assignee + anggota board",
  },
  "card:toggle_label": {
    tag: "Card",
    summary: "Pasang / lepas label",
    roles: MEMBER,
    body: s.obj({ card_id: s.uuid(), label_id: s.uuid() }, ["card_id", "label_id"]),
    response: s.obj({ card_id: s.uuid(), label_id: s.uuid(), added: s.bool() }),
    emails: "Label",
  },
  "card:open_room": {
    tag: "Card",
    summary: "Buka / buat thread chat untuk card",
    roles: ANY,
    body: s.obj({ card_id: s.uuid() }, ["card_id"]),
    response: s.obj({ room_id: s.uuid(), card_id: s.uuid() }),
  },
  "checklist:create": {
    tag: "Card",
    summary: "Buat checklist di card",
    roles: MEMBER,
    body: s.obj({ card_id: s.uuid(), title: s.str() }, ["card_id"]),
    response: s.obj({ id: s.uuid(), title: s.str() }),
    emails: "Checklist",
  },
  "checklist:delete": {
    tag: "Card",
    summary: "Hapus checklist",
    roles: MEMBER,
    body: s.obj({ checklist_id: s.uuid() }, ["checklist_id"]),
    response: s.obj({ id: s.uuid() }),
  },
  "checklist:add_item": {
    tag: "Card",
    summary: "Tambah item checklist",
    description: "Kirim `checklist_id`, atau `card_id` untuk checklist pertama (dibuat otomatis).",
    roles: MEMBER,
    body: s.obj({ checklist_id: s.uuid(), card_id: s.uuid(), content: s.str(), assignee_id: s.nullable(s.uuid()), due_at: s.dt() }, ["content"]),
    response: s.any(),
    emails: "Item checklist baru",
  },
  "checklist:update_item": {
    tag: "Card",
    summary: "Ubah isi / PIC / deadline item",
    roles: MEMBER,
    body: s.obj({ item_id: s.uuid(), content: s.str(), assignee_id: s.nullable(s.uuid()), due_at: s.dt() }, ["item_id"]),
    response: s.obj({ id: s.uuid() }),
  },
  "checklist:toggle_item": {
    tag: "Card",
    summary: "Centang / lepas centang item",
    roles: MEMBER,
    body: s.obj({ item_id: s.uuid() }, ["item_id"]),
    response: s.obj({ id: s.uuid(), is_done: s.bool() }),
    emails: "Checklist selesai / dibuka",
  },
  "checklist:delete_item": {
    tag: "Card",
    summary: "Hapus item checklist",
    roles: MEMBER,
    body: s.obj({ item_id: s.uuid() }, ["item_id"]),
    response: s.obj({ id: s.uuid() }),
  },
  "attachment:upload": {
    tag: "Card",
    summary: "Unggah lampiran (card) atau kirim gambar/file (chat)",
    description:
      "Isi tepat salah satu: `card_id` atau `room_id`. File dikirim base64 (tanpa/dengan prefix data URL), maks 8 MB. Untuk room, membuat pesan bertipe image/file. Expo: `FileSystem.readAsStringAsync(uri, { encoding: 'base64' })`.",
    roles: `${MEMBER} (room: semua anggota ruang)`,
    body: s.obj(
      {
        card_id: s.uuid(),
        room_id: s.uuid(),
        file_name: s.str(),
        mime_type: s.str(),
        data_base64: s.str("Isi file dalam base64"),
        content: s.str("Caption (khusus room)"),
      },
      ["file_name", "mime_type", "data_base64"],
    ),
    response: s.obj({ id: s.uuid(), url: s.str(), message_id: s.uuid() }),
    emails: "Lampiran (card) / Pesan chat (room)",
  },
  "attachment:delete": {
    tag: "Card",
    summary: "Hapus lampiran",
    roles: "pengunggah, owner, admin",
    body: s.obj({ attachment_id: s.uuid() }, ["attachment_id"]),
    response: s.obj({ id: s.uuid() }),
  },

  // ---------------------------------------------------------------- Chat
  "room:create": {
    tag: "Chat",
    summary: "Buat ruang grup",
    roles: MEMBER,
    body: s.obj({ ...wsId, name: s.str(), member_ids: s.arr(s.uuid()) }, ["name"]),
    response: s.obj({ id: s.uuid(), name: s.str() }),
    emails: "Ditambahkan ke ruang chat → anggota terpilih",
  },
  "room:open_direct": {
    tag: "Chat",
    summary: "Buka / buat pesan langsung (DM)",
    roles: ANY,
    body: s.obj({ ...wsId, user_id: s.uuid() }, ["user_id"]),
    response: s.obj({ room_id: s.uuid() }),
  },
  "room:add_members": {
    tag: "Chat",
    summary: "Tambah anggota ke ruang grup / thread card",
    roles: "admin ruang, owner, admin",
    body: s.obj({ room_id: s.uuid(), member_ids: s.arr(s.uuid()) }, ["room_id", "member_ids"]),
    response: s.obj({ room_id: s.uuid(), added: s.arr(s.uuid()) }),
    emails: "Ditambahkan ke ruang chat",
  },
  "room:leave": {
    tag: "Chat",
    summary: "Keluar dari ruang (bukan ruang board)",
    roles: ANY,
    body: s.obj({ room_id: s.uuid() }, ["room_id"]),
    response: s.obj({ room_id: s.uuid() }),
  },
  "room:mute": {
    tag: "Chat",
    summary: "Bisukan ruang (email chat berhenti)",
    description: "`minutes: 0` = aktifkan lagi.",
    roles: ANY,
    body: s.obj({ room_id: s.uuid(), minutes: s.int() }, ["room_id"]),
    response: s.obj({ room_id: s.uuid(), muted_until: s.dt() }),
  },
  "message:send": {
    tag: "Chat",
    summary: "Kirim pesan teks",
    description:
      "Tag otomatis dari teks: `@Nama Lengkap`, `@namadepan`, `@bagian-email`, `@semua`. `mention_ids` opsional untuk tag eksplisit. Gagal (403) jika ruang `only_admins_can_send` dan user bukan admin.",
    roles: "anggota ruang",
    body: s.obj(
      { room_id: s.uuid(), content: s.str("Maks 4000 karakter"), reply_to_id: s.uuid(), card_id: s.uuid("Rujuk card"), mention_ids: s.arr(s.uuid()) },
      ["room_id", "content"],
    ),
    response: s.obj({ id: s.uuid(), room_id: s.uuid(), content: s.str(), created_at: s.str(), mention_ids: s.arr(s.uuid()), emailed: s.int() }),
    emails: "Pesan baru (dengan/tanpa tag, sesuai preferensi) / Mention",
  },
  "message:update": {
    tag: "Chat",
    summary: "Edit pesan sendiri",
    roles: "pengirim",
    body: s.obj({ message_id: s.uuid(), content: s.str() }, ["message_id", "content"]),
    response: s.any(),
  },
  "message:delete": {
    tag: "Chat",
    summary: "Hapus pesan untuk semua (soft delete)",
    roles: "pengirim, admin ruang, owner, admin",
    body: s.obj({ message_id: s.uuid() }, ["message_id"]),
    response: s.any(),
  },
  "message:react": {
    tag: "Chat",
    summary: "Toggle reaksi",
    roles: "anggota ruang",
    body: s.obj({ message_id: s.uuid(), emoji: s.str("Default 👍") }, ["message_id"]),
    response: s.obj({ message_id: s.uuid(), emoji: s.str(), active: s.bool() }),
  },
  "message:mark_read": {
    tag: "Chat",
    summary: "Tandai semua pesan di ruang sudah dibaca",
    description: "Panggil saat ruang dibuka/menerima pesan baru. Mengubah `unread_count` & centang biru pengirim.",
    roles: "anggota ruang",
    body: s.obj({ room_id: s.uuid() }, ["room_id"]),
    response: s.obj({ room_id: s.uuid(), message_id: s.uuid(), changed: s.bool() }),
  },
  "notification:mark_read": {
    tag: "Chat",
    summary: "Tandai notifikasi dibaca",
    description: "Tanpa `notification_id` = semua.",
    body: s.obj({ notification_id: s.uuid() }),
    response: ok,
  },

  // ---------------------------------------------------------------- Developer
  "dev:create_workspace": {
    tag: "Developer",
    summary: "Daftarkan perusahaan + undang pemimpinnya",
    roles: "developer",
    body: s.obj({ name: s.str(), admin_email: s.email() }, ["name", "admin_email"]),
    response: s.obj({ workspace_id: s.uuid(), invitation_id: s.uuid(), existing_user: s.bool(), expires_at: s.str() }),
    emails: "Undangan (peran owner)",
  },
  "dev:invite_admin": {
    tag: "Developer",
    summary: "Undang admin (atau pemimpin bila workspace belum punya owner)",
    roles: "developer",
    body: s.obj({ workspace_id: s.uuid(), email: s.email() }, ["workspace_id", "email"]),
    response: s.any(),
    emails: "Undangan",
  },
  "dev:set_user_active": {
    tag: "Developer",
    summary: "Aktifkan / nonaktifkan akun",
    roles: "developer",
    body: s.obj({ user_id: s.uuid(), active: s.bool() }, ["user_id", "active"]),
    response: s.obj({ user_id: s.uuid(), active: s.bool() }),
  },
  "dev:update_user": {
    tag: "Developer",
    summary: "Edit nama / email login akun",
    roles: "developer",
    body: s.obj({ user_id: s.uuid(), name: s.str(), email: s.email() }, ["user_id"]),
    response: s.obj({ user_id: s.uuid(), name: s.str(), email: s.email() }),
    emails: "Email login diubah → alamat lama & baru",
  },
  "dev:delete_user": {
    tag: "Developer",
    summary: "Hapus akun permanen",
    description: "Konten buatan user dialihkan ke anggota lain; workspace yang dipimpin tetap ada tanpa owner.",
    roles: "developer",
    body: s.obj({ user_id: s.uuid(), confirm_email: s.email("Harus sama dengan email akun") }, ["user_id", "confirm_email"]),
    response: s.obj({ user_id: s.uuid(), deleted: s.bool() }),
  },
  "dev:send_password_reset": {
    tag: "Developer",
    summary: "Kirim email reset password ke akun",
    roles: "developer",
    body: s.obj({ user_id: s.uuid() }, ["user_id"]),
    response: s.obj({ ok: s.bool(), message: s.str() }),
    emails: "Atur ulang password",
  },
  "smtp:status": { tag: "Developer", summary: "Tes koneksi SMTP", roles: "developer", response: s.any() },
  "smtp:test_send": {
    tag: "Developer",
    summary: "Kirim email tes",
    roles: "developer",
    body: s.obj({ to: s.email() }, ["to"]),
    response: s.any(),
  },
};
