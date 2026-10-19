import { randomInt, timingSafeEqual } from "node:crypto";
import { createSession, generateToken, hashToken, loadAuthUser, normalizeEmail, toMeDto } from "../../auth/auth";
import { googleClientId, verifyGoogleToken } from "../../auth/google";
import { googleLoginOtpEmail } from "../../services/email-templates";
import { sendEmailNow } from "../../services/mailer";
import type { ActionContext, ActionResult } from "../context";
import { listMyWorkspaces } from "../snapshot";

export const GOOGLE_OTP_TTL_SECONDS = 300;
export const GOOGLE_OTP_RESEND_SECONDS = 60;
const INVALID_CODE = "OTP salah, kedaluwarsa, atau sudah digunakan. Minta kode baru jika diperlukan.";

export async function googleConfig(): Promise<ActionResult> {
  const clientId = googleClientId();
  return { result: { enabled: Boolean(clientId), client_id: clientId } };
}

export async function startGoogleLogin(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const clientId = googleClientId();
  if (!clientId) throw new Error("Login Google belum dikonfigurasi. Hubungi admin atau gunakan password.");
  const credential = typeof payload.credential === "string" ? payload.credential : "";
  if (!credential || credential.length > 16384) throw new Error("Kredensial Google tidak valid.");
  const identity = await (ctx.googleTokenVerifier ?? verifyGoogleToken)(credential, clientId);
  const email = normalizeEmail(identity.email);
  const challenge = generateToken();
  const challengeHash = hashToken(challenge);
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");

  const pending = await ctx.sql.begin(async (tx) => {
    // The same user lock is always acquired before challenge/identity rows.
    const users = await tx<{ id: string; name: string; email: string; is_active: boolean }>`
      SELECT id, name, email, is_active FROM users WHERE LOWER(email) = ${email} FOR UPDATE
    `;
    const user = users[0];
    if (users.length !== 1 || !user?.is_active) throw new Error("Akun belum terdaftar atau tidak aktif. Hubungi admin workspace.");
    const identities = await tx<{ google_sub: string; user_id: string }>`
      SELECT google_sub, user_id FROM google_identities WHERE google_sub = ${identity.sub} OR user_id = ${user.id}
    `;
    if (identities.some((link) => link.google_sub !== identity.sub || link.user_id !== user.id)) {
      throw new Error("Akun Google tidak cocok dengan akun yang terhubung. Hubungi admin.");
    }
    const [limit] = await tx<{ recent: number; cooling_down: boolean }>`
      SELECT COUNT(*)::int AS recent,
        COALESCE(MAX(created_at) > now() - interval '60 seconds', false) AS cooling_down
      FROM google_login_challenges WHERE user_id = ${user.id} AND created_at > now() - interval '15 minutes'
    `;
    if (limit.cooling_down) throw new Error("Tunggu 60 detik sebelum meminta OTP lagi.");
    if (limit.recent >= 5) throw new Error("Terlalu banyak permintaan OTP. Coba lagi dalam 15 menit.");
    await tx`UPDATE google_login_challenges SET consumed_at = now() WHERE user_id = ${user.id} AND consumed_at IS NULL`;
    await tx`DELETE FROM google_login_challenges WHERE user_id = ${user.id} AND created_at < now() - interval '1 day'`;
    const [row] = await tx<{ expires_at: string }>`
      INSERT INTO google_login_challenges (challenge_hash, user_id, google_sub, email, otp_hash, expires_at)
      VALUES (${challengeHash}, ${user.id}, ${identity.sub}, ${user.email}, ${hashToken(`${challenge}:${code}`)}, now() + interval '5 minutes')
      RETURNING expires_at::text AS expires_at
    `;
    return { user, expiresAt: row.expires_at };
  });

  // SMTP runs after commit, without holding database locks.
  const mail = googleLoginOtpEmail(pending.user.name, code);
  try {
    await sendEmailNow({ to: pending.user.email, ...mail });
    await ctx.sql`UPDATE google_login_challenges SET delivered_at = now() WHERE challenge_hash = ${challengeHash}`;
  } catch {
    await ctx.sql`UPDATE google_login_challenges SET consumed_at = now() WHERE challenge_hash = ${challengeHash}`;
    throw new Error("Email OTP gagal dikirim. Coba lagi nanti atau hubungi admin.");
  }
  return { result: {
    challenge, email: pending.user.email, expires_at: pending.expiresAt,
    resend_after_seconds: GOOGLE_OTP_RESEND_SECONDS,
  } };
}

export async function verifyGoogleLogin(ctx: ActionContext, payload: Record<string, unknown>): Promise<ActionResult> {
  if (!googleClientId()) throw new Error("Login Google belum dikonfigurasi.");
  const challenge = typeof payload.challenge === "string" ? payload.challenge : "";
  const code = typeof payload.code === "string" ? payload.code.trim() : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new Error(INVALID_CODE);
  const challengeHash = hashToken(challenge);
  const [lookup] = await ctx.sql<{ user_id: string }>`SELECT user_id FROM google_login_challenges WHERE challenge_hash = ${challengeHash}`;
  if (!lookup) throw new Error(INVALID_CODE);

  const outcome = await ctx.sql.begin(async (tx) => {
    await tx`SELECT id FROM users WHERE id = ${lookup.user_id} FOR UPDATE`;
    const [row] = await tx<{
      user_id: string; google_sub: string; email: string; otp_hash: string; attempts: number;
      valid: boolean;
    }>`
      SELECT user_id, google_sub, email, otp_hash, attempts,
        (expires_at > now() AND consumed_at IS NULL AND delivered_at IS NOT NULL AND attempts < 5) AS valid
      FROM google_login_challenges WHERE challenge_hash = ${challengeHash} FOR UPDATE
    `;
    if (!row?.valid) return { error: INVALID_CODE };
    const expected = Buffer.from(row.otp_hash, "hex");
    const actual = Buffer.from(hashToken(`${challenge}:${code.slice(0, 64)}`), "hex");
    if (!/^\d{6}$/.test(code) || !timingSafeEqual(expected, actual)) {
      // Return the error to commit the attempt increment; throwing would roll it back.
      await tx`UPDATE google_login_challenges SET attempts = attempts + 1 WHERE challenge_hash = ${challengeHash}`;
      return { error: INVALID_CODE };
    }
    const user = await loadAuthUser(tx, row.user_id);
    if (!user?.is_active || user.email !== row.email) return { error: "Akun berubah atau dinonaktifkan. Ulangi login atau hubungi admin." };
    await tx`
      INSERT INTO google_identities (google_sub, user_id) VALUES (${row.google_sub}, ${user.id}) ON CONFLICT DO NOTHING
    `;
    const [link] = await tx<{ user_id: string }>`SELECT user_id FROM google_identities WHERE google_sub = ${row.google_sub}`;
    if (link?.user_id !== user.id) return { error: "Akun Google tidak cocok. Hubungi admin." };
    await tx`UPDATE google_login_challenges SET consumed_at = now() WHERE challenge_hash = ${challengeHash}`;
    await tx`UPDATE users SET last_seen_at = now() WHERE id = ${user.id}`;
    const token = await createSession(tx, user.id);
    return { user, token };
  });
  if (outcome.error || !outcome.user || !outcome.token) throw new Error(outcome.error || INVALID_CODE);
  return {
    result: { token: outcome.token, me: toMeDto(outcome.user) },
    auth: { user: outcome.user, token: outcome.token },
    workspaceIds: (await listMyWorkspaces(ctx.sql, outcome.user.id)).map((w) => w.id),
  };
}
