"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { CloseIcon } from "@/components/icons";
import type { RequestFn } from "@/lib/use-workspace-socket";
import type { WorkspaceRole, WorkspaceSnapshot } from "@/server/ws/protocol";

export const inputClass =
  "w-full rounded-card border border-line bg-floor px-3 py-2.5 text-xs text-ink placeholder:text-muted focus:border-primary focus:bg-bg focus:outline-none disabled:opacity-60";

export const smallInputClass =
  "h-8 w-full rounded-lg border border-line bg-floor px-2.5 text-xs text-ink placeholder:text-muted focus:border-primary focus:bg-bg focus:outline-none";

export const primaryBtn =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-card bg-primary px-3.5 py-2 text-xs font-semibold text-on-primary transition hover:bg-primary-strong active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

export const outlineBtn =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-card border border-line bg-bg px-3.5 py-2 text-xs font-semibold text-ink transition hover:border-primary hover:text-primary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

export const dangerBtn =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-card border border-danger/30 bg-danger/10 px-3.5 py-2 text-xs font-semibold text-danger transition hover:bg-danger hover:text-white disabled:opacity-50";

export const cardClass = "rounded-card border border-line bg-bg p-4 shadow-soft";

export const ROLE_META: Record<WorkspaceRole, { label: string; className: string }> = {
  owner: { label: "Pemimpin", className: "bg-primary text-on-primary" },
  admin: { label: "Admin", className: "bg-primary-soft text-primary" },
  member: { label: "Anggota", className: "border border-line bg-floor text-muted" },
  guest: { label: "Tamu", className: "bg-floor text-subtle" },
};

export function RoleBadge({ role }: { role: WorkspaceRole | "developer" }) {
  const meta =
    role === "developer"
      ? { label: "Developer", className: "bg-ink text-white" }
      : ROLE_META[role] || ROLE_META.member;
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.className}`}>
      {meta.label}
    </span>
  );
}

export function Avatar({
  name,
  online,
  size = "md",
}: {
  name: string;
  online?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const dims = size === "sm" ? "h-6 w-6 text-[10px]" : size === "lg" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-bold text-primary ${dims}`}>
      {(name || "?").charAt(0).toUpperCase()}
      {online !== undefined && (
        <span
          className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg ${online ? "bg-success" : "bg-subtle"}`}
        />
      )}
    </span>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 md:p-10" onMouseDown={onClose}>
      <div
        className={`w-full ${wide ? "max-w-3xl" : "max-w-md"} rounded-card border border-line bg-bg shadow-soft`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 text-sm font-bold text-ink">{title}</div>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-lg p-1 text-muted hover:bg-floor hover:text-ink" aria-label="Tutup">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-primary" : "bg-line"}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white transition ${checked ? "translate-x-4.5" : "translate-x-0.5"}`} />
    </button>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line bg-bg p-8 text-center">
      <div className="text-sm font-semibold text-ink">{title}</div>
      {children && <div className="mt-1 text-xs text-muted">{children}</div>}
    </div>
  );
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return "belum pernah";
  const diff = Date.now() - new Date(value).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} menit lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.round(h / 24)} hari lalu`;
}

/** `<input type="datetime-local">` value <-> ISO string. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function dueStatus(due: string | null, completed: string | null): "none" | "done" | "overdue" | "soon" | "later" {
  if (!due) return "none";
  if (completed) return "done";
  const diff = new Date(due).getTime() - Date.now();
  if (diff < 0) return "overdue";
  if (diff < 24 * 3600_000) return "soon";
  return "later";
}

export const DUE_CLASS: Record<string, string> = {
  none: "text-muted",
  done: "bg-success/10 text-success",
  overdue: "bg-danger/10 text-danger",
  soon: "bg-[#fff6d9] text-[#a87400]",
  later: "bg-floor text-muted",
};

const LABEL_TOKEN: Record<string, string> = { danger: "#e5534b", primary: "#3b63d6", success: "#2fa36b" };
export function labelColor(color: string): string {
  return LABEL_TOKEN[color] || (/^#[0-9a-f]{6}$/i.test(color) ? color : "#3b63d6");
}

export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Workspace context: snapshot + request + toast for every view.
// ---------------------------------------------------------------------------

export interface Toast {
  id: number;
  text: string;
  tone: "success" | "error" | "info";
}

interface WorkspaceCtx {
  snapshot: WorkspaceSnapshot;
  request: RequestFn;
  /** Runs a request and shows a toast on failure (optional success toast). */
  run: <T = unknown>(
    action: Parameters<RequestFn>[0],
    payload?: Record<string, unknown>,
    successText?: string,
  ) => Promise<T | null>;
  toast: (text: string, tone?: Toast["tone"]) => void;
  navigate: (nav: Partial<NavState>) => void;
  nav: NavState;
}

export interface NavState {
  tab: "kanban" | "chat" | "user" | "admin" | "settings";
  boardId: string;
  roomId: string;
  cardId: string;
}

const Ctx = createContext<WorkspaceCtx | null>(null);

export function useWorkspace(): WorkspaceCtx {
  const value = useContext(Ctx);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}

export function WorkspaceProvider({
  value,
  children,
}: {
  value: Omit<WorkspaceCtx, "run" | "toast">;
  children: React.ReactNode;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  const { request } = value;
  const run = useCallback(
    async <T,>(action: Parameters<RequestFn>[0], payload?: Record<string, unknown>, successText?: string) => {
      try {
        const res = await request<T>(action, payload);
        if (successText) toast(successText, "success");
        return res;
      } catch (err) {
        toast(err instanceof Error ? err.message : "Operasi gagal", "error");
        return null;
      }
    },
    [request, toast],
  );
  return (
    <Ctx.Provider value={{ ...value, run, toast }}>
      {children}
      <ToastStack toasts={toasts} />
    </Ctx.Provider>
  );
}

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-card border px-4 py-3 text-xs font-semibold shadow-soft ${
            t.tone === "error"
              ? "border-danger/30 bg-[#fdecea] text-danger"
              : t.tone === "success"
                ? "border-success/30 bg-[#e3f5ec] text-success"
                : "border-primary/20 bg-primary-soft text-primary"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
