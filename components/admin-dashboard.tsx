"use client";

import { useState } from "react";
import {
  ActivityIcon,
  CheckCircleIcon,
  LockIcon,
  MailIcon,
  PlusIcon,
  SendIcon,
  SettingsIcon,
  ShieldIcon,
  UnlockIcon,
  UsersIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { WorkspaceSnapshot, WsAction } from "@/server/ws/protocol";

interface AdminDashboardProps {
  snapshot: WorkspaceSnapshot;
  currentUserId: string;
  sendWsAction: (action: WsAction, payload?: Record<string, unknown>) => void;
}

export function AdminDashboard({
  snapshot,
  currentUserId,
  sendWsAction,
}: AdminDashboardProps) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin" | "guest">(
    "member",
  );
  const [testEmailRecipient, setTestEmailRecipient] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  const activeWorkspace = snapshot.workspaces[0] || {
    id: "default",
    name: "Auto Smart Workspace",
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      setFeedbackMessage({
        text: "Masukkan alamat email yang valid.",
        type: "error",
      });
      return;
    }

    sendWsAction("workspace:invite_member", {
      workspace_id: activeWorkspace.id,
      email: inviteEmail.trim(),
      name: inviteName.trim(),
      role: inviteRole,
    });

    setFeedbackMessage({
      text: `Undangan ke ${inviteEmail} berhasil diproses. Jika belum ada akun, otomatis dibuat sebagai User Biasa (${inviteRole}) dan email undangan dikirimkan.`,
      type: "success",
    });

    setInviteEmail("");
    setInviteName("");
  };

  const handleTestSmtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmailRecipient.trim()) {
      setFeedbackMessage({
        text: "Masukkan email tujuan uji coba.",
        type: "error",
      });
      return;
    }

    sendWsAction("smtp:test_send", {
      to: testEmailRecipient.trim(),
    });

    setFeedbackMessage({
      text: `Permintaan uji coba email ke ${testEmailRecipient} telah dikirim ke antrean SMTP.`,
      type: "success",
    });
  };

  return (
    <div className="space-y-6">
      {/* Header Info Admin */}
      <section className="rounded-card border border-line bg-bg p-6 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-btn bg-primary-soft text-primary">
              <ShieldIcon className="h-6 w-6" />
            </div>
            <div>
              <span className="text-[12px] font-bold uppercase tracking-widest text-accent-text">
                Administrator Control Center
              </span>
              <h2 className="text-2xl font-extrabold text-ink">
                Tata Kelola Workspace: {activeWorkspace.name}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-btn bg-floor/60 px-3.5 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-success" />
            <span className="text-xs font-semibold text-ink">
              Mode Akses: Administrator Penuh
            </span>
          </div>
        </div>

        {feedbackMessage && (
          <div
            className={`mt-4 flex items-center justify-between rounded-btn border p-3.5 text-xs font-semibold ${
              feedbackMessage.type === "success"
                ? "border-success bg-primary-soft text-success"
                : "border-danger bg-primary-soft text-danger"
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircleIcon className="h-4 w-4" />
              <span>{feedbackMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="text-[11px] underline"
            >
              Tutup
            </button>
          </div>
        )}

        {/* 4 Kartu Statistik Tata Kelola */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-card border border-line bg-floor/40 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-subtle">
                Total Anggota
              </span>
              <UsersIcon className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-ink">
              {snapshot.workspace_members?.length || snapshot.users.length} User
            </p>
            <p className="mt-1 text-[11px] text-muted">
              {
                (snapshot.workspace_members || []).filter(
                  (m) => m.role === "admin" || m.role === "owner",
                ).length
              }{" "}
              Admin ·{" "}
              {
                (snapshot.workspace_members || []).filter(
                  (m) => m.role === "member",
                ).length
              }{" "}
              User Biasa
            </p>
          </div>

          <div className="rounded-card border border-line bg-floor/40 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-subtle">
                Papan &amp; List
              </span>
              <SettingsIcon className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-ink">
              {snapshot.boards.length} Board
            </p>
            <p className="mt-1 text-[11px] text-muted">
              {snapshot.lists.length} Kolom Kanban aktif
            </p>
          </div>

          <div className="rounded-card border border-line bg-floor/40 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-subtle">
                Ruang Chat Terintegrasi
              </span>
              <LockIcon className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-ink">
              {snapshot.rooms.length} Room
            </p>
            <p className="mt-1 text-[11px] text-muted">
              {
                snapshot.rooms.filter((r) => r.only_admins_can_send).length
              }{" "}
              Room Dibatasi Admin
            </p>
          </div>

          <div className="rounded-card border border-line bg-floor/40 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-subtle">
                Layanan SMTP
              </span>
              <MailIcon className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-2 text-sm font-extrabold text-ink">
              {snapshot.smtp_status?.ok ? "Aktif & Terhubung" : "Non-Aktif"}
            </p>
            <p className="mt-1 truncate text-[11px] text-muted">
              {snapshot.smtp_status?.host}:{snapshot.smtp_status?.port}
            </p>
          </div>
        </div>
      </section>

      {/* Grid: Kiri = Undang via Gmail & Manajemen Anggota, Kanan = Pengaturan Chat & SMTP */}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        {/* Kolom Kiri */}
        <div className="space-y-6">
          {/* Form Undang Anggota via Email / Gmail */}
          <section className="rounded-card border border-line bg-bg p-5 shadow-soft">
            <div className="flex items-center gap-2 border-b border-line pb-3">
              <MailIcon className="h-4 w-4 text-primary" />
              <h3 className="text-base font-extrabold text-ink">
                Undang Anggota via Gmail / Email
              </h3>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Undang kolega dengan akun Google/email apa pun. Apabila pengguna
              belum memiliki akun di sistem, akun baru akan{" "}
              <strong>otomatis dibuat sebagai User Biasa</strong>, didaftarkan
              ke ruang kerja, dan tautan bergabung dikirimkan via SMTP.
            </p>

            <form onSubmit={handleInvite} className="mt-4 space-y-3">
              <div>
                <label className="text-[12px] font-semibold text-ink">
                  Alamat Email Penerima
                </label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="contoh: kolega@gmail.com"
                  className="mt-1 h-[44px] w-full rounded-btn border border-line bg-bg px-3 text-xs text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[12px] font-semibold text-ink">
                    Nama Lengkap (Opsional)
                  </label>
                  <input
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Nama tampilan"
                    className="mt-1 h-[44px] w-full rounded-btn border border-line bg-bg px-3 text-xs text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <label className="text-[12px] font-semibold text-ink">
                    Peran Awal
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) =>
                      setInviteRole(
                        e.target.value as "member" | "admin" | "guest",
                      )
                    }
                    className="mt-1 h-[44px] w-full rounded-btn border border-line bg-bg px-3 text-xs font-semibold text-ink focus:border-primary focus:outline-none"
                  >
                    <option value="member">User Biasa (Member)</option>
                    <option value="admin">Administrator (Admin)</option>
                    <option value="guest">Tamu Terbatas (Guest)</option>
                  </select>
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                className="!mt-2 !h-[44px] !text-xs"
              >
                <PlusIcon className="h-4 w-4" />
                Kirim Undangan Workspace via SMTP
              </Button>
            </form>
          </section>

          {/* Daftar & Manajemen Role Anggota */}
          <section className="rounded-card border border-line bg-bg p-5 shadow-soft">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <UsersIcon className="h-4 w-4 text-primary" />
                <h3 className="text-base font-extrabold text-ink">
                  Daftar Anggota Workspace
                </h3>
              </div>
              <span className="text-xs font-semibold text-subtle">
                {(snapshot.workspace_members || []).length} Terdaftar
              </span>
            </div>

            <div className="mt-3 divide-y divide-line/60">
              {(snapshot.workspace_members || []).map((m) => {
                const isCurrentUser = m.user_id === currentUserId;
                return (
                  <div
                    key={m.user_id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-ink">
                          {m.user_name}
                        </span>
                        {isCurrentUser && (
                          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-accent-text">
                            Saya
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted">{m.user_email}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        aria-label={`Ubah role ${m.user_name}`}
                        disabled={m.role === "owner"}
                        value={m.role}
                        onChange={(e) =>
                          sendWsAction("admin:update_member_role", {
                            workspace_id: activeWorkspace.id,
                            user_id: m.user_id,
                            role: e.target.value,
                          })
                        }
                        className="h-[36px] rounded-btn border border-line bg-floor/60 px-2.5 text-xs font-semibold text-ink focus:border-primary focus:outline-none"
                      >
                        <option value="owner" disabled>
                          Owner
                        </option>
                        <option value="admin">Admin</option>
                        <option value="member">Member (User Biasa)</option>
                        <option value="guest">Guest</option>
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Kolom Kanan */}
        <div className="space-y-6">
          {/* Pengaturan Ruang Chat (only_admins_can_send) */}
          <section className="rounded-card border border-line bg-bg p-5 shadow-soft">
            <div className="flex items-center gap-2 border-b border-line pb-3">
              <LockIcon className="h-4 w-4 text-primary" />
              <h3 className="text-base font-extrabold text-ink">
                Perizinan Ruang Diskusi
              </h3>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Atur hak kirim pesan seperti di grup WhatsApp. Jika diaktifkan,
              hanya Admin yang dapat mengirim pesan di room tersebut.
            </p>

            <div className="mt-4 space-y-2.5">
              {snapshot.rooms.map((room) => (
                <div
                  key={room.id}
                  className="flex items-center justify-between rounded-btn border border-line bg-floor/40 p-3"
                >
                  <div>
                    <p className="text-xs font-bold text-ink">
                      {room.name || "Direct Message"}
                    </p>
                    <span className="text-[11px] font-semibold text-accent-text uppercase">
                      Tipe: {room.type}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      sendWsAction("admin:toggle_room_permission", {
                        room_id: room.id,
                        only_admins_can_send: !room.only_admins_can_send,
                      })
                    }
                    className={`flex items-center gap-1.5 rounded-btn px-3 py-1.5 text-xs font-semibold transition ${
                      room.only_admins_can_send
                        ? "bg-danger text-on-primary"
                        : "border border-line bg-bg text-ink hover:bg-primary-soft"
                    }`}
                  >
                    {room.only_admins_can_send ? (
                      <>
                        <LockIcon className="h-3.5 w-3.5" />
                        Hanya Admin
                      </>
                    ) : (
                      <>
                        <UnlockIcon className="h-3.5 w-3.5" />
                        Semua Member
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Konfigurasi & Uji Layanan SMTP */}
          <section className="rounded-card border border-line bg-bg p-5 shadow-soft">
            <div className="flex items-center gap-2 border-b border-line pb-3">
              <MailIcon className="h-4 w-4 text-primary" />
              <h3 className="text-base font-extrabold text-ink">
                Layanan SMTP &amp; Notifikasi Email
              </h3>
            </div>

            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between border-b border-line/40 py-1.5">
                <span className="text-muted">Host Relay:</span>
                <strong className="text-ink">
                  {snapshot.smtp_status?.host || "smtp.gmail.com"}
                </strong>
              </div>
              <div className="flex justify-between border-b border-line/40 py-1.5">
                <span className="text-muted">Port &amp; Enkripsi:</span>
                <strong className="text-ink">
                  {snapshot.smtp_status?.port || 587} (STARTTLS)
                </strong>
              </div>
              <div className="flex justify-between border-b border-line/40 py-1.5">
                <span className="text-muted">Akun Pengirim:</span>
                <strong className="truncate max-w-[200px] text-ink">
                  {snapshot.smtp_status?.user || "-"}
                </strong>
              </div>
            </div>

            <form onSubmit={handleTestSmtp} className="mt-4 space-y-2">
              <label className="text-[12px] font-semibold text-ink">
                Kirim Email Uji Coba
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  value={testEmailRecipient}
                  onChange={(e) => setTestEmailRecipient(e.target.value)}
                  placeholder="email.tujuan@gmail.com"
                  className="h-[44px] w-full rounded-btn border border-line bg-bg px-3 text-xs text-ink placeholder:text-subtle focus:border-primary focus:outline-none"
                />
                <Button
                  type="submit"
                  variant="outline"
                  className="!h-[44px] !w-auto !px-3.5 !text-xs whitespace-nowrap"
                >
                  <SendIcon className="h-3.5 w-3.5" />
                  Kirim Tes
                </Button>
              </div>
            </form>
          </section>

          {/* Log Aktivitas Terkini (Lintas Modul) */}
          <section className="rounded-card border border-line bg-bg p-5 shadow-soft">
            <div className="flex items-center gap-2 border-b border-line pb-3">
              <ActivityIcon className="h-4 w-4 text-primary" />
              <h3 className="text-base font-extrabold text-ink">
                Audit Log Aktivitas Terkini
              </h3>
            </div>

            <div className="mt-3 max-h-[280px] space-y-2 overflow-y-auto pr-1">
              {snapshot.activities.slice(0, 8).map((act) => (
                <div
                  key={act.id}
                  className="rounded-btn border border-line/60 bg-floor/30 p-2.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <strong className="text-ink">{act.actor_name}</strong>
                    <span className="text-[10px] text-subtle">
                      {new Date(act.created_at).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] font-medium text-muted">
                    {act.action.replace(/_/g, " ")}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
