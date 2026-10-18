"use client";

import { useState } from "react";
import { BellIcon, LockIcon, MailIcon, UserIcon } from "@/components/icons";
import { Toggle, cardClass, inputClass, primaryBtn, useWorkspace } from "@/components/ui/kit";

/** Profile, password and per-user email notification preferences. */
export function SettingsView() {
  const { snapshot, run } = useWorkspace();
  const me = snapshot.me;
  const activeWs = snapshot.workspaces.find((w) => w.id === snapshot.active_workspace_id);
  const [name, setName] = useState(me.name);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  const prefs = [
    {
      key: "notify_chat_email",
      title: "Email semua pesan chat",
      desc: "Kirim setiap pesan baru di ruang chat Anda ke Gmail, walaupun Anda tidak di-tag.",
      value: me.notify_chat_email,
      blockedBy: activeWs && !activeWs.email_chat_enabled ? "Admin menonaktifkan email chat untuk workspace ini." : null,
    },
    {
      key: "notify_mention_email",
      title: "Email saat di-tag (@nama)",
      desc: "Tetap dikirim walaupun email semua pesan chat dimatikan.",
      value: me.notify_mention_email,
      blockedBy: null,
    },
    {
      key: "notify_activity_email",
      title: "Email aktivitas workspace",
      desc: "Card baru/dipindah/selesai, penugasan, checklist, deadline, anggota baru, dan aktivitas lain.",
      value: me.notify_activity_email,
      blockedBy:
        activeWs && !activeWs.email_activity_enabled ? "Admin menonaktifkan email aktivitas untuk workspace ini." : null,
    },
  ] as const;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className={`${cardClass} space-y-4 lg:row-span-2`}>
        <div className="flex items-center gap-2">
          <BellIcon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold">Notifikasi Email (Gmail)</h2>
        </div>
        <p className="text-[11px] text-muted">
          Dikirim ke <strong className="text-ink">{me.email}</strong>. Setiap fitur memakai format email sendiri.
        </p>
        <div className="divide-y divide-line">
          {prefs.map((p) => (
            <div key={p.key} className="flex items-start justify-between gap-4 py-3">
              <div>
                <div className="text-xs font-semibold">{p.title}</div>
                <div className="text-[11px] text-muted">{p.desc}</div>
                {p.blockedBy && <div className="mt-1 text-[11px] font-semibold text-[#a87400]">{p.blockedBy}</div>}
              </div>
              <Toggle checked={p.value} onChange={(v) => run("account:update_preferences", { [p.key]: v }, "Pengaturan notifikasi disimpan")} />
            </div>
          ))}
        </div>
      </div>

      <form
        className={`${cardClass} space-y-3`}
        onSubmit={(e) => {
          e.preventDefault();
          run("account:update_profile", { name }, "Profil disimpan");
        }}
      >
        <div className="flex items-center gap-2">
          <UserIcon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold">Profil</h2>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Nama</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <MailIcon className="h-3.5 w-3.5" /> {me.email}
        </div>
        <button type="submit" className={primaryBtn} disabled={name.trim() === me.name}>
          Simpan Profil
        </button>
      </form>

      <form
        className={`${cardClass} space-y-3`}
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await run("account:change_password", { current_password: current, new_password: next }, "Password diganti. Perangkat lain telah dikeluarkan.");
          if (res) {
            setCurrent("");
            setNext("");
          }
        }}
      >
        <div className="flex items-center gap-2">
          <LockIcon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold">Ganti Password</h2>
        </div>
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Password saat ini" className={inputClass} />
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Password baru (min. 8 karakter)" className={inputClass} />
        <button type="submit" className={primaryBtn} disabled={!current || next.length < 8}>
          Ganti Password
        </button>
      </form>
    </div>
  );
}
