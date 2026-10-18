"use client";

import { useState } from "react";
import { MailIcon, UserIcon } from "@/components/icons";
import { inputClass, primaryBtn } from "@/components/ui/kit";
import type { RequestFn } from "@/lib/use-workspace-socket";
import { AuthShell, Field, FormError, FormNotice } from "./auth-shell";

export function LoginPage({ request, connected }: { request: RequestFn; connected: boolean }) {
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!email.trim()) return setError("Masukkan alamat email.");
    setBusy(true);
    try {
      if (mode === "login") {
        if (!password) throw new Error("Masukkan password.");
        await request("auth:login", { email, password });
      } else {
        const res = await request<{ message: string }>("password:reset_request", { email });
        setNotice(res.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal masuk");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      connected={connected}
      title={mode === "login" ? "Masuk ke Workspace" : "Lupa Password"}
      subtitle={
        mode === "login"
          ? "Gunakan email dan password akun Anda."
          : "Kami akan mengirim tautan atur ulang password ke email Anda."
      }
      footer="Belum punya akun? Akun dibuat lewat undangan email dari admin perusahaan Anda."
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <FormNotice message={notice} />
        <Field label="Alamat Email">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted">
              <MailIcon className="h-4 w-4" />
            </span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@perusahaan.com"
              className={`${inputClass} pl-9`}
            />
          </div>
        </Field>
        {mode === "login" && (
          <Field label="Password">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password Anda"
              className={inputClass}
            />
          </Field>
        )}
        <button type="submit" disabled={busy || !connected} className={`${primaryBtn} w-full py-2.5`}>
          <UserIcon className="h-4 w-4" />
          {busy ? "Memproses..." : mode === "login" ? "Masuk" : "Kirim Tautan Reset"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "forgot" : "login");
            setError(null);
            setNotice(null);
          }}
          className="w-full cursor-pointer text-center text-[11px] font-semibold text-primary hover:underline"
        >
          {mode === "login" ? "Lupa password?" : "Kembali ke halaman masuk"}
        </button>
      </form>
    </AuthShell>
  );
}
