export type WsAction =
  // --- Auth & account (some allowed before login) ---
  | "auth:login"
  | "auth:google_config"
  | "auth:google_start"
  | "auth:google_verify"
  | "auth:resume"
  | "auth:logout"
  | "invite:lookup"
  | "invite:accept"
  | "password:reset_request"
  | "password:reset"
  | "account:update_profile"
  | "account:change_password"
  | "account:update_preferences"
  // --- Workspace scope ---
  | "state:init"
  | "workspace:select"
  | "workspace:update_settings"
  | "workspace:invite_member"
  | "workspace:remove_member"
  | "invite:revoke"
  | "invite:resend"
  | "admin:update_member_role"
  | "admin:toggle_room_permission"
  // --- Task board ---
  | "board:create"
  | "board:update"
  | "board:delete"
  | "board:toggle_member"
  | "list:create"
  | "list:update"
  | "list:move"
  | "list:delete"
  | "label:create"
  | "label:delete"
  | "card:create"
  | "card:update"
  | "card:move"
  | "card:delete"
  | "card:from_message"
  | "card:toggle_assignee"
  | "card:toggle_label"
  | "card:open_room"
  | "checklist:create"
  | "checklist:delete"
  | "checklist:add_item"
  | "checklist:update_item"
  | "checklist:toggle_item"
  | "checklist:delete_item"
  | "attachment:upload"
  | "attachment:delete"
  // --- Chat ---
  | "room:create"
  | "room:open_direct"
  | "room:add_members"
  | "room:leave"
  | "room:mute"
  | "message:send"
  | "message:update"
  | "message:delete"
  | "message:react"
  | "message:mark_read"
  // --- Notifications ---
  | "notification:mark_read"
  // --- Platform developer console (account management only) ---
  | "dev:create_workspace"
  | "dev:invite_admin"
  | "dev:set_user_active"
  | "dev:update_user"
  | "dev:delete_user"
  | "dev:send_password_reset"
  | "smtp:status"
  | "smtp:test_send";

export type PlatformRole = "developer" | "user";

export interface GoogleLoginConfigDto { enabled: boolean; client_id: string | null }
export interface GoogleLoginChallengeDto {
  challenge: string;
  email: string;
  expires_at: string;
  resend_after_seconds: number;
}
export type WorkspaceRole = "owner" | "admin" | "member" | "guest";

export interface WsRequestMessage<T = Record<string, unknown>> {
  id: string;
  action: WsAction;
  payload?: T;
}

export interface WsResponseMessage<T = unknown> {
  id: string;
  type: "response";
  ok: boolean;
  action: WsAction;
  data?: T;
  error?: string;
}

export type WsEventName = WsAction | "presence" | "session:revoked" | "notification:browser";

export interface BrowserNotificationDto {
  id: string;
  title: string;
  body: string;
  /** Relative, same-origin deep link. */
  url: string;
}

export interface WsBroadcastEvent<T = unknown> {
  type: "event";
  event: WsEventName;
  data: T;
  /** Snapshot scoped to the receiving user + their active workspace. */
  snapshot?: WorkspaceSnapshot;
  timestamp: string;
}

export interface MeDto {
  id: string;
  name: string;
  email: string;
  platform_role: PlatformRole;
  avatar_url: string | null;
  notify_chat_email: boolean;
  notify_mention_email: boolean;
  notify_activity_email: boolean;
}

export interface UserDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  last_seen_at: string | null;
  online: boolean;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  owner_id: string | null;
  my_role: WorkspaceRole;
  email_chat_enabled: boolean;
  email_activity_enabled: boolean;
}

export interface WorkspaceMemberDto {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  joined_at: string;
  user_name: string;
  user_email: string;
  avatar_url: string | null;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: WorkspaceRole | null;
  workspace_id: string | null;
  created_by_name: string | null;
  created_at: string;
  expires_at: string;
}

export interface InvitationLookupDto {
  purpose: "invite" | "reset";
  email: string;
  role: WorkspaceRole | null;
  workspace_name: string | null;
  inviter_name: string | null;
  existing_user: boolean;
  expires_at: string;
}

export interface AuthResultDto {
  token: string;
  me: MeDto;
}

export interface SmtpStatusDto {
  ok: boolean;
  message: string;
  host: string;
  port: number;
  user: string;
  enabled: boolean;
}

export interface BoardDto {
  id: string;
  workspace_id: string;
  name: string;
  visibility: "private" | "workspace";
  created_by: string;
  archived_at: string | null;
  room_id: string | null;
  member_ids: string[];
}

export interface ListDto {
  id: string;
  board_id: string;
  name: string;
  position: number;
  archived_at: string | null;
}

export interface LabelDto {
  id: string;
  board_id: string;
  name: string;
  color: string;
}

export interface ChecklistItemDto {
  id: string;
  checklist_id: string;
  card_id: string;
  content: string;
  is_done: boolean;
  assignee_id: string | null;
  due_at: string | null;
  position: number;
}

export interface ChecklistDto {
  id: string;
  card_id: string;
  title: string;
  position: number;
  items: ChecklistItemDto[];
}

export interface AttachmentDto {
  id: string;
  uploader_id: string;
  card_id: string | null;
  message_id: string | null;
  file_url: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface CardDto {
  id: string;
  list_id: string;
  board_id: string;
  title: string;
  description: string | null;
  position: number;
  due_at: string | null;
  completed_at: string | null;
  created_by: string;
  source_message_id: string | null;
  archived_at: string | null;
  created_at: string;
  room_id: string | null;
  assignee_ids: string[];
  label_ids: string[];
  checklists: ChecklistDto[];
  /** Flattened items of all checklists (kept for dashboards). */
  checklist_items: ChecklistItemDto[];
  attachments: AttachmentDto[];
}

export interface RoomDto {
  id: string;
  workspace_id: string;
  type: "group" | "direct" | "board" | "card";
  name: string | null;
  board_id: string | null;
  card_id: string | null;
  only_admins_can_send: boolean;
  created_by: string;
  member_ids: string[];
  admin_ids: string[];
  my_role: "admin" | "member" | null;
  muted_until: string | null;
  unread_count: number;
  last_message_at: string | null;
}

export interface MessageReactionDto {
  message_id: string;
  user_id: string;
  emoji: string;
}

export interface MessageDto {
  id: string;
  room_id: string;
  sender_id: string | null;
  sender_name: string | null;
  type: "text" | "image" | "file" | "voice" | "system" | "task_event";
  content: string | null;
  reply_to_id: string | null;
  card_id: string | null;
  card_title: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  reactions: MessageReactionDto[];
  mention_ids: string[];
  delivered_to: string[];
  read_by: string[];
  attachments: AttachmentDto[];
}

export interface ActivityDto {
  id: string;
  board_id: string;
  card_id: string | null;
  actor_id: string;
  actor_name: string;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface NotificationDto {
  id: string;
  user_id: string;
  type: string;
  ref_type: string;
  ref_id: string;
  is_read: boolean;
  created_at: string;
  title: string;
}

export interface DevAccountDto {
  id: string;
  name: string;
  email: string;
  platform_role: PlatformRole;
  is_active: boolean;
  created_at: string;
  last_seen_at: string | null;
  online: boolean;
  memberships: { workspace_id: string; workspace_name: string; role: WorkspaceRole }[];
}

export interface DevWorkspaceDto {
  id: string;
  name: string;
  slug: string;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  member_count: number;
  created_at: string;
}

export interface DevConsoleDto {
  accounts: DevAccountDto[];
  workspaces: DevWorkspaceDto[];
  pending_tokens: InvitationDto[];
  smtp_status: SmtpStatusDto;
}

export interface WorkspaceSnapshot {
  me: MeDto;
  workspaces: WorkspaceDto[];
  active_workspace_id: string | null;
  users: UserDto[];
  workspace_members: WorkspaceMemberDto[];
  invitations: InvitationDto[];
  boards: BoardDto[];
  lists: ListDto[];
  labels: LabelDto[];
  cards: CardDto[];
  rooms: RoomDto[];
  messages: MessageDto[];
  activities: ActivityDto[];
  notifications: NotificationDto[];
  smtp_status?: SmtpStatusDto;
  /** Only present for platform developers. Never contains workspace content. */
  dev?: DevConsoleDto;
}
