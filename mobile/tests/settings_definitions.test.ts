import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runMigrations } from '../src/db/run_migrations';
import { SETTING_DEFINITIONS, validateSettingValue } from '../src/settings/settings_definitions';
import { readAllSettings, writeSetting } from '../src/settings/settings_repository';
import { openNodeDatabase } from './support/node_sqlite_executor';

test('every default value satisfies its own definition', () => {
  for (const definition of SETTING_DEFINITIONS) {
    assert.equal(validateSettingValue(definition, definition.defaultValue), null, definition.key);
  }
});

test('setting keys are unique', () => {
  const keys = SETTING_DEFINITIONS.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('out-of-range and malformed values are rejected', () => {
  const executor = openNodeDatabase();
  runMigrations(executor);
  assert.throws(() => writeSetting(executor, 'a2.target_retention', 0.99));
  assert.throws(() => writeSetting(executor, 'a2.daily_review_cap', 7));
  assert.throws(() => writeSetting(executor, 'schedule.morning_time', '7:30'));
  assert.throws(() => writeSetting(executor, 'a4.level', 'C2'));
  assert.throws(() => writeSetting(executor, 'modules.enabled', []));
  assert.throws(() => writeSetting(executor, 'no.such.key', true));
  executor.close();
});

test('stored values override defaults and survive a re-read', () => {
  const executor = openNodeDatabase();
  runMigrations(executor);
  writeSetting(executor, 'a2.target_retention', 0.85);
  writeSetting(executor, 'schedule.morning_time', '06:45');
  const values = readAllSettings(executor);
  assert.equal(values.get('a2.target_retention'), 0.85);
  assert.equal(values.get('schedule.morning_time'), '06:45');
  assert.equal(values.get('a4.target_language'), 'es-419');
  executor.close();
});
