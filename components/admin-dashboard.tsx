"use client";

import { useState } from "react";
import { ActivityIcon, LockIcon, MailIcon, SendIcon, SettingsIcon, UnlockIcon, UsersIcon } from "@/components/icons";
import { roomTitle } from "@/components/layout/sidebar";
import {
  Avatar,
  RoleBadge,
  Toggle,
  cardClass,
  dangerBtn,
  dueStatus,
  formatDate,
  inputClass,
  outlineBtn,
  primaryBtn,
  timeAgo,
  useWorkspace,
} from "@/components/ui/kit";
import type { WorkspaceRole } from "@/server/ws/protocol";

/** Workspace management for the company leader (owner) and admins. */
export function AdminDashboard() {
  const { snapshot, run } = useWorkspace();
  const ws = snapshot.workspaces.find((w) => w.id === snapshot.active_workspace_id);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [wsName, setWsName] = useState(ws?.name || "");
  if (!ws) return null;
  const myRole = ws.my_role;
  const openCards = snapshot.cards.filter((c) => !c.completed_at);
  const overdue = openCards.filter((c) => dueStatus(c.due_at, null) === "overdue");

  const canChangeRole = (target: WorkspaceRole, userId: string) =>
    userId !== snapshot.me.id && target !== "owner" && (myRole === "owner" || target !== "admin");

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Anggota", value: snapshot.workspace_members.length },
          { label: "Undangan tertunda", value: snapshot.invitations.length },
          { label: "Tugas terbuka", value: openCards.length },
          { label: "Lewat deadline", value: overdue.length },
        ].map((s) => (
          <div key={s.label} className={cardClass}>
            <div className="text-[11px] font-semibold text-muted">{s.label}</div>
            <div className="mt-1 text-2xl font-bold">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <form
          className={`${cardClass} space-y-3`}
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await run(
              "workspace:invite_member",
              { workspace_id: ws.id, email: inviteEmail, role: inviteRole },
              `Undangan dikirim ke ${inviteEmail}`,
            );
            if (res) setInviteEmail("");
          }}
        >
          <div className="flex items-center gap-2">
            <MailIcon className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold">Undang Anggota</h2>
          </div>
          <p className="text-[11px] text-muted">
            Penerima mendapat email berisi tautan untuk membuat akun (nama & password). Anda akan diberi tahu lewat email
            saat undangan diterima.
          </p>
          <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="email@gmail.com" className={inputClass} />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)} className={inputClass}>
            <option value="member">Anggota (user biasa)</option>
            <option value="guest">Tamu (lihat & chat saja)</option>
            <option value="admin">Admin workspace</option>
          </select>
          <button type="submit" className={`${primaryBtn} w-full`} disabled={!inviteEmail.trim()}>
            <SendIcon className="h-3.5 w-3.5" /> Kirim Undangan
          </button>

          {snapshot.invitations.length > 0 && (
            <div className="space-y-2 border-t border-line pt-3">
              <div className="text-[11px] font-bold text-muted uppercase">Menunggu diterima</div>
              {snapshot.invitations.map((inv) => (
                <div key={inv.id} className="space-y-1 rounded-lg border border-line p-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{inv.email}</span>
                    {inv.role && <RoleBadge role={inv.role} />}
                  </div>
                  <div className="text-muted">
                    oleh {inv.created_by_name || "-"} · berlaku s/d {formatDate(inv.expires_at)}
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" className={outlineBtn} onClick={() => run("invite:resend", { invitation_id: inv.id }, "Undangan dikirim ulang")}>
                      Kirim ulang
                    </button>
                    <button type="button" className={dangerBtn} onClick={() => run("invite:revoke", { invitation_id: inv.id }, "Undangan dibatalkan")}>
                      Batalkan
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </form>

        <div className={`${cardClass} space-y-3 lg:col-span-2`}>
          <div className="flex items-center gap-2">
            <UsersIcon className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold">Anggota Workspace</h2>
          </div>
          <div className="divide-y divide-line">
            {snapshot.workspace_members.map((m) => {
              const user = snapshot.users.find((u) => u.id === m.user_id);
              const editable = canChangeRole(m.role, m.user_id);
              return (
                <div key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={m.user_name} online={user?.online} />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">
                        {m.user_name} {m.user_id === snapshot.me.id && <span className="text-muted">(Anda)</span>}
                      </div>
                      <div className="truncate text-[11px] text-muted">
                        {m.user_email} · {user?.online ? "online" : `aktif ${timeAgo(user?.last_seen_at)}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {editable ? (
                      <select
                        value={m.role}
                        onChange={(e) => run("admin:update_member_role", { workspace_id: ws.id, user_id: m.user_id, role: e.target.value }, "Peran diperbarui")}
                        className="h-8 cursor-pointer rounded-lg border border-line bg-bg px-2 text-[11px]"
                      >
                        {myRole === "owner" && <option value="admin">Admin</option>}
                        <option value="member">Anggota</option>
                        <option value="guest">Tamu</option>
                      </select>
                    ) : (
                      <RoleBadge role={m.role} />
                    )}
                    {editable && (
                      <button
                        type="button"
                        className={dangerBtn}
                        onClick={() => window.confirm(`Keluarkan ${m.user_name} dari workspace?`) && run("workspace:remove_member", { workspace_id: ws.id, user_id: m.user_id }, "Anggota dikeluarkan")}
                      >
                        Keluarkan
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className={`${cardClass} space-y-3`}>
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold">Pengaturan Workspace</h2>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run("workspace:update_settings", { workspace_id: ws.id, name: wsName }, "Nama workspace disimpan");
            }}
          >
            <input value={wsName} onChange={(e) => setWsName(e.target.value)} className={inputClass} />
            <button type="submit" className={outlineBtn}>
              Simpan
            </button>
          </form>
          <div className="flex items-start justify-between gap-4 border-t border-line pt-3">
            <div>
              <div className="text-xs font-semibold">Email untuk pesan chat</div>
              <div className="text-[11px] text-muted">
                Jika aktif, anggota yang mengizinkan &quot;email semua pesan chat&quot; menerima email untuk setiap pesan. Tag (@nama)
                tetap dikirim walau ini dimatikan.
              </div>
            </div>
            <Toggle checked={ws.email_chat_enabled} onChange={(v) => run("workspace:update_settings", { workspace_id: ws.id, email_chat_enabled: v }, "Pengaturan disimpan")} />
          </div>
          <div className="flex items-start justify-between gap-4 border-t border-line pt-3">
            <div>
              <div className="text-xs font-semibold">Email untuk aktivitas workspace</div>
              <div className="text-[11px] text-muted">Card, penugasan, checklist, deadline, board, anggota, dan lainnya.</div>
            </div>
            <Toggle checked={ws.email_activity_enabled} onChange={(v) => run("workspace:update_settings", { workspace_id: ws.id, email_activity_enabled: v }, "Pengaturan disimpan")} />
          </div>
          {snapshot.smtp_status && (
            <div className="rounded-lg bg-floor p-2.5 text-[11px] text-muted">
              <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${snapshot.smtp_status.enabled ? "bg-success" : "bg-danger"}`} />
              {snapshot.smtp_status.message}
            </div>
          )}
        </div>

        <div className={`${cardClass} space-y-3`}>
          <div className="flex items-center gap-2">
            <LockIcon className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold">Izin Ruang Chat</h2>
          </div>
          <div className="divide-y divide-line">
            {snapshot.rooms
              .filter((r) => r.type !== "direct")
              .map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                  <span className="flex items-center gap-2 truncate">
                    {r.only_admins_can_send ? <LockIcon className="h-3.5 w-3.5 text-danger" /> : <UnlockIcon className="h-3.5 w-3.5 text-success" />}
                    {roomTitle(r, snapshot.users, snapshot.me.id)}
                  </span>
                  <label className="flex items-center gap-2 text-[11px] text-muted">
                    Hanya admin
                    <Toggle checked={r.only_admins_can_send} onChange={(v) => run("admin:toggle_room_permission", { room_id: r.id, only_admins_can_send: v })} />
                  </label>
                </div>
              ))}
          </div>
        </div>
      </div>

      <div className={`${cardClass} space-y-2`}>
        <div className="flex items-center gap-2">
          <ActivityIcon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold">Log Aktivitas</h2>
        </div>
        <div className="max-h-80 divide-y divide-line overflow-y-auto">
          {snapshot.activities.slice(0, 40).map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 py-1.5 text-[11px]">
              <span>
                <strong>{a.actor_name}</strong> <span className="text-muted">{a.action.replace(/_/g, " ")}</span>{" "}
                <span className="text-subtle">· {snapshot.boards.find((b) => b.id === a.board_id)?.name}</span>
              </span>
              <span className="shrink-0 text-subtle">{timeAgo(a.created_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
