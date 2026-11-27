import { MODULES, type WindowId } from '../daily/module_catalog';
import type { SqlExecutor } from '../platform/sql_executor';
import { addDays } from '../time/logical_day';

/**
 * The adherence and learning metrics of spec Section 10, computed on the device from the
 * event tables. Each has a current value over the last `days` logical days (default 30,
 * never before tracking began) and, where it is a daily quantity, a per-day series for the
 * trend line (null = no data that day).
 */
export const METRIC_WINDOW_DAYS = 30;
export const SPEARMAN_MIN_PAIRS = 30;

export interface Share {
  readonly numerator: number;
  readonly denominator: number;
  /** numerator / denominator, or null when the denominator is 0. */
  readonly value: number | null;
}

export interface StatsReport {
  readonly from: string;
  readonly to: string;
  readonly days: readonly string[];
  readonly adherence: { readonly mean: number | null; readonly series: readonly (number | null)[] };
  readonly windowCompletion: Readonly<Record<WindowId, Share>>;
  readonly retrieval: {
    readonly overall: Share;
    readonly byModule: Readonly<Record<string, Share>>;
    readonly byElapsed: Readonly<Record<string, Share>>;
    readonly calibrationGap: number | null;
  };
  readonly delayedRecall: Share;
  readonly production: { readonly exact: Share; readonly close: Share; readonly fail: Share; readonly meanNormalizedDistance: number | null };
  readonly priorities: { readonly meanScore: number | null; readonly series: readonly (number | null)[]; readonly carriedOver: number };
  readonly journal: { readonly entriesPerWeek: number | null; readonly wordsPerEntry: number | null; readonly series: readonly (number | null)[] };
  readonly moodAdherence: { readonly pairs: number; readonly rho: number | null; readonly enabled: boolean };
  readonly latency: { readonly medianMinutes: number | null; readonly samples: number; readonly byWindow: Readonly<Record<WindowId, number | null>> };
}

export const share = (numerator: number, denominator: number): Share => ({ numerator, denominator, value: denominator > 0 ? numerator / denominator : null });

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? null) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Average ranks (1-based), ties sharing the mean of their positions. */
export function ranks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = new Array<number>(values.length).fill(0);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]?.value === order[i]?.value) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k]?.index ?? 0] = rank;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation (Pearson correlation of the ranks); null if undefined. */
export function spearman(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length || x.length < 3) return null;
  const rx = ranks(x);
  const ry = ranks(y);
  const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const mx = mean(rx);
  const my = mean(ry);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < rx.length; i += 1) {
    const dx = (rx[i] ?? 0) - mx;
    const dy = (ry[i] ?? 0) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

export function elapsedBucket(days: number): string {
  if (days < 1.5) return '1';
  if (days < 6.5) return '2–6';
  if (days < 29.5) return '7–29';
  return '≥30';
}

const REVIEW_STATE = 2;
const AGAIN = 1;

export function computeStats(
  executor: SqlExecutor,
  input: {
    readonly today: string;
    readonly trackingStart: string | null;
    readonly enabledModules: readonly string[];
    readonly targetRetention: number;
    readonly moodEnabled: boolean;
    readonly days?: number;
  },
): StatsReport {
  const span = input.days ?? METRIC_WINDOW_DAYS;
  let from = addDays(input.today, -(span - 1));
  if (input.trackingStart && input.trackingStart > from) from = input.trackingStart;
  if (from > input.today) from = input.today;
  const days: string[] = [];
  for (let date = from; date <= input.today; date = addDays(date, 1)) days.push(date);
  const enabled = input.enabledModules.filter((id) => MODULES.some((module) => module.id === id));

  // Daily adherence: completed modules ÷ enabled modules.
  const completions = executor.all<{ date: string; module: string; completed_at: string }>(
    "SELECT date, module, completed_at FROM task_completion WHERE date >= ? AND date <= ? AND module != 'A3R'",
    [from, input.today],
  );
  const completedByDay = new Map<string, Set<string>>();
  for (const row of completions) {
    if (!enabled.includes(row.module)) continue;
    const set = completedByDay.get(row.date) ?? new Set<string>();
    set.add(row.module);
    completedByDay.set(row.date, set);
  }
  const adherenceSeries = days.map((date) => (enabled.length === 0 ? null : (completedByDay.get(date)?.size ?? 0) / enabled.length));
  const adherenceValues = adherenceSeries.filter((value): value is number => value !== null);
  const adherenceMean = adherenceValues.length > 0 ? adherenceValues.reduce((s, v) => s + v, 0) / adherenceValues.length : null;

  // Window completion rate: completed days ÷ elapsed days (today counts once it is complete).
  const sessions = executor.all<{ date: string; morning_completed_at: string | null; evening_completed_at: string | null }>(
    'SELECT date, morning_completed_at, evening_completed_at FROM daily_session WHERE date >= ? AND date <= ?',
    [from, input.today],
  );
  const windowShare = (column: 'morning_completed_at' | 'evening_completed_at'): Share => {
    const completed = sessions.filter((s) => s[column] !== null);
    const todayDone = completed.some((s) => s.date === input.today);
    return share(completed.length, days.length - (todayDone ? 0 : 1));
  };

  // A2 retrieval: reviews of cards in Review state not graded Again.
  const reviews = executor.all<{ card_id: string; grade: number; elapsed_days: number; state_before: number }>(
    'SELECT card_id, grade, elapsed_days, state_before FROM srs_review_log WHERE reviewed_at >= ? AND state_before = ?',
    [`${from}T00:00:00.000Z`, REVIEW_STATE],
  );
  const tally = (rows: typeof reviews) => share(rows.filter((r) => r.grade !== AGAIN).length, rows.length);
  const byModule: Record<string, Share> = {};
  for (const module of ['A1', 'A3', 'A4', 'A5']) {
    const rows = reviews.filter((r) => r.card_id.startsWith(`${module}:`));
    if (rows.length > 0) byModule[module] = tally(rows);
  }
  const byElapsed: Record<string, Share> = {};
  for (const bucket of ['1', '2–6', '7–29', '≥30']) {
    const rows = reviews.filter((r) => elapsedBucket(r.elapsed_days) === bucket);
    if (rows.length > 0) byElapsed[bucket] = tally(rows);
  }
  const overall = tally(reviews);

  // A3 delayed recall and A4 production accuracy, from the recorded responses.
  const responses = (module: string) =>
    executor
      .all<{ response_json: string | null }>('SELECT response_json FROM task_completion WHERE module = ? AND date >= ? AND date <= ?', [module, from, input.today])
      .map((row) => (row.response_json ? (JSON.parse(row.response_json) as Record<string, unknown>) : {}));
  const recalls = responses('A3R');
  const phrases = responses('A4');
  const firstResults = phrases.map((r) => String(r.first_result ?? ''));
  const distances = phrases.map((r) => r.first_normalized_distance).filter((d): d is number => typeof d === 'number');

  // Priorities: done = 1, partial = 0.5, not done = 0; mean per day.
  const priorities = executor.all<{ date: string; status: string; carried_from_id: number | null }>(
    'SELECT date, status, carried_from_id FROM priority WHERE date >= ? AND date <= ?',
    [from, input.today],
  );
  const SCORE: Record<string, number | null> = { done: 1, partial: 0.5, not_done: 0, open: null };
  const prioritySeries = days.map((date) => {
    const scored = priorities.filter((p) => p.date === date).map((p) => SCORE[p.status]).filter((s): s is number => s !== null && s !== undefined);
    return scored.length > 0 ? scored.reduce((s, v) => s + v, 0) / scored.length : null;
  });
  const priorityValues = prioritySeries.filter((v): v is number => v !== null);

  // Journal volume.
  const entries = executor.all<{ date: string; body_md: string; mood: number | null }>(
    'SELECT date, body_md, mood FROM journal_entry WHERE date >= ? AND date <= ?',
    [from, input.today],
  );
  const words = (body: string) => (body.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
  const journalSeries = days.map((date) => {
    const entry = entries.find((e) => e.date === date);
    return entry ? words(entry.body_md) : null;
  });
  const totalWords = entries.reduce((sum, e) => sum + words(e.body_md), 0);

  // Mood – adherence (Spearman), only with mood on and enough paired days.
  const pairs = entries
    .filter((e) => e.mood !== null)
    .map((e) => ({ mood: e.mood as number, adherence: adherenceSeries[days.indexOf(e.date)] }))
    .filter((p): p is { mood: number; adherence: number } => typeof p.adherence === 'number');
  const rho = input.moodEnabled && pairs.length >= SPEARMAN_MIN_PAIRS ? spearman(pairs.map((p) => p.mood), pairs.map((p) => p.adherence)) : null;

  // Response latency: notification fire time → first completion in that window that day.
  const fired = executor.all<{ date: string; window: WindowId; fire_at: string }>(
    "SELECT date, window, fire_at FROM notification_schedule WHERE status = 'fired' AND date >= ? AND date <= ?",
    [from, input.today],
  );
  const windowModules = (window: WindowId) => MODULES.filter((m) => m.window === window).map((m) => m.id as string);
  const latencyFor = (window: WindowId) =>
    fired
      .filter((f) => f.window === window)
      .map((f) => {
        const first = completions
          .filter((c) => c.date === f.date && windowModules(window).includes(c.module) && c.completed_at >= f.fire_at)
          .map((c) => c.completed_at)
          .sort()[0];
        return first ? (new Date(first).getTime() - new Date(f.fire_at).getTime()) / 60_000 : null;
      })
      .filter((m): m is number => m !== null);
  const morningLatency = latencyFor('morning');
  const eveningLatency = latencyFor('evening');

  return {
    from,
    to: input.today,
    days,
    adherence: { mean: adherenceMean, series: adherenceSeries },
    windowCompletion: { morning: windowShare('morning_completed_at'), evening: windowShare('evening_completed_at') },
    retrieval: {
      overall,
      byModule,
      byElapsed,
      calibrationGap: overall.value === null ? null : overall.value - input.targetRetention,
    },
    delayedRecall: share(recalls.filter((r) => r.correct === true).length, recalls.length),
    production: {
      exact: share(firstResults.filter((r) => r === 'exact').length, firstResults.length),
      close: share(firstResults.filter((r) => r === 'close').length, firstResults.length),
      fail: share(firstResults.filter((r) => r === 'fail').length, firstResults.length),
      meanNormalizedDistance: distances.length > 0 ? distances.reduce((s, d) => s + d, 0) / distances.length : null,
    },
    priorities: {
      meanScore: priorityValues.length > 0 ? priorityValues.reduce((s, v) => s + v, 0) / priorityValues.length : null,
      series: prioritySeries,
      carriedOver: priorities.filter((p) => p.carried_from_id !== null).length,
    },
    journal: {
      entriesPerWeek: days.length > 0 ? (entries.length * 7) / days.length : null,
      wordsPerEntry: entries.length > 0 ? totalWords / entries.length : null,
      series: journalSeries,
    },
    moodAdherence: { pairs: pairs.length, rho, enabled: input.moodEnabled },
    latency: {
      medianMinutes: median([...morningLatency, ...eveningLatency]),
      samples: morningLatency.length + eveningLatency.length,
      byWindow: { morning: median(morningLatency), evening: median(eveningLatency) },
    },
  };
}
