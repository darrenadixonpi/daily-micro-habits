import { M0001_INITIAL_SCHEMA } from './migrations/m0001_initial_schema';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/** Forward-only migrations, in order. The database's PRAGMA user_version equals the last applied version. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'm0001_initial_schema', sql: M0001_INITIAL_SCHEMA },
];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

/** The main database file in the app's SQLite directory. */
export const MAIN_DATABASE_NAME = 'microhabits.db';

/**
 * Data tables in foreign-key order (parents first). Used by backup export/restore.
 * journal_fts is excluded: it is an index rebuilt from journal_entry.
 */
export const DATA_TABLES_IN_DEPENDENCY_ORDER = [
  'settings',
  'generation_request',
  'content_item',
  'daily_session',
  'task_completion',
  'srs_card',
  'srs_review_log',
  'priority',
  'journal_entry',
  'notification_schedule',
  'streak_freeze',
] as const;

export type DataTableName = (typeof DATA_TABLES_IN_DEPENDENCY_ORDER)[number];

/** Primary-key column used to order rows deterministically. */
export const PRIMARY_KEY_BY_TABLE: Record<DataTableName, string> = {
  settings: 'key',
  generation_request: 'id',
  content_item: 'id',
  daily_session: 'date',
  task_completion: 'id',
  srs_card: 'id',
  srs_review_log: 'id',
  priority: 'id',
  journal_entry: 'id',
  notification_schedule: 'id',
  streak_freeze: 'id',
};

/** Expected columns per table after the latest migration; checked by diagnostic T2. */
export const EXPECTED_COLUMNS: Record<DataTableName, readonly string[]> = {
  settings: ['key', 'value_json', 'updated_at'],
  generation_request: ['id', 'module', 'requested_at', 'items_requested', 'items_accepted', 'status'],
  content_item: [
    'id', 'module', 'language', 'tier_or_level', 'domain', 'payload_json', 'source', 'status', 'served_on',
    'generation_request_id',
  ],
  daily_session: ['date', 'morning_completed_at', 'evening_completed_at', 'freeze_used'],
  task_completion: ['id', 'date', 'module', 'content_item_id', 'completed_at', 'response_json'],
  srs_card: [
    'id', 'content_item_id', 'card_type', 'language', 'due', 'stability', 'difficulty', 'scheduled_days',
    'learning_step', 'reps', 'lapses', 'state', 'schedule_status', 'last_review', 'suspended',
    'scheduler_card_json', 'created_at',
  ],
  srs_review_log: [
    'id', 'card_id', 'grade', 'reviewed_at', 'elapsed_days', 'scheduled_days', 'response_ms', 'state_before',
    'revlog_json',
  ],
  priority: ['id', 'date', 'position', 'text', 'status', 'note', 'carried_from_id'],
  journal_entry: ['id', 'date', 'body_md', 'mood', 'prompt_id', 'created_at', 'updated_at'],
  notification_schedule: ['id', 'os_notification_id', 'window', 'fire_at', 'summary'],
  streak_freeze: ['id', 'earned_on', 'used_on'],
};
