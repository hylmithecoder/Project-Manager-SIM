"use client";

import { useEffect, useRef, useState } from "react";
import {
  BellIcon,
  BoardIcon,
  ChatIcon,
  LogoutIcon,
  MenuIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
} from "@/components/icons";
import { Avatar, RoleBadge, timeAgo, useWorkspace, type NavState } from "@/components/ui/kit";

const TAB_INFO: Record<NavState["tab"], { title: string; icon: React.ReactNode }> = {
  kanban: { title: "Papan Kanban & Tugas", icon: <BoardIcon className="h-4 w-4 text-primary" /> },
  chat: { title: "Chat Grup & Diskusi", icon: <ChatIcon className="h-4 w-4 text-primary" /> },
  user: { title: "Dashboard Saya", icon: <UserIcon className="h-4 w-4 text-primary" /> },
  admin: { title: "Kelola Workspace", icon: <ShieldIcon className="h-4 w-4 text-primary" /> },
  settings: { title: "Pengaturan Akun & Notifikasi", icon: <SettingsIcon className="h-4 w-4 text-primary" /> },
};

export function Navbar({
  connected,
  onLogout,
  onToggleSidebar,
}: {
  connected: boolean;
  onLogout: () => void;
  onToggleSidebar: () => void;
}) {
  const { snapshot, nav, navigate, run } = useWorkspace();
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const activeWs = snapshot.workspaces.find((w) => w.id === snapshot.active_workspace_id);
  const unread = snapshot.notifications.filter((n) => !n.is_read);
  const tab = TAB_INFO[nav.tab];

  useEffect(() => {
    if (!bellOpen) return;
    const close = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [bellOpen]);

  const openNotification = (n: (typeof snapshot.notifications)[number]) => {
    if (!n.is_read) run("notification:mark_read", { notification_id: n.id });
    if (n.ref_type === "card") {
      const card = snapshot.cards.find((c) => c.id === n.ref_id);
      if (card) navigate({ tab: "kanban", boardId: card.board_id, cardId: card.id });
    } else if (n.ref_type === "message") {
      const msg = snapshot.messages.find((m) => m.id === n.ref_id);
      if (msg) navigate({ tab: "chat", roomId: msg.room_id });
    } else if (n.ref_type === "workspace") {
      navigate({ tab: "admin" });
    }
    setBellOpen(false);
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between gap-3 border-b border-line bg-bg px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-card border border-line bg-floor text-ink hover:border-primary md:hidden"
          aria-label="Menu"
        >
          <MenuIcon className="h-4 w-4" />
        </button>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-primary text-xs font-bold text-on-primary">
          {(activeWs?.name || "W").slice(0, 2).toUpperCase()}
        </div>
        <div className="hidden min-w-0 sm:block">
          {snapshot.workspaces.length > 1 ? (
            <select
              value={snapshot.active_workspace_id || ""}
              onChange={(e) => run("workspace:select", { workspace_id: e.target.value })}
              className="max-w-56 cursor-pointer truncate bg-transparent text-xs font-bold text-ink focus:outline-none"
            >
              {snapshot.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="truncate text-xs font-bold">{activeWs?.name}</div>
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            {tab.icon}
            <span className="truncate">{tab.title}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <span className="hidden items-center gap-1.5 rounded-full border border-line bg-floor px-2.5 py-1 text-[11px] text-muted md:flex">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-success" : "animate-pulse bg-muted"}`} />
          {connected ? "Live" : "Menyambung ulang..."}
        </span>

        <div className="relative" ref={bellRef}>
          <button
            type="button"
            onClick={() => setBellOpen((v) => !v)}
            className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-card border border-line bg-bg text-ink hover:border-primary"
            aria-label="Notifikasi"
          >
            <BellIcon className="h-4 w-4" />
            {unread.length > 0 && (
              <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                {unread.length > 9 ? "9+" : unread.length}
              </span>
            )}
          </button>
          {bellOpen && (
            <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-line bg-bg shadow-soft">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <span className="text-xs font-bold">Notifikasi</span>
                {unread.length > 0 && (
                  <button type="button" onClick={() => run("notification:mark_read", {})} className="cursor-pointer text-[11px] font-semibold text-primary hover:underline">
                    Tandai semua dibaca
                  </button>
                )}
              </div>
              <div className="max-h-96 overflow-y-auto">
                {snapshot.notifications.length === 0 && <div className="p-4 text-center text-xs text-muted">Belum ada notifikasi.</div>}
                {snapshot.notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => openNotification(n)}
                    className={`block w-full cursor-pointer border-b border-line/60 px-4 py-2.5 text-left text-xs hover:bg-floor ${n.is_read ? "text-muted" : "bg-primary-soft/30 font-semibold text-ink"}`}
                  >
                    <div className="line-clamp-2">{n.title}</div>
                    <div className="mt-0.5 text-[10px] font-normal text-muted">{timeAgo(n.created_at)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => navigate({ tab: "settings" })}
          className="flex cursor-pointer items-center gap-2 rounded-card border border-line bg-floor/60 py-1.5 pr-2.5 pl-2 hover:border-primary"
        >
          <Avatar name={snapshot.me.name} size="sm" />
          <div className="hidden text-left lg:block">
            <div className="text-xs leading-tight font-semibold">{snapshot.me.name}</div>
            <div className="text-[10px] leading-tight text-muted">{snapshot.me.email}</div>
          </div>
          {activeWs && <RoleBadge role={activeWs.my_role} />}
        </button>

        <button
          type="button"
          onClick={onLogout}
          className="flex h-9 cursor-pointer items-center gap-1.5 rounded-card border border-line bg-bg px-3 text-xs font-medium text-ink hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
          title="Keluar"
        >
          <LogoutIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Keluar</span>
        </button>
      </div>
    </header>
  );
}
