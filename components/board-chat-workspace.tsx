"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminDashboard } from "@/components/admin-dashboard";
import { LoginPage } from "@/components/auth/login-page";
import { ChatRoomView } from "@/components/chat/chat-room-view";
import { KanbanBoardView } from "@/components/kanban/kanban-board-view";
import { AppLayout } from "@/components/layout/app-layout";
import type { SidebarTab } from "@/components/layout/sidebar";
import { UserDashboard } from "@/components/user-dashboard";
import type {
  UserDto,
  WorkspaceSnapshot,
  WsAction,
  WsBroadcastEvent,
  WsResponseMessage,
} from "@/server/ws/protocol";

function generateUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function resolveWsUrl(): string {
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    if (window.location.port && window.location.port !== "3000") {
      return `${proto}//${window.location.host}/ws`;
    }
    return (
      process.env.NEXT_PUBLIC_WS_URL ||
      `${proto}//${window.location.hostname}:5790/ws`
    );
  }
  return process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:5790/ws";
}

export function BoardChatWorkspace() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<SidebarTab>("kanban");

  // Authentication State
  const [activeUserId, setActiveUserId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("pm_active_user_id");
      if (saved) return saved;
    }
    return "";
  });

  const [activeBoardId, setActiveBoardId] = useState<string>("");
  const [activeRoomId, setActiveRoomId] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  // Enforce Clean Isometric Blue theme
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", "default");
    }
  }, []);

  const initialJoinEmail = useMemo(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("join_email") || "";
    }
    return "";
  }, []);


  const currentUser: UserDto | null = useMemo(() => {
    if (!activeUserId || !snapshot?.users) return null;
    return snapshot.users.find((u) => u.id === activeUserId) || null;
  }, [activeUserId, snapshot]);

  const currentUserRole = useMemo(() => {
    if (!currentUser || !snapshot?.workspace_members) return "member";
    const member = snapshot.workspace_members.find(
      (m) => m.user_id === currentUser.id,
    );
    return member?.role || "member";
  }, [currentUser, snapshot]);

  const isCurrentUserAdmin =
    currentUserRole === "admin" || currentUserRole === "owner";

  const sendWsAction = useCallback(
    (action: WsAction, payload: Record<string, unknown> = {}) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setStatusMessage("WebSocket belum terhubung ke server Bun (port 5790).");
        return;
      }

      const req = {
        id: generateUuid(),
        action,
        payload: {
          actor_id: activeUserId || undefined,
          ...payload,
        },
      };
      ws.send(JSON.stringify(req));
    },
    [activeUserId],
  );

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    function connect() {
      if (unmounted) return;
      const ws = new WebSocket(resolveWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted) return;
        setWsConnected(true);
        setStatusMessage(null);
      };

      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(String(evt.data)) as
            | WsBroadcastEvent
            | WsResponseMessage;

          if ("type" in parsed && parsed.type === "event" && parsed.snapshot) {
            setSnapshot(parsed.snapshot);
            if (initialJoinEmail) {
              const matching = parsed.snapshot.users.find(
                (u) => u.email.toLowerCase() === initialJoinEmail.toLowerCase(),
              );
              if (matching) {
                setActiveUserId(matching.id);
                if (typeof window !== "undefined") {
                  localStorage.setItem("pm_active_user_id", matching.id);
                }
              }
            }
          } else if (
            "type" in parsed &&
            parsed.type === "response" &&
            !parsed.ok
          ) {
            setStatusMessage(parsed.error || "Operasi gagal dijalankan");
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        setWsConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [initialJoinEmail]);

  const activeBoard = useMemo(() => {
    if (!snapshot?.boards?.length) return null;
    return (
      snapshot.boards.find((b) => b.id === activeBoardId) ||
      snapshot.boards[0] ||
      null
    );
  }, [snapshot, activeBoardId]);

  const activeRoom = useMemo(() => {
    if (!snapshot?.rooms?.length) return null;
    return (
      snapshot.rooms.find((r) => r.id === activeRoomId) ||
      snapshot.rooms[0] ||
      null
    );
  }, [snapshot, activeRoomId]);

  const handleSelectUser = (user: UserDto) => {
    setActiveUserId(user.id);
    if (typeof window !== "undefined") {
      localStorage.setItem("pm_active_user_id", user.id);
    }
  };

  const handleLogout = () => {
    setActiveUserId("");
    if (typeof window !== "undefined") {
      localStorage.removeItem("pm_active_user_id");
    }
  };

  const handleEmailLogin = (email: string) => {
    const trimmed = email.trim().toLowerCase();
    const existing = snapshot?.users?.find(
      (u) => u.email.toLowerCase() === trimmed,
    );
    if (existing) {
      handleSelectUser(existing);
      return;
    }

    // Auto-provision via workspace:invite_member if not existing
    sendWsAction("workspace:invite_member", {
      email: trimmed,
      role: "member",
    });
    setStatusMessage(
      `Sedang mendaftarkan ${trimmed} dan menyambungkan ke workspace...`,
    );
  };

  // If user is not authenticated, render LoginPage
  if (!currentUser) {
    return (
      <LoginPage
        users={snapshot?.users || []}
        workspaceMembers={snapshot?.workspace_members || []}
        onSelectUser={handleSelectUser}
        onLoginWithEmail={handleEmailLogin}
        initialEmail={initialJoinEmail}
        wsConnected={wsConnected}
      />
    );
  }

  // If authenticated, render full modern AppLayout with Navbar & Sidebar
  return (
    <AppLayout
      currentUser={currentUser}
      currentRole={currentUserRole}
      workspaceName={snapshot?.workspaces?.[0]?.name || "Auto Smart Workspace"}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      isAdminOrOwner={isCurrentUserAdmin}
      rooms={snapshot?.rooms || []}
      activeRoomId={activeRoom?.id || ""}
      onSelectRoom={setActiveRoomId}
      boards={snapshot?.boards || []}
      activeBoardId={activeBoard?.id || ""}
      onSelectBoard={setActiveBoardId}
      memberCount={snapshot?.workspace_members?.length || 0}
      wsConnected={wsConnected}
      onLogout={handleLogout}
    >
      {statusMessage && (
        <div className="mb-4 flex items-center justify-between rounded-card border border-primary/20 bg-primary-soft/50 px-4 py-2.5 text-xs font-semibold text-primary">
          <span>{statusMessage}</span>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-[11px] underline hover:text-ink"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Render selected view according to sidebar tab */}
      {activeTab === "kanban" && snapshot && (
        <KanbanBoardView
          snapshot={snapshot}
          activeBoard={activeBoard}
          onSelectBoard={setActiveBoardId}
          sendWsAction={sendWsAction}
        />
      )}

      {activeTab === "chat" && snapshot && (
        <ChatRoomView
          snapshot={snapshot}
          activeRoom={activeRoom}
          onSelectRoom={setActiveRoomId}
          currentUserId={currentUser.id}
          isCurrentUserAdmin={isCurrentUserAdmin}
          sendWsAction={sendWsAction}
        />
      )}

      {activeTab === "user" && snapshot && (
        <UserDashboard
          snapshot={snapshot}
          currentUserId={currentUser.id}
          sendWsAction={sendWsAction}
        />
      )}

      {activeTab === "admin" && snapshot && (
        <AdminDashboard
          snapshot={snapshot}
          currentUserId={currentUser.id}
          sendWsAction={sendWsAction}
        />
      )}
    </AppLayout>
  );
}
