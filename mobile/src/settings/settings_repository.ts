import type { SqlExecutor } from '../platform/sql_executor';
import {
  SETTING_DEFINITIONS,
  SETTING_DEFINITIONS_BY_KEY,
  validateSettingValue,
  type SettingValue,
} from './settings_definitions';

/** Prefix for internal bookkeeping rows in the settings table (not user settings). */
export const INTERNAL_KEY_PREFIX = 'internal.';

interface SettingRow {
  readonly key: string;
  readonly value_json: string;
}

/** All user settings: stored values where present and valid, defaults otherwise. */
export function readAllSettings(executor: SqlExecutor): Map<string, SettingValue> {
  const stored = new Map(
    executor.all<SettingRow>('SELECT key, value_json FROM settings').map((row) => [row.key, row.value_json]),
  );
  const values = new Map<string, SettingValue>();
  for (const definition of SETTING_DEFINITIONS) {
    const json = stored.get(definition.key);
    let value: SettingValue = definition.defaultValue;
    if (json !== undefined) {
      try {
        const parsed: unknown = JSON.parse(json);
        if (validateSettingValue(definition, parsed) === null) value = parsed as SettingValue;
      } catch {
        // Corrupt value: fall back to the default.
      }
    }
    values.set(definition.key, value);
  }
  return values;
}

export function writeSetting(executor: SqlExecutor, key: string, value: SettingValue, now: Date = new Date()): void {
  const definition = SETTING_DEFINITIONS_BY_KEY.get(key);
  if (!definition) throw new Error(`Unknown setting: ${key}`);
  const problem = validateSettingValue(definition, value);
  if (problem) throw new Error(`${definition.label}: ${problem}`);
  upsertRow(executor, key, JSON.stringify(value), now);
}

export function readInternalValue(executor: SqlExecutor, name: string): unknown {
  const row = executor.get<SettingRow>('SELECT key, value_json FROM settings WHERE key = ?', [INTERNAL_KEY_PREFIX + name]);
  return row ? (JSON.parse(row.value_json) as unknown) : undefined;
}

export function writeInternalValue(executor: SqlExecutor, name: string, value: unknown, now: Date = new Date()): void {
  upsertRow(executor, INTERNAL_KEY_PREFIX + name, JSON.stringify(value), now);
}

function upsertRow(executor: SqlExecutor, key: string, valueJson: string, now: Date): void {
  executor.run(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [key, valueJson, now.toISOString()],
  );
}
