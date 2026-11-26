import type { Notifier } from './notification_ledger';
import type { PlannedNotification } from './notification_plan';

/** In-memory Notifier for diagnostics: "fires" (removes) entries whose time has passed when told to. */
export function createFakeNotifier(): Notifier & { deliverDueAt(now: Date): number; pending: Map<string, PlannedNotification> } {
  const pending = new Map<string, PlannedNotification>();
  let counter = 0;
  return {
    pending,
    async pendingIds() {
      return [...pending.keys()];
    },
    async cancelAll() {
      pending.clear();
    },
    async schedule(entry) {
      counter += 1;
      const id = `fake-${counter}`;
      pending.set(id, entry);
      return id;
    },
    deliverDueAt(now) {
      let delivered = 0;
      for (const [id, entry] of pending) {
        if (entry.fireAt.getTime() <= now.getTime()) {
          pending.delete(id);
          delivered += 1;
        }
      }
      return delivered;
    },
  };
}
