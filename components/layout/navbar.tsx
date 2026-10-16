"use client";

import {
  BoardIcon,
  ChatIcon,
  LogoutIcon,
  MenuIcon,
  ShieldIcon,
  UserIcon,
} from "@/components/icons";
import type { UserDto } from "@/server/ws/protocol";

interface NavbarProps {
  currentUser: UserDto;
  currentRole: string;
  workspaceName: string;
  activeTab: "kanban" | "chat" | "user" | "admin";
  wsConnected: boolean;
  onLogout: () => void;
  onToggleSidebar?: () => void;
}

export function Navbar({
  currentUser,
  currentRole,
  workspaceName,
  activeTab,
  wsConnected,
  onLogout,
  onToggleSidebar,
}: NavbarProps) {
  const getTabLabel = () => {
    switch (activeTab) {
      case "kanban":
        return {
          title: "Papan Kanban & Tugas",
          icon: <BoardIcon className="h-4 w-4 text-primary" />,
        };
      case "chat":
        return {
          title: "Ruang Obrolan & Chat Diskusi",
          icon: <ChatIcon className="h-4 w-4 text-primary" />,
        };
      case "user":
        return {
          title: "Dashboard Saya (Tugas Personal)",
          icon: <UserIcon className="h-4 w-4 text-primary" />,
        };
      case "admin":
        return {
          title: "Dashboard Administrator & SMTP",
          icon: <ShieldIcon className="h-4 w-4 text-primary" />,
        };
      default:
        return {
          title: "Workspace",
          icon: <BoardIcon className="h-4 w-4 text-primary" />,
        };
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "owner":
        return {
          label: "Owner",
          className: "bg-primary text-on-primary",
        };
      case "admin":
        return {
          label: "Admin",
          className: "bg-primary-soft text-primary font-semibold",
        };
      case "member":
        return {
          label: "Member",
          className: "bg-floor text-muted border border-line",
        };
      default:
        return {
          label: "Guest",
          className: "bg-floor text-muted",
        };
    }
  };

  const currentTabInfo = getTabLabel();
  const roleBadge = getRoleBadge(currentRole);

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-line bg-bg px-4 md:px-6">
      {/* Kiri: Toggle Sidebar (Mobile) + Judul Workspace & Breadcrumb */}
      <div className="flex items-center gap-3 md:gap-4">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="flex h-9 w-9 items-center justify-center rounded-card border border-line bg-floor text-ink md:hidden hover:border-primary"
            aria-label="Toggle Menu"
          >
            <MenuIcon className="h-4 w-4" />
          </button>
        )}

        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-card bg-primary font-bold text-on-primary">
            AS
          </div>
          <div className="hidden sm:block">
            <div className="text-xs font-bold tracking-tight text-ink">
              {workspaceName || "Auto Smart Workspace"}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted">
              {currentTabInfo.icon}
              <span>{currentTabInfo.title}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Kanan: WebSocket Status + Profile + Logout */}
      <div className="flex items-center gap-2.5 sm:gap-4">
        {/* WebSocket Indicator */}
        <div className="hidden items-center gap-1.5 rounded-full border border-line bg-floor px-2.5 py-1 text-[11px] font-medium text-ink md:flex">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              wsConnected ? "bg-success" : "bg-muted animate-pulse"
            }`}
          />
          <span className="text-muted">
            {wsConnected ? "Live :5790" : "Offline"}
          </span>
        </div>

        {/* User Profile Info */}
        <div className="flex items-center gap-2.5 rounded-card border border-line bg-floor/60 py-1.5 pr-2.5 pl-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary">
            {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : "U"}
          </div>
          <div className="hidden text-left lg:block">
            <div className="text-xs font-semibold text-ink leading-tight">
              {currentUser.name}
            </div>
            <div className="text-[10px] text-muted leading-tight">
              {currentUser.email}
            </div>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${roleBadge.className}`}
          >
            {roleBadge.label}
          </span>
        </div>

        {/* Logout Button */}
        <button
          type="button"
          onClick={onLogout}
          className="flex h-9 items-center gap-1.5 rounded-card border border-line bg-bg px-3 text-xs font-medium text-ink transition hover:border-danger/40 hover:bg-danger/10 hover:text-danger active:scale-95"
          title="Keluar dari akun"
        >
          <LogoutIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Keluar</span>
        </button>
      </div>
    </header>
  );
}
