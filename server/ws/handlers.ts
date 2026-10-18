import * as auth from "./actions/auth";
import * as board from "./actions/board";
import * as chat from "./actions/chat";
import * as dev from "./actions/developer";
import * as workspace from "./actions/workspace";
import type { ActionContext, ActionResult } from "./context";
import { requireUser } from "./context";
import type { WsAction } from "./protocol";
import { buildSnapshot } from "./snapshot";

type Handler = (ctx: ActionContext, payload: Record<string, unknown>) => Promise<ActionResult>;

/** Actions an unauthenticated socket may call (login & account recovery). */
export const PUBLIC_ACTIONS: ReadonlySet<WsAction> = new Set<WsAction>([
  "auth:login",
  "auth:resume",
  "invite:lookup",
  "invite:accept",
  "password:reset_request",
  "password:reset",
]);

export const ACTION_HANDLERS: Record<WsAction, Handler> = {
  "auth:login": auth.login,
  "auth:resume": auth.resume,
  "auth:logout": (ctx) => auth.logout(ctx),
  "invite:lookup": auth.lookupToken,
  "invite:accept": auth.acceptInvite,
  "password:reset_request": (ctx, p) => auth.requestPasswordReset(ctx, p),
  "password:reset": auth.resetPassword,
  "account:update_profile": auth.updateProfile,
  "account:change_password": auth.changePassword,
  "account:update_preferences": auth.updatePreferences,

  "state:init": async (ctx) => ({
    result: await buildSnapshot(ctx.sql, requireUser(ctx), ctx.activeWorkspaceId, ctx.onlineUserIds),
  }),
  "workspace:select": workspace.selectWorkspace,
  "workspace:update_settings": workspace.updateSettings,
  "workspace:invite_member": workspace.inviteMember,
  "workspace:remove_member": workspace.removeMember,
  "invite:revoke": workspace.revokeInvitation,
  "invite:resend": workspace.resendInvitation,
  "admin:update_member_role": workspace.updateMemberRole,
  "admin:toggle_room_permission": workspace.toggleRoomPermission,

  "board:create": board.createBoard,
  "board:update": board.updateBoard,
  "board:delete": board.archiveBoard,
  "board:toggle_member": board.toggleBoardMember,
  "list:create": board.createList,
  "list:update": board.renameList,
  "list:move": board.moveList,
  "list:delete": board.archiveList,
  "label:create": board.createLabel,
  "label:delete": board.deleteLabel,
  "card:create": board.createCard,
  "card:update": board.updateCard,
  "card:move": board.moveCard,
  "card:delete": board.archiveCard,
  "card:from_message": board.cardFromMessage,
  "card:toggle_assignee": board.toggleAssignee,
  "card:toggle_label": board.toggleLabel,
  "card:open_room": board.openCardRoom,
  "checklist:create": board.createChecklist,
  "checklist:delete": board.deleteChecklist,
  "checklist:add_item": board.addChecklistItem,
  "checklist:update_item": board.updateChecklistItem,
  "checklist:toggle_item": board.toggleChecklistItem,
  "checklist:delete_item": board.deleteChecklistItem,
  "attachment:upload": board.uploadAttachment,
  "attachment:delete": board.deleteAttachment,

  "room:create": chat.createRoom,
  "room:open_direct": chat.openDirectRoom,
  "room:add_members": chat.addRoomMembers,
  "room:leave": chat.leaveRoom,
  "room:mute": chat.muteRoom,
  "message:send": chat.sendMessage,
  "message:update": chat.updateMessage,
  "message:delete": chat.deleteMessage,
  "message:react": chat.reactMessage,
  "message:mark_read": chat.markRoomRead,
  "notification:mark_read": chat.markNotificationsRead,

  "dev:create_workspace": dev.createCompanyWorkspace,
  "dev:invite_admin": dev.inviteWorkspaceAdmin,
  "dev:set_user_active": dev.setUserActive,
  "dev:update_user": dev.updateUser,
  "dev:delete_user": dev.deleteUser,
  "dev:send_password_reset": dev.sendPasswordResetFor,
  "smtp:status": (ctx) => dev.smtpStatus(ctx),
  "smtp:test_send": dev.smtpTestSend,
};

export async function handleWsAction(
  ctx: ActionContext,
  action: WsAction,
  payload: Record<string, unknown> = {},
): Promise<ActionResult> {
  const handler = ACTION_HANDLERS[action];
  if (!handler) throw new Error(`Aksi WebSocket tidak dikenal: ${String(action)}`);
  if (!PUBLIC_ACTIONS.has(action)) requireUser(ctx);
  return handler(ctx, payload);
}
