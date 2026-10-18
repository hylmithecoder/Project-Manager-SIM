"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { BellIcon } from "@/components/icons";
import { Modal, outlineBtn, primaryBtn, useWorkspace } from "@/components/ui/kit";
import {
  browserNotificationStatus, dismissBrowserNotificationOnboarding,
  prepareBrowserNotificationsAfterLogin, setBrowserNotificationsEnabled,
  subscribeBrowserNotifications,
} from "@/lib/browser-notifications";

const serverStatus = () => "loading";

export function BrowserNotificationOnboarding({ userId }: { userId: string }) {
  const { navigate } = useWorkspace();
  const status = useSyncExternalStore(subscribeBrowserNotifications, () => browserNotificationStatus(userId), serverStatus);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void prepareBrowserNotificationsAfterLogin(userId).then((needed) => {
      if (active) setOpen(needed);
    });
    return () => { active = false; };
  }, [userId, status]);

  const dismiss = () => {
    dismissBrowserNotificationOnboarding(userId);
    setOpen(false);
  };

  const enable = async () => {
    setBusy(true);
    setError("");
    try {
      await setBrowserNotificationsEnabled(userId, true);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Izin belum diberikan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open && status !== "enabled"} onClose={dismiss} title="Izinkan notifikasi browser">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <BellIcon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p className="text-xs text-muted">Dapatkan pemberitahuan pesan chat, penugasan, dan aktivitas workspace meskipun Anda sedang membuka tab lain.</p>
        </div>
        {status === "denied" ? (
          <p className="text-xs text-muted">Izin notifikasi diblokir. Klik ikon pengaturan situs di sebelah alamat browser → Setelan situs → Notifikasi → Izinkan, lalu kembali ke aplikasi.</p>
        ) : (
          <p className="text-xs text-muted">Klik Izinkan notifikasi, lalu pilih Izinkan pada permintaan browser.</p>
        )}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={outlineBtn} onClick={dismiss}>Nanti saja</button>
          {status === "denied" ? (
            <button type="button" className={primaryBtn} onClick={() => { dismiss(); navigate({ tab: "settings" }); }}>Buka Pengaturan</button>
          ) : (
            <button type="button" className={primaryBtn} disabled={busy} onClick={() => void enable()}>{busy ? "Meminta izin..." : "Izinkan notifikasi"}</button>
          )}
        </div>
      </div>
    </Modal>
  );
}
