/**
 * Email templates for every workspace feature. All templates share one clean
 * layout (blue isometric theme) but each feature gets its own badge, headline,
 * detail rows and call-to-action so recipients can tell events apart at a
 * glance in Gmail.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Tone = "primary" | "success" | "danger" | "warning" | "neutral";

const TONES: Record<Tone, { bg: string; fg: string }> = {
  primary: { bg: "#e9eefb", fg: "#3b63d6" },
  success: { bg: "#e3f5ec", fg: "#2fa36b" },
  danger: { bg: "#fdecea", fg: "#e5534b" },
  warning: { bg: "#fff6d9", fg: "#a87400" },
  neutral: { bg: "#eef1f7", fg: "#6b7488" },
};

interface LayoutParams {
  badge: string;
  tone?: Tone;
  headline: string;
  /** Already-escaped HTML paragraphs. */
  bodyHtml: string;
  details?: [string, string][];
  quote?: string | null;
  cta?: { label: string; url: string } | null;
  footerNote?: string;
}

export function renderLayout(p: LayoutParams): string {
  const tone = TONES[p.tone || "primary"];
  const details = (p.details || [])
    .filter(([, v]) => v !== "")
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:#9aa3b5;font-size:13px;width:38%;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0;color:#1b2440;font-size:13px;font-weight:600">${escapeHtml(v)}</td></tr>`,
    )
    .join("");
  const quote = p.quote
    ? `<div style="margin:16px 0;padding:12px 16px;border-left:4px solid ${tone.fg};background:#f6f8fc;border-radius:10px;color:#2f3e75;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(p.quote)}</div>`
    : "";
  const cta = p.cta
    ? `<p style="text-align:center;margin:24px 0 4px"><a href="${escapeHtml(p.cta.url)}" style="display:inline-block;background:#3b63d6;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:16px;font-weight:700;font-size:14px">${escapeHtml(p.cta.label)}</a></p>`
    : "";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#eef1f7;font-family:'Plus Jakarta Sans',Arial,sans-serif;color:#1b2440">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dce3ee;border-radius:20px;padding:30px">
<div style="font-size:12px;font-weight:800;color:#3b63d6;letter-spacing:.08em">PROJECT MANAGER WORKSPACE</div>
<div style="display:inline-block;margin-top:14px;background:${tone.bg};color:${tone.fg};font-size:11px;font-weight:700;padding:5px 12px;border-radius:9999px;text-transform:uppercase;letter-spacing:.08em">${escapeHtml(p.badge)}</div>
<h1 style="font-size:21px;line-height:1.35;margin:14px 0 8px;color:#1b2440">${escapeHtml(p.headline)}</h1>
<div style="font-size:14px;line-height:1.65;color:#6b7488">${p.bodyHtml}</div>
${quote}
${details ? `<table style="width:100%;border-collapse:collapse;margin-top:12px;border-top:1px solid #eef1f7">${details}</table>` : ""}
${cta}
<div style="margin-top:28px;border-top:1px solid #dce3ee;padding-top:14px;font-size:11px;color:#9aa3b5;line-height:1.6">${escapeHtml(p.footerNote || "Email ini dikirim otomatis oleh Project Manager Workspace. Atur notifikasi email Anda di menu Pengaturan.")}</div>
</div>
</body>
</html>`;
}

const p = (text: string) => `<p style="margin:0 0 10px">${text}</p>`;
const b = (text: string) => `<strong style="color:#1b2440">${escapeHtml(text)}</strong>`;

const ROLE_LABEL: Record<string, string> = {
  owner: "Pemimpin Perusahaan (Owner)",
  admin: "Admin Workspace",
  member: "Anggota",
  guest: "Tamu",
};

export function roleLabel(role: string | null | undefined): string {
  return ROLE_LABEL[role || "member"] || String(role);
}

// ---------------------------------------------------------------------------
// Account lifecycle
// ---------------------------------------------------------------------------

export function googleLoginOtpEmail(name: string, code: string): RenderedEmail {
  return {
    subject: "Kode OTP login Google — Project Manager",
    html: renderLayout({
      badge: "Verifikasi Login", headline: "Kode OTP login Google",
      bodyHtml: p(`Hai ${b(name)}, masukkan kode berikut untuk menyelesaikan login dengan Google.`),
      quote: code,
      details: [["Berlaku", "5 menit"], ["Penggunaan", "Sekali pakai"]],
      footerNote: "Jangan bagikan kode ini kepada siapa pun. Jika Anda tidak mencoba login, abaikan email ini.",
    }),
  };
}

export function invitationEmail(x: {
  inviterName: string;
  workspaceName: string;
  role: string;
  acceptUrl: string;
  existingUser: boolean;
  expiresAt: string;
}): RenderedEmail {
  return {
    subject: `Undangan bergabung ke workspace "${x.workspaceName}"`,
    html: renderLayout({
      badge: "Undangan Workspace",
      headline: `Anda diundang ke ${x.workspaceName}`,
      bodyHtml:
        p(`${b(x.inviterName)} mengundang Anda bergabung ke workspace ${b(x.workspaceName)} sebagai ${b(roleLabel(x.role))}.`) +
        p(
          x.existingUser
            ? "Anda sudah memiliki akun. Klik tombol di bawah lalu konfirmasi dengan password Anda untuk bergabung."
            : "Klik tombol di bawah untuk membuat akun baru (nama &amp; password) dan langsung bergabung.",
        ),
      details: [
        ["Workspace", x.workspaceName],
        ["Peran", roleLabel(x.role)],
        ["Berlaku sampai", formatDate(x.expiresAt)],
      ],
      cta: {
        label: x.existingUser ? "Terima Undangan" : "Buat Akun & Bergabung",
        url: x.acceptUrl,
      },
      footerNote:
        "Jika Anda tidak merasa diundang, abaikan email ini. Tautan hanya bisa dipakai satu kali.",
    }),
  };
}

export function welcomeEmail(x: {
  name: string;
  workspaceName: string;
  role: string;
  loginUrl: string;
  newAccount: boolean;
}): RenderedEmail {
  return {
    subject: x.newAccount
      ? `Selamat datang, akun Anda berhasil dibuat`
      : `Anda sekarang anggota "${x.workspaceName}"`,
    html: renderLayout({
      badge: x.newAccount ? "Akun Baru" : "Bergabung",
      tone: "success",
      headline: x.newAccount
        ? `Selamat ${x.name}, akun Anda sudah dibuat!`
        : `Selamat ${x.name}, Anda sudah bergabung!`,
      bodyHtml:
        p(
          `Sekarang Anda bisa masuk ke workspace kerja Anda, ${b(x.workspaceName)}, dan mulai berkolaborasi di task board serta chat grup.`,
        ) + p("Masuk menggunakan email ini dan password yang baru saja Anda buat."),
      details: [
        ["Workspace", x.workspaceName],
        ["Peran", roleLabel(x.role)],
      ],
      cta: { label: "Masuk ke Workspace", url: x.loginUrl },
    }),
  };
}

export function invitationAcceptedEmail(x: {
  inviterName: string;
  inviteeName: string;
  inviteeEmail: string;
  workspaceName: string;
  role: string;
  url: string;
}): RenderedEmail {
  return {
    subject: `${x.inviteeName} telah menerima undangan Anda`,
    html: renderLayout({
      badge: "Undangan Diterima",
      tone: "success",
      headline: `${x.inviteeName} sudah bergabung ke ${x.workspaceName}`,
      bodyHtml: p(
        `Hai ${b(x.inviterName)}, orang yang Anda undang sudah membuat akun dan kini menjadi anggota workspace.`,
      ),
      details: [
        ["Nama", x.inviteeName],
        ["Email", x.inviteeEmail],
        ["Peran", roleLabel(x.role)],
      ],
      cta: { label: "Lihat Anggota", url: x.url },
    }),
  };
}

export function passwordResetEmail(x: {
  name: string;
  resetUrl: string;
  requestedBy: string | null;
  expiresAt: string;
}): RenderedEmail {
  return {
    subject: "Atur ulang password akun Anda",
    html: renderLayout({
      badge: "Keamanan Akun",
      tone: "warning",
      headline: "Permintaan atur ulang password",
      bodyHtml:
        p(`Hai ${b(x.name)}, ${x.requestedBy ? `${b(x.requestedBy)} (tim developer) mengirimkan` : "kami menerima"} permintaan untuk mengatur ulang password akun Anda.`) +
        p("Klik tombol di bawah untuk membuat password baru."),
      details: [["Berlaku sampai", formatDate(x.expiresAt)]],
      cta: { label: "Atur Password Baru", url: x.resetUrl },
      footerNote: "Jika Anda tidak meminta ini, abaikan email ini; password Anda tidak berubah.",
    }),
  };
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export function chatMessageEmail(x: {
  recipientName: string;
  senderName: string;
  roomName: string;
  workspaceName: string;
  content: string;
  mentioned: boolean;
  isDirect: boolean;
  url: string;
}): RenderedEmail {
  const where = x.isDirect ? "pesan langsung" : `#${x.roomName}`;
  return {
    subject: x.mentioned
      ? `${x.senderName} menyebut Anda di ${where}`
      : `[${x.workspaceName}] Pesan baru dari ${x.senderName} di ${where}`,
    html: renderLayout({
      badge: x.mentioned ? "Mention" : x.isDirect ? "Pesan Langsung" : "Chat Grup",
      tone: x.mentioned ? "warning" : "primary",
      headline: x.mentioned
        ? `${x.senderName} menyebut Anda`
        : `Pesan baru dari ${x.senderName}`,
      bodyHtml: p(
        `Hai ${b(x.recipientName)}, ada pesan baru di ${b(where)} pada workspace ${b(x.workspaceName)}.`,
      ),
      quote: x.content,
      cta: { label: "Balas di Chat", url: x.url },
      footerNote:
        "Tidak ingin menerima email untuk setiap pesan chat? Matikan opsi \"Email semua pesan chat\" di menu Pengaturan.",
    }),
  };
}

// ---------------------------------------------------------------------------
// Workspace / task board activity
// ---------------------------------------------------------------------------

export interface ActivityEmailInput {
  action: string;
  actorName: string;
  recipientName: string;
  workspaceName: string;
  boardName?: string | null;
  cardTitle?: string | null;
  payload: Record<string, unknown>;
  url: string;
}

interface ActivitySpec {
  badge: string;
  tone: Tone;
  subject: string;
  headline: string;
  body: string;
  details?: [string, string][];
  quote?: string | null;
  cta: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function formatDate(value: unknown): string {
  if (!value) return "";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: process.env.APP_TIMEZONE || "Asia/Jakarta",
  });
}

function activitySpec(x: ActivityEmailInput): ActivitySpec {
  const a = b(x.actorName);
  const card = x.cardTitle || str(x.payload.card_title);
  const board = x.boardName || str(x.payload.board_name);
  const baseDetails: [string, string][] = [
    ["Board", board],
    ["Card", card],
    ["Oleh", x.actorName],
  ];
  switch (x.action) {
    case "card_created":
      return {
        badge: "Card Baru",
        tone: "primary",
        subject: `Card baru: "${card}"`,
        headline: `Card baru di ${board}`,
        body: `${a} menambahkan card ${b(card)} ke kolom ${b(str(x.payload.list_name))}.`,
        details: [...baseDetails, ["Kolom", str(x.payload.list_name)]],
        quote: str(x.payload.description) || null,
        cta: "Buka Card",
      };
    case "card_created_from_message":
      return {
        badge: "Card dari Chat",
        tone: "primary",
        subject: `Pesan chat dijadikan card: "${card}"`,
        headline: "Pesan chat diubah menjadi tugas",
        body: `${a} membuat card ${b(card)} langsung dari pesan chat.`,
        details: baseDetails,
        quote: str(x.payload.message_content) || null,
        cta: "Buka Card",
      };
    case "card_moved":
      return {
        badge: "Card Dipindah",
        tone: "neutral",
        subject: `"${card}" dipindah ke ${str(x.payload.to_list)}`,
        headline: `Card dipindah ke ${str(x.payload.to_list)}`,
        body: `${a} memindahkan card ${b(card)} dari ${b(str(x.payload.from_list))} ke ${b(str(x.payload.to_list))}.`,
        details: [...baseDetails, ["Dari", str(x.payload.from_list)], ["Ke", str(x.payload.to_list)]],
        cta: "Lihat Board",
      };
    case "card_completed":
      return {
        badge: "Tugas Selesai",
        tone: "success",
        subject: `Selesai: "${card}"`,
        headline: "Tugas ditandai selesai",
        body: `${a} menandai card ${b(card)} sebagai selesai.`,
        details: baseDetails,
        cta: "Lihat Card",
      };
    case "card_reopened":
      return {
        badge: "Tugas Dibuka Lagi",
        tone: "warning",
        subject: `Dibuka kembali: "${card}"`,
        headline: "Tugas dibuka kembali",
        body: `${a} menandai card ${b(card)} sebagai belum selesai.`,
        details: baseDetails,
        cta: "Lihat Card",
      };
    case "card_updated":
      return {
        badge: "Card Diperbarui",
        tone: "neutral",
        subject: `Card diperbarui: "${card}"`,
        headline: "Detail card diperbarui",
        body: `${a} memperbarui detail card ${b(card)}.`,
        details: [...baseDetails, ["Perubahan", str(x.payload.changes)]],
        cta: "Lihat Card",
      };
    case "due_changed":
      return {
        badge: "Deadline",
        tone: "warning",
        subject: `Deadline "${card}" ${x.payload.due_at ? "diubah" : "dihapus"}`,
        headline: x.payload.due_at ? "Deadline card diubah" : "Deadline card dihapus",
        body: `${a} ${x.payload.due_at ? "mengatur deadline" : "menghapus deadline"} card ${b(card)}.`,
        details: [...baseDetails, ["Deadline baru", formatDate(x.payload.due_at) || "Tanpa deadline"]],
        cta: "Lihat Card",
      };
    case "card_archived":
      return {
        badge: "Card Diarsipkan",
        tone: "danger",
        subject: `Card diarsipkan: "${card}"`,
        headline: "Card diarsipkan",
        body: `${a} mengarsipkan card ${b(card)}.`,
        details: baseDetails,
        cta: "Buka Board",
      };
    case "card_assigned":
      return {
        badge: "Penugasan",
        tone: "primary",
        subject: `Tugas untuk ${str(x.payload.assignee_name)}: "${card}"`,
        headline:
          x.payload.assignee_name === x.recipientName
            ? "Anda mendapat tugas baru"
            : `${str(x.payload.assignee_name)} ditugaskan`,
        body: `${a} menugaskan ${b(str(x.payload.assignee_name))} pada card ${b(card)}.`,
        details: [...baseDetails, ["Deadline", formatDate(x.payload.due_at) || "Tanpa deadline"]],
        cta: "Kerjakan Tugas",
      };
    case "card_unassigned":
      return {
        badge: "Penugasan Dilepas",
        tone: "neutral",
        subject: `${str(x.payload.assignee_name)} dilepas dari "${card}"`,
        headline: "Penugasan dilepas",
        body: `${a} melepas ${b(str(x.payload.assignee_name))} dari card ${b(card)}.`,
        details: baseDetails,
        cta: "Lihat Card",
      };
    case "label_changed":
      return {
        badge: "Label",
        tone: "neutral",
        subject: `Label "${str(x.payload.label_name)}" ${x.payload.added ? "ditambahkan ke" : "dilepas dari"} "${card}"`,
        headline: "Label card berubah",
        body: `${a} ${x.payload.added ? "menambahkan" : "melepas"} label ${b(str(x.payload.label_name))} pada card ${b(card)}.`,
        details: baseDetails,
        cta: "Lihat Card",
      };
    case "checklist_created":
      return {
        badge: "Checklist",
        tone: "primary",
        subject: `Checklist baru di "${card}"`,
        headline: "Checklist baru ditambahkan",
        body: `${a} membuat checklist ${b(str(x.payload.checklist_title))} di card ${b(card)}.`,
        details: baseDetails,
        cta: "Lihat Checklist",
      };
    case "checklist_item_added":
      return {
        badge: "Checklist",
        tone: "primary",
        subject: `Item checklist baru di "${card}"`,
        headline: "Item checklist ditambahkan",
        body: `${a} menambahkan item checklist di card ${b(card)}.`,
        details: baseDetails,
        quote: str(x.payload.content),
        cta: "Lihat Checklist",
      };
    case "checklist_item_done":
    case "checklist_item_undone":
      return {
        badge: x.action === "checklist_item_done" ? "Checklist Selesai" : "Checklist Dibuka",
        tone: x.action === "checklist_item_done" ? "success" : "warning",
        subject: `Checklist "${str(x.payload.content)}" ${x.action === "checklist_item_done" ? "selesai" : "dibuka lagi"}`,
        headline: x.action === "checklist_item_done" ? "Item checklist dicentang" : "Centang item checklist dilepas",
        body: `${a} ${x.action === "checklist_item_done" ? "mencentang" : "melepas centang"} item checklist di card ${b(card)}.`,
        details: [...baseDetails, ["Progres", str(x.payload.progress)]],
        quote: str(x.payload.content),
        cta: "Lihat Checklist",
      };
    case "attachment_added":
      return {
        badge: "Lampiran",
        tone: "primary",
        subject: `Lampiran baru di "${card}"`,
        headline: "File baru dilampirkan",
        body: `${a} melampirkan file ${b(str(x.payload.file_name))} pada card ${b(card)}.`,
        details: [...baseDetails, ["Ukuran", formatBytes(Number(x.payload.size_bytes || 0))]],
        cta: "Lihat Lampiran",
      };
    case "list_created":
      return {
        badge: "Kolom Baru",
        tone: "primary",
        subject: `Kolom baru "${str(x.payload.list_name)}" di ${board}`,
        headline: "Kolom list baru",
        body: `${a} menambahkan kolom ${b(str(x.payload.list_name))} di board ${b(board)}.`,
        details: [["Board", board], ["Oleh", x.actorName]],
        cta: "Lihat Board",
      };
    case "list_renamed":
      return {
        badge: "Kolom Diubah",
        tone: "neutral",
        subject: `Kolom diubah menjadi "${str(x.payload.list_name)}"`,
        headline: "Nama kolom diubah",
        body: `${a} mengganti nama kolom ${b(str(x.payload.old_name))} menjadi ${b(str(x.payload.list_name))}.`,
        details: [["Board", board]],
        cta: "Lihat Board",
      };
    case "list_archived":
      return {
        badge: "Kolom Diarsipkan",
        tone: "danger",
        subject: `Kolom "${str(x.payload.list_name)}" diarsipkan`,
        headline: "Kolom list diarsipkan",
        body: `${a} mengarsipkan kolom ${b(str(x.payload.list_name))} di board ${b(board)}.`,
        details: [["Board", board]],
        cta: "Lihat Board",
      };
    case "board_created":
      return {
        badge: "Board Baru",
        tone: "primary",
        subject: `Board baru: ${board}`,
        headline: `Board ${board} dibuat`,
        body: `${a} membuat board ${b(board)} beserta ruang chat diskusinya.`,
        details: [["Visibilitas", x.payload.visibility === "private" ? "Privat" : "Seluruh workspace"]],
        cta: "Buka Board",
      };
    case "board_updated":
      return {
        badge: "Board Diperbarui",
        tone: "neutral",
        subject: `Board diperbarui: ${board}`,
        headline: "Pengaturan board diubah",
        body: `${a} memperbarui board ${b(board)}.`,
        details: [["Visibilitas", x.payload.visibility === "private" ? "Privat" : "Seluruh workspace"]],
        cta: "Buka Board",
      };
    case "board_archived":
      return {
        badge: "Board Diarsipkan",
        tone: "danger",
        subject: `Board diarsipkan: ${board}`,
        headline: "Board diarsipkan",
        body: `${a} mengarsipkan board ${b(board)}.`,
        cta: "Buka Workspace",
      };
    case "board_member_added":
    case "board_member_removed":
      return {
        badge: "Anggota Board",
        tone: "neutral",
        subject: `${str(x.payload.member_name)} ${x.action === "board_member_added" ? "ditambahkan ke" : "dikeluarkan dari"} board ${board}`,
        headline: "Anggota board berubah",
        body: `${a} ${x.action === "board_member_added" ? "menambahkan" : "mengeluarkan"} ${b(str(x.payload.member_name))} ${x.action === "board_member_added" ? "ke" : "dari"} board ${b(board)}.`,
        cta: "Buka Board",
      };
    case "member_invited":
      return {
        badge: "Undangan",
        tone: "primary",
        subject: `${x.actorName} mengundang ${str(x.payload.email)}`,
        headline: "Anggota baru diundang",
        body: `${a} mengundang ${b(str(x.payload.email))} sebagai ${b(roleLabel(str(x.payload.role)))}.`,
        cta: "Lihat Anggota",
      };
    case "member_joined":
      return {
        badge: "Anggota Baru",
        tone: "success",
        subject: `${str(x.payload.member_name)} bergabung ke ${x.workspaceName}`,
        headline: "Anggota baru bergabung",
        body: `${b(str(x.payload.member_name))} kini menjadi ${b(roleLabel(str(x.payload.role)))} di workspace ${b(x.workspaceName)}.`,
        cta: "Sapa di Chat",
      };
    case "member_role_changed":
      return {
        badge: "Peran Diubah",
        tone: "warning",
        subject: `Peran ${str(x.payload.member_name)} diubah menjadi ${roleLabel(str(x.payload.role))}`,
        headline: "Peran anggota diubah",
        body: `${a} mengubah peran ${b(str(x.payload.member_name))} menjadi ${b(roleLabel(str(x.payload.role)))}.`,
        cta: "Lihat Anggota",
      };
    case "member_removed":
      return {
        badge: "Anggota Dikeluarkan",
        tone: "danger",
        subject: `${str(x.payload.member_name)} dikeluarkan dari ${x.workspaceName}`,
        headline: "Anggota dikeluarkan",
        body: `${a} mengeluarkan ${b(str(x.payload.member_name))} dari workspace.`,
        cta: "Lihat Anggota",
      };
    case "room_created":
      return {
        badge: "Ruang Chat",
        tone: "primary",
        subject: `Ruang chat baru: #${str(x.payload.room_name)}`,
        headline: "Anda ditambahkan ke ruang chat",
        body: `${a} membuat ruang chat ${b(`#${str(x.payload.room_name)}`)} dan menambahkan Anda.`,
        cta: "Buka Chat",
      };
    case "room_permission_changed":
      return {
        badge: "Pengaturan Chat",
        tone: "warning",
        subject: `Izin kirim pesan #${str(x.payload.room_name)} diubah`,
        headline: "Pengaturan ruang chat diubah",
        body: `${a} ${x.payload.only_admins_can_send ? "membatasi pengiriman pesan hanya untuk admin" : "membuka pengiriman pesan untuk semua anggota"} di ${b(`#${str(x.payload.room_name)}`)}.`,
        cta: "Buka Chat",
      };
    case "workspace_updated":
      return {
        badge: "Workspace",
        tone: "neutral",
        subject: `Pengaturan workspace ${x.workspaceName} diubah`,
        headline: "Pengaturan workspace diperbarui",
        body: `${a} memperbarui pengaturan workspace ${b(x.workspaceName)}.`,
        details: [
          ["Email chat", x.payload.email_chat_enabled === false ? "Nonaktif" : "Aktif"],
          ["Email aktivitas", x.payload.email_activity_enabled === false ? "Nonaktif" : "Aktif"],
        ],
        cta: "Buka Workspace",
      };
    case "due_soon":
      return {
        badge: "Deadline Dekat",
        tone: "danger",
        subject: `Pengingat: "${card}" jatuh tempo ${formatDate(x.payload.due_at)}`,
        headline: "Deadline tugas sudah dekat",
        body: `Card ${b(card)} yang ditugaskan kepada Anda akan jatuh tempo dalam 24 jam dan belum selesai.`,
        details: [["Board", board], ["Card", card], ["Deadline", formatDate(x.payload.due_at)]],
        cta: "Selesaikan Sekarang",
      };
    default:
      return {
        badge: "Aktivitas",
        tone: "neutral",
        subject: `Aktivitas baru di ${x.workspaceName}`,
        headline: "Aktivitas baru di workspace",
        body: `${a} melakukan ${b(x.action.replace(/_/g, " "))}.`,
        details: baseDetails,
        cta: "Buka Workspace",
      };
  }
}

export function activityEmail(x: ActivityEmailInput): RenderedEmail {
  const spec = activitySpec(x);
  return {
    subject: `[${x.workspaceName}] ${spec.subject}`,
    html: renderLayout({
      badge: spec.badge,
      tone: spec.tone,
      headline: spec.headline,
      bodyHtml: p(`Hai ${b(x.recipientName)},`) + p(spec.body),
      details: spec.details,
      quote: spec.quote,
      cta: { label: spec.cta, url: x.url },
    }),
  };
}

function formatBytes(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
