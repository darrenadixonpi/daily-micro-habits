import * as Application from 'expo-application';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { listAllBackupFiles, listBackupNames, writeDailyBackup } from '../../src/backup/daily_backup';
import { a1TiersWithContent } from '../../src/content/content_repository';
import { generationUsage } from '../../src/generation/generation_service';
import { installedVoices, type InstalledVoice } from '../../src/platform/speech';
import { createAppBackupFileStore } from '../../src/platform/app_backup_file_store';
import { appCryptoPrimitives } from '../../src/platform/app_crypto_primitives';
import { readBackupKey, verifyRecoveryPassphrase } from '../../src/security/recovery_passphrase';
import { SETTING_DEFINITIONS, type SettingDefinition, type SettingValue } from '../../src/settings/settings_definitions';
import { readAllSettings, writeSetting } from '../../src/settings/settings_repository';
import { readAnthropicApiKeyPresent, saveAnthropicApiKey } from '../../src/settings/settings_secrets';
import { useAppState } from '../../src/ui/app_state_context';
import { ActionButton, ChipGroup, FormField, NavigationRow, Stepper, SwitchRow } from '../../src/ui/controls';
import { Card, LabelValueRow, ScreenMessage, ScreenScrollView } from '../../src/ui/screen_layout';
import { COLORS, ui } from '../../src/ui/ui_styles';

/** Data and security controls, then every spec Section 3 setting (saved on change, validated). */
export default function SettingsScreen() {
  const { database, refreshDaily } = useAppState();
  const [values, setValues] = useState<Map<string, SettingValue> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (database) setValues(readAllSettings(database.executor));
  }, [database]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, SettingDefinition[]>();
    for (const definition of SETTING_DEFINITIONS) {
      byGroup.set(definition.group, [...(byGroup.get(definition.group) ?? []), definition]);
    }
    return [...byGroup.entries()];
  }, []);

  if (!database || !values) return <ScreenMessage loading />;
  const a1Tiers = a1TiersWithContent(database.executor);

  const save = (key: string, value: SettingValue) => {
    try {
      writeSetting(database.executor, key, value);
      setValues(readAllSettings(database.executor));
      setErrors(({ [key]: _removed, ...rest }) => rest);
      void refreshDaily();
    } catch (error) {
      setErrors((previous) => ({ ...previous, [key]: error instanceof Error ? error.message : String(error) }));
    }
  };

  return (
    <ScreenScrollView testID="screen-settings">
      <DataAndSecurityCard />
      <Text testID="settings-intro" style={ui.muted}>Settings are saved as you change them. Each shows the milestone in which it starts to take effect.</Text>
      {groups.map(([group, definitions]) => (
        <Card key={group} title={group} testID={`settings-group-${group.replace(/\W+/g, '-').toLowerCase()}`}>
          {definitions.map((definition) => (
            <SettingEditor
              key={definition.key}
              definition={withAvailableOptions(definition, values.get(definition.key), a1Tiers)}
              value={values.get(definition.key) ?? definition.defaultValue}
              error={errors[definition.key]}
              onChange={(value) => save(definition.key, value)}
            />
          ))}
          {group === 'A4 Language' ? (
            <VoicePicker
              targetLanguage={String(values.get('a4.target_language'))}
              current={String(values.get('a4.speech_voice'))}
              onPick={(voice) => save('a4.speech_voice', voice)}
            />
          ) : null}
          {group === 'Generation' ? <ApiKeyEditor /> : null}
          {group === 'Generation' ? <GenerationUsageView /> : null}
        </Card>
      ))}
    </ScreenScrollView>
  );
}

/** Decision G3: the A1 tier picker offers only tiers that have words (plus the current value). */
function withAvailableOptions(definition: SettingDefinition, value: SettingValue | undefined, a1Tiers: readonly string[]): SettingDefinition {
  if (definition.key !== 'a1.tier' || definition.kind !== 'choice') return definition;
  return { ...definition, options: definition.options.filter((option) => a1Tiers.includes(option.value) || option.value === value) };
}

/** Installed text-to-speech voices for the A4 language; picking one stores its identifier. */
function VoicePicker({ targetLanguage, current, onPick }: { readonly targetLanguage: string; readonly current: string; readonly onPick: (voice: string) => void }) {
  const [voices, setVoices] = useState<InstalledVoice[] | null>(null);
  useEffect(() => {
    let active = true;
    installedVoices(targetLanguage)
      .then((list) => active && setVoices(list))
      .catch(() => active && setVoices([]));
    return () => {
      active = false;
    };
  }, [targetLanguage]);
  if (voices === null) return <Text style={ui.muted}>Looking for installed voices…</Text>;
  if (voices.length === 0) return <Text style={ui.muted}>No installed voices for this language; the system default is used.</Text>;
  return (
    <View style={{ gap: 6, paddingVertical: 6 }}>
      <Text style={ui.muted}>Installed voices (enhanced voices sound better: iOS Settings → Accessibility → Spoken Content → Voices)</Text>
      <ChipGroup
        testIDPrefix="setting-voice"
        options={voices.slice(0, 24).map((voice) => ({ value: voice.identifier, label: `${voice.name} (${voice.language}${voice.quality === 'Enhanced' ? ', enhanced' : ''})` }))}
        isSelected={(identifier) => identifier === current}
        onPress={onPick}
      />
    </View>
  );
}

/** This month's generation requests against the budget, with measured token counts. */
function GenerationUsageView() {
  const { database, background, runBackgroundNow } = useAppState();
  const [running, setRunning] = useState(false);
  if (!database) return null;
  const usage = generationUsage(database.executor, readAllSettings(database.executor), new Date());
  return (
    <View style={{ gap: 6, paddingVertical: 6 }} testID="settings-generation-usage">
      <LabelValueRow label="Requests this month" value={`${usage.requests} of ${usage.budget}`} />
      <LabelValueRow label="Tokens in / out" value={`${usage.inputTokens.toLocaleString()} / ${usage.outputTokens.toLocaleString()}`} />
      <LabelValueRow label="Items accepted" value={String(usage.itemsAccepted)} />
      {usage.lastError ? <Text style={[ui.muted, { color: COLORS.fail }]}>Last error: {usage.lastError}</Text> : null}
      <Text style={ui.muted}>
        Requests run in the background while the app is open: refills when a module runs low, and A3 Simpler / Go deeper on request. At the
        budget, the app uses bundled content only. Set a matching monthly spend limit in the Anthropic Console as well.
      </Text>
      <ActionButton
        testID="settings-generation-run"
        label={running ? 'Checking…' : 'Check for new content now'}
        disabled={running}
        onPress={() => {
          setRunning(true);
          void runBackgroundNow().finally(() => setRunning(false));
        }}
      />
      {background ? (
        <Text testID="settings-generation-last" style={ui.muted}>
          Last run: {background.generation ? `${background.generation.module} ${background.generation.status}, ${background.generation.accepted}/${background.generation.requested} accepted` : 'no refill needed'}
          {background.onThisDay.length > 0 ? ` · On this day: ${background.onThisDay.join(', ')}` : ''}
        </Text>
      ) : null}
    </View>
  );
}

function SettingEditor({
  definition,
  value,
  error,
  onChange,
}: {
  readonly definition: SettingDefinition;
  readonly value: SettingValue;
  readonly error: string | undefined;
  readonly onChange: (value: SettingValue) => void;
}) {
  const testID = `setting-${definition.key.replace(/\./g, '-')}`;
  if (definition.kind === 'boolean') {
    return (
      <View style={{ paddingVertical: 4 }}>
        <SwitchRow testID={testID} label={`${definition.label} · ${definition.effectiveFrom}`} value={value === true} onChange={onChange} />
      </View>
    );
  }
  return (
    <View style={{ gap: 6, paddingVertical: 6 }}>
      <LabelValueRow label={definition.label} value={definition.effectiveFrom} />
      <EditorControl testID={testID} definition={definition} value={value} onChange={onChange} />
      {definition.note ? <Text style={ui.muted}>{definition.note}</Text> : null}
      {error ? <Text style={[ui.muted, { color: COLORS.fail }]}>{error}</Text> : null}
    </View>
  );
}

function EditorControl({
  definition,
  value,
  onChange,
  testID,
}: {
  readonly definition: SettingDefinition;
  readonly value: SettingValue;
  readonly onChange: (value: SettingValue) => void;
  readonly testID: string;
}) {
  switch (definition.kind) {
    case 'boolean':
      return null;
    case 'choice':
      return <ChipGroup testIDPrefix={testID} options={definition.options} isSelected={(option) => option === value} onPress={onChange} />;
    case 'multichoice': {
      const selected = Array.isArray(value) ? (value as readonly string[]) : [];
      return (
        <ChipGroup
          testIDPrefix={testID}
          options={definition.options}
          isSelected={(option) => selected.includes(option)}
          onPress={(option) =>
            onChange(
              selected.includes(option)
                ? selected.filter((item) => item !== option)
                : definition.options.map((o) => o.value).filter((v) => v === option || selected.includes(v)),
            )
          }
        />
      );
    }
    case 'number': {
      const current = typeof value === 'number' ? value : definition.defaultValue;
      const decimals = (String(definition.step).split('.')[1] ?? '').length;
      return (
        <Stepper
          testID={testID}
          value={current}
          decimals={decimals}
          rangeLabel={`${definition.min}–${definition.max}`}
          onStep={(direction) => {
            const next = Number((current + direction * definition.step).toFixed(decimals));
            if (next >= definition.min - 1e-9 && next <= definition.max + 1e-9) onChange(next);
          }}
        />
      );
    }
    case 'time':
    case 'text':
      return (
        <TextSettingInput
          testID={testID}
          value={typeof value === 'string' ? value : ''}
          placeholder={definition.kind === 'time' ? 'HH:MM' : ''}
          keyboard={definition.kind === 'time' ? 'numbers-and-punctuation' : 'default'}
          onCommit={onChange}
        />
      );
  }
}

function TextSettingInput({
  value,
  placeholder,
  keyboard,
  onCommit,
  testID,
}: {
  readonly value: string;
  readonly placeholder: string;
  readonly keyboard: 'default' | 'numbers-and-punctuation';
  readonly onCommit: (value: string) => void;
  readonly testID: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <FormField
      testID={testID}
      value={draft}
      placeholder={placeholder}
      keyboardType={keyboard}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="done"
      onChangeText={setDraft}
      onEndEditing={() => {
        if (draft !== value) onCommit(draft.trim());
      }}
    />
  );
}

function ApiKeyEditor() {
  const [present, setPresent] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    void readAnthropicApiKeyPresent().then(setPresent);
  }, []);
  const store = async () => {
    await saveAnthropicApiKey(draft);
    setDraft('');
    setPresent(await readAnthropicApiKeyPresent());
  };
  return (
    <View style={{ gap: 6, paddingVertical: 6 }}>
      <LabelValueRow label="Anthropic API key" value="M4" />
      <Text style={ui.muted}>
        {present === null ? 'Checking Keychain…' : present ? 'Stored in the Keychain.' : 'Not set.'} Saving an empty field removes it.
      </Text>
      <FormField
        testID="setting-api-key"
        value={draft}
        onChangeText={setDraft}
        placeholder="sk-ant-…"
        secureTextEntry
        autoCapitalize="none"
        trailingAction={{ label: 'Save', onPress: () => void store(), testID: 'setting-api-key-save' }}
      />
    </View>
  );
}

/** Recovery passphrase, backups, notifications and diagnostics. */
function DataAndSecurityCard() {
  const { database, daily, passphraseSet, notificationsAllowed, refreshDaily } = useAppState();
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  if (!database || !daily) return null;
  const store = createAppBackupFileStore();
  const backups = listBackupNames(store);
  const allBackups = listAllBackupFiles(store);

  const testPassphrase = async () => {
    const ok = await verifyRecoveryPassphrase(testInput, database.keyHex, database.location.directory);
    setTestResult(ok ? 'Correct: this passphrase unlocks your data.' : 'Does not match.');
    setTestInput('');
  };
  const backupNow = async () => {
    const key = await readBackupKey();
    if (!key) {
      setBackupMessage('Set a recovery passphrase first.');
      return;
    }
    const result = writeDailyBackup(database.executor, appCryptoPrimitives, store, {
      keyMaterial: key,
      date: daily.today,
      appVersion: `${Application.nativeApplicationVersion ?? '?'} (${Application.nativeBuildVersion ?? '?'})`,
      retention: Number(readAllSettings(database.executor).get('backup.retention_files')),
      now: new Date(),
    });
    setBackupMessage(`Wrote ${result.fileName} (${Math.round(result.bytes / 1024)} KB).`);
  };

  return (
    <Card title="Data and security" testID="settings-data-security">
      <NavigationRow
        testID="settings-passphrase"
        label="Recovery passphrase"
        value={passphraseSet ? 'Change' : 'Set'}
        href="/setup/passphrase"
      />
      {passphraseSet ? (
        <FormField
          testID="settings-passphrase-test"
          value={testInput}
          onChangeText={setTestInput}
          secureTextEntry
          placeholder="Test your passphrase"
          autoCapitalize="none"
          trailingAction={{ label: 'Test', onPress: () => void testPassphrase(), testID: 'settings-passphrase-test-run' }}
        />
      ) : (
        <Text style={ui.muted}>Not set: daily backups are off.</Text>
      )}
      {testResult ? <Text style={ui.muted}>{testResult}</Text> : null}

      <LabelValueRow label="Backups in Files → On My iPhone" value={String(backups.length)} />
      <Text style={ui.muted}>{backups.length > 0 ? `Newest: ${backups[backups.length - 1]}` : 'None yet.'}</Text>
      {allBackups.length > backups.length ? <Text style={ui.muted}>Plus {allBackups.length - backups.length} safety backup(s) kept indefinitely.</Text> : null}
      <ActionButton testID="settings-backup-now" label="Write a backup now" onPress={() => void backupNow()} />
      {backupMessage ? <Text style={ui.muted}>{backupMessage}</Text> : null}
      <NavigationRow testID="settings-export" label="Export JSON and journal" href="/data/export" />
      <NavigationRow testID="settings-restore" label="Restore or verify a backup" href="/data/restore" />

      <LabelValueRow
        label="Notifications"
        value={notificationsAllowed === false ? 'off in iOS Settings' : daily.notifications ? `${daily.notifications.scheduled} scheduled` : '—'}
      />
      <ActionButton testID="settings-rebuild-notifications" label="Rebuild notification schedule" onPress={() => void refreshDaily()} />
      <NavigationRow testID="settings-diagnostics" label="Diagnostics" href="/diagnostics" />
    </Card>
  );
}
