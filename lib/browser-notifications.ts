import type { BrowserNotificationDto } from "@/server/ws/protocol";

const CHANGE_EVENT = "pm-browser-notifications-change";
const preferenceKey = (userId: string) => `pm_browser_notifications:${userId}`;
const onboardingKey = (userId: string) => `pm_browser_notification_onboarding:${userId}`;
let worker: Promise<ServiceWorkerRegistration> | null = null;

/** A primitive snapshot keeps useSyncExternalStore stable between changes. */
export function browserNotificationStatus(userId: string): string {
  if (typeof window === "undefined") return "loading";
  if (!window.isSecureContext) return "insecure";
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission !== "granted") return Notification.permission;
  try {
    return localStorage.getItem(preferenceKey(userId)) === "true" ? "enabled" : "disabled";
  } catch {
    return "storage-unavailable";
  }
}

export function subscribeBrowserNotifications(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

export async function setBrowserNotificationsEnabled(userId: string, enabled: boolean): Promise<void> {
  if (enabled) {
    if (!window.isSecureContext || !("Notification" in window)) {
      throw new Error("Notifikasi memerlukan browser yang mendukung dan HTTPS atau localhost.");
    }
    // Called directly from a user click, before any other asynchronous work.
    const permission = await Notification.requestPermission();
    window.dispatchEvent(new Event(CHANGE_EVENT));
    if (permission !== "granted") {
      throw new Error(permission === "denied"
        ? "Izin diblokir. Izinkan Notifikasi di pengaturan situs browser, lalu aktifkan kembali."
        : "Izin belum diberikan. Klik Aktifkan untuk mencoba lagi.");
    }
  }
  localStorage.setItem(preferenceKey(userId), String(enabled));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Ask once after sign-in; a visible button handles browsers requiring a click. */
export async function prepareBrowserNotificationsAfterLogin(userId: string): Promise<boolean> {
  const status = browserNotificationStatus(userId);
  if (["loading", "insecure", "unsupported", "storage-unavailable", "enabled"].includes(status)) return false;
  try {
    // Preserve an intentional opt-out, including when permission is still granted.
    if (localStorage.getItem(preferenceKey(userId)) === "false") return false;
    if (sessionStorage.getItem(onboardingKey(userId)) === "dismissed") return false;
    if (Notification.permission === "granted") {
      localStorage.setItem(preferenceKey(userId), "true");
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return false;
    }
    if (Notification.permission === "denied") return true;
    if (!sessionStorage.getItem(onboardingKey(userId))) {
      sessionStorage.setItem(onboardingKey(userId), "attempted");
      try {
        await setBrowserNotificationsEnabled(userId, true);
        return false;
      } catch {
        // Dismissed prompts and gesture requirements retain the in-app request.
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function dismissBrowserNotificationOnboarding(userId: string): void {
  try { sessionStorage.setItem(onboardingKey(userId), "dismissed"); } catch { /* The dialog can still close. */ }
}

export function parseBrowserNotification(value: unknown): BrowserNotificationDto | null {
  if (!value || typeof value !== "object") return null;
  const n = value as BrowserNotificationDto;
  if (![n.id, n.title, n.body, n.url].every((v) => typeof v === "string") || !n.id || !n.title) return null;
  // Backend links always point to the workspace page on this origin.
  if (n.url !== "/" && !n.url.startsWith("/?")) return null;
  return { id: n.id, title: n.title.slice(0, 200), body: n.body.slice(0, 300), url: n.url };
}

async function notificationWorker(): Promise<ServiceWorkerRegistration> {
  if (!worker) {
    worker = (async () => {
      await navigator.serviceWorker.register("/notifications-sw.js", { scope: "/", updateViaCache: "none" });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Service worker belum siap. Muat ulang dan coba lagi.")), 8000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    })().catch((error) => {
      worker = null;
      throw error;
    });
  }
  return worker;
}

/** Runs per socket message, so React batching cannot drop rapid events. */
export async function showBrowserNotification(
  userId: string,
  value: unknown,
  isCurrentUser: () => boolean = () => true,
): Promise<boolean> {
  const n = parseBrowserNotification(value);
  if (!n || !isCurrentUser() || browserNotificationStatus(userId) !== "enabled") return false;
  const show = async () => {
    const seenKey = `pm_browser_notifications_seen:${userId}`;
    let seen: string[] = [];
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(seenKey) || "[]");
      if (Array.isArray(saved)) seen = saved.filter((id): id is string => typeof id === "string");
    } catch { /* Treat an invalid cache as empty. */ }
    if (seen.includes(n.id)) return false;
    const options: NotificationOptions = {
      body: n.body, tag: `pm:${n.id}`, icon: "/favicon.ico", data: { url: n.url },
    };
    let registration: ServiceWorkerRegistration | null = null;
    if ("serviceWorker" in navigator) {
      try { registration = await notificationWorker(); } catch { /* Desktop fallback below. */ }
    }
    if (!isCurrentUser() || browserNotificationStatus(userId) !== "enabled") return false;
    if (registration) {
      await registration.showNotification(n.title, options);
    } else {
      const notification = new Notification(n.title, options);
      notification.onclick = () => {
        notification.close();
        if (!isCurrentUser()) return;
        window.focus();
        window.location.assign(n.url);
      };
    }
    localStorage.setItem(seenKey, JSON.stringify([...seen.slice(-99), n.id]));
    return true;
  };
  // Serialize across tabs; the shared cache then suppresses duplicate alerts.
  if ("locks" in navigator) return navigator.locks.request(`pm-notification:${userId}`, show);
  return show();
}
