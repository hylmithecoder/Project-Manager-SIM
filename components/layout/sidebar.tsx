"use client";

import {
  BoardIcon,
  ChatIcon,
  CloseIcon,
  FolderIcon,
  LockIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
} from "@/components/icons";
import type { BoardDto, RoomDto } from "@/server/ws/protocol";

export type SidebarTab = "kanban" | "chat" | "user" | "admin";

interface SidebarProps {
  activeTab: SidebarTab;
  onSelectTab: (tab: SidebarTab) => void;
  isAdminOrOwner: boolean;
  rooms: RoomDto[];
  activeRoomId: string;
  onSelectRoom: (roomId: string) => void;
  boards: BoardDto[];
  activeBoardId: string;
  onSelectBoard: (boardId: string) => void;
  memberCount: number;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
}

export function Sidebar({
  activeTab,
  onSelectTab,
  isAdminOrOwner,
  rooms,
  activeRoomId,
  onSelectRoom,
  boards,
  activeBoardId,
  onSelectBoard,
  memberCount,
  isOpenMobile = false,
  onCloseMobile,
}: SidebarProps) {
  const navItems: {
    id: SidebarTab;
    label: string;
    icon: React.ReactNode;
    badge?: string;
    restricted?: boolean;
  }[] = [
    {
      id: "kanban",
      label: "Papan Kanban",
      icon: <BoardIcon className="h-4 w-4" />,
    },
    {
      id: "chat",
      label: "Chat Grup",
      icon: <ChatIcon className="h-4 w-4" />,
    },
    {
      id: "user",
      label: "Dashboard Saya",
      icon: <UserIcon className="h-4 w-4" />,
    },
    {
      id: "admin",
      label: "Dashboard Admin",
      icon: <ShieldIcon className="h-4 w-4" />,
      badge: isAdminOrOwner ? "Admin" : "Terkunci",
      restricted: !isAdminOrOwner,
    },
  ];

  const content = (
    <div className="flex h-full w-64 flex-col justify-between border-r border-line bg-bg p-4 font-sans text-ink">
      {/* Top: Menu Items */}
      <div className="space-y-6 overflow-y-auto pr-1">
        {/* Mobile Header with Close Button */}
        <div className="flex items-center justify-between pb-2 md:hidden border-b border-line">
          <div className="text-xs font-bold uppercase tracking-wider text-muted">
            Menu Navigasi
          </div>
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="flex h-7 w-7 items-center justify-center rounded-card border border-line bg-floor text-muted hover:text-ink"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Main Nav */}
        <div className="space-y-1">
          <div className="px-2 pb-1.5 text-[10px] font-bold tracking-wider text-muted uppercase">
            Menu Utama
          </div>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectTab(item.id);
                  if (onCloseMobile) onCloseMobile();
                }}
                className={`flex w-full items-center justify-between rounded-card px-3 py-2 text-xs font-semibold transition ${
                  isActive
                    ? "bg-primary text-on-primary"
                    : "text-ink hover:bg-primary-soft/40 hover:text-primary"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className={isActive ? "text-on-primary" : "text-muted"}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      isActive
                        ? "bg-on-primary/20 text-on-primary"
                        : item.restricted
                          ? "bg-floor text-muted"
                          : "bg-primary-soft text-primary"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Boards Section */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 pb-1.5 text-[10px] font-bold tracking-wider text-muted uppercase">
            <span>Papan Proyek</span>
            <span className="rounded bg-floor px-1.5 py-0.2 text-[10px] text-muted">
              {boards.length}
            </span>
          </div>
          <div className="space-y-0.5">
            {boards.map((b) => {
              const isSelected = activeBoardId === b.id && activeTab === "kanban";
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    onSelectBoard(b.id);
                    onSelectTab("kanban");
                    if (onCloseMobile) onCloseMobile();
                  }}
                  className={`flex w-full items-center gap-2 rounded-card px-3 py-1.5 text-xs text-left transition ${
                    isSelected
                      ? "border border-primary/30 bg-primary-soft/50 font-semibold text-primary"
                      : "text-ink hover:bg-floor hover:text-primary"
                  }`}
                >
                  <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <span className="truncate">{b.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Chat Rooms Section */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 pb-1.5 text-[10px] font-bold tracking-wider text-muted uppercase">
            <span>Ruang Obrolan</span>
            <span className="rounded bg-floor px-1.5 py-0.2 text-[10px] text-muted">
              {rooms.length}
            </span>
          </div>
          <div className="space-y-0.5">
            {rooms.map((r) => {
              const isSelected = activeRoomId === r.id && activeTab === "chat";
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    onSelectRoom(r.id);
                    onSelectTab("chat");
                    if (onCloseMobile) onCloseMobile();
                  }}
                  className={`flex w-full items-center justify-between rounded-card px-3 py-1.5 text-xs text-left transition ${
                    isSelected
                      ? "border border-primary/30 bg-primary-soft/50 font-semibold text-primary"
                      : "text-ink hover:bg-floor hover:text-primary"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-muted font-mono text-[11px]">#</span>
                    <span className="truncate">{r.name}</span>
                  </div>
                  {r.only_admins_can_send && (
                    <span title="Hanya admin yang dapat mengirim pesan">
                      <LockIcon className="h-3 w-3 shrink-0 text-danger" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom: Workspace Stats */}
      <div className="border-t border-line pt-3 text-xs space-y-2">
        <div className="flex items-center justify-between rounded-card border border-line bg-floor/60 p-2 text-xs">
          <div className="flex items-center gap-2 text-ink">
            <UsersIcon className="h-4 w-4 text-primary" />
            <span className="font-semibold text-xs">Anggota Tim</span>
          </div>
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-primary">
            {memberCount}
          </span>
        </div>
        <div className="text-[10px] text-muted text-center">
          Auto Smart Workspace • v1.0
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar: Always Visible */}
      <aside className="hidden h-[calc(100vh-4rem)] shrink-0 md:block">
        {content}
      </aside>

      {/* Mobile Drawer Backdrop */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs md:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Mobile Sidebar Overlay */}
      <div
        className={`fixed inset-y-0 left-0 z-50 transform bg-bg transition-transform duration-200 ease-in-out md:hidden ${
          isOpenMobile ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {content}
      </div>
    </>
  );
}
