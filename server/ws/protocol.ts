export type WsAction =
  | "state:init"
  | "board:create"
  | "board:update"
  | "board:delete"
  | "list:create"
  | "list:update"
  | "list:delete"
  | "card:create"
  | "card:update"
  | "card:move"
  | "card:delete"
  | "card:from_message"
  | "checklist:add_item"
  | "checklist:toggle_item"
  | "checklist:delete_item"
  | "room:create"
  | "message:send"
  | "message:update"
  | "message:delete"
  | "message:react"
  | "message:mark_read";

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

export interface WsBroadcastEvent<T = unknown> {
  type: "event";
  event: WsAction;
  data: T;
  snapshot: WorkspaceSnapshot;
  timestamp: string;
}

export interface UserDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  last_seen_at: string | null;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
}

export interface BoardDto {
  id: string;
  workspace_id: string;
  name: string;
  visibility: "private" | "workspace";
  created_by: string;
  archived_at: string | null;
  room_id: string | null;
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
  position: number;
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
  assignee_ids: string[];
  label_ids: string[];
  checklist_items: ChecklistItemDto[];
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
}

export interface WorkspaceSnapshot {
  users: UserDto[];
  workspaces: WorkspaceDto[];
  boards: BoardDto[];
  lists: ListDto[];
  labels: LabelDto[];
  cards: CardDto[];
  rooms: RoomDto[];
  messages: MessageDto[];
  activities: ActivityDto[];
  notifications: NotificationDto[];
}
