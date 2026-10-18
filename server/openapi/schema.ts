/** Tiny JSON-Schema builders used by the OpenAPI catalog. */
export type Schema = Record<string, unknown>;

export const s = {
  str: (description?: string, extra: Schema = {}): Schema => ({ type: "string", ...(description ? { description } : {}), ...extra }),
  uuid: (description?: string): Schema => ({ type: "string", format: "uuid", ...(description ? { description } : {}) }),
  email: (description?: string): Schema => ({ type: "string", format: "email", ...(description ? { description } : {}) }),
  dt: (description?: string): Schema => ({ type: ["string", "null"], format: "date-time", ...(description ? { description } : {}) }),
  bool: (description?: string): Schema => ({ type: "boolean", ...(description ? { description } : {}) }),
  int: (description?: string): Schema => ({ type: "integer", ...(description ? { description } : {}) }),
  num: (description?: string): Schema => ({ type: "number", ...(description ? { description } : {}) }),
  enum: (values: string[], description?: string): Schema => ({ type: "string", enum: values, ...(description ? { description } : {}) }),
  nullable: (schema: Schema): Schema => ({ anyOf: [schema, { type: "null" }] }),
  arr: (items: Schema, description?: string): Schema => ({ type: "array", items, ...(description ? { description } : {}) }),
  obj: (properties: Record<string, Schema>, required: string[] = [], description?: string): Schema => ({
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    ...(description ? { description } : {}),
  }),
  ref: (name: string): Schema => ({ $ref: `#/components/schemas/${name}` }),
  any: (description?: string): Schema => ({ type: "object", additionalProperties: true, ...(description ? { description } : {}) }),
};

const ROLES = ["owner", "admin", "member", "guest"];

/** Mirrors server/ws/protocol.ts DTOs. */
export const COMPONENT_SCHEMAS: Record<string, Schema> = {
  Error: s.obj({ ok: { const: false }, action: s.str(), error: s.str("Pesan error (Bahasa Indonesia), aman ditampilkan ke user") }, ["ok", "error"]),
  WorkspaceRole: s.enum(ROLES),
  Me: s.obj(
    {
      id: s.uuid(),
      name: s.str(),
      email: s.email(),
      platform_role: s.enum(["developer", "user"]),
      avatar_url: s.nullable(s.str()),
      notify_chat_email: s.bool("Email untuk setiap pesan chat (dengan/tanpa tag)"),
      notify_mention_email: s.bool("Email saat di-tag"),
      notify_activity_email: s.bool("Email aktivitas workspace"),
    },
    ["id", "name", "email", "platform_role"],
  ),
  AuthResult: s.obj({ token: s.str("Session token. Simpan (SecureStore) dan kirim sebagai Bearer / auth:resume"), me: s.ref("Me") }, ["token", "me"]),
  User: s.obj({
    id: s.uuid(), name: s.str(), email: s.email(), phone: s.nullable(s.str()), avatar_url: s.nullable(s.str()),
    last_seen_at: s.dt(), online: s.bool(),
  }),
  Workspace: s.obj({
    id: s.uuid(), name: s.str(), slug: s.str(), owner_id: s.nullable(s.uuid()), my_role: s.ref("WorkspaceRole"),
    email_chat_enabled: s.bool(), email_activity_enabled: s.bool(),
  }),
  WorkspaceMember: s.obj({
    workspace_id: s.uuid(), user_id: s.uuid(), role: s.ref("WorkspaceRole"), joined_at: s.str(),
    user_name: s.str(), user_email: s.email(), avatar_url: s.nullable(s.str()),
  }),
  Invitation: s.obj({
    id: s.uuid(), email: s.email(), role: s.nullable(s.ref("WorkspaceRole")), workspace_id: s.nullable(s.uuid()),
    created_by_name: s.nullable(s.str()), created_at: s.str(), expires_at: s.str(),
  }),
  InvitationLookup: s.obj({
    purpose: s.enum(["invite", "reset"]), email: s.email(), role: s.nullable(s.ref("WorkspaceRole")),
    workspace_name: s.nullable(s.str()), inviter_name: s.nullable(s.str()),
    existing_user: s.bool("true = email sudah punya akun → cukup minta password; false = tampilkan form nama + password"),
    expires_at: s.str(),
  }),
  SmtpStatus: s.obj({ ok: s.bool(), message: s.str(), host: s.str(), port: s.int(), user: s.str(), enabled: s.bool() }),
  Board: s.obj({
    id: s.uuid(), workspace_id: s.uuid(), name: s.str(), visibility: s.enum(["private", "workspace"]),
    created_by: s.uuid(), archived_at: s.dt(), room_id: s.nullable(s.uuid()), member_ids: s.arr(s.uuid()),
  }),
  List: s.obj({ id: s.uuid(), board_id: s.uuid(), name: s.str(), position: s.num("Urutan kolom (ascending)"), archived_at: s.dt() }),
  Label: s.obj({ id: s.uuid(), board_id: s.uuid(), name: s.str(), color: s.str("Hex, mis. #3b63d6") }),
  ChecklistItem: s.obj({
    id: s.uuid(), checklist_id: s.uuid(), card_id: s.uuid(), content: s.str(), is_done: s.bool(),
    assignee_id: s.nullable(s.uuid()), due_at: s.dt(), position: s.num(),
  }),
  Checklist: s.obj({ id: s.uuid(), card_id: s.uuid(), title: s.str(), position: s.num(), items: s.arr(s.ref("ChecklistItem")) }),
  Attachment: s.obj({
    id: s.uuid(), uploader_id: s.uuid(), card_id: s.nullable(s.uuid()), message_id: s.nullable(s.uuid()),
    file_url: s.str("Path relatif, gabungkan dengan base URL: /uploads/<id>/<nama>"), file_name: s.str(),
    mime_type: s.str(), size_bytes: s.num(), created_at: s.str(),
  }),
  Card: s.obj({
    id: s.uuid(), list_id: s.uuid(), board_id: s.uuid(), title: s.str(), description: s.nullable(s.str()),
    position: s.num("Urutan di dalam list (ascending)"), due_at: s.dt(), completed_at: s.dt(), created_by: s.uuid(),
    source_message_id: s.nullable(s.uuid()), archived_at: s.dt(), created_at: s.str(), room_id: s.nullable(s.uuid()),
    assignee_ids: s.arr(s.uuid()), label_ids: s.arr(s.uuid()), checklists: s.arr(s.ref("Checklist")),
    checklist_items: s.arr(s.ref("ChecklistItem"), "Gabungan item dari semua checklist"), attachments: s.arr(s.ref("Attachment")),
  }),
  Room: s.obj({
    id: s.uuid(), workspace_id: s.uuid(), type: s.enum(["group", "direct", "board", "card"]),
    name: s.nullable(s.str("null untuk DM: tampilkan nama anggota lain")), board_id: s.nullable(s.uuid()), card_id: s.nullable(s.uuid()),
    only_admins_can_send: s.bool(), created_by: s.uuid(), member_ids: s.arr(s.uuid()), admin_ids: s.arr(s.uuid()),
    my_role: s.nullable(s.enum(["admin", "member"])), muted_until: s.dt(), unread_count: s.int(), last_message_at: s.dt(),
  }),
  MessageReaction: s.obj({ message_id: s.uuid(), user_id: s.uuid(), emoji: s.str() }),
  Message: s.obj({
    id: s.uuid(), room_id: s.uuid(), sender_id: s.nullable(s.uuid()), sender_name: s.nullable(s.str()),
    type: s.enum(["text", "image", "file", "voice", "system", "task_event"]), content: s.nullable(s.str()),
    reply_to_id: s.nullable(s.uuid()), card_id: s.nullable(s.uuid()), card_title: s.nullable(s.str()),
    edited_at: s.dt(), deleted_at: s.dt(), created_at: s.str(), reactions: s.arr(s.ref("MessageReaction")),
    mention_ids: s.arr(s.uuid()),
    delivered_to: s.arr(s.uuid(), "Hanya terisi untuk pesan milik user sendiri (centang dua)"),
    read_by: s.arr(s.uuid(), "Hanya terisi untuk pesan milik user sendiri (centang biru)"),
    attachments: s.arr(s.ref("Attachment")),
  }),
  Activity: s.obj({
    id: s.uuid(), board_id: s.uuid(), card_id: s.nullable(s.uuid()), actor_id: s.uuid(), actor_name: s.str(),
    action: s.str("card_created, card_moved, card_completed, due_changed, ..."), payload: s.any(), created_at: s.str(),
  }),
  Notification: s.obj({
    id: s.uuid(), user_id: s.uuid(), type: s.enum(["mention", "assigned", "due_soon", "new_message", "member_joined"]),
    ref_type: s.enum(["card", "message", "room", "workspace"]), ref_id: s.uuid(), is_read: s.bool(), created_at: s.str(),
    title: s.str("Teks siap tampil"),
  }),
  DevAccount: s.obj({
    id: s.uuid(), name: s.str(), email: s.email(), platform_role: s.enum(["developer", "user"]), is_active: s.bool(),
    created_at: s.str(), last_seen_at: s.dt(), online: s.bool(),
    memberships: s.arr(s.obj({ workspace_id: s.uuid(), workspace_name: s.str(), role: s.ref("WorkspaceRole") })),
  }),
  DevWorkspace: s.obj({
    id: s.uuid(), name: s.str(), slug: s.str(), owner_id: s.nullable(s.uuid()), owner_name: s.nullable(s.str()),
    owner_email: s.nullable(s.str()), member_count: s.int(), created_at: s.str(),
  }),
  DevConsole: s.obj({
    accounts: s.arr(s.ref("DevAccount")), workspaces: s.arr(s.ref("DevWorkspace")),
    pending_tokens: s.arr(s.ref("Invitation")), smtp_status: s.ref("SmtpStatus"),
  }),
  WorkspaceSnapshot: s.obj(
    {
      me: s.ref("Me"),
      workspaces: s.arr(s.ref("Workspace"), "Semua workspace milik user"),
      active_workspace_id: s.nullable(s.uuid()),
      users: s.arr(s.ref("User"), "Anggota workspace aktif"),
      workspace_members: s.arr(s.ref("WorkspaceMember")),
      invitations: s.arr(s.ref("Invitation"), "Hanya untuk owner/admin"),
      boards: s.arr(s.ref("Board"), "Board yang boleh dilihat user"),
      lists: s.arr(s.ref("List")),
      labels: s.arr(s.ref("Label")),
      cards: s.arr(s.ref("Card")),
      rooms: s.arr(s.ref("Room"), "Room di mana user menjadi anggota"),
      messages: s.arr(s.ref("Message"), "200 pesan terakhir per room"),
      activities: s.arr(s.ref("Activity")),
      notifications: s.arr(s.ref("Notification")),
      smtp_status: s.ref("SmtpStatus"),
      dev: s.ref("DevConsole"),
    },
    ["me", "workspaces", "active_workspace_id"],
    "Data yang di-scope per user + workspace aktif. Developer hanya mendapat `dev`, tanpa isi workspace.",
  ),
  WsRequest: s.obj({ id: s.str("ID unik buatan client untuk mencocokkan response"), action: s.str(), payload: s.any() }, ["id", "action"]),
  WsResponse: s.obj({ id: s.str(), type: { const: "response" }, ok: s.bool(), action: s.str(), data: {}, error: s.str() }, ["id", "type", "ok", "action"]),
  WsEvent: s.obj(
    {
      type: { const: "event" },
      event: s.str("Nama aksi pemicu, `presence`, `state:init`, atau `session:revoked`"),
      data: {},
      snapshot: s.ref("WorkspaceSnapshot"),
      timestamp: s.str(),
    },
    ["type", "event", "timestamp"],
  ),
};
