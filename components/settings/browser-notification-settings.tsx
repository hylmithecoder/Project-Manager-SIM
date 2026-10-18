"use client";

import { useState, useSyncExternalStore } from "react";
import { BellIcon } from "@/components/icons";
import { cardClass, outlineBtn, primaryBtn } from "@/components/ui/kit";
import {
  browserNotificationStatus, setBrowserNotificationsEnabled,
  showBrowserNotification, subscribeBrowserNotifications,
} from "@/lib/browser-notifications";

const serverStatus = () => "loading";

export function BrowserNotificationSettings({ userId }: { userId: string }) {
  const status = useSyncExternalStore(subscribeBrowserNotifications, () => browserNotificationStatus(userId), serverStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const unavailable = ["loading", "unsupported", "insecure", "storage-unavailable", "denied"].includes(status);
  const descriptions: Record<string, string> = {
    loading: "Memeriksa dukungan browser...",
    unsupported: "Browser ini belum mendukung notifikasi. Coba browser lain yang mendukung.",
    insecure: "Buka aplikasi melalui HTTPS atau localhost untuk mengaktifkan notifikasi.",
    "storage-unavailable": "Penyimpanan browser tidak tersedia. Izinkan penyimpanan situs lalu muat ulang.",
    denied: "Izin diblokir. Buka pengaturan situs browser → Notifikasi → Izinkan, lalu kembali ke sini.",
    default: "Klik Aktifkan, lalu pilih Izinkan pada permintaan izin browser.",
    disabled: "Notifikasi browser untuk akun ini sedang nonaktif di perangkat ini.",
    enabled: "Aktif untuk akun ini di browser ini, termasuk saat tab berada di latar belakang.",
  };

  const act = async (test: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      if (!test) await setBrowserNotificationsEnabled(userId, status !== "enabled");
      if (test || status !== "enabled") {
        await showBrowserNotification(userId, {
          id: crypto.randomUUID(), title: "Notifikasi Project Manager aktif",
          body: "Aktivitas workspace dan pesan baru akan muncul di sini.", url: "/?tab=settings",
        });
        setMessage("Notifikasi uji dikirim. Jika tidak terlihat, periksa pengaturan notifikasi sistem atau mode Jangan Ganggu.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Notifikasi gagal ditampilkan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${cardClass} space-y-3`}>
      <div className="flex items-center gap-2">
        <BellIcon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-bold">Notifikasi Browser</h2>
      </div>
      <p className="text-xs text-muted">Aktivitas board, card, checklist, penugasan, deadline, anggota, dan pesan chat sesuai akses Anda.</p>
      <p className="text-[11px] text-muted">{descriptions[status]}</p>
      <p className="text-[11px] text-muted">Biarkan aplikasi terbuka dan terhubung. Notifikasi baru berhenti saat semua tab ditutup. Pengaturan ini terpisah dari email; ruang chat yang dibisukan hanya memberi notifikasi saat Anda di-tag.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryBtn} disabled={busy || unavailable} onClick={() => void act(false)}>
          {busy ? "Memproses..." : status === "enabled" ? "Nonaktifkan" : "Aktifkan"}
        </button>
        {status === "enabled" && <button type="button" className={outlineBtn} disabled={busy} onClick={() => void act(true)}>Kirim Notifikasi Uji</button>}
      </div>
      {message && <p role="status" className="text-[11px] text-muted">{message}</p>}
    </section>
  );
}
