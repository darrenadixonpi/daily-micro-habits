import type { SqlExecutor } from '../platform/sql_executor';
import { writeSetting } from '../settings/settings_repository';
import { GRADES, type AppScheduler } from '../srs/fsrs_scheduler';
import { createSrsCard, recordReview } from '../srs/review_service';

/** Distinctive word used to prove journal search works after a restore. */
export const SAMPLE_JOURNAL_SEARCH_TERM = 'photosynthesis';

/** Fills every data table of a freshly migrated scratch database with a few realistic rows. */
export function insertSampleRows(executor: SqlExecutor, scheduler: AppScheduler): void {
  const now = new Date(Date.UTC(2026, 10, 26, 18, 0, 0));
  writeSetting(executor, 'a2.target_retention', 0.85, now);
  writeSetting(executor, 'modules.enabled', ['A1', 'A2', 'D3'], now);
  executor.run(
    `INSERT INTO generation_request (module, requested_at, items_requested, items_accepted, status)
     VALUES ('A3', ?, 5, 4, 'succeeded')`,
    [now.toISOString()],
  );
  const items: [string, string, string | null][] = [
    ['a1-t2-0001', 'A1', 'en'],
    ['a3-physics-0001', 'A3', null],
    ['a4-es-419-0001', 'A4', 'es-419'],
  ];
  for (const [id, module, language] of items) {
    executor.run(
      `INSERT INTO content_item (id, module, language, tier_or_level, domain, payload_json, source, status, served_on)
       VALUES (?, ?, ?, '2', NULL, ?, 'bundled', 'served', '2026-11-26')`,
      [id, module, language, JSON.stringify({ sample: true, text: `Sample ${id} — ñ, é, 日本` })],
    );
  }
  executor.run(`INSERT INTO daily_session (date, morning_completed_at, evening_completed_at, freeze_used)
                VALUES ('2026-11-26', ?, NULL, 0)`, [now.toISOString()]);
  executor.run(
    `INSERT INTO task_completion (date, module, content_item_id, completed_at, response_json)
     VALUES ('2026-11-26', 'A1', 'a1-t2-0001', ?, '{"sentence":"A sample sentence."}')`,
    [now.toISOString()],
  );
  createSrsCard(executor, scheduler, {
    cardId: 'card-sample-1', contentItemId: 'a4-es-419-0001', cardType: 'production', language: 'es-419',
    now, dueAt: now,
  });
  let reviewTime = now;
  for (const grade of [GRADES[2], GRADES[0], GRADES[2]]) {
    const card = recordReview(executor, scheduler, {
      cardId: 'card-sample-1', grade: grade as (typeof GRADES)[number], now: reviewTime, responseMs: 4200,
    });
    reviewTime = new Date(card.dueAt.getTime() + 60_000);
  }
  executor.run(`INSERT INTO priority (date, position, text, status) VALUES ('2026-11-26', 1, 'Finish M1', 'done')`);
  executor.run(
    `INSERT INTO priority (date, position, text, status, carried_from_id) VALUES ('2026-11-27', 1, 'Finish M1', 'open', 1)`,
  );
  executor.run(
    `INSERT INTO journal_entry (date, body_md, mood, prompt_id, created_at, updated_at)
     VALUES ('2026-11-26', ?, 4, NULL, ?, ?)`,
    [`Read about ${SAMPLE_JOURNAL_SEARCH_TERM} today.\n\nSecond paragraph.`, now.toISOString(), now.toISOString()],
  );
  executor.run(
    `INSERT INTO notification_schedule (os_notification_id, window, fire_at, summary)
     VALUES ('sample-os-id', 'evening', ?, '3 review cards due')`,
    [now.toISOString()],
  );
  executor.run(`INSERT INTO streak_freeze (earned_on, used_on) VALUES ('2026-11-20', '2026-11-26')`);
}
