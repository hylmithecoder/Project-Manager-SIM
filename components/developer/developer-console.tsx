"use client";

import { useMemo, useState } from "react";
import {
  FolderIcon,
  LockIcon,
  LogoutIcon,
  MailIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  ShieldIcon,
  UsersIcon,
} from "@/components/icons";
import { SettingsView } from "@/components/settings/settings-view";
import type { DevAccountDto } from "@/server/ws/protocol";
import {
  Avatar,
  Modal,
  RoleBadge,
  cardClass,
  dangerBtn,
  formatDate,
  inputClass,
  outlineBtn,
  primaryBtn,
  smallInputClass,
  timeAgo,
  useWorkspace,
} from "@/components/ui/kit";

/**
 * Platform developer console: provisions company workspaces (by inviting the
 * company leader) and manages accounts. It never shows boards, cards or chat;
 * the server does not send that data to developers at all.
 */
export function DeveloperConsole({ onLogout, connected }: { onLogout: () => void; connected: boolean }) {
  const { snapshot, run } = useWorkspace();
  const dev = snapshot.dev;
  const [tab, setTab] = useState<"overview" | "settings">("overview");
  const [companyName, setCompanyName] = useState("");
  const [leaderEmail, setLeaderEmail] = useState("");
  const [adminEmailByWs, setAdminEmailByWs] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [testTo, setTestTo] = useState("");
  const [smtpCheck, setSmtpCheck] = useState<string | null>(null);
  const [editing, setEditing] = useState<DevAccountDto | null>(null);
  const [deleting, setDeleting] = useState<DevAccountDto | null>(null);

  const accounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (dev?.accounts || []).filter(
      (a) => !q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q),
    );
  }, [dev, query]);

  if (!dev) return null;
  const wsName = (id: string | null) => dev.workspaces.find((w) => w.id === id)?.name || "-";

  const createCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await run("dev:create_workspace", { name: companyName, admin_email: leaderEmail },
      `Workspace dibuat. Undangan dikirim ke ${leaderEmail}.`);
    if (res) {
      setCompanyName("");
      setLeaderEmail("");
    }
  };

  return (
    <div className="min-h-dvh bg-floor font-sans text-ink">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-bg px-4 md:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-card bg-ink font-bold text-white">
            <ShieldIcon className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-bold">Konsol Developer</div>
            <div className="text-[11px] text-muted">Manajemen akun & workspace perusahaan</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-line bg-floor px-2.5 py-1 text-[11px] text-muted md:flex">
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-success" : "animate-pulse bg-muted"}`} />
            {connected ? "Live" : "Offline"}
          </span>
          <button type="button" onClick={() => setTab(tab === "overview" ? "settings" : "overview")} className={outlineBtn}>
            {tab === "overview" ? "Akun Saya" : "Kembali"}
          </button>
          <button type="button" onClick={onLogout} className={outlineBtn}>
            <LogoutIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Keluar</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
        {tab === "settings" ? (
          <SettingsView />
        ) : (
          <>
            <div className="flex items-start gap-3 rounded-card border border-primary/20 bg-primary-soft/50 p-4 text-xs text-ink-soft">
              <LockIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p>
                Developer hanya mengelola <strong>akun</strong> dan <strong>workspace perusahaan</strong>. Isi workspace
                (board, tugas, chat) tetap privat milik perusahaan dan tidak dapat dibuka dari konsol ini.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: "Total akun", value: dev.accounts.length, icon: <UsersIcon className="h-4 w-4" /> },
                { label: "Workspace perusahaan", value: dev.workspaces.length, icon: <FolderIcon className="h-4 w-4" /> },
                { label: "Undangan admin tertunda", value: dev.pending_tokens.length, icon: <MailIcon className="h-4 w-4" /> },
                { label: "Akun nonaktif", value: dev.accounts.filter((a) => !a.is_active).length, icon: <LockIcon className="h-4 w-4" /> },
              ].map((s) => (
                <div key={s.label} className={cardClass}>
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-muted">
                    <span className="text-primary">{s.icon}</span>
                    {s.label}
                  </div>
                  <div className="mt-1 text-2xl font-bold">{s.value}</div>
                </div>
              ))}
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <form onSubmit={createCompany} className={`${cardClass} space-y-3`}>
                <div>
                  <h2 className="text-sm font-bold">Daftarkan Perusahaan Baru</h2>
                  <p className="mt-0.5 text-[11px] text-muted">
                    Membuat workspace privat lalu mengundang pemimpin perusahaan untuk membuat akunnya sendiri.
                  </p>
                </div>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Nama perusahaan / workspace" className={inputClass} />
                <input type="email" value={leaderEmail} onChange={(e) => setLeaderEmail(e.target.value)} placeholder="Email pemimpin perusahaan" className={inputClass} />
                <button type="submit" className={`${primaryBtn} w-full`} disabled={!companyName.trim() || !leaderEmail.trim()}>
                  <PlusIcon className="h-4 w-4" />
                  Buat Workspace & Kirim Undangan
                </button>
              </form>

              <div className={`${cardClass} space-y-3 lg:col-span-2`}>
                <h2 className="text-sm font-bold">Workspace Perusahaan</h2>
                <div className="divide-y divide-line">
                  {dev.workspaces.map((w) => (
                    <div key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold">{w.name}</div>
                        <div className="text-[11px] text-muted">
                          {w.owner_name ? `Pemimpin: ${w.owner_name} (${w.owner_email})` : "Menunggu pemimpin menerima undangan"} ·{" "}
                          {w.member_count} anggota · dibuat {formatDate(w.created_at)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="email"
                          value={adminEmailByWs[w.id] || ""}
                          onChange={(e) => setAdminEmailByWs((p) => ({ ...p, [w.id]: e.target.value }))}
                          placeholder={w.owner_id ? "Email admin tambahan" : "Email pemimpin"}
                          className={`${smallInputClass} w-48`}
                        />
                        <button
                          type="button"
                          className={outlineBtn}
                          onClick={async () => {
                            const email = adminEmailByWs[w.id];
                            if (!email) return;
                            const res = await run("dev:invite_admin", { workspace_id: w.id, email }, `Undangan dikirim ke ${email}`);
                            if (res) setAdminEmailByWs((p) => ({ ...p, [w.id]: "" }));
                          }}
                        >
                          <SendIcon className="h-3.5 w-3.5" />
                          Undang
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {dev.pending_tokens.length > 0 && (
              <div className={`${cardClass} space-y-2`}>
                <h2 className="text-sm font-bold">Undangan Pemimpin / Admin Tertunda</h2>
                <div className="divide-y divide-line">
                  {dev.pending_tokens.map((t) => (
                    <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                      <div>
                        <span className="font-semibold">{t.email}</span>{" "}
                        <span className="text-muted">
                          → {wsName(t.workspace_id)} sebagai {t.role === "owner" ? "pemimpin" : "admin"} · kedaluwarsa {formatDate(t.expires_at)}
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        <button type="button" className={outlineBtn} onClick={() => run("invite:resend", { invitation_id: t.id }, "Undangan dikirim ulang")}>
                          Kirim ulang
                        </button>
                        <button type="button" className={dangerBtn} onClick={() => run("invite:revoke", { invitation_id: t.id }, "Undangan dibatalkan")}>
                          Batalkan
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={`${cardClass} space-y-3`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold">Semua Akun</h2>
                <div className="relative w-64 max-w-full">
                  <SearchIcon className="absolute top-2.5 left-2.5 h-3.5 w-3.5 text-muted" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama / email" className={`${smallInputClass} pl-8`} />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="text-[10px] tracking-wider text-muted uppercase">
                    <tr className="border-b border-line">
                      <th className="py-2">Akun</th>
                      <th>Workspace & peran</th>
                      <th>Aktivitas</th>
                      <th className="text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {accounts.map((a) => (
                      <tr key={a.id} className={a.is_active ? "" : "opacity-60"}>
                        <td className="py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={a.name} online={a.online} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 font-semibold">
                                {a.name}
                                {a.platform_role === "developer" && <RoleBadge role="developer" />}
                                {!a.is_active && <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger">Nonaktif</span>}
                              </div>
                              <div className="text-[11px] text-muted">{a.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {a.memberships.length === 0 && <span className="text-[11px] text-subtle">-</span>}
                            {a.memberships.map((m) => (
                              <span key={m.workspace_id} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px]">
                                {m.workspace_name}
                                <RoleBadge role={m.role} />
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="text-[11px] text-muted">{a.online ? "Online" : timeAgo(a.last_seen_at)}</td>
                        <td className="text-right">
                          {a.platform_role !== "developer" && (
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <button type="button" className={outlineBtn} onClick={() => setEditing(a)}>
                                Edit
                              </button>
                              <button type="button" className={outlineBtn} onClick={() => run("dev:send_password_reset", { user_id: a.id }, `Tautan reset dikirim ke ${a.email}`)}>
                                Reset password
                              </button>
                              <button
                                type="button"
                                className={a.is_active ? dangerBtn : outlineBtn}
                                onClick={() =>
                                  run("dev:set_user_active", { user_id: a.id, active: !a.is_active }, a.is_active ? "Akun dinonaktifkan" : "Akun diaktifkan")
                                }
                              >
                                {a.is_active ? "Nonaktifkan" : "Aktifkan"}
                              </button>
                              <button type="button" className={dangerBtn} onClick={() => setDeleting(a)}>
                                Hapus
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={`${cardClass} space-y-3`}>
              <h2 className="text-sm font-bold">Layanan Email (SMTP)</h2>
              <div className="text-xs text-muted">
                {dev.smtp_status.message} · pengirim <strong className="text-ink">{dev.smtp_status.user || "-"}</strong>
              </div>
              {smtpCheck && <div className="rounded-card bg-floor p-2.5 text-[11px]">{smtpCheck}</div>}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={outlineBtn}
                  onClick={async () => {
                    const res = await run<{ message: string }>("smtp:status");
                    if (res) setSmtpCheck(res.message);
                  }}
                >
                  Cek koneksi SMTP
                </button>
                <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Kirim email tes ke..." className={`${smallInputClass} w-60`} />
                <button
                  type="button"
                  className={primaryBtn}
                  onClick={async () => {
                    const res = await run<{ ok: boolean; error?: string }>("smtp:test_send", { to: testTo });
                    if (res) setSmtpCheck(res.ok ? `Email tes terkirim ke ${testTo}` : `Gagal: ${res.error}`);
                  }}
                >
                  <SendIcon className="h-3.5 w-3.5" />
                  Kirim tes
                </button>
              </div>
            </div>
          </>
        )}
      </main>
      {editing && <EditAccountModal key={editing.id} account={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteAccountModal key={deleting.id} account={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function EditAccountModal({ account, onClose }: { account: DevAccountDto; onClose: () => void }) {
  const { run } = useWorkspace();
  const [name, setName] = useState(account.name);
  const [email, setEmail] = useState(account.email);
  const emailChanged = email.trim().toLowerCase() !== account.email.toLowerCase();
  return (
    <Modal open onClose={onClose} title={`Edit akun ${account.name}`}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run("dev:update_user", { user_id: account.id, name, email }, "Akun diperbarui")) onClose();
        }}
      >
        <label className="block space-y-1">
          <span className="text-xs font-medium">Nama</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Email login</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </label>
        {emailChanged && (
          <p className="rounded-lg bg-[#fff6d9] p-2.5 text-[11px] text-[#a87400]">
            Pemberitahuan perubahan email akan dikirim ke alamat lama dan baru. Pengguna harus masuk dengan email baru.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={outlineBtn} onClick={onClose}>
            Batal
          </button>
          <button type="submit" className={primaryBtn} disabled={name.trim().length < 2 || !email.trim()}>
            Simpan
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteAccountModal({ account, onClose }: { account: DevAccountDto; onClose: () => void }) {
  const { run } = useWorkspace();
  const [confirm, setConfirm] = useState("");
  const owns = account.memberships.filter((m) => m.role === "owner");
  return (
    <Modal open onClose={onClose} title="Hapus akun permanen">
      <form
        className="space-y-3 text-xs"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run("dev:delete_user", { user_id: account.id, confirm_email: confirm }, `Akun ${account.email} dihapus`)) onClose();
        }}
      >
        <p>
          Akun <strong>{account.name}</strong> ({account.email}) akan dihapus permanen dan dikeluarkan dari semua workspace.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-[11px] text-muted">
          <li>Board, card, ruang chat, dan lampiran buatannya dialihkan ke anggota lain di workspace yang sama.</li>
          <li>Pesan chatnya tetap ada tanpa nama pengirim; riwayat aktivitasnya dihapus.</li>
          {owns.length > 0 && (
            <li className="font-semibold text-danger">
              Ia pemimpin di {owns.map((m) => m.workspace_name).join(", ")}. Workspace tetap ada, undang pemimpin baru setelahnya.
            </li>
          )}
        </ul>
        <label className="block space-y-1">
          <span className="font-medium">
            Ketik <strong>{account.email}</strong> untuk konfirmasi
          </span>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={outlineBtn} onClick={onClose}>
            Batal
          </button>
          <button type="submit" className={dangerBtn} disabled={confirm.trim().toLowerCase() !== account.email.toLowerCase()}>
            Hapus permanen
          </button>
        </div>
      </form>
    </Modal>
  );
}
