import net from "node:net";
import tls from "node:tls";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  enabled: boolean;
}

export function getSmtpConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USERNAME || "";
  const rawPass = process.env.SMTP_PASSWORD || "";
  // Strip surrounding quotes if present in .env
  const pass = rawPass.replace(/^["']|["']$/g, "");
  const from = process.env.SMTP_FROM || user || "Auto Smart Workspace";
  const enabled = process.env.SMTP_ENABLED !== "false";

  return { host, port, user, pass, from, enabled };
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

interface SmtpSession {
  write(cmd: string): void;
  readResponse(): Promise<{ code: number; line: string }>;
  close(): void;
}

function createSmtpSession(config: SmtpConfig): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    let socket: net.Socket | tls.TLSSocket;
    let buffer = "";
    let pendingResolve:
      | ((res: { code: number; line: string }) => void)
      | null = null;
    let pendingReject: ((err: Error) => void) | null = null;

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      // Keep unfinished fragment in buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line) continue;
        const code = parseInt(line.slice(0, 3), 10);
        const isLastLine = line.charAt(3) === " " || line.length === 3;
        if (!isNaN(code) && isLastLine) {
          if (pendingResolve) {
            const cb = pendingResolve;
            pendingResolve = null;
            pendingReject = null;
            cb({ code, line });
          }
        }
      }
    };

    const onError = (err: Error) => {
      if (pendingReject) {
        const cb = pendingReject;
        pendingResolve = null;
        pendingReject = null;
        cb(err);
      }
      reject(err);
    };

    if (config.port === 465) {
      socket = tls.connect({
        host: config.host,
        port: config.port,
        rejectUnauthorized: false,
      });
    } else {
      socket = net.connect({
        host: config.host,
        port: config.port,
      });
    }

    socket.on("data", onData);
    socket.on("error", onError);

    const session: SmtpSession = {
      write(cmd: string) {
        socket.write(`${cmd}\r\n`);
      },
      readResponse() {
        return new Promise((res, rej) => {
          pendingResolve = res;
          pendingReject = rej;
        });
      },
      close() {
        try {
          socket.end();
          socket.destroy();
        } catch {
          // ignore
        }
      },
    };

    socket.once("connect", async () => {
      try {
        const banner = await session.readResponse();
        if (banner.code !== 220) {
          throw new Error(`Unexpected SMTP banner: ${banner.line}`);
        }

        // Send initial EHLO
        session.write(`EHLO localhost`);
        const ehloRes = await session.readResponse();
        if (ehloRes.code !== 250) {
          throw new Error(`EHLO failed: ${ehloRes.line}`);
        }

        // Upgrade to TLS if port 587 STARTTLS
        if (config.port === 587) {
          session.write("STARTTLS");
          const starttlsRes = await session.readResponse();
          if (starttlsRes.code !== 220) {
            throw new Error(`STARTTLS rejected: ${starttlsRes.line}`);
          }

          socket.removeAllListeners("data");
          socket.removeAllListeners("error");

          const tlsSocket = tls.connect({
            socket,
            host: config.host,
            rejectUnauthorized: false,
          });

          socket = tlsSocket;
          tlsSocket.on("data", onData);
          tlsSocket.on("error", onError);

          await new Promise<void>((tlsResolve, tlsReject) => {
            tlsSocket.once("secureConnect", () => tlsResolve());
            tlsSocket.once("error", tlsReject);
          });

          // Re-EHLO after TLS upgrade
          session.write("EHLO localhost");
          const secureEhlo = await session.readResponse();
          if (secureEhlo.code !== 250) {
            throw new Error(
              `Secure EHLO failed: ${secureEhlo.line}`,
            );
          }
        }

        // Authenticate if user and pass are configured
        if (config.user && config.pass) {
          session.write("AUTH LOGIN");
          const authPrompt = await session.readResponse();
          if (authPrompt.code !== 334) {
            throw new Error(`AUTH LOGIN rejected: ${authPrompt.line}`);
          }

          session.write(Buffer.from(config.user).toString("base64"));
          const userRes = await session.readResponse();
          if (userRes.code !== 334) {
            throw new Error(`Username rejected: ${userRes.line}`);
          }

          session.write(Buffer.from(config.pass).toString("base64"));
          const passRes = await session.readResponse();
          if (passRes.code !== 235) {
            throw new Error(`Authentication failed: ${passRes.line}`);
          }
        }

        resolve(session);
      } catch (err) {
        session.close();
        reject(err);
      }
    });
  });
}

export async function verifySmtpConnection(): Promise<{
  ok: boolean;
  message: string;
  config: { host: string; port: number; user: string; enabled: boolean };
}> {
  const config = getSmtpConfig();
  if (!config.enabled) {
    return {
      ok: false,
      message: "SMTP dinonaktifkan (SMTP_ENABLED=false)",
      config: {
        host: config.host,
        port: config.port,
        user: config.user,
        enabled: false,
      },
    };
  }

  let session: SmtpSession | null = null;
  try {
    session = await createSmtpSession(config);
    session.write("QUIT");
    return {
      ok: true,
      message: `Berhasil terhubung dan terautentikasi ke ${config.host}:${config.port} (${config.user})`,
      config: {
        host: config.host,
        port: config.port,
        user: config.user,
        enabled: true,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Koneksi SMTP gagal: ${msg}`,
      config: {
        host: config.host,
        port: config.port,
        user: config.user,
        enabled: config.enabled,
      },
    };
  } finally {
    session?.close();
  }
}

export async function sendEmail(
  opts: SendEmailOptions,
): Promise<{ ok: boolean; messageId: string; error?: string }> {
  const config = getSmtpConfig();
  if (!config.enabled) {
    return {
      ok: false,
      messageId: "",
      error: "SMTP dinonaktifkan di .env (SMTP_ENABLED=false)",
    };
  }

  const senderAddress = config.user;
  const fromHeader = `"${config.from}" <${senderAddress}>`;
  const messageId = `<${crypto.randomUUID()}@${config.host}>`;

  let session: SmtpSession | null = null;
  try {
    session = await createSmtpSession(config);

    session.write(`MAIL FROM:<${senderAddress}>`);
    const mailRes = await session.readResponse();
    if (mailRes.code !== 250) {
      throw new Error(`MAIL FROM rejected: ${mailRes.line}`);
    }

    session.write(`RCPT TO:<${opts.to}>`);
    const rcptRes = await session.readResponse();
    if (rcptRes.code !== 250 && rcptRes.code !== 251) {
      throw new Error(`RCPT TO rejected: ${rcptRes.line}`);
    }

    session.write("DATA");
    const dataPrompt = await session.readResponse();
    if (dataPrompt.code !== 354) {
      throw new Error(`DATA rejected: ${dataPrompt.line}`);
    }

    const emailContent = [
      `From: ${fromHeader}`,
      `To: <${opts.to}>`,
      `Subject: ${opts.subject}`,
      `Message-ID: ${messageId}`,
      `Date: ${new Date().toUTCString()}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 8bit`,
      ``,
      opts.html,
      `.`,
    ].join("\r\n");

    session.write(emailContent);
    const finishRes = await session.readResponse();
    if (finishRes.code !== 250) {
      throw new Error(`Message data rejected: ${finishRes.line}`);
    }

    session.write("QUIT");
    return { ok: true, messageId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, messageId: "", error };
  } finally {
    session?.close();
  }
}

export async function sendWorkspaceInvitationEmail(params: {
  toEmail: string;
  toName: string;
  inviterName: string;
  workspaceName: string;
  joinUrl: string;
}): Promise<{ ok: boolean; messageId: string; error?: string }> {
  const subject = `Undangan Bergabung ke Workspace "${params.workspaceName}"`;
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Plus Jakarta Sans', Arial, sans-serif; background: #eef1f7; margin: 0; padding: 24px; color: #1b2440; }
    .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 20px; padding: 32px; border: 1px solid #dce3ee; box-shadow: 0 6px 16px rgba(27,36,64,0.08); }
    .badge { display: inline-block; background: #e9eefb; color: #3b63d6; font-size: 12px; font-weight: bold; padding: 6px 12px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.1em; }
    h1 { font-size: 24px; font-weight: 800; color: #1b2440; margin-top: 16px; line-height: 1.3; }
    p { font-size: 15px; line-height: 1.6; color: #6b7488; }
    .btn { display: inline-block; background: #3b63d6; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 16px; font-weight: 700; font-size: 15px; margin-top: 20px; box-shadow: 0 8px 20px rgba(59,99,214,0.3); }
    .footer { margin-top: 32px; border-top: 1px solid #dce3ee; padding-top: 16px; font-size: 12px; color: #9aa3b5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Undangan Workspace</div>
    <h1>Hai ${params.toName}, Anda Telah Diundang!</h1>
    <p>
      <strong>${params.inviterName}</strong> telah mengundang Anda untuk bergabung ke ruang kerja
      <strong>"${params.workspaceName}"</strong> pada platform <em>Task Board + Chat Grup Terintegrasi</em>.
    </p>
    <p>
      Akun Anda telah disiapkan sebagai <strong>User Biasa (Member)</strong>. Anda dapat langsung mengelola tugas yang ditugaskan, mencentang checklist, dan berkolaborasi dalam ruang diskusi real-time.
    </p>
    <p style="text-align: center;">
      <a href="${params.joinUrl}" class="btn">Buka Workspace Sekarang</a>
    </p>
    <div class="footer">
      Email ini dikirim otomatis oleh sistem notifikasi Auto Smart Parking Workspace. Jika Anda tidak mengenali pengirim ini, Anda dapat mengabaikan email ini.
    </div>
  </div>
</body>
</html>
`;

  return sendEmail({
    to: params.toEmail,
    subject,
    html,
  });
}
