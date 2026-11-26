/**
 * Streak and freeze rules (spec Section 4), as a pure state machine over closed days.
 *
 * - A day counts when at least one window is fully complete.
 * - One freeze is earned per `freezeEarnDays` counted days; at most MAX_BANKED_FREEZES are banked
 *   (a day that would earn a freeze while the bank is full earns nothing).
 * - At day close, a missed day uses a banked freeze automatically; with none banked the
 *   streak resets to 0. A freeze keeps the streak but does not add to it.
 */
export const MAX_BANKED_FREEZES = 2;

export interface StreakState {
  /** The last logical date already closed, or null before the first close. */
  readonly lastClosedDate: string | null;
  readonly currentStreak: number;
  readonly longestStreak: number;
  /** Counted days since the last freeze was earned (or attempted at a full bank). */
  readonly countedTowardNextFreeze: number;
  readonly bankedFreezes: number;
}

export type StreakEvent =
  | { readonly kind: 'counted'; readonly date: string; readonly streak: number }
  | { readonly kind: 'freeze_earned'; readonly date: string }
  | { readonly kind: 'freeze_used'; readonly date: string }
  | { readonly kind: 'reset'; readonly date: string; readonly previousStreak: number };

export const INITIAL_STREAK_STATE: StreakState = {
  lastClosedDate: null,
  currentStreak: 0,
  longestStreak: 0,
  countedTowardNextFreeze: 0,
  bankedFreezes: 0,
};

export function closeDay(
  state: StreakState,
  date: string,
  counted: boolean,
  freezeEarnDays: number,
): { readonly state: StreakState; readonly events: StreakEvent[] } {
  const events: StreakEvent[] = [];
  let { currentStreak, longestStreak, countedTowardNextFreeze, bankedFreezes } = state;
  if (counted) {
    currentStreak += 1;
    longestStreak = Math.max(longestStreak, currentStreak);
    events.push({ kind: 'counted', date, streak: currentStreak });
    countedTowardNextFreeze += 1;
    if (countedTowardNextFreeze >= freezeEarnDays) {
      countedTowardNextFreeze = 0;
      if (bankedFreezes < MAX_BANKED_FREEZES) {
        bankedFreezes += 1;
        events.push({ kind: 'freeze_earned', date });
      }
    }
  } else if (bankedFreezes > 0) {
    bankedFreezes -= 1;
    events.push({ kind: 'freeze_used', date });
  } else {
    if (currentStreak > 0) events.push({ kind: 'reset', date, previousStreak: currentStreak });
    currentStreak = 0;
  }
  return {
    state: { lastClosedDate: date, currentStreak, longestStreak, countedTowardNextFreeze, bankedFreezes },
    events,
  };
}
