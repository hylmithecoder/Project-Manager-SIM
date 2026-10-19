import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { CertificateFormat } from "google-auth-library/build/src/auth/oauth2client";
import { googleClientId, googleIdentityFromClaims, verifyGoogleToken } from "../auth/google";
import { hashToken } from "../auth/auth";
import type { BunServer, BunSqlClient } from "../bun-env";
import { createSqlClient, ensureDatabaseExists } from "../database/postgre";
import { migrateSchema } from "../database/scheme";
import { SEED_IDS, seedDatabase } from "../database/seeder";
import { startServer, type WsClientData } from "../index";
import { setMailTransport } from "../services/mailer";
import { googleLoginOtpEmail } from "../services/email-templates";
import type { SendEmailOptions } from "../services/smtp";
import type { AuthResultDto, GoogleLoginChallengeDto, WsAction, WsResponseMessage, WorkspaceSnapshot } from "../ws/protocol";
import { mountGoogleSignIn, type GoogleIdentityServices } from "../../lib/google-sign-in";

const CLIENT_ID = "123456789-google-test.apps.googleusercontent.com";
const originalClientId = process.env.GOOGLE_CLIENT_ID;

describe("Google ID token verification", () => {
  test("Google button forwards only live credentials and cleans up on unmount", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    let callback: ((response: { credential?: string }) => void) | undefined;
    const received: string[] = [];
    let cleared = false;
    const element = { replaceChildren: () => { cleared = true; } } as unknown as HTMLElement;
    const google: GoogleIdentityServices = { accounts: { id: {
      initialize: (options) => { expect(options.client_id).toBe(CLIENT_ID); callback = options.callback; },
      renderButton: (container, options) => { expect(container).toBe(element); expect(options.text).toBe("signin_with"); },
    } } };
    try {
      Object.defineProperty(globalThis, "window", { value: { google }, configurable: true });
      const unmount = mountGoogleSignIn(element, CLIENT_ID, (value) => received.push(value));
      callback?.({}); callback?.({ credential: "signed-token" });
      expect(received).toEqual(["signed-token"]);
      unmount(); callback?.({ credential: "late-token" });
      expect(received).toEqual(["signed-token"]);
      expect(cleared).toBe(true);
      Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
      expect(() => mountGoogleSignIn(element, CLIENT_ID, () => undefined)).toThrow("belum dimuat");
    } finally {
      if (original) Object.defineProperty(globalThis, "window", original);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  test("config and verified claims reject incomplete identities", () => {
    process.env.GOOGLE_CLIENT_ID = "invalid";
    expect(googleClientId()).toBeNull();
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    expect(googleClientId()).toBe(CLIENT_ID);
    const payload = { sub: "google-user", email: " User@Gmail.com ", email_verified: true } as TokenPayload;
    expect(googleIdentityFromClaims(payload)).toEqual({ sub: "google-user", email: "user@gmail.com" });
    expect(() => googleIdentityFromClaims(undefined)).toThrow();
    expect(() => googleIdentityFromClaims({ ...payload, email_verified: false })).toThrow();
    expect(() => googleIdentityFromClaims({ ...payload, email: "invalid" })).toThrow();
    expect(() => googleIdentityFromClaims({ ...payload, sub: "" })).toThrow();
  });

  test("Google library verifies signatures, issuer, audience, expiry and verified email", async () => {
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const client = new OAuth2Client();
    client.getFederatedSignonCertsAsync = async () => ({
      certs: { test: keys.publicKey.export({ type: "spki", format: "pem" }).toString() }, format: CertificateFormat.PEM,
    });
    const now = Math.floor(Date.now() / 1000);
    const base = { sub: "google-user", email: "user@gmail.com", email_verified: true, aud: CLIENT_ID, iss: "https://accounts.google.com", iat: now, exp: now + 3600 };
    const jwt = (claims: object) => {
      const input = `${Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
      return `${input}.${sign("RSA-SHA256", Buffer.from(input), keys.privateKey).toString("base64url")}`;
    };
    expect(await verifyGoogleToken(jwt(base), CLIENT_ID, client)).toEqual({ sub: "google-user", email: "user@gmail.com" });
    for (const claims of [{ ...base, aud: "wrong-client" }, { ...base, iss: "https://evil.test" }, { ...base, exp: now - 600 }, { ...base, email_verified: false }]) {
      await expect(verifyGoogleToken(jwt(claims), CLIENT_ID, client)).rejects.toThrow("Verifikasi Google gagal");
    }
    const tampered = jwt(base).split(".");
    tampered[1] = Buffer.from(JSON.stringify({ ...base, email: "victim@gmail.com" })).toString("base64url");
    await expect(verifyGoogleToken(tampered.join("."), CLIENT_ID, client)).rejects.toThrow("Verifikasi Google gagal");
    await expect(verifyGoogleToken("", CLIENT_ID, client)).rejects.toThrow("tidak valid");
  });

  test("OTP template escapes names and includes only the single-use code", () => {
    const mail = googleLoginOtpEmail("<script>name</script>", "012345");
    expect(mail.html).toContain("012345");
    expect(mail.html).toContain("5 menit");
    expect(mail.html).not.toContain("<script>name");
  });
});

interface ApiResponse<T> { ok: boolean; data: T; error?: string; status: number }

describe("Google + email OTP API", () => {
  let sql: BunSqlClient;
  let server: BunServer<WsClientData>;
  let base = "";
  const outbox: SendEmailOptions[] = [];
  const captureMail = async (mail: SendEmailOptions) => { outbox.push(mail); return { ok: true }; };
  const post = async <T = Record<string, unknown>>(action: WsAction, payload: Record<string, unknown> = {}): Promise<ApiResponse<T>> => {
    const response = await fetch(`${base}/api/v1/${action.replace(":", "/")}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    return { ...(await response.json()) as Omit<ApiResponse<T>, "status">, status: response.status };
  };
  const issue = async (credential = "raka") => {
    const response = await post<GoogleLoginChallengeDto>("auth:google_start", { credential });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error);
    const mail = outbox.pop();
    const code = mail?.html.match(/white-space:pre-wrap">(\d{6})<\/div>/)?.[1];
    if (!code) throw new Error("Missing OTP in captured test email");
    return { ...response.data, code };
  };
  const clear = async () => {
    await sql`DELETE FROM google_login_challenges WHERE user_id IN (${SEED_IDS.users.raka}, ${SEED_IDS.users.nadia})`;
    outbox.length = 0;
  };

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    await ensureDatabaseExists("projectmanager_google_test");
    sql = createSqlClient("projectmanager_google_test");
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    await migrateSchema(sql);
    await seedDatabase(sql);
    setMailTransport(captureMail);
    server = await startServer({
      hostname: "127.0.0.1", port: 0, sql, autoMigrateAndSeed: false, dueSoonIntervalMs: 0,
      googleTokenVerifier: async (credential, audience) => {
        if (audience !== CLIENT_ID || !["raka", "nadia", "unknown", "different-sub", "different-email"].includes(credential)) throw new Error("Verifikasi Google gagal");
        return {
          sub: credential === "different-sub" ? "other-sub" : credential === "different-email" ? "google-raka" : `google-${credential}`,
          email: credential === "different-sub" ? "raka@gmail.com" : credential === "different-email" ? "nadia@gmail.com" : `${credential}@gmail.com`,
        };
      },
    });
    base = `http://127.0.0.1:${server.port}`;
  });
  afterAll(async () => {
    server?.stop(true);
    await sql?.close();
    setMailTransport(null);
    if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = originalClientId;
  });

  test("config is public and missing configuration fails closed", async () => {
    expect((await post("auth:google_config")).data).toEqual({ enabled: true, client_id: CLIENT_ID });
    delete process.env.GOOGLE_CLIENT_ID;
    try {
      expect((await post("auth:google_config")).data).toEqual({ enabled: false, client_id: null });
      expect((await post("auth:google_start", { credential: "raka" })).ok).toBe(false);
      expect((await post("auth:google_verify", { challenge: "x", code: "123456" })).ok).toBe(false);
    } finally { process.env.GOOGLE_CLIENT_ID = CLIENT_ID; }
  });

  test("invalid, unregistered and inactive Google accounts cannot obtain an OTP/session", async () => {
    await clear();
    expect((await post("auth:google_start", { credential: "forged" })).ok).toBe(false);
    expect((await post("auth:google_start", { credential: "unknown" })).ok).toBe(false);
    await sql`UPDATE users SET is_active = false WHERE id = ${SEED_IDS.users.nadia}`;
    try { expect((await post("auth:google_start", { credential: "nadia" })).ok).toBe(false); }
    finally { await sql`UPDATE users SET is_active = true WHERE id = ${SEED_IDS.users.nadia}`; }
    expect(outbox).toHaveLength(0);
    const [count] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM google_login_challenges`;
    expect(count.n).toBe(0);
  });

  test("Google proof alone creates no session; correct OTP links the subject and logs in once", async () => {
    await clear();
    const pending = await issue();
    const [count] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM sessions`;
    expect(count.n).toBe(0);
    expect((pending as unknown as { token?: string }).token).toBeUndefined();
    const [stored] = await sql<{ otp_hash: string; challenge_hash: string }>`SELECT otp_hash, challenge_hash FROM google_login_challenges`;
    expect(stored.challenge_hash).toBe(hashToken(pending.challenge));
    expect(stored.otp_hash).not.toBe(pending.code);
    const wrong = pending.code === "000000" ? "111111" : "000000";
    expect((await post("auth:google_verify", { challenge: pending.challenge, code: wrong })).ok).toBe(false);
    const [attempt] = await sql<{ attempts: number }>`SELECT attempts FROM google_login_challenges`;
    expect(attempt.attempts).toBe(1);
    const completed = await post<AuthResultDto>("auth:google_verify", { challenge: pending.challenge, code: pending.code });
    expect(completed.ok).toBe(true);
    expect(completed.data.me.id).toBe(SEED_IDS.users.raka);
    const snapshot = await fetch(`${base}/api/snapshot`, { headers: { Authorization: `Bearer ${completed.data.token}` } });
    expect(snapshot.status).toBe(200);
    expect((await post("auth:google_verify", { challenge: pending.challenge, code: pending.code })).ok).toBe(false);
    const [link] = await sql<{ user_id: string }>`SELECT user_id FROM google_identities WHERE google_sub = 'google-raka'`;
    expect(link.user_id).toBe(SEED_IDS.users.raka);
    await migrateSchema(sql);
    expect((await sql`SELECT 1 FROM google_identities WHERE google_sub = 'google-raka'`)).toHaveLength(1);
  });

  test("five wrong attempts lock the challenge even when the correct code is supplied later", async () => {
    await clear();
    const pending = await issue();
    const wrong = pending.code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await post("auth:google_verify", { challenge: pending.challenge, code: wrong })).ok).toBe(false);
    expect((await post("auth:google_verify", { challenge: pending.challenge, code: pending.code })).ok).toBe(false);
    const [row] = await sql<{ attempts: number }>`SELECT attempts FROM google_login_challenges`;
    expect(row.attempts).toBe(5);
  });

  test("expired codes, changed accounts and mismatched challenges fail verification", async () => {
    await clear();
    const first = await issue();
    const second = await issue("nadia");
    expect((await post("auth:google_verify", { challenge: second.challenge, code: first.code === second.code ? "abcdef" : first.code })).ok).toBe(false);
    await sql`UPDATE google_login_challenges SET expires_at = now() - interval '1 minute' WHERE user_id = ${SEED_IDS.users.raka}`;
    expect((await post("auth:google_verify", { challenge: first.challenge, code: first.code })).ok).toBe(false);
    await sql`UPDATE users SET is_active = false WHERE id = ${SEED_IDS.users.nadia}`;
    try { expect((await post("auth:google_verify", { challenge: second.challenge, code: second.code })).ok).toBe(false); }
    finally { await sql`UPDATE users SET is_active = true WHERE id = ${SEED_IDS.users.nadia}`; }
  });

  test("resending enforces cooldown, invalidates the previous code and limits email bursts", async () => {
    await clear();
    const first = await issue();
    expect((await post("auth:google_start", { credential: "raka" })).error).toContain("60 detik");
    await sql`UPDATE google_login_challenges SET created_at = now() - interval '61 seconds' WHERE user_id = ${SEED_IDS.users.raka}`;
    const replacement = await issue();
    expect((await post("auth:google_verify", { challenge: first.challenge, code: first.code })).ok).toBe(false);
    expect((await post("auth:google_verify", { challenge: replacement.challenge, code: replacement.code })).ok).toBe(true);
    for (let i = 0; i < 3; i++) {
      await sql`UPDATE google_login_challenges SET created_at = now() - interval '61 seconds' WHERE user_id = ${SEED_IDS.users.raka}`;
      await issue();
    }
    await sql`UPDATE google_login_challenges SET created_at = now() - interval '61 seconds' WHERE user_id = ${SEED_IDS.users.raka}`;
    expect((await post("auth:google_start", { credential: "raka" })).error).toContain("15 menit");
  });

  test("SMTP failure does not return a usable challenge or create a session", async () => {
    await clear();
    setMailTransport(async () => ({ ok: false, error: "SMTP unavailable" }));
    try {
      const response = await post("auth:google_start", { credential: "raka" });
      expect(response.ok).toBe(false);
      expect(response.error).toContain("gagal dikirim");
      const [row] = await sql<{ invalidated: boolean; delivered_at: string | null }>`SELECT consumed_at IS NOT NULL AS invalidated, delivered_at FROM google_login_challenges`;
      expect(row.invalidated).toBe(true);
      expect(row.delivered_at).toBeNull();
    } finally { setMailTransport(captureMail); }
  });

  test("Google subjects cannot be silently linked to a different existing account", async () => {
    await clear();
    expect((await post("auth:google_start", { credential: "different-sub" })).ok).toBe(false);
    expect((await post("auth:google_start", { credential: "different-email" })).ok).toBe(false);
    expect(outbox).toHaveLength(0);
  });

  test("parallel verification creates exactly one session", async () => {
    await clear();
    const pending = await issue();
    const [before] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM sessions`;
    const results = await Promise.all([1, 2].map(() => post("auth:google_verify", { challenge: pending.challenge, code: pending.code })));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const [after] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM sessions`;
    expect(after.n).toBe(before.n + 1);
  });

  test("WebSocket stays anonymous until OTP and then receives its authenticated snapshot", async () => {
    await clear();
    const socket = new WebSocket(base.replace(/^http/, "ws") + "/ws");
    await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error("ws error")); });
    let seq = 0;
    let snapshot: WorkspaceSnapshot | null = null;
    socket.addEventListener("message", (event) => { const message = JSON.parse(String(event.data)); if (message.snapshot) snapshot = message.snapshot; });
    const call = <T,>(action: WsAction, payload: Record<string, unknown> = {}) => new Promise<WsResponseMessage<T>>((resolve, reject) => {
      const id = String(++seq);
      const timer = setTimeout(() => reject(new Error(`Timeout ${action}`)), 5000);
      const receive = (event: MessageEvent) => {
        const response = JSON.parse(String(event.data));
        if (response.type !== "response" || response.id !== id) return;
        clearTimeout(timer); socket.removeEventListener("message", receive); resolve(response);
      };
      socket.addEventListener("message", receive); socket.send(JSON.stringify({ id, action, payload }));
    });
    try {
      const started = await call<GoogleLoginChallengeDto>("auth:google_start", { credential: "raka" });
      expect(started.ok).toBe(true);
      expect((await call("state:init")).ok).toBe(false);
      expect(snapshot).toBeNull();
      const code = outbox.pop()?.html.match(/white-space:pre-wrap">(\d{6})<\/div>/)?.[1];
      expect((await call("auth:google_verify", { challenge: started.data!.challenge, code })).ok).toBe(true);
      const deadline = Date.now() + 3000;
      while (!snapshot && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
      expect((snapshot as WorkspaceSnapshot | null)?.me.id).toBe(SEED_IDS.users.raka);
    } finally {
      socket.close();
      // Allow the server's asynchronous last-seen/presence cleanup before closing SQL.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });
});
