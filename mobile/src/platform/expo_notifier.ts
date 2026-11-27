import * as Notifications from 'expo-notifications';
import type { Notifier } from '../notifications/notification_ledger';

/** Shows notifications as banners even while the app is open. */
export function configureForegroundNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Current permission, without prompting. */
export async function readNotificationPermission(): Promise<{ granted: boolean; canAsk: boolean }> {
  const current = await Notifications.getPermissionsAsync();
  return { granted: current.granted, canAsk: !current.granted && current.canAskAgain };
}

/** Shows the iOS permission prompt if it has not been answered yet; returns whether notifications are allowed. */
export async function requestNotificationPermission(): Promise<boolean> {
  const current = await readNotificationPermission();
  if (current.granted) return true;
  if (!current.canAsk) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Notifier over expo-notifications local DATE triggers. */
export const expoNotifier: Notifier = {
  async pendingIds() {
    return (await Notifications.getAllScheduledNotificationsAsync()).map((request) => request.identifier);
  },
  async cancelAll() {
    await Notifications.cancelAllScheduledNotificationsAsync();
  },
  async schedule(entry) {
    return Notifications.scheduleNotificationAsync({
      content: { title: entry.title, body: entry.body, data: { window: entry.window, date: entry.date } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: entry.fireAt },
    });
  },
};
