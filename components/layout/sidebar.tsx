"use client";

import {
  BoardIcon,
  ChatIcon,
  CloseIcon,
  FolderIcon,
  LockIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
} from "@/components/icons";
import { useWorkspace, type NavState } from "@/components/ui/kit";
import type { RoomDto, UserDto } from "@/server/ws/protocol";

export type SidebarTab = NavState["tab"];

export function roomTitle(room: RoomDto, users: UserDto[], meId: string): string {
  if (room.type === "direct") {
    const other = users.find((u) => room.member_ids.includes(u.id) && u.id !== meId);
    return other?.name || "Pesan langsung";
  }
  return room.name || "Ruang chat";
}

export function Sidebar({ isOpenMobile, onCloseMobile }: { isOpenMobile: boolean; onCloseMobile: () => void }) {
  const { snapshot, nav, navigate } = useWorkspace();
  const activeWs = snapshot.workspaces.find((w) => w.id === snapshot.active_workspace_id);
  const isManager = activeWs?.my_role === "owner" || activeWs?.my_role === "admin";
  const onlineCount = snapshot.users.filter((u) => u.online).length;
  const totalUnread = snapshot.rooms.reduce((n, r) => n + r.unread_count, 0);

  const go = (next: Partial<NavState>) => {
    navigate(next);
    onCloseMobile();
  };

  const navItems: { id: SidebarTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "kanban", label: "Papan Kanban", icon: <BoardIcon className="h-4 w-4" /> },
    { id: "chat", label: "Chat Grup", icon: <ChatIcon className="h-4 w-4" />, badge: totalUnread },
    { id: "user", label: "Dashboard Saya", icon: <UserIcon className="h-4 w-4" /> },
    ...(isManager ? [{ id: "admin" as const, label: "Kelola Workspace", icon: <ShieldIcon className="h-4 w-4" /> }] : []),
    { id: "settings", label: "Pengaturan", icon: <SettingsIcon className="h-4 w-4" /> },
  ];

  const groups: { label: string; rooms: RoomDto[] }[] = [
    { label: "Grup", rooms: snapshot.rooms.filter((r) => r.type === "group") },
    { label: "Diskusi Board", rooms: snapshot.rooms.filter((r) => r.type === "board") },
    { label: "Thread Card", rooms: snapshot.rooms.filter((r) => r.type === "card") },
    { label: "Pesan Langsung", rooms: snapshot.rooms.filter((r) => r.type === "direct") },
  ];

  const content = (
    <div className="flex h-full w-64 flex-col justify-between border-r border-line bg-bg p-4 font-sans text-ink">
      <div className="space-y-5 overflow-y-auto pr-1">
        <div className="flex items-center justify-between border-b border-line pb-2 md:hidden">
          <div className="text-xs font-bold tracking-wider text-muted uppercase">Menu</div>
          <button type="button" onClick={onCloseMobile} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-card border border-line bg-floor text-muted">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-1">
          {navItems.map((item) => {
            const active = nav.tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go({ tab: item.id })}
                className={`flex w-full cursor-pointer items-center justify-between rounded-card px-3 py-2 text-xs font-semibold transition ${
                  active ? "bg-primary text-on-primary" : "text-ink hover:bg-primary-soft/40 hover:text-primary"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span className={active ? "text-on-primary" : "text-muted"}>{item.icon}</span>
                  {item.label}
                </span>
                {!!item.badge && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${active ? "bg-on-primary/20" : "bg-danger text-white"}`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 pb-1 text-[10px] font-bold tracking-wider text-muted uppercase">
            <span>Board</span>
            <span>{snapshot.boards.length}</span>
          </div>
          {snapshot.boards.map((b) => {
            const selected = nav.tab === "kanban" && nav.boardId === b.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => go({ tab: "kanban", boardId: b.id })}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-card px-3 py-1.5 text-left text-xs transition ${
                  selected ? "border border-primary/30 bg-primary-soft/50 font-semibold text-primary" : "text-ink hover:bg-floor hover:text-primary"
                }`}
              >
                <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="truncate">{b.name}</span>
                {b.visibility === "private" && <LockIcon className="ml-auto h-3 w-3 shrink-0 text-muted" />}
              </button>
            );
          })}
        </div>

        {groups
          .filter((g) => g.rooms.length > 0)
          .map((g) => (
            <div key={g.label} className="space-y-1">
              <div className="px-2 pb-1 text-[10px] font-bold tracking-wider text-muted uppercase">{g.label}</div>
              {g.rooms.map((r) => {
                const selected = nav.tab === "chat" && nav.roomId === r.id;
                const title = roomTitle(r, snapshot.users, snapshot.me.id);
                const other = r.type === "direct" ? snapshot.users.find((u) => r.member_ids.includes(u.id) && u.id !== snapshot.me.id) : null;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => go({ tab: "chat", roomId: r.id })}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-card px-3 py-1.5 text-left text-xs transition ${
                      selected ? "border border-primary/30 bg-primary-soft/50 font-semibold text-primary" : "text-ink hover:bg-floor hover:text-primary"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {other ? (
                        <span className={`h-2 w-2 shrink-0 rounded-full ${other.online ? "bg-success" : "bg-subtle"}`} />
                      ) : (
                        <span className="font-mono text-[11px] text-muted">#</span>
                      )}
                      <span className={`truncate ${r.unread_count ? "font-bold" : ""}`}>{title}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {r.only_admins_can_send && <LockIcon className="h-3 w-3 text-danger" />}
                      {r.unread_count > 0 && (
                        <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-on-primary">{r.unread_count}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
      </div>

      <div className="space-y-2 border-t border-line pt-3">
        <div className="flex items-center justify-between rounded-card border border-line bg-floor/60 p-2 text-xs">
          <span className="flex items-center gap-2 font-semibold">
            <UsersIcon className="h-4 w-4 text-primary" />
            Anggota
          </span>
          <span className="text-[11px] text-muted">
            <span className="font-bold text-success">{onlineCount}</span> online / {snapshot.users.length}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden h-[calc(100dvh-4rem)] shrink-0 md:block">{content}</aside>
      {isOpenMobile && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onCloseMobile} />}
      <div className={`fixed inset-y-0 left-0 z-50 bg-bg transition-transform duration-200 md:hidden ${isOpenMobile ? "translate-x-0" : "-translate-x-full"}`}>
        {content}
      </div>
    </>
  );
}
