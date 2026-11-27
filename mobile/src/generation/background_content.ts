import { dateKeyOf } from '../content/content_types';
import type { SqlExecutor } from '../platform/sql_executor';
import type { SettingValue } from '../settings/settings_definitions';
import { addDays } from '../time/logical_day';
import type { FetchLike } from './anthropic_client';
import { runOneRefill, type GenerationOutcome } from './generation_service';
import { fetchOnThisDayIfMissing } from './wikimedia_on_this_day';

/**
 * Background content work after each daily cycle while the app is open (spec Section 6:
 * never at notification time): fetch missing A5 entries for today and the next two days,
 * then at most one generation refill if an API key is stored. Network failures are silent;
 * bundled content keeps every task usable offline.
 */
export interface BackgroundContentReport {
  readonly onThisDay: readonly string[];
  readonly generation: GenerationOutcome | null;
  /** True when today's content changed, so the daily cycle should run again. */
  readonly todayChanged: boolean;
}

export async function runBackgroundContentWork(deps: {
  readonly executor: SqlExecutor;
  readonly fetchImpl: FetchLike;
  readonly apiKey: string | null;
  readonly settings: ReadonlyMap<string, SettingValue>;
  readonly today: string;
  readonly now: Date;
}): Promise<BackgroundContentReport> {
  const enabled = Array.isArray(deps.settings.get('modules.enabled')) ? (deps.settings.get('modules.enabled') as readonly string[]) : [];
  const onThisDay: string[] = [];
  let todayChanged = false;
  if (enabled.includes('A5')) {
    for (let offset = 0; offset < 3; offset += 1) {
      const key = dateKeyOf(addDays(deps.today, offset));
      const result = await fetchOnThisDayIfMissing(deps.executor, deps.fetchImpl, key, deps.now);
      if (result !== 'exists') onThisDay.push(`${key}: ${result}`);
      if (offset === 0 && result === 'stored') todayChanged = true;
    }
  }
  let generation: GenerationOutcome | null = null;
  if (deps.apiKey) {
    generation = await runOneRefill({ executor: deps.executor, fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, settings: deps.settings, now: deps.now });
    if (generation && generation.accepted > 0) todayChanged = true;
  }
  return { onThisDay, generation, todayChanged };
}
