/**
 * Every user setting from spec Section 3, with its default and allowed values.
 * Stored in the settings table as JSON under `key`. The Anthropic API key is not a
 * setting row: it lives in the Keychain (see settings_secrets.ts). The recovery
 * passphrase is set in first-launch setup (M2) and is never stored.
 */
export type SettingValue = string | number | boolean | readonly string[];

interface BaseDefinition<Kind extends string, Value extends SettingValue> {
  readonly key: string;
  readonly group: string;
  readonly label: string;
  readonly kind: Kind;
  readonly defaultValue: Value;
  /** Milestone in which the setting starts to change app behaviour. */
  readonly effectiveFrom: 'M2' | 'M3' | 'M4';
  readonly note?: string;
}

export type TimeSetting = BaseDefinition<'time', string>;
export type BooleanSetting = BaseDefinition<'boolean', boolean>;
export interface NumberSetting extends BaseDefinition<'number', number> {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}
export interface ChoiceSetting extends BaseDefinition<'choice', string> {
  readonly options: readonly { readonly value: string; readonly label: string }[];
}
export interface MultiChoiceSetting extends BaseDefinition<'multichoice', readonly string[]> {
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly minSelected: number;
}
export type TextSetting = BaseDefinition<'text', string>;

export type SettingDefinition =
  | TimeSetting
  | BooleanSetting
  | NumberSetting
  | ChoiceSetting
  | MultiChoiceSetting
  | TextSetting;

const option = (value: string, label: string) => ({ value, label });

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  // Schedule
  { key: 'schedule.morning_time', group: 'Schedule', label: 'Morning window', kind: 'time', defaultValue: '07:30', effectiveFrom: 'M2' },
  { key: 'schedule.evening_time', group: 'Schedule', label: 'Evening window', kind: 'time', defaultValue: '21:00', effectiveFrom: 'M2' },
  { key: 'schedule.weekend_times_enabled', group: 'Schedule', label: 'Separate weekend times', kind: 'boolean', defaultValue: false, effectiveFrom: 'M2' },
  { key: 'schedule.weekend_morning_time', group: 'Schedule', label: 'Weekend morning window', kind: 'time', defaultValue: '08:30', effectiveFrom: 'M2' },
  { key: 'schedule.weekend_evening_time', group: 'Schedule', label: 'Weekend evening window', kind: 'time', defaultValue: '21:00', effectiveFrom: 'M2' },
  {
    key: 'schedule.time_zone_mode', group: 'Schedule', label: 'Time zone', kind: 'choice', defaultValue: 'follow_device',
    options: [option('follow_device', 'Follow device'), option('fixed', 'Fixed')], effectiveFrom: 'M2',
  },
  {
    key: 'schedule.fixed_time_zone', group: 'Schedule', label: 'Fixed time zone (IANA name)', kind: 'text', defaultValue: '',
    effectiveFrom: 'M2', note: 'Used only when Time zone is Fixed, e.g. America/New_York',
  },
  // Modules
  {
    key: 'modules.enabled', group: 'Modules', label: 'Enabled modules', kind: 'multichoice',
    defaultValue: ['A1', 'A2', 'A3', 'A4', 'A5', 'D1', 'D2', 'D3'], minSelected: 1, effectiveFrom: 'M2',
    options: [
      option('A1', 'A1 Word of the day'), option('A2', 'A2 Review'), option('A3', 'A3 Concept'),
      option('A4', 'A4 Language'), option('A5', 'A5 On this day'), option('D1', 'D1 Morning top-3'),
      option('D2', 'D2 Evening review'), option('D3', 'D3 Journal'),
    ],
  },
  // A1
  {
    key: 'a1.tier', group: 'A1 Word', label: 'Difficulty tier', kind: 'choice', defaultValue: '2', effectiveFrom: 'M3',
    options: [option('1', '1 Common'), option('2', '2 Advanced'), option('3', '3 Rare')],
    note: 'All three tiers have bundled words; tier 2 is the default. Only tiers that have words are offered (decision G3).',
  },
  // A2
  { key: 'a2.daily_review_cap', group: 'A2 Review', label: 'Daily review cap', kind: 'number', defaultValue: 20, min: 5, max: 100, step: 5, effectiveFrom: 'M3' },
  { key: 'a2.target_retention', group: 'A2 Review', label: 'Target retention', kind: 'number', defaultValue: 0.9, min: 0.8, max: 0.95, step: 0.01, effectiveFrom: 'M3' },
  // A3
  {
    key: 'a3.core_domains', group: 'A3 Concept', label: 'Core domains', kind: 'multichoice', minSelected: 0, effectiveFrom: 'M3',
    defaultValue: ['ai_ml', 'chemistry', 'physics', 'biology', 'biomedicine', 'drug_discovery'],
    options: [
      option('ai_ml', 'AI & machine learning'), option('chemistry', 'Chemistry'), option('physics', 'Physics'),
      option('biology', 'Biology'), option('biomedicine', 'Biomedicine'),
      option('drug_discovery', 'Drug development & discovery'),
    ],
  },
  {
    key: 'a3.optional_domains', group: 'A3 Concept', label: 'Optional domains', kind: 'multichoice', minSelected: 0,
    defaultValue: [], effectiveFrom: 'M3',
    options: [option('statistics_data_science', 'Statistics & data science'), option('mathematics', 'Mathematics')],
  },
  {
    key: 'a3.depth', group: 'A3 Concept', label: 'Depth', kind: 'choice', defaultValue: 'intermediate', effectiveFrom: 'M3',
    options: [option('introductory', 'Introductory'), option('intermediate', 'Intermediate'), option('advanced', 'Advanced')],
  },
  {
    key: 'a3.explainer_length', group: 'A3 Concept', label: 'Explainer length', kind: 'choice', defaultValue: 'standard',
    effectiveFrom: 'M3',
    options: [option('short', 'Short (~150 words)'), option('standard', 'Standard (~250)'), option('long', 'Long (~400)')],
  },
  { key: 'a3.include_formulas', group: 'A3 Concept', label: 'Include formulas', kind: 'boolean', defaultValue: true, effectiveFrom: 'M3' },
  { key: 'a3.allow_generated', group: 'A3 Concept', label: 'Allow generated concepts', kind: 'boolean', defaultValue: false, effectiveFrom: 'M4' },
  // A4
  {
    key: 'a4.target_language', group: 'A4 Language', label: 'Target language', kind: 'choice', defaultValue: 'es-419',
    effectiveFrom: 'M3', note: 'Only Spanish (es-419) is bundled; other languages need generation and an API key',
    options: [
      option('es-419', 'Spanish, Latin American (es-419)'), option('fr', 'French (fr)'), option('de', 'German (de)'),
      option('it', 'Italian (it)'), option('pt-BR', 'Portuguese, Brazil (pt-BR)'), option('ja', 'Japanese (ja)'),
      option('ko', 'Korean (ko)'), option('zh-Hans', 'Chinese, Simplified (zh-Hans)'),
    ],
  },
  {
    key: 'a4.level', group: 'A4 Language', label: 'Level (CEFR)', kind: 'choice', defaultValue: 'A2', effectiveFrom: 'M3',
    options: ['A1', 'A2', 'B1', 'B2', 'C1'].map((level) => option(level, level)),
  },
  {
    key: 'a4.accent_strictness', group: 'A4 Language', label: 'Accent strictness', kind: 'choice',
    defaultValue: 'accents_optional', effectiveFrom: 'M3',
    options: [option('exact', 'Exact'), option('accents_optional', 'Accents optional')],
  },
  {
    key: 'a4.speech_voice', group: 'A4 Language', label: 'Speech voice', kind: 'text', defaultValue: 'es-MX', effectiveFrom: 'M3',
    note: 'A language tag such as es-MX (the system voice), or an installed voice picked below',
  },
  { key: 'a4.speech_rate', group: 'A4 Language', label: 'Speech rate', kind: 'number', defaultValue: 0.8, min: 0.5, max: 1, step: 0.05, effectiveFrom: 'M3' },
  // D3
  { key: 'd3.daily_prompt', group: 'D3 Journal', label: 'Daily prompt', kind: 'boolean', defaultValue: false, effectiveFrom: 'M2' },
  { key: 'd3.mood_score', group: 'D3 Journal', label: 'Mood score', kind: 'boolean', defaultValue: false, effectiveFrom: 'M2' },
  // Streaks
  {
    key: 'streaks.freeze_earn_days', group: 'Streaks', label: 'Days per earned freeze', kind: 'number', defaultValue: 7,
    min: 3, max: 30, step: 1, effectiveFrom: 'M2',
  },
  // Privacy
  {
    key: 'privacy.app_lock', group: 'Privacy', label: 'App lock', kind: 'choice', defaultValue: 'off', effectiveFrom: 'M2',
    options: [option('biometric', 'Biometric'), option('device_pin', 'Device PIN'), option('off', 'Off')],
  },
  // Backup
  { key: 'backup.daily_file_enabled', group: 'Backup', label: 'Daily backup file', kind: 'boolean', defaultValue: true, effectiveFrom: 'M2' },
  { key: 'backup.retention_files', group: 'Backup', label: 'Backup files kept', kind: 'number', defaultValue: 14, min: 7, max: 60, step: 1, effectiveFrom: 'M2' },
  // Generation
  {
    key: 'generation.provider', group: 'Generation', label: 'Provider', kind: 'choice', defaultValue: 'anthropic', effectiveFrom: 'M4',
    options: [option('anthropic', 'Anthropic API')],
  },
  {
    key: 'generation.model', group: 'Generation', label: 'Model', kind: 'choice', defaultValue: 'claude-opus-5-5', effectiveFrom: 'M4',
    options: [
      option('claude-opus-5-5', 'Opus 5.5'), option('claude-sonnet-5-5', 'Sonnet 5.5'), option('claude-haiku-5-5', 'Haiku 5.5'),
    ],
  },
  {
    key: 'generation.monthly_request_budget', group: 'Generation', label: 'Monthly request budget', kind: 'number',
    defaultValue: 100, min: 0, max: 1000, step: 10, effectiveFrom: 'M4',
  },
];

export const SETTING_DEFINITIONS_BY_KEY: ReadonlyMap<string, SettingDefinition> = new Map(
  SETTING_DEFINITIONS.map((definition) => [definition.key, definition]),
);

/** Returns null if the value is valid for the definition, otherwise a reason. */
export function validateSettingValue(definition: SettingDefinition, value: unknown): string | null {
  switch (definition.kind) {
    case 'time':
      return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? null : 'Expected HH:MM (24-hour)';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Expected true or false';
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Expected a number';
      if (value < definition.min - 1e-9 || value > definition.max + 1e-9) {
        return `Expected ${definition.min}–${definition.max}`;
      }
      const steps = (value - definition.min) / definition.step;
      return Math.abs(steps - Math.round(steps)) < 1e-6 ? null : `Expected a multiple of ${definition.step}`;
    }
    case 'choice':
      return typeof value === 'string' && definition.options.some((o) => o.value === value) ? null : 'Not an allowed option';
    case 'multichoice': {
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return 'Expected a list of options';
      if (new Set(value).size !== value.length) return 'Duplicate options';
      if (!value.every((item) => definition.options.some((o) => o.value === item))) return 'Not an allowed option';
      return value.length >= definition.minSelected ? null : `Select at least ${definition.minSelected}`;
    }
    case 'text':
      if (typeof value !== 'string') return 'Expected text';
      if (definition.key === 'schedule.fixed_time_zone' && value !== '' && !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(value)) {
        return 'Expected an IANA time zone such as America/New_York';
      }
      return value.length <= 100 ? null : 'Too long';
  }
}
