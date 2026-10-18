import type { BunSqlClient } from "../../bun-env";
import {
  createAccountToken,
  isValidEmail,
  normalizeEmail,
  type AuthUserRow,
} from "../../auth/auth";
import { invitationEmail } from "../../services/email-templates";
import { enqueueEmail } from "../../services/mailer";
import { deepLink, notifyActivity, recordActivity } from "../../services/notify";
import type { ActionContext, ActionResult } from "../context";
import {
  MANAGER_ROLES,
  PermissionError,
  getWorkspaceRole,
  requireUser,
  requireWorkspaceRole,
  roomDisplayName,
  str,
  userName,
} from "../context";
import type { WorkspaceRole } from "../protocol";

export async function selectWorkspace(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const workspaceId = str(payload.workspace_id);
  await requireWorkspaceRole(ctx, workspaceId);
  return { result: { workspace_id: workspaceId }, selectWorkspaceId: workspaceId };
}

export async function updateSettings(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const workspaceId = str(payload.workspace_id);
  const { user } = await requireWorkspaceRole(ctx, workspaceId, MANAGER_ROLES);
  const [current] = await ctx.sql<{ name: string; email_chat_enabled: boolean; email_activity_enabled: boolean }>`
    SELECT name, email_chat_enabled, email_activity_enabled FROM workspaces WHERE id = ${workspaceId}
  `;
  const name = str(payload.name) || current.name;
  const chat = typeof payload.email_chat_enabled === "boolean" ? payload.email_chat_enabled : current.email_chat_enabled;
  const activity =
    typeof payload.email_activity_enabled === "boolean" ? payload.email_activity_enabled : current.email_activity_enabled;
  await ctx.sql`
    UPDATE workspaces
    SET name = ${name.slice(0, 100)}, email_chat_enabled = ${chat}, email_activity_enabled = ${activity}
    WHERE id = ${workspaceId}
  `;
  await notifyActivity(ctx.sql, ctx.origin, {
    workspaceId,
    boardId: null,
    actorId: user.id,
    action: "workspace_updated",
    payload: { email_chat_enabled: chat, email_activity_enabled: activity },
  });
  return {
    result: { workspace_id: workspaceId, name, email_chat_enabled: chat, email_activity_enabled: activity },
    workspaceIds: [workspaceId],
    platform: true,
  };
}

/**
 * Sends an invitation email with a one-time link. No account is created here:
 * the invitee creates their own account (name + password) when accepting.
 */
export async function sendInvitation(
  sql: BunSqlClient,
  origin: string,
  params: { workspaceId: string; email: string; role: WorkspaceRole; inviter: AuthUserRow },
): Promise<{ invitation_id: string; existing_user: boolean; expires_at: string }> {
  const email = normalizeEmail(params.email);
  if (!isValidEmail(email)) throw new Error("Alamat email tidak valid");

  const [existing] = await sql<{ id: string; platform_role: string }>`
    SELECT id, platform_role FROM users WHERE LOWER(email) = ${email}
  `;
  if (existing?.platform_role === "developer") {
    throw new Error("Akun developer tidak dapat diundang ke workspace");
  }
  if (existing && (await getWorkspaceRole(sql, params.workspaceId, existing.id))) {
    throw new Error("Pengguna ini sudah menjadi anggota workspace");
  }

  const [ws] = await sql<{ name: string }>`SELECT name FROM workspaces WHERE id = ${params.workspaceId}`;
  if (!ws) throw new Error("Workspace tidak ditemukan");

  const { token, id, expiresAt } = await createAccountToken(sql, {
    purpose: "invite",
    email,
    workspaceId: params.workspaceId,
    role: params.role,
    createdBy: params.inviter.id,
  });
  const mail = invitationEmail({
    inviterName: params.inviter.name,
    workspaceName: ws.name,
    role: params.role,
    acceptUrl: deepLink(origin, { invite: token }),
    existingUser: Boolean(existing),
    expiresAt,
  });
  enqueueEmail({ to: email, subject: mail.subject, html: mail.html });
  return { invitation_id: id, existing_user: Boolean(existing), expires_at: expiresAt };
}

export async function inviteMember(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const workspaceId = str(payload.workspace_id) || ctx.activeWorkspaceId || "";
  const { user, role: myRole } = await requireWorkspaceRole(ctx, workspaceId, MANAGER_ROLES);
  const role: WorkspaceRole =
    payload.role === "admin" ? "admin" : payload.role === "guest" ? "guest" : "member";
  if (role === "admin" && myRole !== "owner" && myRole !== "admin") {
    throw new PermissionError("Hanya owner/admin yang dapat mengundang admin");
  }
  const email = normalizeEmail(payload.email);
  const sent = await sendInvitation(ctx.sql, ctx.origin, { workspaceId, email, role, inviter: user });
  await notifyActivity(ctx.sql, ctx.origin, {
    workspaceId,
    boardId: null,
    actorId: user.id,
    action: "member_invited",
    payload: { email, role },
  });
  return {
    result: { ...sent, email, role, email_queued: true },
    workspaceIds: [workspaceId],
  };
}

async function loadInvitation(ctx: ActionContext, invitationId: string) {
  const [inv] = await ctx.sql<{
    id: string;
    email: string;
    workspace_id: string | null;
    role: WorkspaceRole | null;
  }>`
    SELECT id, email, workspace_id, role FROM account_tokens
    WHERE id = ${invitationId} AND purpose = 'invite' AND used_at IS NULL AND revoked_at IS NULL
  `;
  if (!inv || !inv.workspace_id || !inv.role) throw new Error("Undangan tidak ditemukan");
  const user = requireUser(ctx);
  // Developers manage owner/admin invitations; workspace managers manage their own.
  if (user.platform_role !== "developer") {
    await requireWorkspaceRole(ctx, inv.workspace_id, MANAGER_ROLES);
  }
  return { inv: inv as typeof inv & { workspace_id: string; role: WorkspaceRole }, user };
}

export async function revokeInvitation(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { inv } = await loadInvitation(ctx, str(payload.invitation_id));
  await ctx.sql`UPDATE account_tokens SET revoked_at = now() WHERE id = ${inv.id}`;
  return { result: { id: inv.id }, workspaceIds: [inv.workspace_id], platform: true };
}

export async function resendInvitation(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const { inv, user } = await loadInvitation(ctx, str(payload.invitation_id));
  const sent = await sendInvitation(ctx.sql, ctx.origin, {
    workspaceId: inv.workspace_id,
    email: inv.email,
    role: inv.role,
    inviter: user,
  });
  return { result: sent, workspaceIds: [inv.workspace_id], platform: true };
}

async function assertCanManageTarget(
  ctx: ActionContext,
  workspaceId: string,
  targetUserId: string,
): Promise<{ user: AuthUserRow; myRole: WorkspaceRole; targetRole: WorkspaceRole }> {
  const { user, role: myRole } = await requireWorkspaceRole(ctx, workspaceId, MANAGER_ROLES);
  const targetRole = await getWorkspaceRole(ctx.sql, workspaceId, targetUserId);
  if (!targetRole) throw new Error("Pengguna bukan anggota workspace ini");
  if (targetRole === "owner") throw new PermissionError("Owner workspace tidak dapat diubah");
  if (targetUserId === user.id) throw new PermissionError("Anda tidak dapat mengubah peran Anda sendiri");
  if (myRole === "admin" && targetRole === "admin") {
    throw new PermissionError("Admin hanya dapat mengelola anggota dan tamu");
  }
  return { user, myRole, targetRole };
}

export async function updateMemberRole(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const workspaceId = str(payload.workspace_id) || ctx.activeWorkspaceId || "";
  const targetUserId = str(payload.user_id);
  const role = str(payload.role) as WorkspaceRole;
  if (!["admin", "member", "guest"].includes(role)) throw new Error("Peran tidak valid");
  const { user, myRole } = await assertCanManageTarget(ctx, workspaceId, targetUserId);
  if (role === "admin" && myRole !== "owner") {
    throw new PermissionError("Hanya owner yang dapat mengangkat admin");
  }
  const memberName = await userName(ctx.sql, targetUserId);
  await ctx.sql.begin(async (tx) => {
    await tx`
      UPDATE workspace_members SET role = ${role}
      WHERE workspace_id = ${workspaceId} AND user_id = ${targetUserId}
    `;
    await recordActivity(tx, {
      workspaceId,
      boardId: null,
      actorId: user.id,
      action: "member_role_changed",
      eventText: `${user.name} mengubah peran ${memberName} menjadi ${role}`,
    });
  });
  await notifyActivity(ctx.sql, ctx.origin, {
    workspaceId,
    boardId: null,
    actorId: user.id,
    action: "member_role_changed",
    payload: { member_name: memberName, role },
  });
  return {
    result: { workspace_id: workspaceId, user_id: targetUserId, role },
    workspaceIds: [workspaceId],
    platform: true,
  };
}

export async function removeMember(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const workspaceId = str(payload.workspace_id) || ctx.activeWorkspaceId || "";
  const targetUserId = str(payload.user_id);
  const { user } = await assertCanManageTarget(ctx, workspaceId, targetUserId);
  const memberName = await userName(ctx.sql, targetUserId);
  await ctx.sql.begin(async (tx) => {
    await tx`DELETE FROM workspace_members WHERE workspace_id = ${workspaceId} AND user_id = ${targetUserId}`;
    await tx`
      DELETE FROM room_members
      WHERE user_id = ${targetUserId}
        AND room_id IN (SELECT id FROM rooms WHERE workspace_id = ${workspaceId})
    `;
    await tx`
      DELETE FROM board_members
      WHERE user_id = ${targetUserId}
        AND board_id IN (SELECT id FROM boards WHERE workspace_id = ${workspaceId})
    `;
    await recordActivity(tx, {
      workspaceId,
      boardId: null,
      actorId: user.id,
      action: "member_removed",
      eventText: `${user.name} mengeluarkan ${memberName} dari workspace`,
    });
  });
  await notifyActivity(ctx.sql, ctx.origin, {
    workspaceId,
    boardId: null,
    actorId: user.id,
    action: "member_removed",
    payload: { member_name: memberName },
  });
  return {
    result: { workspace_id: workspaceId, user_id: targetUserId },
    workspaceIds: [workspaceId],
    userIds: [targetUserId],
    platform: true,
  };
}

export async function toggleRoomPermission(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const roomId = str(payload.room_id);
  const onlyAdmins = Boolean(payload.only_admins_can_send);
  const [room] = await ctx.sql<{ id: string; workspace_id: string; name: string | null; type: string }>`
    SELECT id, workspace_id, name, type FROM rooms WHERE id = ${roomId}
  `;
  if (!room) throw new Error("Ruang chat tidak ditemukan");
  const { user, role } = await requireWorkspaceRole(ctx, room.workspace_id);
  const [rm] = await ctx.sql<{ role: string }>`
    SELECT role FROM room_members WHERE room_id = ${roomId} AND user_id = ${user.id}
  `;
  if (!MANAGER_ROLES.includes(role) && rm?.role !== "admin") {
    throw new PermissionError("Hanya admin yang dapat mengubah izin ruang chat");
  }
  await ctx.sql`UPDATE rooms SET only_admins_can_send = ${onlyAdmins} WHERE id = ${roomId}`;
  const roomMembers = await ctx.sql<{ user_id: string }>`
    SELECT user_id FROM room_members WHERE room_id = ${roomId}
  `;
  await notifyActivity(
    ctx.sql,
    ctx.origin,
    {
      workspaceId: room.workspace_id,
      boardId: null,
      actorId: user.id,
      action: "room_permission_changed",
      payload: { room_name: roomDisplayName(room), only_admins_can_send: onlyAdmins },
    },
    { onlyUserIds: roomMembers.map((m) => m.user_id) },
  );
  return {
    result: { room_id: roomId, only_admins_can_send: onlyAdmins },
    workspaceIds: [room.workspace_id],
  };
}
