"use client";

import { useState } from "react";
import { Navbar } from "@/components/layout/navbar";
import { Sidebar, type SidebarTab } from "@/components/layout/sidebar";
import type { BoardDto, RoomDto, UserDto } from "@/server/ws/protocol";

interface AppLayoutProps {
  currentUser: UserDto;
  currentRole: string;
  workspaceName: string;
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
  wsConnected: boolean;
  onLogout: () => void;
  children: React.ReactNode;
}

export function AppLayout({
  currentUser,
  currentRole,
  workspaceName,
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
  wsConnected,
  onLogout,
  children,
}: AppLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div
      data-theme="default"
      className="flex min-h-screen w-full flex-col bg-floor font-sans text-ink"
    >
      {/* Top Navbar */}
      <Navbar
        currentUser={currentUser}
        currentRole={currentRole}
        workspaceName={workspaceName}
        activeTab={activeTab}
        wsConnected={wsConnected}
        onLogout={onLogout}
        onToggleSidebar={() => setMobileMenuOpen((prev) => !prev)}
      />

      {/* Main Container with Sidebar + Content */}
      <div className="flex h-[calc(100vh-4rem)] w-full overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          onSelectTab={onSelectTab}
          isAdminOrOwner={isAdminOrOwner}
          rooms={rooms}
          activeRoomId={activeRoomId}
          onSelectRoom={onSelectRoom}
          boards={boards}
          activeBoardId={activeBoardId}
          onSelectBoard={onSelectBoard}
          memberCount={memberCount}
          isOpenMobile={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />

        {/* Scrollable View Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
