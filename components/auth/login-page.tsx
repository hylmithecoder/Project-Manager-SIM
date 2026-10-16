"use client";

import { useState } from "react";
import { CheckCircleIcon, MailIcon, UserIcon } from "@/components/icons";
import { ProductivityIllustration } from "@/components/illustrations/productivity";
import type { UserDto, WorkspaceMemberDto } from "@/server/ws/protocol";

interface LoginPageProps {
  users: UserDto[];
  workspaceMembers: WorkspaceMemberDto[];
  onSelectUser: (user: UserDto) => void;
  onLoginWithEmail: (email: string) => void;
  initialEmail?: string;
  wsConnected: boolean;
}

export function LoginPage({
  users,
  workspaceMembers,
  onSelectUser,
  onLoginWithEmail,
  initialEmail = "",
  wsConnected,
}: LoginPageProps) {
  const [emailInput, setEmailInput] = useState(initialEmail);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const getMemberRole = (userId: string) => {
    const member = workspaceMembers.find((m) => m.user_id === userId);
    return member?.role || "member";
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
          className: "bg-floor text-muted",
        };
      default:
        return {
          label: "Guest",
          className: "bg-floor text-muted",
        };
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = emailInput.trim().toLowerCase();
    if (!trimmed) {
      setErrorMsg("Silakan masukkan alamat email.");
      return;
    }
    setErrorMsg(null);
    onLoginWithEmail(trimmed);
  };

  return (
    <div
      data-theme="default"
      className="flex min-h-screen w-full items-center justify-center bg-floor p-4 md:p-8 font-sans text-ink"
    >
      <div className="w-full max-w-4xl overflow-hidden rounded-card border border-line bg-bg shadow-soft">
        <div className="grid grid-cols-1 md:grid-cols-12">
          {/* Sisi Kiri: Branding & Isometric Illustration */}
          <div className="flex flex-col justify-between border-b border-line bg-primary-soft/40 p-6 md:col-span-5 md:border-b-0 md:border-r md:p-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-line bg-bg px-3 py-1 text-xs font-semibold text-primary">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    wsConnected ? "bg-success" : "bg-muted"
                  }`}
                />
                {wsConnected
                  ? "WebSocket Live (Port 5790)"
                  : "Menghubungkan Server..."}
              </div>

              <div>
                <span className="text-[11px] font-bold tracking-wider text-muted uppercase">
                  Workspace Kolaboratif
                </span>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink md:text-3xl">
                  Auto Smart Workspace
                </h1>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Sistem Task Board + Chat Grup Terintegrasi berbasis PostgreSQL
                  21 tabel UUID dengan desain Clean Isometric UI tema biru.
                </p>
              </div>
            </div>

            <div className="my-6 flex justify-center py-2">
              <div className="w-48 max-w-full drop-shadow-sm">
                <ProductivityIllustration />
              </div>
            </div>

            <div className="space-y-2 rounded-card border border-line bg-bg p-3.5 text-xs text-muted">
              <div className="flex items-center gap-2 font-medium text-ink">
                <CheckCircleIcon className="h-4 w-4 text-primary" />
                <span>Fitur Lengkap & Terintegrasi</span>
              </div>
              <p className="text-[11px] text-muted">
                Papan Kanban interaktif, chat grup terintegrasi, personal
                dashboard, dan manajemen anggota dengan notifikasi SMTP Gmail.
              </p>
            </div>
          </div>

          {/* Sisi Kanan: Form Login & Quick Account Picker */}
          <div className="flex flex-col justify-between p-6 md:col-span-7 md:p-8">
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-ink">
                  Masuk ke Workspace
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Pilih salah satu profil untuk masuk cepat, atau masukkan email
                  Anda.
                </p>
              </div>

              {errorMsg && (
                <div className="rounded-card border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
                  {errorMsg}
                </div>
              )}

              {/* Quick Account Picker */}
              <div className="space-y-2.5">
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">
                  Pilih Akun Cepat (Dev / Demo)
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {users.slice(0, 4).map((user) => {
                    const role = getMemberRole(user.id);
                    const badge = getRoleBadge(role);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => onSelectUser(user)}
                        className="group flex items-center justify-between rounded-card border border-line bg-floor/60 p-3 text-left transition hover:border-primary hover:bg-primary-soft/30"
                      >
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary group-hover:bg-primary group-hover:text-on-primary">
                            {user.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="truncate">
                            <div className="truncate text-xs font-semibold text-ink group-hover:text-primary">
                              {user.name}
                            </div>
                            <div className="truncate text-[10px] text-muted">
                              {user.email}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Divider */}
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-line" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-bg px-3 text-[11px] text-muted uppercase tracking-wider">
                    atau gunakan email
                  </span>
                </div>
              </div>

              {/* Form Input Email */}
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-ink">
                    Alamat Email (Gmail / Perusahaan)
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted">
                      <MailIcon className="h-4 w-4" />
                    </span>
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="contoh: nama@gmail.com"
                      className="w-full rounded-card border border-line bg-floor py-2.5 pr-3 pl-9 text-xs text-ink placeholder:text-muted focus:border-primary focus:bg-bg focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-card bg-primary px-4 py-2.5 text-xs font-semibold text-on-primary transition hover:bg-primary-strong active:scale-[0.99]"
                >
                  <UserIcon className="h-4 w-4" />
                  Masuk ke Workspace
                </button>
              </form>
            </div>

            <div className="mt-6 border-t border-line pt-4 text-center text-[11px] text-muted">
              Diundang via Gmail? Masukkan email Anda untuk otomatis bergabung
              sebagai anggota baru.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
