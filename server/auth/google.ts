import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { isValidEmail, normalizeEmail } from "./auth";

export interface GoogleIdentity { sub: string; email: string }
export type GoogleTokenVerifier = (credential: string, clientId: string) => Promise<GoogleIdentity>;
const google = new OAuth2Client({ transporterOptions: { timeout: 10000 } });

export function googleClientId(): string | null {
  const value = process.env.GOOGLE_CLIENT_ID?.trim();
  return value && /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value) ? value : null;
}

/** The signed, verified Google subject is the stable identity; email is not a subject. */
export function googleIdentityFromClaims(payload: TokenPayload | undefined): GoogleIdentity {
  const email = normalizeEmail(payload?.email);
  if (!payload?.sub || payload.sub.length > 255 || payload.email_verified !== true || !isValidEmail(email)) {
    throw new Error("Akun Google belum memiliki email terverifikasi.");
  }
  return { sub: payload.sub, email };
}

export async function verifyGoogleToken(
  credential: string, clientId: string, client: Pick<OAuth2Client, "verifyIdToken"> = google,
): Promise<GoogleIdentity> {
  if (!credential || credential.length > 16384) throw new Error("Kredensial Google tidak valid. Pilih akun Google lagi.");
  try {
    // Google's library validates signature, audience, issuer and expiry and caches public keys.
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    return googleIdentityFromClaims(ticket.getPayload());
  } catch {
    throw new Error("Verifikasi Google gagal. Pilih akun Google lagi.");
  }
}
