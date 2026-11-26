import {
  GRADES,
  serializeSchedulerObject,
  type AppScheduler,
  type SchedulerCard,
} from './fsrs_scheduler';

/**
 * Deterministic FSRS review sequences. tools/generate_fsrs_reference_vectors.ts runs
 * them under Node and stores the outputs; diagnostic T1 re-runs them on the phone's
 * Hermes engine and compares, which verifies ts-fsrs behaves identically there.
 */
export const REFERENCE_RETENTIONS = [0.8, 0.85, 0.9, 0.95] as const;
export const REFERENCE_SEEDS = [11, 23, 47, 101, 9001] as const;
export const REFERENCE_STEPS_PER_CASE = 10;
const START_MS = Date.UTC(2026, 0, 1, 8, 0, 0);
const HOUR_MS = 3_600_000;

export interface ReferenceStep {
  readonly grade: number;
  readonly now: string;
  readonly card: unknown;
  readonly revlog: unknown;
}

export interface ReferenceCase {
  readonly caseId: string;
  readonly desiredRetention: number;
  readonly seed: number;
  readonly steps: readonly ReferenceStep[];
}

export interface ReferenceVectorFile {
  readonly format: 'dmh-fsrs-reference-vectors-1';
  readonly tsFsrsVersion: string;
  readonly modelVersion: string;
  readonly cases: readonly ReferenceCase[];
}

/** Runs one case: a linear congruential generator picks each grade and the delay after the due time. */
export function computeReferenceCase(scheduler: AppScheduler, desiredRetention: number, seed: number): ReferenceCase {
  const caseId = `r${desiredRetention}-s${seed}`;
  let state = seed >>> 0;
  let card: SchedulerCard = scheduler.newCard({ now: new Date(START_MS), cardId: caseId });
  const steps: ReferenceStep[] = [];
  for (let index = 0; index < REFERENCE_STEPS_PER_CASE; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const grade = GRADES[(state >>> 24) % GRADES.length] as (typeof GRADES)[number];
    const now = new Date(card.dueAt.getTime() + (state % 240) * HOUR_MS);
    const result = scheduler.review({ card, grade, now });
    steps.push({
      grade,
      now: now.toISOString(),
      card: JSON.parse(serializeSchedulerObject(result.card)) as unknown,
      revlog: JSON.parse(serializeSchedulerObject(result.revlog)) as unknown,
    });
    card = result.card as SchedulerCard;
  }
  return { caseId, desiredRetention, seed, steps };
}

export interface VectorComparison {
  readonly matched: boolean;
  readonly stepsCompared: number;
  readonly maxAbsoluteDifference: number;
  readonly firstMismatch: string | null;
}

/** Numbers may differ by at most `tolerance` (floating-point library differences); everything else must be equal. */
export function compareReferenceCases(
  expected: readonly ReferenceCase[],
  actual: readonly ReferenceCase[],
  tolerance = 1e-9,
): VectorComparison {
  let maxAbsoluteDifference = 0;
  let stepsCompared = 0;
  let firstMismatch: string | null = null;
  const compare = (path: string, a: unknown, b: unknown): void => {
    if (firstMismatch) return;
    if (typeof a === 'number' && typeof b === 'number') {
      const difference = Math.abs(a - b);
      maxAbsoluteDifference = Math.max(maxAbsoluteDifference, difference);
      if (difference > tolerance * Math.max(1, Math.abs(a))) firstMismatch = `${path}: expected ${a}, got ${b}`;
      return;
    }
    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const key of keys) {
        compare(`${path}.${key}`, (a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]);
      }
      return;
    }
    if (a !== b) firstMismatch = `${path}: expected ${JSON.stringify(a)}, got ${JSON.stringify(b)}`;
  };
  if (expected.length !== actual.length) {
    return { matched: false, stepsCompared: 0, maxAbsoluteDifference: 0, firstMismatch: 'case count differs' };
  }
  expected.forEach((expectedCase, caseIndex) => {
    const actualCase = actual[caseIndex] as ReferenceCase;
    expectedCase.steps.forEach((step, stepIndex) => {
      stepsCompared += 1;
      compare(`${expectedCase.caseId}[${stepIndex}]`, step, actualCase.steps[stepIndex]);
    });
  });
  return { matched: firstMismatch === null, stepsCompared, maxAbsoluteDifference, firstMismatch };
}

export async function computeAllReferenceCases(
  createScheduler: (desiredRetention: number) => Promise<AppScheduler>,
): Promise<ReferenceCase[]> {
  const cases: ReferenceCase[] = [];
  for (const retention of REFERENCE_RETENTIONS) {
    const scheduler = await createScheduler(retention);
    for (const seed of REFERENCE_SEEDS) cases.push(computeReferenceCase(scheduler, retention, seed));
  }
  return cases;
}
