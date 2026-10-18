import {
  assertPassword,
  createAccountToken,
  createSession,
  findValidAccountToken,
  hashToken,
  isValidEmail,
  loadAuthUser,
  normalizeEmail,
  resolveSession,
  revokeSession,
  toMeDto,
  verifyCredentials,
  type AuthUserRow,
} from "../../auth/auth";
import {
  invitationAcceptedEmail,
  passwordResetEmail,
  welcomeEmail,
} from "../../services/email-templates";
import { enqueueEmail } from "../../services/mailer";
import {
  createNotifications,
  deepLink,
  notifyActivity,
  recordActivity,
} from "../../services/notify";
import type { ActionContext, ActionResult } from "../context";
import { requireUser, str } from "../context";
import type { InvitationLookupDto } from "../protocol";
import { listMyWorkspaces } from "../snapshot";
import { addWorkspaceMember } from "./membership";

async function touchLastSeen(ctx: ActionContext, userId: string) {
  await ctx.sql`UPDATE users SET last_seen_at = now() WHERE id = ${userId}`;
}

async function workspaceIdsOf(ctx: ActionContext, userId: string): Promise<string[]> {
  return (await listMyWorkspaces(ctx.sql, userId)).map((w) => w.id);
}

export async function login(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const user = await verifyCredentials(ctx.sql, payload.email, payload.password);
  const token = await createSession(ctx.sql, user.id);
  await touchLastSeen(ctx, user.id);
  return {
    result: { token, me: toMeDto(user) },
    auth: { user, token },
    workspaceIds: await workspaceIdsOf(ctx, user.id),
  };
}

export async function resume(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const token = str(payload.token);
  const user = await resolveSession(ctx.sql, token);
  if (!user) throw new Error("Sesi Anda sudah berakhir, silakan login kembali");
  await touchLastSeen(ctx, user.id);
  return {
    result: { token, me: toMeDto(user) },
    auth: { user, token },
    workspaceIds: await workspaceIdsOf(ctx, user.id),
  };
}

export async function logout(ctx: ActionContext): Promise<ActionResult> {
  await revokeSession(ctx.sql, ctx.sessionToken);
  return { result: { ok: true }, auth: { logout: true } };
}

export async function lookupToken(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const row = await findValidAccountToken(ctx.sql, payload.token);
  const [info] = await ctx.sql<{ workspace_name: string | null; inviter_name: string | null }>`
    SELECT
      (SELECT name FROM workspaces WHERE id = ${row.workspace_id}) AS workspace_name,
      (SELECT name FROM users WHERE id = ${row.created_by}) AS inviter_name
  `;
  const existing = await ctx.sql`SELECT 1 FROM users WHERE LOWER(email) = ${row.email}`;
  const result: InvitationLookupDto = {
    purpose: row.purpose,
    email: row.email,
    role: row.role,
    workspace_name: info?.workspace_name ?? null,
    inviter_name: info?.inviter_name ?? null,
    existing_user: existing.length > 0,
    expires_at: row.expires_at,
  };
  return { result };
}

/**
 * Invitation acceptance: new emails create an account (name + password);
 * existing accounts confirm with their password. Afterwards the invitee gets a
 * welcome email and the inviter gets an "invitation accepted" email.
 */
export async function acceptInvite(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const row = await findValidAccountToken(ctx.sql, payload.token, "invite");
  if (!row.workspace_id || !row.role) throw new Error("Undangan tidak valid");
  const workspaceId = row.workspace_id;
  const role = row.role;

  const [existing] = await ctx.sql<{ id: string; platform_role: string }>`
    SELECT id, platform_role FROM users WHERE LOWER(email) = ${row.email}
  `;
  let existingUser: AuthUserRow | null = null;
  let newAccount: { name: string; hash: string } | null = null;
  if (existing) {
    if (existing.platform_role === "developer") {
      throw new Error("Akun developer tidak dapat menjadi anggota workspace");
    }
    existingUser = await verifyCredentials(ctx.sql, row.email, payload.password);
  } else {
    const name = str(payload.name);
    if (name.length < 2) throw new Error("Nama lengkap minimal 2 karakter");
    const password = assertPassword(payload.password);
    newAccount = { name: name.slice(0, 100), hash: await Bun.password.hash(password) };
  }

  const userId = await ctx.sql.begin(async (tx) => {
    let id = existingUser?.id ?? "";
    if (newAccount) {
      const [created] = await tx<{ id: string }>`
        INSERT INTO users (name, email, password_hash, last_seen_at)
        VALUES (${newAccount.name}, ${row.email}, ${newAccount.hash}, now())
        RETURNING id
      `;
      id = created.id;
    }
    const claimed = await tx`
      UPDATE account_tokens SET used_at = now(), user_id = ${id}
      WHERE id = ${row.id} AND used_at IS NULL AND revoked_at IS NULL
      RETURNING id
    `;
    if (claimed.length === 0) throw new Error("Tautan ini sudah pernah digunakan");
    await addWorkspaceMember(tx, workspaceId, id, role);
    await recordActivity(tx, {
      workspaceId,
      boardId: null,
      actorId: id,
      action: "member_joined",
      eventText: `${existingUser?.name ?? newAccount?.name} bergabung ke workspace`,
    });
    return id;
  });
  const user = (await loadAuthUser(ctx.sql, userId))!;

  const [ws] = await ctx.sql<{ name: string }>`SELECT name FROM workspaces WHERE id = ${workspaceId}`;
  const token = await createSession(ctx.sql, user.id);
  const workspaceUrl = deepLink(ctx.origin, { workspace: workspaceId });

  const welcome = welcomeEmail({
    name: user.name,
    workspaceName: ws?.name || "Workspace",
    role,
    loginUrl: workspaceUrl,
    newAccount: Boolean(newAccount),
  });
  enqueueEmail({ to: user.email, subject: welcome.subject, html: welcome.html });

  if (row.created_by && row.created_by !== user.id) {
    const inviter = await loadAuthUser(ctx.sql, row.created_by);
    if (inviter && inviter.is_active) {
      const accepted = invitationAcceptedEmail({
        inviterName: inviter.name,
        inviteeName: user.name,
        inviteeEmail: user.email,
        workspaceName: ws?.name || "Workspace",
        role,
        url: deepLink(ctx.origin, { workspace: workspaceId, tab: "admin" }),
      });
      enqueueEmail({ to: inviter.email, subject: accepted.subject, html: accepted.html });
      if (inviter.platform_role !== "developer") {
        await createNotifications(ctx.sql, [inviter.id], "member_joined", "workspace", workspaceId);
      }
    }
  }

  // Everyone else in the workspace gets the regular "member joined" email.
  await notifyActivity(ctx.sql, ctx.origin, {
    workspaceId,
    boardId: null,
    actorId: user.id,
    action: "member_joined",
    payload: { member_name: user.name, role },
  }, {
    // The inviter already received the dedicated "accepted" email.
    excludeUserIds: row.created_by ? [row.created_by] : [],
  });

  return {
    result: { token, me: toMeDto(user), workspace_id: workspaceId, new_account: Boolean(newAccount) },
    auth: { user, token },
    selectWorkspaceId: workspaceId,
    workspaceIds: [workspaceId],
    platform: true,
  };
}

export async function requestPasswordReset(
  ctx: ActionContext,
  payload: Record<string, unknown>,
  requestedBy: AuthUserRow | null = null,
): Promise<ActionResult> {
  const email = normalizeEmail(payload.email);
  if (!isValidEmail(email)) throw new Error("Alamat email tidak valid");
  const [user] = await ctx.sql<{ id: string; name: string; is_active: boolean }>`
    SELECT id, name, is_active FROM users WHERE LOWER(email) = ${email}
  `;
  // Do not reveal whether the email exists.
  if (user && user.is_active) {
    const { token, expiresAt } = await createAccountToken(ctx.sql, {
      purpose: "reset",
      email,
      userId: user.id,
      createdBy: requestedBy?.id ?? null,
    });
    const mail = passwordResetEmail({
      name: user.name,
      resetUrl: deepLink(ctx.origin, { reset: token }),
      requestedBy: requestedBy?.name ?? null,
      expiresAt,
    });
    enqueueEmail({ to: email, subject: mail.subject, html: mail.html });
  }
  return {
    result: { ok: true, message: "Jika email terdaftar, tautan atur ulang password sudah dikirim." },
  };
}

export async function resetPassword(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const row = await findValidAccountToken(ctx.sql, payload.token, "reset");
  const password = assertPassword(payload.password);
  const hash = await Bun.password.hash(password);
  const [target] = await ctx.sql<{ id: string }>`
    SELECT id FROM users WHERE LOWER(email) = ${row.email} AND is_active = true
  `;
  if (!target) throw new Error("Akun tidak ditemukan atau dinonaktifkan");
  await ctx.sql.begin(async (tx) => {
    await tx`UPDATE users SET password_hash = ${hash} WHERE id = ${target.id}`;
    await tx`UPDATE account_tokens SET used_at = now() WHERE id = ${row.id}`;
    await tx`DELETE FROM sessions WHERE user_id = ${target.id}`;
  });
  const user = (await loadAuthUser(ctx.sql, target.id))!;
  const token = await createSession(ctx.sql, user.id);
  return {
    result: { token, me: toMeDto(user) },
    auth: { user, token },
    revokeUserIds: [user.id],
  };
}

export async function updateProfile(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const user = requireUser(ctx);
  const name = str(payload.name);
  if (name.length < 2) throw new Error("Nama minimal 2 karakter");
  await ctx.sql`UPDATE users SET name = ${name.slice(0, 100)} WHERE id = ${user.id}`;
  return {
    result: { name },
    userIds: [user.id],
    workspaceIds: await workspaceIdsOf(ctx, user.id),
    platform: true,
  };
}

export async function changePassword(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const user = requireUser(ctx);
  await verifyCredentials(ctx.sql, user.email, payload.current_password);
  const hash = await Bun.password.hash(assertPassword(payload.new_password));
  await ctx.sql`UPDATE users SET password_hash = ${hash} WHERE id = ${user.id}`;
  // Keep the current session, sign out every other device.
  if (ctx.sessionToken) {
    await ctx.sql`
      DELETE FROM sessions WHERE user_id = ${user.id} AND token_hash <> ${hashToken(ctx.sessionToken)}
    `;
  }
  return { result: { ok: true } };
}

export async function updatePreferences(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const user = requireUser(ctx);
  const pick = (key: string, fallback: boolean) =>
    typeof payload[key] === "boolean" ? (payload[key] as boolean) : fallback;
  const chat = pick("notify_chat_email", user.notify_chat_email);
  const mention = pick("notify_mention_email", user.notify_mention_email);
  const activity = pick("notify_activity_email", user.notify_activity_email);
  await ctx.sql`
    UPDATE users
    SET notify_chat_email = ${chat}, notify_mention_email = ${mention}, notify_activity_email = ${activity}
    WHERE id = ${user.id}
  `;
  return {
    result: { notify_chat_email: chat, notify_mention_email: mention, notify_activity_email: activity },
    userIds: [user.id],
  };
}
