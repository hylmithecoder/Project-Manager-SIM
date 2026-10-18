"use client";

import { useEffect, useState } from "react";
import { inputClass, outlineBtn, primaryBtn } from "@/components/ui/kit";
import type { RequestFn } from "@/lib/use-workspace-socket";
import type { InvitationLookupDto } from "@/server/ws/protocol";
import { AuthShell, Field, FormError } from "./auth-shell";

const ROLE_TEXT: Record<string, string> = {
  owner: "Pemimpin Perusahaan (Owner)",
  admin: "Admin Workspace",
  member: "Anggota",
  guest: "Tamu",
};

/**
 * Opened from the invitation email (`/?invite=<token>`): new emails fill a
 * create-account form (name + password), existing accounts confirm with their
 * password. On success the server emails the invitee and the inviter.
 */
export function InviteAcceptPage({
  token,
  request,
  connected,
  onDone,
}: {
  token: string;
  request: RequestFn;
  connected: boolean;
  onDone: () => void;
}) {
  const [info, setInfo] = useState<InvitationLookupDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    request<InvitationLookupDto>("invite:lookup", { token })
      .then((res) => {
        if (cancelled) return;
        if (res.purpose !== "invite") throw new Error("Tautan ini bukan undangan workspace");
        setInfo(res);
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : "Undangan tidak valid"));
    return () => {
      cancelled = true;
    };
  }, [connected, request, token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!info) return;
    if (!info.existing_user) {
      if (name.trim().length < 2) return setError("Nama lengkap minimal 2 karakter.");
      if (password.length < 8) return setError("Password minimal 8 karakter.");
      if (password !== confirm) return setError("Konfirmasi password tidak sama.");
    }
    setBusy(true);
    try {
      await request("invite:accept", { token, name, password });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menerima undangan");
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <AuthShell connected={connected} title="Undangan tidak dapat dipakai" subtitle={loadError}>
        <button type="button" onClick={onDone} className={`${outlineBtn} w-full`}>
          Ke halaman masuk
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      connected={connected}
      title={info?.existing_user ? "Terima Undangan" : "Buat Akun Baru"}
      subtitle={
        info
          ? `${info.inviter_name || "Admin"} mengundang Anda ke "${info.workspace_name}" sebagai ${ROLE_TEXT[info.role || "member"]}.`
          : "Memeriksa undangan..."
      }
      footer="Setelah akun dibuat, kami mengirim email konfirmasi ke Anda dan memberi tahu pengundang."
    >
      {info && (
        <form onSubmit={submit} className="space-y-4">
          <FormError message={error} />
          <Field label="Email">
            <input value={info.email} disabled className={inputClass} />
          </Field>
          {info.existing_user ? (
            <Field label="Password akun Anda" hint="Email ini sudah terdaftar. Masukkan password untuk bergabung.">
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </Field>
          ) : (
            <>
              <Field label="Nama lengkap">
                <input
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="contoh: Sari Wulandari"
                  className={inputClass}
                />
              </Field>
              <Field label="Password" hint="Minimal 8 karakter.">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Ulangi password">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </>
          )}
          <button type="submit" disabled={busy} className={`${primaryBtn} w-full py-2.5`}>
            {busy ? "Memproses..." : info.existing_user ? "Gabung ke Workspace" : "Buat Akun & Masuk"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
