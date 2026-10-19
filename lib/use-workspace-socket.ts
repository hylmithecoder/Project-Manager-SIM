"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AuthResultDto,
  WorkspaceSnapshot,
  WsAction,
  WsBroadcastEvent,
  WsResponseMessage,
} from "@/server/ws/protocol";
import { resolveWsUrl } from "./ws-url";
import { showBrowserNotification } from "./browser-notifications";

const TOKEN_KEY = "pm_session_token";
const WORKSPACE_KEY = "pm_active_workspace";

export type RequestFn = <T = unknown>(
  action: WsAction,
  payload?: Record<string, unknown>,
) => Promise<T>;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type AuthState = "connecting" | "restoring" | "anonymous" | "authenticated";

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Owns the single WebSocket: reconnects with backoff, restores the session
 * token after every reconnect, and exposes promise-based requests so forms
 * can show server errors inline.
 */
export function useWorkspaceSocket() {
  const [connected, setConnected] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("connecting");
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [lastEvent, setLastEvent] = useState<WsBroadcastEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const notificationUser = useRef<string | null>(null);

  const rawRequest = useCallback(
    <T,>(action: WsAction, payload: Record<string, unknown> = {}): Promise<T> => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("Belum terhubung ke server, coba lagi sebentar."));
      }
      const id = newId();
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.current.delete(id);
          reject(new Error("Server tidak merespons, coba lagi."));
        }, 30000);
        pending.current.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        ws.send(JSON.stringify({ id, action, payload }));
      });
    },
    [],
  );

  const storeSession = useCallback((token: string | null) => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }, []);

  const request: RequestFn = useCallback(
    async <T,>(action: WsAction, payload: Record<string, unknown> = {}) => {
      const result = await rawRequest<T>(action, payload);
      if (
        action === "auth:login" ||
        action === "auth:google_verify" ||
        action === "invite:accept" ||
        action === "password:reset"
      ) {
        storeSession((result as unknown as AuthResultDto).token);
        setAuthState("authenticated");
      }
      if (action === "auth:logout") {
        notificationUser.current = null;
        storeSession(null);
        localStorage.removeItem(WORKSPACE_KEY);
        setSnapshot(null);
        setAuthState("anonymous");
      }
      if (action === "workspace:select") {
        localStorage.setItem(WORKSPACE_KEY, String(payload.workspace_id || ""));
      }
      return result;
    },
    [rawRequest, storeSession],
  );

  useEffect(() => {
    let unmounted = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pendingMap = pending.current;

    const restore = async () => {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) {
        setAuthState("anonymous");
        return;
      }
      setAuthState("restoring");
      try {
        await rawRequest("auth:resume", { token });
        const ws = localStorage.getItem(WORKSPACE_KEY);
        if (ws) await rawRequest("workspace:select", { workspace_id: ws }).catch(() => undefined);
        setAuthState("authenticated");
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        notificationUser.current = null;
        setSnapshot(null);
        setAuthState("anonymous");
      }
    };

    function connect() {
      if (unmounted) return;
      const ws = new WebSocket(resolveWsUrl(window.location));
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        void restore();
      };

      ws.onmessage = (evt) => {
        let msg: WsBroadcastEvent | WsResponseMessage;
        try {
          msg = JSON.parse(String(evt.data));
        } catch {
          return;
        }
        if (msg.type === "response") {
          const p = pendingMap.get(msg.id);
          if (!p) return;
          pendingMap.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.data);
          else p.reject(new Error(msg.error || "Operasi gagal"));
          return;
        }
        if (msg.event === "session:revoked") {
          notificationUser.current = null;
          localStorage.removeItem(TOKEN_KEY);
          setSnapshot(null);
          setAuthState("anonymous");
          return;
        }
        if (msg.snapshot) {
          notificationUser.current = msg.snapshot.me.id;
          setSnapshot(msg.snapshot);
        }
        if (msg.event === "notification:browser") {
          const userId = notificationUser.current;
          if (userId) {
            void showBrowserNotification(userId, msg.data, () => notificationUser.current === userId)
              .catch((error) => console.warn("[browser-notification]", error));
          }
          return;
        }
        setLastEvent(msg);
      };

      ws.onclose = () => {
        for (const [id, p] of pendingMap) {
          clearTimeout(p.timer);
          p.reject(new Error("Koneksi terputus"));
          pendingMap.delete(id);
        }
        if (unmounted) return;
        setConnected(false);
        setAuthState((s) => (s === "authenticated" ? "restoring" : "connecting"));
        retry += 1;
        timer = setTimeout(connect, Math.min(10000, 1000 * 2 ** Math.min(retry, 4)));
      };

      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      unmounted = true;
      notificationUser.current = null;
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [rawRequest]);

  return { connected, authState, snapshot, lastEvent, request };
}
