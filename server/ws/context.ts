import type { BunSqlClient } from "../bun-env";
import type { AuthUserRow } from "../auth/auth";
import type { WorkspaceRole } from "./protocol";
import type { GoogleTokenVerifier } from "../auth/google";

/** Per-request context; `user` is bound to the socket after login/resume. */
export interface ActionContext {
  sql: BunSqlClient;
  user: AuthUserRow | null;
  sessionToken: string | null;
  activeWorkspaceId: string | null;
  /** Public base URL used in email links, derived from the browser Origin. */
  origin: string;
  onlineUserIds: ReadonlySet<string>;
  /** Optional dependency supplied by isolated integration tests, never by API payloads. */
  googleTokenVerifier?: GoogleTokenVerifier;
}

export interface ActionResult {
  result: unknown;
  /** Workspaces whose members must receive a refreshed snapshot. */
  workspaceIds?: string[];
  /** Refresh the developer console of connected developers. */
  platform?: boolean;
  /** Users whose own snapshot must refresh (e.g. profile/notification changes). */
  userIds?: string[];
  /** Bind (login) or clear (logout) the socket session. */
  auth?: { user: AuthUserRow; token: string } | { logout: true };
  /** Switch the active workspace of the calling socket. */
  selectWorkspaceId?: string | null;
  /** Users whose sockets must be signed out (account disabled). */
  revokeUserIds?: string[];
}

export class PermissionError extends Error {}
/** Missing/expired session (HTTP 401); PermissionError alone maps to 403. */
export class AuthRequiredError extends PermissionError {}

export function requireUser(ctx: ActionContext): AuthUserRow {
  if (!ctx.user) throw new AuthRequiredError("Silakan login terlebih dahulu");
  return ctx.user;
}

export function requireDeveloper(ctx: ActionContext): AuthUserRow {
  const user = requireUser(ctx);
  if (user.platform_role !== "developer") {
    throw new PermissionError("Hanya tim developer yang dapat melakukan aksi ini");
  }
  return user;
}

export function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export function optionalId(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export async function getWorkspaceRole(
  sql: BunSqlClient,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const [row] = await sql<{ role: WorkspaceRole }>`
    SELECT role FROM workspace_members
    WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
  `;
  return row?.role ?? null;
}

export const MANAGER_ROLES: WorkspaceRole[] = ["owner", "admin"];
export const WRITER_ROLES: WorkspaceRole[] = ["owner", "admin", "member"];
export const ALL_ROLES: WorkspaceRole[] = ["owner", "admin", "member", "guest"];

/**
 * Workspace content is private to its members. Platform developers are never
 * members, so every content action fails for them here.
 */
export async function requireWorkspaceRole(
  ctx: ActionContext,
  workspaceId: string,
  allowed: WorkspaceRole[] = ALL_ROLES,
): Promise<{ user: AuthUserRow; role: WorkspaceRole }> {
  const user = requireUser(ctx);
  if (!workspaceId) throw new Error("workspace_id diperlukan");
  const role = await getWorkspaceRole(ctx.sql, workspaceId, user.id);
  if (!role) {
    throw new PermissionError("Anda bukan anggota workspace ini");
  }
  if (!allowed.includes(role)) {
    throw new PermissionError("Peran Anda tidak memiliki izin untuk aksi ini");
  }
  return { user, role };
}

export interface BoardInfo {
  id: string;
  workspace_id: string;
  name: string;
  visibility: "private" | "workspace";
  created_by: string;
}

export async function loadBoard(sql: BunSqlClient, boardId: string): Promise<BoardInfo> {
  if (!boardId) throw new Error("board_id diperlukan");
  const [board] = await sql<BoardInfo>`
    SELECT id, workspace_id, name, visibility, created_by
    FROM boards WHERE id = ${boardId} AND archived_at IS NULL
  `;
  if (!board) throw new Error("Board tidak ditemukan");
  return board;
}

export async function isBoardMember(
  sql: BunSqlClient,
  boardId: string,
  userId: string,
): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM board_members WHERE board_id = ${boardId} AND user_id = ${userId}
  `;
  return rows.length > 0;
}

/**
 * Board access: workspace membership plus, for private boards, board
 * membership. `write` excludes guests (read + chat only).
 */
export async function requireBoardAccess(
  ctx: ActionContext,
  boardId: string,
  opts: { write?: boolean; manage?: boolean } = {},
): Promise<{ user: AuthUserRow; role: WorkspaceRole; board: BoardInfo }> {
  const board = await loadBoard(ctx.sql, boardId);
  const allowed = opts.manage ? MANAGER_ROLES : opts.write ? WRITER_ROLES : ALL_ROLES;
  const { user, role } = await requireWorkspaceRole(ctx, board.workspace_id, ALL_ROLES);
  if (
    board.visibility === "private" &&
    !(await isBoardMember(ctx.sql, board.id, user.id))
  ) {
    throw new PermissionError("Board ini privat");
  }
  const isBoardCreator = board.created_by === user.id;
  if (!allowed.includes(role) && !(opts.manage && isBoardCreator && role !== "guest")) {
    throw new PermissionError("Peran Anda tidak memiliki izin untuk aksi ini");
  }
  return { user, role, board };
}

export interface CardInfo {
  id: string;
  board_id: string;
  list_id: string;
  title: string;
  due_at: string | null;
  completed_at: string | null;
}

export async function loadCard(sql: BunSqlClient, cardId: string): Promise<CardInfo> {
  if (!cardId) throw new Error("card_id diperlukan");
  const [card] = await sql<CardInfo>`
    SELECT id, board_id, list_id, title, due_at::text AS due_at, completed_at::text AS completed_at
    FROM cards WHERE id = ${cardId} AND archived_at IS NULL
  `;
  if (!card) throw new Error("Card tidak ditemukan");
  return card;
}

export async function requireCardAccess(
  ctx: ActionContext,
  cardId: string,
  opts: { write?: boolean } = { write: true },
) {
  const card = await loadCard(ctx.sql, cardId);
  const access = await requireBoardAccess(ctx, card.board_id, opts);
  return { ...access, card };
}

export interface RoomInfo {
  id: string;
  workspace_id: string;
  type: "group" | "direct" | "board" | "card";
  name: string | null;
  board_id: string | null;
  card_id: string | null;
  only_admins_can_send: boolean;
}

export async function requireRoomMember(
  ctx: ActionContext,
  roomId: string,
): Promise<{
  user: AuthUserRow;
  role: WorkspaceRole;
  room: RoomInfo;
  roomRole: "admin" | "member";
}> {
  if (!roomId) throw new Error("room_id diperlukan");
  const [room] = await ctx.sql<RoomInfo>`
    SELECT id, workspace_id, type, name, board_id, card_id, only_admins_can_send
    FROM rooms WHERE id = ${roomId}
  `;
  if (!room) throw new Error("Ruang chat tidak ditemukan");
  const { user, role } = await requireWorkspaceRole(ctx, room.workspace_id);
  const [member] = await ctx.sql<{ role: "admin" | "member" }>`
    SELECT role FROM room_members WHERE room_id = ${roomId} AND user_id = ${user.id}
  `;
  if (!member) throw new PermissionError("Anda bukan anggota ruang chat ini");
  return { user, role, room, roomRole: member.role };
}

export async function userName(sql: BunSqlClient, userId: string): Promise<string> {
  const [row] = await sql<{ name: string }>`SELECT name FROM users WHERE id = ${userId}`;
  return row?.name || "Pengguna";
}

export function roomDisplayName(room: { name: string | null; type: string }): string {
  return room.name || (room.type === "direct" ? "Pesan Langsung" : "Ruang Chat");
}
