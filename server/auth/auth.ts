import { createHash, randomBytes } from "node:crypto";
import type { BunSqlClient } from "../bun-env";
import type { MeDto, PlatformRole, WorkspaceRole } from "../ws/protocol";

export const SESSION_TTL_DAYS = 30;
export const INVITE_TTL_DAYS = 7;
export const RESET_TTL_HOURS = 2;
export const MIN_PASSWORD_LENGTH = 8;

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only hashes are stored; the raw token lives in the email / browser. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function assertPassword(password: unknown): string {
  const value = String(password ?? "");
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password minimal ${MIN_PASSWORD_LENGTH} karakter`);
  }
  return value;
}

export interface AuthUserRow {
  id: string;
  name: string;
  email: string;
  platform_role: PlatformRole;
  avatar_url: string | null;
  is_active: boolean;
  notify_chat_email: boolean;
  notify_mention_email: boolean;
  notify_activity_email: boolean;
}

export function toMeDto(u: AuthUserRow): MeDto {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    platform_role: u.platform_role === "developer" ? "developer" : "user",
    avatar_url: u.avatar_url,
    notify_chat_email: u.notify_chat_email,
    notify_mention_email: u.notify_mention_email,
    notify_activity_email: u.notify_activity_email,
  };
}

export async function loadAuthUser(
  sql: BunSqlClient,
  userId: string,
): Promise<AuthUserRow | null> {
  const [row] = await sql<AuthUserRow>`
    SELECT id, name, email, platform_role, avatar_url, is_active,
           notify_chat_email, notify_mention_email, notify_activity_email
    FROM users WHERE id = ${userId}
  `;
  return row || null;
}

export async function verifyCredentials(
  sql: BunSqlClient,
  emailRaw: unknown,
  password: unknown,
): Promise<AuthUserRow> {
  const email = normalizeEmail(emailRaw);
  const [row] = await sql<AuthUserRow & { password_hash: string }>`
    SELECT id, name, email, platform_role, avatar_url, is_active, password_hash,
           notify_chat_email, notify_mention_email, notify_activity_email
    FROM users WHERE LOWER(email) = ${email}
  `;
  const ok =
    row && (await Bun.password.verify(String(password ?? ""), row.password_hash));
  if (!row || !ok) throw new Error("Email atau password salah");
  if (!row.is_active) {
    throw new Error("Akun Anda dinonaktifkan. Hubungi tim developer.");
  }
  const user: AuthUserRow & { password_hash?: string } = { ...row };
  delete user.password_hash;
  return user;
}

export async function createSession(
  sql: BunSqlClient,
  userId: string,
): Promise<string> {
  const token = generateToken();
  await sql`
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (${userId}, ${hashToken(token)}, now() + ${`${SESSION_TTL_DAYS} days`}::interval)
  `;
  return token;
}

export async function resolveSession(
  sql: BunSqlClient,
  token: unknown,
): Promise<AuthUserRow | null> {
  if (typeof token !== "string" || !token) return null;
  const [row] = await sql<{ user_id: string }>`
    SELECT s.user_id
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token)}
      AND s.expires_at > now()
      AND u.is_active = true
  `;
  if (!row) return null;
  return loadAuthUser(sql, row.user_id);
}

export async function revokeSession(
  sql: BunSqlClient,
  token: unknown,
): Promise<void> {
  if (typeof token !== "string" || !token) return;
  await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`;
}

export interface AccountTokenRow {
  id: string;
  purpose: "invite" | "reset";
  email: string;
  user_id: string | null;
  workspace_id: string | null;
  role: WorkspaceRole | null;
  created_by: string | null;
  expires_at: string;
}

export async function createAccountToken(
  sql: BunSqlClient,
  params: {
    purpose: "invite" | "reset";
    email: string;
    userId?: string | null;
    workspaceId?: string | null;
    role?: WorkspaceRole | null;
    createdBy?: string | null;
  },
): Promise<{ token: string; id: string; expiresAt: string }> {
  const token = generateToken();
  const ttl =
    params.purpose === "invite"
      ? `${INVITE_TTL_DAYS} days`
      : `${RESET_TTL_HOURS} hours`;

  // A new token supersedes older unused ones for the same target.
  if (params.purpose === "invite") {
    await sql`
      UPDATE account_tokens SET revoked_at = now()
      WHERE purpose = 'invite' AND LOWER(email) = ${params.email}
        AND workspace_id IS NOT DISTINCT FROM ${params.workspaceId ?? null}
        AND used_at IS NULL AND revoked_at IS NULL
    `;
  } else {
    await sql`
      UPDATE account_tokens SET revoked_at = now()
      WHERE purpose = 'reset' AND LOWER(email) = ${params.email}
        AND used_at IS NULL AND revoked_at IS NULL
    `;
  }

  const [row] = await sql<{ id: string; expires_at: string }>`
    INSERT INTO account_tokens (token_hash, purpose, email, user_id, workspace_id, role, created_by, expires_at)
    VALUES (
      ${hashToken(token)},
      ${params.purpose},
      ${params.email},
      ${params.userId ?? null},
      ${params.workspaceId ?? null},
      ${params.role ?? null},
      ${params.createdBy ?? null},
      now() + ${ttl}::interval
    )
    RETURNING id, expires_at::text AS expires_at
  `;
  return { token, id: row.id, expiresAt: row.expires_at };
}

export async function findValidAccountToken(
  sql: BunSqlClient,
  rawToken: unknown,
  purpose?: "invite" | "reset",
): Promise<AccountTokenRow> {
  if (typeof rawToken !== "string" || !rawToken) {
    throw new Error("Tautan tidak valid");
  }
  const [row] = await sql<AccountTokenRow & {
    used_at: string | null;
    revoked_at: string | null;
    expired: boolean;
  }>`
    SELECT id, purpose, email, user_id, workspace_id, role, created_by,
           expires_at::text AS expires_at, used_at::text AS used_at,
           revoked_at::text AS revoked_at, (expires_at <= now()) AS expired
    FROM account_tokens
    WHERE token_hash = ${hashToken(rawToken)}
  `;
  if (!row || (purpose && row.purpose !== purpose)) {
    throw new Error("Tautan tidak valid");
  }
  if (row.used_at) throw new Error("Tautan ini sudah pernah digunakan");
  if (row.revoked_at) throw new Error("Tautan ini sudah dibatalkan");
  if (row.expired) throw new Error("Tautan ini sudah kedaluwarsa");
  return row;
}

/**
 * Guarantees one platform developer account exists. The developer manages
 * accounts and company workspaces but is never a workspace member, so it can
 * not read boards, cards or chat.
 */
export async function ensureDeveloperAccount(
  sql: BunSqlClient,
): Promise<{ created: boolean; email: string }> {
  const email = normalizeEmail(
    process.env.DEV_ACCOUNT_EMAIL || "developer@gmail.com",
  );
  const existing = await sql<{ id: string }>`
    SELECT id FROM users WHERE platform_role = 'developer' LIMIT 1
  `;
  if (existing.length > 0) return { created: false, email };

  const password = process.env.DEV_ACCOUNT_PASSWORD || "developer123";
  const hash = await Bun.password.hash(password);
  const inserted = await sql<{ id: string }>`
    INSERT INTO users (name, email, password_hash, platform_role)
    VALUES ('Tim Developer', ${email}, ${hash}, 'developer')
    ON CONFLICT (email) DO NOTHING
    RETURNING id
  `;
  if (inserted.length === 0) {
    // Never silently promote an existing (possibly workspace) account.
    console.warn(
      `[auth] DEV_ACCOUNT_EMAIL ${email} already belongs to a regular user; developer account not created.`,
    );
    return { created: false, email };
  }
  return { created: true, email };
}
