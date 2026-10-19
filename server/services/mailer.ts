import { getSmtpConfig, sendEmail, type SendEmailOptions } from "./smtp";

/**
 * Fire-and-forget email queue. WebSocket handlers enqueue mail after their
 * database transaction commits so slow SMTP never blocks a realtime response.
 * The transport is swappable so tests can capture outgoing mail instead of
 * hitting Gmail.
 */

export type MailTransport = (
  mail: SendEmailOptions,
) => Promise<{ ok: boolean; error?: string }>;

const smtpTransport: MailTransport = async (mail) => {
  if (!getSmtpConfig().enabled) {
    console.log(`[mailer] SMTP disabled, skipped "${mail.subject}" -> ${mail.to}`);
    return { ok: false, error: "SMTP disabled" };
  }
  return sendEmail(mail);
};

let transport: MailTransport = smtpTransport;
const queue: SendEmailOptions[] = [];
let draining: Promise<void> | null = null;

export function setMailTransport(next: MailTransport | null): void {
  transport = next ?? smtpTransport;
}

/** Login codes require a delivery result, rather than the activity email queue. */
export async function sendEmailNow(mail: SendEmailOptions): Promise<void> {
  try {
    const result = await transport(mail);
    if (result.ok) return;
  } catch { /* Do not expose SMTP credentials or message contents. */ }
  throw new Error("Email OTP gagal dikirim. Coba lagi nanti atau hubungi admin.");
}

export function enqueueEmail(mail: SendEmailOptions): void {
  if (!mail.to || !mail.to.includes("@")) return;
  queue.push(mail);
  if (!draining) {
    draining = drain().finally(() => {
      draining = null;
    });
  }
}

async function drain(): Promise<void> {
  while (queue.length > 0) {
    const mail = queue.shift()!;
    try {
      const res = await transport(mail);
      if (!res.ok && res.error !== "SMTP disabled") {
        console.error(`[mailer] Failed "${mail.subject}" -> ${mail.to}: ${res.error}`);
      }
    } catch (err) {
      console.error(`[mailer] Error "${mail.subject}" -> ${mail.to}:`, err);
    }
  }
}

/** Resolves once every queued email has been handed to the transport. */
export async function flushEmailQueue(): Promise<void> {
  while (draining) {
    await draining;
  }
}
