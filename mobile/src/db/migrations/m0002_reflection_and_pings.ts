/**
 * Migration 2 (M2): notification history for the ping log, and journal edit times.
 *
 * notification_schedule rows now outlive their firing: status records whether a
 * scheduled notification fired, was suppressed because its window was already
 * complete, or was cancelled. `date` is the logical day (03:00 boundary) it belongs to.
 */
export const M0002_REFLECTION_AND_PINGS = `
ALTER TABLE notification_schedule ADD COLUMN date TEXT;
ALTER TABLE notification_schedule ADD COLUMN status TEXT NOT NULL DEFAULT 'scheduled'
  CHECK (status IN ('scheduled', 'fired', 'suppressed', 'cancelled'));
ALTER TABLE notification_schedule ADD COLUMN status_changed_at TEXT;
CREATE INDEX notification_schedule_by_date ON notification_schedule (date, window);

ALTER TABLE journal_entry ADD COLUMN last_edited_at TEXT;
CREATE INDEX priority_by_date ON priority (date);
`;
