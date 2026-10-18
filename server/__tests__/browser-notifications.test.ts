import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  browserNotificationStatus, parseBrowserNotification, setBrowserNotificationsEnabled,
  showBrowserNotification, subscribeBrowserNotifications,
  prepareBrowserNotificationsAfterLogin, dismissBrowserNotificationOnboarding,
} from "../../lib/browser-notifications";
import { collectBrowserNotifications, queueBrowserNotification } from "../services/browser-notifications";

const notification = { id: "event-1", title: "Card baru", body: "Ani membuat card", url: "/?workspace=w&card=c" };

describe("Browser notification collector", () => {
  test("isolates concurrent actions and deduplicates recipients", async () => {
    const first = collectBrowserNotifications(async () => {
      await Promise.resolve();
      queueBrowserNotification(["a", "a"], notification);
      return "first";
    });
    const second = collectBrowserNotifications(async () => {
      queueBrowserNotification(["b"], notification);
      return "second";
    });
    const [a, b] = await Promise.all([first, second]);
    expect(a.result).toBe("first");
    expect(a.notifications[0].userIds).toEqual(["a"]);
    expect(b.notifications[0].userIds).toEqual(["b"]);
    expect(a.notifications[0].notification.id).not.toBe(b.notifications[0].notification.id);
    queueBrowserNotification(["outside"], notification);
    expect((await collectBrowserNotifications(async () => undefined)).notifications).toHaveLength(0);
  });

  test("failed actions cannot return queued notifications", async () => {
    await expect(collectBrowserNotifications(async () => {
      queueBrowserNotification(["a"], notification);
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect((await collectBrowserNotifications(async () => undefined)).notifications).toHaveLength(0);
  });
});

type FakeAlert = { title: string; options?: NotificationOptions; onclick?: () => void; closed?: boolean };

/** A scoped fake browser; restore globals even if an assertion fails. */
async function withBrowser(work: (env: ReturnType<typeof fakeBrowser>) => Promise<void>) {
  const env = fakeBrowser();
  const values = { window: env.window, document: env.document, navigator: env.navigator, localStorage: env.storage, sessionStorage: env.sessionStorage, Notification: env.Notification };
  const descriptors = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
    await work(env);
  } finally {
    for (const key of Object.keys(values)) {
      const original = descriptors[key];
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

function fakeBrowser() {
  const alerts: FakeAlert[] = [];
  const entries = new Map<string, string>();
  const sessionEntries = new Map<string, string>();
  const locations: string[] = [];
  const window = Object.assign(new EventTarget(), {
    isSecureContext: true, Notification: true,
    focus: () => undefined, location: { assign: (url: string) => locations.push(url) },
  });
  class FakeNotification {
    static permission: NotificationPermission = "default";
    static requested = 0;
    static decision: NotificationPermission = "granted";
    static async requestPermission() {
      this.requested++;
      this.permission = this.decision;
      return this.permission;
    }
    onclick?: () => void;
    closed = false;
    constructor(public title: string, public options?: NotificationOptions) { alerts.push(this); }
    close() { this.closed = true; }
  }
  return {
    window, document: new EventTarget(), navigator: {} as Record<string, unknown>, Notification: FakeNotification,
    alerts, entries, locations,
    storage: { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) },
    sessionStorage: { getItem: (key: string) => sessionEntries.get(key) ?? null, setItem: (key: string, value: string) => sessionEntries.set(key, value) },
  };
}

describe("Browser notification client", () => {
  test("sign-in requests permission and enables notifications when granted", async () => withBrowser(async (env) => {
    expect(await prepareBrowserNotificationsAfterLogin("a")).toBe(false);
    expect(env.Notification.requested).toBe(1);
    expect(browserNotificationStatus("a")).toBe("enabled");
    expect(await prepareBrowserNotificationsAfterLogin("a")).toBe(false);
    expect(env.Notification.requested).toBe(1);
  }));

  test("existing browser permission enables a new account but preserves explicit opt-outs", async () => withBrowser(async (env) => {
    env.Notification.permission = "granted";
    expect(await prepareBrowserNotificationsAfterLogin("a")).toBe(false);
    expect(browserNotificationStatus("a")).toBe("enabled");
    expect(env.Notification.requested).toBe(0);
    await setBrowserNotificationsEnabled("a", false);
    expect(await prepareBrowserNotificationsAfterLogin("a")).toBe(false);
    expect(browserNotificationStatus("a")).toBe("disabled");
    expect(await prepareBrowserNotificationsAfterLogin("b")).toBe(false);
    expect(browserNotificationStatus("b")).toBe("enabled");
  }));

  test("a dismissed native prompt falls back to a button without repeating automatically", async () => withBrowser(async (env) => {
    env.Notification.decision = "default";
    expect(await prepareBrowserNotificationsAfterLogin("a")).toBe(true);
    expect(await prepareBrowserNotificationsAfterLogin("a")).toBe(true);
    expect(env.Notification.requested).toBe(1);
    dismissBrowserNotificationOnboarding("a");
    expect(await prepareBrowserNotificationsAfterLogin("a")).toBe(false);
    expect(env.Notification.requested).toBe(1);
    expect(await prepareBrowserNotificationsAfterLogin("b")).toBe(true);
    expect(env.Notification.requested).toBe(2);
  }));

  test("a required user gesture can retry the permission request successfully", async () => withBrowser(async (env) => {
    env.Notification.decision = "default";
    expect(await prepareBrowserNotificationsAfterLogin("a")).toBe(true);
    env.Notification.decision = "granted";
    await setBrowserNotificationsEnabled("a", true);
    expect(browserNotificationStatus("a")).toBe("enabled");
    expect(await prepareBrowserNotificationsAfterLogin("a")).toBe(false);
    expect(env.Notification.requested).toBe(2);
  }));

  test("blocked permission shows recovery without re-requesting and unsupported contexts do not prompt", async () => withBrowser(async (env) => {
    env.Notification.permission = "denied";
    expect(await prepareBrowserNotificationsAfterLogin("a")).toBe(true);
    expect(env.Notification.requested).toBe(0);
    dismissBrowserNotificationOnboarding("a");
    expect(await prepareBrowserNotificationsAfterLogin("a")).toBe(false);
    env.window.isSecureContext = false;
    expect(await prepareBrowserNotificationsAfterLogin("b")).toBe(false);
    env.window.isSecureContext = true;
    Reflect.deleteProperty(env.window, "Notification");
    expect(await prepareBrowserNotificationsAfterLogin("b")).toBe(false);
    expect(env.Notification.requested).toBe(0);
  }));

  test("rejects malformed payloads and external navigation", () => {
    expect(parseBrowserNotification(null)).toBeNull();
    expect(parseBrowserNotification({ ...notification, body: 1 })).toBeNull();
    expect(parseBrowserNotification({ ...notification, url: "//evil.test/" })).toBeNull();
    expect(parseBrowserNotification({ ...notification, url: "javascript:alert(1)" })).toBeNull();
    expect(parseBrowserNotification(notification)).toEqual(notification);
  });

  test("permission is explicit and preference belongs to each account", async () => withBrowser(async (env) => {
    expect(browserNotificationStatus("a")).toBe("default");
    expect(await showBrowserNotification("a", notification)).toBe(false);
    expect(env.Notification.requested).toBe(0);
    await setBrowserNotificationsEnabled("a", true);
    expect(env.Notification.requested).toBe(1);
    expect(browserNotificationStatus("a")).toBe("enabled");
    expect(browserNotificationStatus("b")).toBe("disabled");
    await setBrowserNotificationsEnabled("a", false);
    expect(browserNotificationStatus("a")).toBe("disabled");
    expect(env.Notification.requested).toBe(1);
  }));

  test("handles denied, dismissed, unsupported, insecure and storage errors", async () => withBrowser(async (env) => {
    env.Notification.decision = "denied";
    await expect(setBrowserNotificationsEnabled("a", true)).rejects.toThrow("Izin diblokir");
    expect(browserNotificationStatus("a")).toBe("denied");
    env.Notification.decision = "default";
    await expect(setBrowserNotificationsEnabled("a", true)).rejects.toThrow("Izin belum diberikan");
    env.window.isSecureContext = false;
    expect(browserNotificationStatus("a")).toBe("insecure");
    await expect(setBrowserNotificationsEnabled("a", true)).rejects.toThrow("HTTPS");
    env.window.isSecureContext = true;
    Reflect.deleteProperty(env.window, "Notification");
    expect(browserNotificationStatus("a")).toBe("unsupported");
    env.window.Notification = true;
    env.Notification.permission = "granted";
    env.storage.getItem = () => { throw new Error("storage blocked"); };
    expect(browserNotificationStatus("a")).toBe("storage-unavailable");
  }));

  test("subscriptions update on permission focus, storage and local preference changes and clean up", async () => withBrowser(async (env) => {
    let changes = 0;
    const unsubscribe = subscribeBrowserNotifications(() => changes++);
    env.window.dispatchEvent(new Event("focus"));
    env.window.dispatchEvent(new Event("storage"));
    env.document.dispatchEvent(new Event("visibilitychange"));
    await setBrowserNotificationsEnabled("a", false);
    expect(changes).toBe(4);
    unsubscribe();
    env.window.dispatchEvent(new Event("focus"));
    expect(changes).toBe(4);
  }));

  test("desktop display deduplicates, opens deep links and rejects stale sessions", async () => withBrowser(async (env) => {
    await setBrowserNotificationsEnabled("a", true);
    expect(await showBrowserNotification("a", notification)).toBe(true);
    expect(await showBrowserNotification("a", notification)).toBe(false);
    expect(env.alerts).toHaveLength(1);
    env.alerts[0].onclick?.();
    expect(env.locations).toEqual([notification.url]);
    expect(await showBrowserNotification("a", { ...notification, id: "other" }, () => false)).toBe(false);
    await setBrowserNotificationsEnabled("a", false);
    expect(await showBrowserNotification("a", { ...notification, id: "disabled" })).toBe(false);
  }));

  test("service worker display supports mobile, rapid events and cross-tab locks", async () => withBrowser(async (env) => {
    const shown: string[] = [];
    const registrations: string[] = [];
    const registration = { showNotification: async (title: string) => { shown.push(title); } };
    env.navigator.serviceWorker = {
      register: async (url: string) => { registrations.push(url); }, ready: Promise.resolve(registration),
    };
    let serial: Promise<unknown> = Promise.resolve();
    env.navigator.locks = { request: (_key: string, work: () => Promise<unknown>) => {
      const result = serial.then(work);
      serial = result;
      return result;
    } };
    await setBrowserNotificationsEnabled("a", true);
    const results = await Promise.all([
      showBrowserNotification("a", { ...notification, id: "worker-1" }),
      showBrowserNotification("a", { ...notification, id: "worker-1" }),
      showBrowserNotification("a", { ...notification, id: "worker-2" }),
    ]);
    expect(results).toEqual([true, false, true]);
    expect(shown).toHaveLength(2);
    expect(registrations).toEqual(["/notifications-sw.js"]);
    expect(env.alerts).toHaveLength(0);
  }));
});

describe("Notification service worker", () => {
  test("activates and focuses a deep link, opens a new tab when needed, refuses other origins", async () => {
    const handlers: Record<string, (event: unknown) => void> = {};
    const visited: string[] = [];
    let focused = 0;
    let closed = 0;
    let windows: unknown[] = [{ url: "https://pm.test/", navigate: async (url: string) => visited.push(url), focus: async () => focused++ }];
    const worker = {
      addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; },
      skipWaiting: async () => undefined,
      location: { origin: "https://pm.test" },
      clients: { matchAll: async () => windows, openWindow: async (url: string) => visited.push(url) },
    };
    runInNewContext(readFileSync(new URL("../../public/notifications-sw.js", import.meta.url), "utf8"), { self: worker, URL });
    let done = Promise.resolve();
    const waitUntil = (promise: Promise<void>) => { done = promise; };
    handlers.install({ waitUntil });
    await done;
    const click = async (url: string) => {
      handlers.notificationclick({ notification: { data: { url }, close: () => closed++ }, waitUntil });
      await done;
    };
    await click("/?card=c");
    expect(visited).toEqual(["https://pm.test/?card=c"]);
    expect(focused).toBe(1);
    windows = [];
    await click("/?room=r");
    await click("https://evil.test/");
    expect(visited).toEqual(["https://pm.test/?card=c", "https://pm.test/?room=r"]);
    expect(closed).toBe(3);
  });
});
