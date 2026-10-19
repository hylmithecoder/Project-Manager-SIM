"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { inputClass, outlineBtn, primaryBtn } from "@/components/ui/kit";
import { mountGoogleSignIn } from "@/lib/google-sign-in";
import type { RequestFn } from "@/lib/use-workspace-socket";
import type { GoogleLoginChallengeDto, GoogleLoginConfigDto } from "@/server/ws/protocol";
import { Field, FormError, FormNotice } from "./auth-shell";

export function GoogleLogin({ request, connected, onFlowChange }: {
  request: RequestFn; connected: boolean; onFlowChange: (active: boolean) => void;
}) {
  const [config, setConfig] = useState<GoogleLoginConfigDto | null>(null);
  const [ready, setReady] = useState(false);
  const [challenge, setChallenge] = useState<GoogleLoginChallengeDto | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const credential = useRef<string | null>(null);
  const button = useRef<HTMLDivElement>(null);
  const running = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; credential.current = null; };
  }, []);

  useEffect(() => {
    if (!connected) return;
    let active = true;
    void request<GoogleLoginConfigDto>("auth:google_config").then((value) => {
      if (active) setConfig(value);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Konfigurasi Google gagal dimuat."); });
    return () => { active = false; };
  }, [request, connected]);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const start = useCallback(async (value: string) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    credential.current = value;
    try {
      const next = await request<GoogleLoginChallengeDto>("auth:google_start", { credential: value });
      if (!mounted.current) return;
      setChallenge(next);
      setCode("");
      setSeconds(next.resend_after_seconds);
      setNotice(`Kode OTP telah dikirim ke ${next.email}. Berlaku 5 menit.`);
      onFlowChange(true);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Login Google gagal. Coba lagi.");
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [request, onFlowChange]);

  useEffect(() => {
    if (!ready || !config?.client_id || !button.current || challenge) return;
    try { return mountGoogleSignIn(button.current, config.client_id, (value) => void start(value)); }
    catch (cause) { queueMicrotask(() => { if (mounted.current) setError(cause instanceof Error ? cause.message : "Google tidak tersedia."); }); }
  }, [ready, config?.client_id, challenge, start]);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!challenge || running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await request("auth:google_verify", { challenge: challenge.challenge, code });
      credential.current = null;
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Verifikasi OTP gagal.");
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {config?.enabled && <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setReady(true)} onError={() => setError("Google tidak dapat dimuat. Periksa koneksi atau gunakan email dan password.")} />}
      <FormError message={error} />
      <FormNotice message={notice} />
      {challenge ? (
        <form onSubmit={verify} className="space-y-3">
          <Field label="Kode OTP dari email">
            <input autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className={inputClass} placeholder="6 digit OTP" />
          </Field>
          <button type="submit" disabled={busy || !connected || code.length !== 6} className={`${primaryBtn} w-full`}>{busy ? "Memproses..." : "Verifikasi & Masuk"}</button>
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" className={outlineBtn} disabled={busy || !connected || seconds > 0} onClick={() => { if (credential.current) void start(credential.current); }}>{seconds > 0 ? `Kirim ulang (${seconds}d)` : "Kirim ulang OTP"}</button>
            <button type="button" className={outlineBtn} disabled={busy} onClick={() => { credential.current = null; setChallenge(null); setCode(""); setError(null); setNotice(null); onFlowChange(false); }}>Ganti akun / gunakan password</button>
          </div>
        </form>
      ) : (
        <>
          <div ref={button} className={busy || !connected ? "pointer-events-none opacity-50" : ""} aria-label="Masuk dengan Google" />
          {busy && <p role="status" className="text-xs text-muted">Memverifikasi Google dan mengirim OTP...</p>}
          {config?.enabled && !ready && <p className="text-xs text-muted">Memuat tombol Google...</p>}
          {config && !config.enabled && <p className="text-[11px] text-muted">Login Google belum diaktifkan oleh admin. Gunakan email dan password.</p>}
          <p className="text-[11px] text-muted">Masuk dengan Google, lalu masukkan OTP yang dikirim ke email akun tersebut.</p>
        </>
      )}
    </div>
  );
}
