import { DefaultScheduler, Rating, State } from 'ts-fsrs';

/**
 * Scheduler configuration for A2 (spec Section 5). The FSRS model is pinned to FSRS-6:
 * ts-fsrs 6 defaults to FSRS-7, whose card shape adds fields the pilot schema does not
 * store. Learning steps use the library defaults (1 min, 10 min; relearning 10 min).
 */
export const FSRS_MODEL_VERSION = 'FSRS-6' as const;
export const MAXIMUM_INTERVAL_DAYS = 3650;
export const ENABLE_FUZZ = true;

export function createAppScheduler(desiredRetention: number) {
  return DefaultScheduler({
    version: FSRS_MODEL_VERSION,
    desiredRetention,
    enableFuzz: ENABLE_FUZZ,
    maximumInterval: MAXIMUM_INTERVAL_DAYS,
  });
}

export type AppScheduler = Awaited<ReturnType<typeof createAppScheduler>>;
export type SchedulerCard = ReturnType<AppScheduler['newCard']>;
export type SchedulerReviewResult = ReturnType<AppScheduler['review']>;
export type SchedulerRevlog = SchedulerReviewResult['revlog'];
export type SchedulerGrade = Parameters<AppScheduler['review']>[0]['grade'];

export { Rating, State };

export const GRADES: readonly SchedulerGrade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

const DATE_FIELDS = new Set(['dueAt', 'lastReviewAt', 'reviewTime']);

/** JSON form of scheduler objects: Date fields become ISO strings. */
export function serializeSchedulerObject(value: object): string {
  return JSON.stringify(value);
}

/** Inverse of serializeSchedulerObject: ISO strings in date fields become Date objects again. */
export function deserializeSchedulerObject<T>(json: string): T {
  return JSON.parse(json, (key, value: unknown) =>
    DATE_FIELDS.has(key) && typeof value === 'string' ? new Date(value) : value,
  ) as T;
}
