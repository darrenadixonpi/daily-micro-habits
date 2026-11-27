/**
 * Migration 3 (M3 + M4): learning modules, content assignment and generation accounting.
 *
 * Additive only, so a backup written at version 2 restores into this schema by inserting
 * its columns; the new columns take their defaults (see backup_codec.restoreBackupDocument).
 *
 * content_item
 *   assigned_on      Logical day the item is assigned to: today's item, or a reserved future
 *                    day (A1, so the morning notification can name the word in advance).
 *   parent_id        For generated A3 variants (Simpler / Go deeper): the concept they rework.
 *                    Variants never enter the selection pool.
 *   excluded_reason  Why Report error excluded the item.
 *   imported_at      When the bundled item was first imported.
 * generation_request
 *   kind, model, input/output token counts and the error text, so the monthly budget and the
 *   cost estimate in spec Section 6 can be checked against measured values.
 */
export const M0003_LEARNING_AND_GENERATION = `
ALTER TABLE content_item ADD COLUMN assigned_on TEXT;
ALTER TABLE content_item ADD COLUMN parent_id TEXT;
ALTER TABLE content_item ADD COLUMN excluded_reason TEXT;
ALTER TABLE content_item ADD COLUMN imported_at TEXT;
CREATE INDEX content_item_by_assignment ON content_item (module, assigned_on);

ALTER TABLE generation_request ADD COLUMN kind TEXT NOT NULL DEFAULT 'refill';
ALTER TABLE generation_request ADD COLUMN model TEXT;
ALTER TABLE generation_request ADD COLUMN input_tokens INTEGER;
ALTER TABLE generation_request ADD COLUMN output_tokens INTEGER;
ALTER TABLE generation_request ADD COLUMN error TEXT;

CREATE INDEX srs_card_by_content ON srs_card (content_item_id);
CREATE INDEX task_completion_by_module ON task_completion (module, date);
CREATE INDEX srs_review_log_by_time ON srs_review_log (reviewed_at);
`;
