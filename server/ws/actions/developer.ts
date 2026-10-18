import { isValidEmail, normalizeEmail } from "../../auth/auth";
import { escapeHtml, renderLayout } from "../../services/email-templates";
import { enqueueEmail } from "../../services/mailer";
import { sendEmail, verifySmtpConnection } from "../../services/smtp";
import type { ActionContext, ActionResult } from "../context";
import { requireDeveloper, str } from "../context";
import { requestPasswordReset } from "./auth";
import { createGeneralRoom, slugify } from "./membership";
import { sendInvitation } from "./workspace";

/**
 * Platform developer console. The developer provisions company workspaces and
 * manages accounts, but is never added as a workspace member: workspace
 * content stays private to the company.
 */
export async function createCompanyWorkspace(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const dev = requireDeveloper(ctx);
  const name = str(payload.name);
  const adminEmail = normalizeEmail(payload.admin_email);
  if (name.length < 2) throw new Error("Nama perusahaan/workspace minimal 2 karakter");
  if (!isValidEmail(adminEmail)) throw new Error("Email pemimpin perusahaan tidak valid");

  const workspaceId = await ctx.sql.begin(async (tx) => {
    const [ws] = await tx<{ id: string }>`
      INSERT INTO workspaces (name, slug, owner_id)
      VALUES (${name.slice(0, 100)}, ${slugify(name)}, NULL)
      RETURNING id
    `;
    await createGeneralRoom(tx, ws.id, dev.id);
    return ws.id;
  });

  const sent = await sendInvitation(ctx.sql, ctx.origin, {
    workspaceId,
    email: adminEmail,
    role: "owner",
    inviter: dev,
  });
  return { result: { workspace_id: workspaceId, ...sent }, platform: true };
}

export async function inviteWorkspaceAdmin(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const dev = requireDeveloper(ctx);
  const workspaceId = str(payload.workspace_id);
  const [ws] = await ctx.sql<{ owner_id: string | null }>`
    SELECT owner_id FROM workspaces WHERE id = ${workspaceId}
  `;
  if (!ws) throw new Error("Workspace tidak ditemukan");
  const role = ws.owner_id ? "admin" : "owner";
  const sent = await sendInvitation(ctx.sql, ctx.origin, {
    workspaceId,
    email: normalizeEmail(payload.email),
    role,
    inviter: dev,
  });
  return { result: { ...sent, role }, platform: true, workspaceIds: [workspaceId] };
}

export async function setUserActive(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  requireDeveloper(ctx);
  const userId = str(payload.user_id);
  const active = Boolean(payload.active);
  const [target] = await ctx.sql<{ platform_role: string }>`
    SELECT platform_role FROM users WHERE id = ${userId}
  `;
  if (!target) throw new Error("Akun tidak ditemukan");
  if (target.platform_role === "developer") {
    throw new Error("Akun developer tidak dapat dinonaktifkan dari konsol");
  }
  await ctx.sql`UPDATE users SET is_active = ${active} WHERE id = ${userId}`;
  if (!active) await ctx.sql`DELETE FROM sessions WHERE user_id = ${userId}`;
  return {
    result: { user_id: userId, active },
    platform: true,
    revokeUserIds: active ? [] : [userId],
  };
}

async function loadManagedUser(ctx: ActionContext, userId: string) {
  const [target] = await ctx.sql<{ id: string; name: string; email: string; platform_role: string }>`
    SELECT id, name, email, platform_role FROM users WHERE id = ${userId}
  `;
  if (!target) throw new Error("Akun tidak ditemukan");
  if (target.platform_role === "developer") {
    throw new Error("Akun developer tidak dapat diubah dari konsol; gunakan menu Akun Saya");
  }
  return target;
}

async function workspacesOf(ctx: ActionContext, userId: string): Promise<string[]> {
  const rows = await ctx.sql<{ workspace_id: string }>`
    SELECT workspace_id FROM workspace_members WHERE user_id = ${userId}
  `;
  return rows.map((r) => r.workspace_id);
}

/** Edits an account's name and/or login email. The old address is notified. */
export async function updateUser(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  requireDeveloper(ctx);
  const target = await loadManagedUser(ctx, str(payload.user_id));
  const name = str(payload.name) || target.name;
  if (name.length < 2) throw new Error("Nama minimal 2 karakter");
  const email = payload.email === undefined ? target.email : normalizeEmail(payload.email);
  if (!isValidEmail(email)) throw new Error("Alamat email tidak valid");
  if (email !== target.email.toLowerCase()) {
    const taken = await ctx.sql`SELECT 1 FROM users WHERE LOWER(email) = ${email} AND id <> ${target.id}`;
    if (taken.length > 0) throw new Error("Email sudah dipakai akun lain");
  }
  await ctx.sql`UPDATE users SET name = ${name.slice(0, 100)}, email = ${email} WHERE id = ${target.id}`;

  if (email !== target.email.toLowerCase()) {
    const html = renderLayout({
      badge: "Keamanan Akun",
      tone: "warning",
      headline: "Email login akun Anda diubah",
      bodyHtml: `<p>Tim developer mengubah email login akun <strong>${escapeHtml(name)}</strong> dari <strong>${escapeHtml(target.email)}</strong> menjadi <strong>${escapeHtml(email)}</strong>.</p><p>Gunakan email baru untuk masuk. Jika ini tidak Anda minta, hubungi admin perusahaan Anda.</p>`,
    });
    enqueueEmail({ to: target.email, subject: "Email login akun Anda diubah", html });
    enqueueEmail({ to: email, subject: "Email login akun Anda diubah", html });
  }
  return {
    result: { user_id: target.id, name, email },
    platform: true,
    userIds: [target.id],
    workspaceIds: await workspacesOf(ctx, target.id),
  };
}

/**
 * Permanently deletes an account. Content the user created (boards, cards,
 * rooms, attachments) is handed to another workspace member so company data
 * survives; owned workspaces stay but wait for a new leader invitation.
 * Their chat messages remain with the sender shown as deleted.
 */
export async function deleteUser(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const dev = requireDeveloper(ctx);
  const target = await loadManagedUser(ctx, str(payload.user_id));
  if (normalizeEmail(payload.confirm_email) !== target.email.toLowerCase()) {
    throw new Error("Ketik email akun dengan benar untuk konfirmasi penghapusan");
  }
  const uid = target.id;
  const workspaceIds = await workspacesOf(ctx, uid);

  await ctx.sql.begin(async (tx) => {
    const touched = await tx<{ workspace_id: string }>`
      SELECT workspace_id FROM boards WHERE created_by = ${uid}
      UNION SELECT workspace_id FROM rooms WHERE created_by = ${uid}
      UNION SELECT b.workspace_id FROM cards c JOIN boards b ON b.id = c.board_id WHERE c.created_by = ${uid}
      UNION SELECT b.workspace_id FROM attachments a JOIN cards c ON c.id = a.card_id JOIN boards b ON b.id = c.board_id WHERE a.uploader_id = ${uid}
      UNION SELECT r.workspace_id FROM attachments a JOIN messages m ON m.id = a.message_id JOIN rooms r ON r.id = m.room_id WHERE a.uploader_id = ${uid}
      UNION SELECT workspace_id FROM workspace_members WHERE user_id = ${uid}
    `;
    for (const { workspace_id: wsId } of touched) {
      const [heir] = await tx<{ user_id: string }>`
        SELECT wm.user_id FROM workspace_members wm
        WHERE wm.workspace_id = ${wsId} AND wm.user_id <> ${uid}
        ORDER BY CASE wm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'member' THEN 3 ELSE 4 END, wm.joined_at
        LIMIT 1
      `;
      const rep = heir?.user_id ?? dev.id;
      await tx`UPDATE boards SET created_by = ${rep} WHERE workspace_id = ${wsId} AND created_by = ${uid}`;
      await tx`UPDATE rooms SET created_by = ${rep} WHERE workspace_id = ${wsId} AND created_by = ${uid}`;
      await tx`
        UPDATE cards SET created_by = ${rep}
        WHERE created_by = ${uid} AND board_id IN (SELECT id FROM boards WHERE workspace_id = ${wsId})
      `;
      await tx`
        UPDATE attachments SET uploader_id = ${rep}
        WHERE uploader_id = ${uid} AND (
          card_id IN (SELECT c.id FROM cards c JOIN boards b ON b.id = c.board_id WHERE b.workspace_id = ${wsId})
          OR message_id IN (SELECT m.id FROM messages m JOIN rooms r ON r.id = m.room_id WHERE r.workspace_id = ${wsId})
        )
      `;
      // Keep the board room admin-able when the deleted user was its only admin.
      await tx`
        UPDATE room_members SET role = 'admin'
        WHERE user_id = ${heir?.user_id ?? null}
          AND room_id IN (SELECT room_id FROM room_members WHERE user_id = ${uid} AND role = 'admin')
      `;
    }
    await tx`UPDATE workspaces SET owner_id = NULL WHERE owner_id = ${uid}`;
    await tx`UPDATE account_tokens SET revoked_at = now() WHERE LOWER(email) = ${target.email.toLowerCase()} AND used_at IS NULL`;
    await tx`DELETE FROM users WHERE id = ${uid}`;
  });

  return {
    result: { user_id: uid, deleted: true },
    platform: true,
    workspaceIds,
    revokeUserIds: [uid],
  };
}

export async function sendPasswordResetFor(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const dev = requireDeveloper(ctx);
  const [target] = await ctx.sql<{ email: string }>`SELECT email FROM users WHERE id = ${str(payload.user_id)}`;
  if (!target) throw new Error("Akun tidak ditemukan");
  return requestPasswordReset(ctx, { email: target.email }, dev);
}

export async function smtpStatus(ctx: ActionContext): Promise<ActionResult> {
  requireDeveloper(ctx);
  return { result: await verifySmtpConnection() };
}

export async function smtpTestSend(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  requireDeveloper(ctx);
  const to = normalizeEmail(payload.to);
  if (!isValidEmail(to)) throw new Error("Alamat email tujuan tidak valid");
  const res = await sendEmail({
    to,
    subject: "Tes pengiriman email — Project Manager",
    html: renderLayout({
      badge: "Tes SMTP",
      tone: "success",
      headline: "Pengiriman email berhasil",
      bodyHtml: `<p>Integrasi SMTP berfungsi. Waktu kirim: <strong>${new Date().toLocaleString("id-ID")}</strong></p>`,
    }),
  });
  return { result: res };
}
