import { AsyncLocalStorage } from "node:async_hooks";
import type { BrowserNotificationDto } from "../ws/protocol";

export interface BrowserNotificationDelivery {
  userIds: string[];
  notification: BrowserNotificationDto;
}

const deliveries = new AsyncLocalStorage<BrowserNotificationDelivery[]>();

/** Each action/scan gets an isolated queue; failed actions never deliver it. */
export async function collectBrowserNotifications<T>(work: () => Promise<T>) {
  const notifications: BrowserNotificationDelivery[] = [];
  const result = await deliveries.run(notifications, work);
  return { result, notifications };
}

export function queueBrowserNotification(
  userIds: string[],
  notification: Omit<BrowserNotificationDto, "id">,
): void {
  if (!userIds.length) return;
  deliveries.getStore()?.push({
    userIds: [...new Set(userIds)],
    notification: { ...notification, id: crypto.randomUUID() },
  });
}
