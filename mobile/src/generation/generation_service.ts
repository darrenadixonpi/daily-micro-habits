import { countUnserved, servedTitles } from '../content/content_repository';
import type { A3Concept, ContentItem, LearningModuleId } from '../content/content_types';
import { CEFR_LEVELS } from '../content/content_types';
import { runInTransaction, type SqlExecutor } from '../platform/sql_executor';
import type { SettingValue } from '../settings/settings_definitions';
import { createMessage, type FetchLike } from './anthropic_client';
import {
  a1RefillPrompt,
  a3RefillPrompt,
  a3VariantPrompt,
  a4RefillPrompt,
  BATCH_SIZE,
  EXPLAINER_WORDS,
  SYSTEM_PROMPT,
} from './generation_prompts';
import { extractJson, validateA1Batch, validateA3Batch, validateA4Batch } from './generation_validation';

/**
 * Generation pipeline (spec Section 6). Runs in the background while the app is open and
 * online, never at notification time. Every request is recorded in generation_request
 * before it is sent, so the monthly request budget is a hard cap even when a request fails.
 */
export const A1_REFILL_BELOW = 30;
export const A3_REFILL_BELOW = 14;
export const A4_REFILL_BELOW = 30;
/** A failed request for a module is not retried for this long. */
export const RETRY_AFTER_FAILURE_MS = 6 * 3_600_000;

export type GenerationKind = 'refill' | 'variant_simpler' | 'variant_deeper';

export interface GenerationDeps {
  readonly executor: SqlExecutor;
  readonly fetchImpl: FetchLike;
  readonly apiKey: string;
  readonly settings: ReadonlyMap<string, SettingValue>;
  readonly now: Date;
}

export interface GenerationOutcome {
  readonly requestId: number;
  readonly module: LearningModuleId;
  readonly kind: GenerationKind;
  readonly status: 'succeeded' | 'failed' | 'rejected';
  readonly accepted: number;
  readonly requested: number;
  readonly error: string | null;
  readonly itemIds: readonly string[];
}

export interface RefillNeed {
  readonly module: 'A1' | 'A3' | 'A4';
  readonly reason: string;
  readonly tier?: string;
  readonly domain?: string;
  readonly language?: string;
  readonly level?: string;
}

const list = (value: SettingValue | undefined): string[] => (Array.isArray(value) ? [...(value as readonly string[])] : []);

/** First instant of the current calendar month, UTC (the budget period). */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function requestsThisMonth(executor: SqlExecutor, now: Date): number {
  return executor.get<{ n: number }>('SELECT count(*) AS n FROM generation_request WHERE requested_at >= ?', [monthStart(now).toISOString()])?.n ?? 0;
}

export function monthlyBudget(settings: ReadonlyMap<string, SettingValue>): number {
  return Number(settings.get('generation.monthly_request_budget') ?? 100);
}

export function budgetRemaining(executor: SqlExecutor, settings: ReadonlyMap<string, SettingValue>, now: Date): number {
  return Math.max(0, monthlyBudget(settings) - requestsThisMonth(executor, now));
}

export interface GenerationUsage {
  readonly requests: number;
  readonly budget: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly itemsAccepted: number;
  readonly lastError: string | null;
}

export function generationUsage(executor: SqlExecutor, settings: ReadonlyMap<string, SettingValue>, now: Date): GenerationUsage {
  const since = monthStart(now).toISOString();
  const row = executor.get<{ n: number; input: number | null; output: number | null; accepted: number | null }>(
    `SELECT count(*) AS n, sum(input_tokens) AS input, sum(output_tokens) AS output, sum(items_accepted) AS accepted
     FROM generation_request WHERE requested_at >= ?`,
    [since],
  );
  const last = executor.get<{ error: string | null }>("SELECT error FROM generation_request WHERE status = 'failed' AND requested_at >= ? ORDER BY id DESC LIMIT 1", [since]);
  return {
    requests: row?.n ?? 0,
    budget: monthlyBudget(settings),
    inputTokens: row?.input ?? 0,
    outputTokens: row?.output ?? 0,
    itemsAccepted: row?.accepted ?? 0,
    lastError: last?.error ?? null,
  };
}

function recentlyFailed(executor: SqlExecutor, module: string, now: Date): boolean {
  return (
    executor.get(
      "SELECT 1 AS present FROM generation_request WHERE module = ? AND status IN ('failed', 'rejected') AND requested_at >= ?",
      [module, new Date(now.getTime() - RETRY_AFTER_FAILURE_MS).toISOString()],
    ) !== undefined
  );
}

/** Which modules are below their refill trigger (spec Section 6 table), in priority order. */
export function refillNeeds(executor: SqlExecutor, settings: ReadonlyMap<string, SettingValue>): RefillNeed[] {
  const enabled = list(settings.get('modules.enabled'));
  const needs: RefillNeed[] = [];
  if (enabled.includes('A4')) {
    const language = String(settings.get('a4.target_language') ?? 'es-419');
    const level = String(settings.get('a4.level') ?? 'A2');
    const allowed = CEFR_LEVELS.slice(0, CEFR_LEVELS.indexOf(level as (typeof CEFR_LEVELS)[number]) + 1);
    const available = allowed.reduce((sum, cefr) => sum + countUnserved(executor, 'A4', { language, tierOrLevel: cefr }), 0);
    if (available < A4_REFILL_BELOW) needs.push({ module: 'A4', reason: `${available} unserved ${language} phrases at or below ${level}`, language, level });
  }
  if (enabled.includes('A1')) {
    const tier = String(settings.get('a1.tier') ?? '2');
    const available = countUnserved(executor, 'A1', { tierOrLevel: tier });
    if (available < A1_REFILL_BELOW) needs.push({ module: 'A1', reason: `${available} unserved tier-${tier} words`, tier });
  }
  if (enabled.includes('A3') && settings.get('a3.allow_generated') === true) {
    const domains = [...list(settings.get('a3.core_domains')), ...list(settings.get('a3.optional_domains'))];
    const counts = domains.map((domain) => ({ domain, available: countUnserved(executor, 'A3', { domain }) }));
    const lowest = counts.filter((entry) => entry.available < A3_REFILL_BELOW).sort((a, b) => a.available - b.available)[0];
    if (lowest) needs.push({ module: 'A3', reason: `${lowest.available} unserved concepts in ${lowest.domain}`, domain: lowest.domain });
  }
  return needs;
}

function existingTitles(executor: SqlExecutor, module: LearningModuleId, where: string, params: string[]): string[] {
  const pool = executor
    .all<{ payload_json: string }>(`SELECT payload_json FROM content_item WHERE module = ? AND ${where} LIMIT 300`, [module, ...params])
    .map((row) => {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      return String(payload.headword ?? payload.title ?? payload.phrase ?? '');
    });
  return [...new Set([...servedTitles(executor, module), ...pool])].filter(Boolean);
}

function startRequest(executor: SqlExecutor, input: { module: LearningModuleId; kind: GenerationKind; model: string; items: number; now: Date }): number {
  return executor.run(
    "INSERT INTO generation_request (module, requested_at, items_requested, items_accepted, status, kind, model) VALUES (?, ?, ?, 0, 'pending', ?, ?)",
    [input.module, input.now.toISOString(), input.items, input.kind, input.model],
  ).lastInsertRowId;
}

function finishRequest(
  executor: SqlExecutor,
  id: number,
  update: { status: 'succeeded' | 'failed' | 'rejected'; accepted: number; inputTokens: number | null; outputTokens: number | null; error: string | null },
): void {
  executor.run(
    'UPDATE generation_request SET status = ?, items_accepted = ?, input_tokens = ?, output_tokens = ?, error = ? WHERE id = ?',
    [update.status, update.accepted, update.inputTokens, update.outputTokens, update.error ? update.error.slice(0, 500) : null, id],
  );
}

interface PreparedRequest {
  readonly module: LearningModuleId;
  readonly kind: GenerationKind;
  readonly items: number;
  readonly prompt: string;
  readonly maxTokens: number;
  /** Validates the reply and returns rows to insert (without IDs). */
  readonly accept: (reply: unknown) => { rows: { payload: Record<string, unknown>; language: string; tierOrLevel: string | null; domain: string | null; parentId: string | null; served: boolean }[]; rejectedReasons: string[] };
}

async function execute(deps: GenerationDeps, prepared: PreparedRequest, today: string | null): Promise<GenerationOutcome> {
  const { executor, now } = deps;
  if (budgetRemaining(executor, deps.settings, now) < 1) throw new Error('Monthly request budget reached; using bundled content only');
  const model = String(deps.settings.get('generation.model') ?? 'claude-opus-5-5');
  const requestId = startRequest(executor, { module: prepared.module, kind: prepared.kind, model, items: prepared.items, now });
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  try {
    const result = await createMessage(deps.fetchImpl, { apiKey: deps.apiKey, model, system: SYSTEM_PROMPT, prompt: prepared.prompt, maxTokens: prepared.maxTokens });
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
    const { rows, rejectedReasons } = prepared.accept(extractJson(result.text));
    const itemIds: string[] = [];
    runInTransaction(executor, () => {
      rows.forEach((row, index) => {
        const id = `gen-${prepared.module.toLowerCase()}-${requestId}-${index + 1}`;
        const payload = { ...row.payload, id };
        executor.run(
          `INSERT INTO content_item (id, module, language, tier_or_level, domain, payload_json, source, status, served_on, assigned_on, parent_id, generation_request_id, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, 'generated', ?, ?, ?, ?, ?, ?)`,
          [
            id, prepared.module, row.language, row.tierOrLevel, row.domain, JSON.stringify(payload),
            row.served ? 'served' : 'unserved', row.served ? today : null, null, row.parentId, requestId, now.toISOString(),
          ],
        );
        itemIds.push(id);
      });
      finishRequest(executor, requestId, {
        status: rows.length > 0 ? 'succeeded' : 'rejected',
        accepted: rows.length,
        inputTokens,
        outputTokens,
        error: rows.length > 0 ? null : `all items rejected: ${rejectedReasons.slice(0, 3).join('; ')}`,
      });
    });
    return {
      requestId, module: prepared.module, kind: prepared.kind, status: rows.length > 0 ? 'succeeded' : 'rejected',
      accepted: rows.length, requested: prepared.items, error: rows.length > 0 ? null : 'all items rejected', itemIds,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishRequest(executor, requestId, { status: 'failed', accepted: 0, inputTokens, outputTokens, error: message });
    return { requestId, module: prepared.module, kind: prepared.kind, status: 'failed', accepted: 0, requested: prepared.items, error: message, itemIds: [] };
  }
}

function prepareRefill(executor: SqlExecutor, settings: ReadonlyMap<string, SettingValue>, need: RefillNeed): PreparedRequest {
  if (need.module === 'A1') {
    const tier = need.tier ?? '2';
    const existing = existingTitles(executor, 'A1', 'tier_or_level = ?', [tier]);
    return {
      module: 'A1', kind: 'refill', items: BATCH_SIZE, prompt: a1RefillPrompt(tier, existing), maxTokens: 4000,
      accept: (reply) => {
        const outcome = validateA1Batch(reply, { tier, existing });
        return {
          rows: outcome.accepted.map((word) => ({ payload: { ...word }, language: 'en', tierOrLevel: tier, domain: null, parentId: null, served: false })),
          rejectedReasons: outcome.rejected.map((r) => r.reason),
        };
      },
    };
  }
  if (need.module === 'A4') {
    const language = need.language ?? 'es-419';
    const level = need.level ?? 'A2';
    const existing = existingTitles(executor, 'A4', 'language = ?', [language]);
    return {
      module: 'A4', kind: 'refill', items: BATCH_SIZE, prompt: a4RefillPrompt(language, level, existing), maxTokens: 4000,
      accept: (reply) => {
        const outcome = validateA4Batch(reply, { language, level, existing });
        return {
          rows: outcome.accepted.map((phrase) => ({ payload: { ...phrase }, language, tierOrLevel: level, domain: null, parentId: null, served: false })),
          rejectedReasons: outcome.rejected.map((r) => r.reason),
        };
      },
    };
  }
  const domain = need.domain ?? 'physics';
  const depth = String(settings.get('a3.depth') ?? 'intermediate');
  const explainerLength = String(settings.get('a3.explainer_length') ?? 'standard');
  const existing = existingTitles(executor, 'A3', 'domain = ?', [domain]);
  return {
    module: 'A3', kind: 'refill', items: BATCH_SIZE, maxTokens: 12000,
    prompt: a3RefillPrompt({ domain, depth, explainerLength, includeFormulas: settings.get('a3.include_formulas') === true, existing }),
    accept: (reply) => {
      const outcome = validateA3Batch(reply, { domain, explainerWords: EXPLAINER_WORDS[explainerLength] ?? 250, existing });
      return {
        rows: outcome.accepted.map((concept) => ({ payload: { ...concept }, language: 'en', tierOrLevel: concept.depth, domain, parentId: null, served: false })),
        rejectedReasons: outcome.rejected.map((r) => r.reason),
      };
    },
  };
}

/**
 * One background refill: the first module below its trigger that has not failed in the last
 * six hours. Returns null when nothing is needed or the budget is used up.
 */
export async function runOneRefill(deps: GenerationDeps): Promise<GenerationOutcome | null> {
  if (budgetRemaining(deps.executor, deps.settings, deps.now) < 1) return null;
  const need = refillNeeds(deps.executor, deps.settings).find((candidate) => !recentlyFailed(deps.executor, candidate.module, deps.now));
  if (!need) return null;
  return execute(deps, prepareRefill(deps.executor, deps.settings, need), null);
}

/** A3 per-concept tweak: Simpler or Go deeper, stored as a served variant of the concept. */
export async function generateConceptVariant(
  deps: GenerationDeps,
  input: { readonly concept: ContentItem<'A3'>; readonly kind: 'simpler' | 'deeper'; readonly today: string },
): Promise<GenerationOutcome> {
  const explainerLength = String(deps.settings.get('a3.explainer_length') ?? 'standard');
  const parent = input.concept.payload;
  return execute(
    deps,
    {
      module: 'A3',
      kind: input.kind === 'simpler' ? 'variant_simpler' : 'variant_deeper',
      items: 1,
      maxTokens: 3000,
      prompt: a3VariantPrompt(parent, input.kind, explainerLength),
      accept: (reply) => {
        const outcome = validateA3Batch(reply, { domain: parent.domain, explainerWords: EXPLAINER_WORDS[explainerLength] ?? 250, existing: [] });
        return {
          rows: outcome.accepted.slice(0, 1).map((concept) => ({
            payload: { ...concept, variant: input.kind } satisfies Omit<A3Concept, 'id'>,
            language: 'en',
            tierOrLevel: concept.depth,
            domain: parent.domain,
            parentId: input.concept.row.id,
            served: true,
          })),
          rejectedReasons: outcome.rejected.map((r) => r.reason),
        };
      },
    },
    input.today,
  );
}
