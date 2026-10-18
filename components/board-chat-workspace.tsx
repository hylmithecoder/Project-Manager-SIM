"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AdminDashboard } from "@/components/admin-dashboard";
import { InviteAcceptPage } from "@/components/auth/invite-accept-page";
import { LoginPage } from "@/components/auth/login-page";
import { ResetPasswordPage } from "@/components/auth/reset-password-page";
import { ChatRoomView } from "@/components/chat/chat-room-view";
import { DeveloperConsole } from "@/components/developer/developer-console";
import { KanbanBoardView } from "@/components/kanban/kanban-board-view";
import { AppLayout } from "@/components/layout/app-layout";
import { SettingsView } from "@/components/settings/settings-view";
import { WorkspaceProvider, outlineBtn, type NavState } from "@/components/ui/kit";
import { UserDashboard } from "@/components/user-dashboard";
import { useWorkspaceSocket } from "@/lib/use-workspace-socket";
import { BrowserNotificationOnboarding } from "@/components/browser-notification-onboarding";

const TABS: NavState["tab"][] = ["kanban", "chat", "user", "admin", "settings"];
const noopSubscribe = () => () => {};

function Splash({ text }: { text: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-floor font-sans">
      <div className="flex items-center gap-3 rounded-card border border-line bg-bg px-5 py-4 text-xs font-semibold text-muted shadow-soft">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
        {text}
      </div>
    </div>
  );
}

export function BoardChatWorkspace() {
  const { connected, authState, snapshot, request } = useWorkspaceSocket();
  // null during SSR / before hydration, so server and first client render match.
  const search = useSyncExternalStore(noopSubscribe, () => window.location.search, () => null);
  const params = useMemo(() => new URLSearchParams(search || ""), [search]);
  const [dismissedToken, setDismissedToken] = useState(false);
  const [navTouched, setNavTouched] = useState(false);
  const [nav, setNav] = useState<NavState>({ tab: "kanban", boardId: "", roomId: "", cardId: "" });

  // Deep links from email notifications (?workspace=&board=&card=&room=&tab=).
  const deepLink = useMemo<Partial<NavState>>(() => {
    const tab = params.get("tab") as NavState["tab"] | null;
    const room = params.get("room");
    const card = params.get("card");
    const board = params.get("board");
    return {
      ...(board ? { boardId: board } : {}),
      ...(card ? { cardId: card, tab: "kanban" as const } : {}),
      ...(room ? { roomId: room, tab: "chat" as const } : {}),
      ...(tab && TABS.includes(tab) ? { tab } : {}),
    };
  }, [params]);
  const effectiveNav = useMemo(() => (navTouched ? nav : { ...nav, ...deepLink }), [navTouched, nav, deepLink]);

  const navigate = useCallback(
    (next: Partial<NavState>) => {
      setNavTouched(true);
      setNav({ ...effectiveNav, ...next });
    },
    [effectiveNav],
  );

  const deepWorkspace = params.get("workspace");
  const activeWorkspaceId = snapshot?.active_workspace_id;
  const canSwitchToDeepWorkspace = Boolean(
    deepWorkspace && snapshot?.workspaces.some((w) => w.id === deepWorkspace),
  );
  useEffect(() => {
    if (!navTouched && canSwitchToDeepWorkspace && deepWorkspace && activeWorkspaceId && activeWorkspaceId !== deepWorkspace) {
      request("workspace:select", { workspace_id: deepWorkspace }).catch(() => undefined);
    }
  }, [navTouched, canSwitchToDeepWorkspace, deepWorkspace, activeWorkspaceId, request]);

  const clearTokenFromUrl = useCallback(() => {
    window.history.replaceState(null, "", window.location.pathname);
    setDismissedToken(true);
  }, []);

  const logout = useCallback(() => {
    request("auth:logout").catch(() => undefined);
    setNavTouched(true);
    setNav({ tab: "kanban", boardId: "", roomId: "", cardId: "" });
  }, [request]);

  if (search === null) return <Splash text="Memuat aplikasi..." />;

  const inviteToken = params.get("invite");
  const resetToken = params.get("reset");
  if (inviteToken && !dismissedToken) {
    return <InviteAcceptPage token={inviteToken} request={request} connected={connected} onDone={clearTokenFromUrl} />;
  }
  if (resetToken && !dismissedToken) {
    return <ResetPasswordPage token={resetToken} request={request} connected={connected} onDone={clearTokenFromUrl} />;
  }

  if (authState === "anonymous") return <LoginPage request={request} connected={connected} />;
  if (!snapshot) {
    return <Splash text={connected ? "Memuat workspace..." : "Menghubungkan ke server..."} />;
  }

  const providerValue = { snapshot, request, nav: effectiveNav, navigate };

  if (snapshot.me.platform_role === "developer") {
    return (
      <WorkspaceProvider value={providerValue}>
        <DeveloperConsole onLogout={logout} connected={connected} />
      </WorkspaceProvider>
    );
  }

  if (!snapshot.active_workspace_id) {
    return (
      <WorkspaceProvider value={providerValue}>
        {authState === "authenticated" && <BrowserNotificationOnboarding key={snapshot.me.id} userId={snapshot.me.id} />}
        <div className="min-h-dvh space-y-5 bg-floor p-4 font-sans text-ink md:p-8">
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="flex items-center justify-between rounded-card border border-line bg-bg p-5 shadow-soft">
              <div>
                <h1 className="text-lg font-bold">Halo, {snapshot.me.name}</h1>
                <p className="text-xs text-muted">
                  Akun Anda belum tergabung di workspace mana pun. Minta admin perusahaan mengirim undangan ke {snapshot.me.email}.
                </p>
              </div>
              <button type="button" className={outlineBtn} onClick={logout}>
                Keluar
              </button>
            </div>
            <SettingsView />
          </div>
        </div>
      </WorkspaceProvider>
    );
  }

  const activeWs = snapshot.workspaces.find((w) => w.id === snapshot.active_workspace_id);
  const isManager = activeWs?.my_role === "owner" || activeWs?.my_role === "admin";
  const tab = effectiveNav.tab === "admin" && !isManager ? "kanban" : effectiveNav.tab;

  return (
    <WorkspaceProvider value={providerValue}>
      {authState === "authenticated" && <BrowserNotificationOnboarding key={snapshot.me.id} userId={snapshot.me.id} />}
      <AppLayout connected={connected} onLogout={logout}>
        {tab === "kanban" && <KanbanBoardView />}
        {tab === "chat" && <ChatRoomView />}
        {tab === "user" && <UserDashboard />}
        {tab === "admin" && <AdminDashboard />}
        {tab === "settings" && <SettingsView />}
      </AppLayout>
    </WorkspaceProvider>
  );
}
