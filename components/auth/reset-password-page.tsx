"use client";

import { useState } from "react";
import { inputClass, primaryBtn } from "@/components/ui/kit";
import type { RequestFn } from "@/lib/use-workspace-socket";
import { AuthShell, Field, FormError } from "./auth-shell";

export function ResetPasswordPage({
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
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password minimal 8 karakter.");
    if (password !== confirm) return setError("Konfirmasi password tidak sama.");
    setBusy(true);
    try {
      await request("password:reset", { token, password });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengatur password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      connected={connected}
      title="Atur Password Baru"
      subtitle="Semua sesi lain akan dikeluarkan setelah password diganti."
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <Field label="Password baru" hint="Minimal 8 karakter.">
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Ulangi password baru">
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        </Field>
        <button type="submit" disabled={busy || !connected} className={`${primaryBtn} w-full py-2.5`}>
          {busy ? "Menyimpan..." : "Simpan & Masuk"}
        </button>
      </form>
    </AuthShell>
  );
}
