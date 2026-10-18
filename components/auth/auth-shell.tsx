"use client";

import { CheckCircleIcon } from "@/components/icons";
import { ProductivityIllustration } from "@/components/illustrations/productivity";

export function AuthShell({
  connected,
  title,
  subtitle,
  children,
  footer,
}: {
  connected: boolean;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-floor p-4 font-sans text-ink md:p-8">
      <div className="w-full max-w-4xl overflow-hidden rounded-card border border-line bg-bg shadow-soft">
        <div className="grid grid-cols-1 md:grid-cols-12">
          <div className="flex flex-col justify-between border-b border-line bg-primary-soft/40 p-6 md:col-span-5 md:border-r md:border-b-0 md:p-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-line bg-bg px-3 py-1 text-xs font-semibold text-primary">
                <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-success" : "animate-pulse bg-muted"}`} />
                {connected ? "Server terhubung" : "Menghubungkan server..."}
              </div>
              <div>
                <span className="text-[11px] font-bold tracking-wider text-muted uppercase">Workspace Kolaboratif</span>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink md:text-3xl">Project Manager Workspace</h1>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Task board + chat grup terintegrasi. Setiap perusahaan punya workspace privat sendiri.
                </p>
              </div>
            </div>
            <div className="my-6 flex justify-center py-2">
              <div className="w-48 max-w-full">
                <ProductivityIllustration />
              </div>
            </div>
            <div className="space-y-2 rounded-card border border-line bg-bg p-3.5 text-xs text-muted">
              <div className="flex items-center gap-2 font-medium text-ink">
                <CheckCircleIcon className="h-4 w-4 text-primary" />
                <span>Privat & terintegrasi</span>
              </div>
              <p className="text-[11px]">
                Akun dibuat lewat undangan email. Notifikasi aktivitas & chat dikirim ke Gmail sesuai pengaturan Anda.
              </p>
            </div>
          </div>
          <div className="flex flex-col justify-between p-6 md:col-span-7 md:p-8">
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-ink">{title}</h2>
                <p className="mt-1 text-xs text-muted">{subtitle}</p>
              </div>
              {children}
            </div>
            {footer && <div className="mt-6 border-t border-line pt-4 text-center text-[11px] text-muted">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="rounded-card border border-danger/30 bg-danger/10 p-3 text-xs text-danger">{message}</div>;
}

export function FormNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="rounded-card border border-success/30 bg-success/10 p-3 text-xs text-success">{message}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}
