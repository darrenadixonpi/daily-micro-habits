import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import {
  SETTING_DEFINITIONS,
  type SettingDefinition,
  type SettingValue,
} from '../src/settings/settings_definitions';
import { readAllSettings, writeSetting } from '../src/settings/settings_repository';
import { readAnthropicApiKeyPresent, saveAnthropicApiKey } from '../src/settings/settings_secrets';
import { useAppState } from '../src/ui/app_state_context';
import { COLORS, ui } from '../src/ui/ui_styles';

/** Every spec Section 3 setting, stored immediately on change and validated against its definition. */
export default function SettingsScreen() {
  const { database } = useAppState();
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

  if (!database || !values) {
    return (
      <View style={[ui.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const save = (key: string, value: SettingValue) => {
    try {
      writeSetting(database.executor, key, value);
      setValues(readAllSettings(database.executor));
      setErrors(({ [key]: _removed, ...rest }) => rest);
    } catch (error) {
      setErrors((previous) => ({ ...previous, [key]: error instanceof Error ? error.message : String(error) }));
    }
  };

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.body} keyboardShouldPersistTaps="handled">
      <Text style={ui.muted}>
        Settings are saved as you change them. Each shows the milestone in which it starts to take effect.
      </Text>
      {groups.map(([group, definitions]) => (
        <View key={group} style={ui.card}>
          <Text style={ui.h2}>{group}</Text>
          {definitions.map((definition) => (
            <SettingEditor
              key={definition.key}
              definition={definition}
              value={values.get(definition.key) ?? definition.defaultValue}
              error={errors[definition.key]}
              onChange={(value) => save(definition.key, value)}
            />
          ))}
          {group === 'Generation' ? <ApiKeyEditor /> : null}
        </View>
      ))}
    </ScrollView>
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
  return (
    <View style={{ gap: 6, paddingVertical: 6 }}>
      <View style={ui.row}>
        <Text style={[ui.text, { flex: 1 }]}>{definition.label}</Text>
        <Text style={ui.muted}>{definition.effectiveFrom}</Text>
      </View>
      <EditorControl definition={definition} value={value} onChange={onChange} />
      {definition.note ? <Text style={ui.muted}>{definition.note}</Text> : null}
      {error ? <Text style={[ui.muted, { color: COLORS.fail }]}>{error}</Text> : null}
    </View>
  );
}

function EditorControl({
  definition,
  value,
  onChange,
}: {
  readonly definition: SettingDefinition;
  readonly value: SettingValue;
  readonly onChange: (value: SettingValue) => void;
}) {
  switch (definition.kind) {
    case 'boolean':
      return <Switch value={value === true} onValueChange={(next) => onChange(next)} />;
    case 'choice':
      return (
        <ChipRow
          options={definition.options}
          isSelected={(option) => option === value}
          onPress={(option) => onChange(option)}
        />
      );
    case 'multichoice': {
      const selected = Array.isArray(value) ? (value as readonly string[]) : [];
      return (
        <ChipRow
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
      const stepTo = (direction: 1 | -1) => {
        const next = Number((current + direction * definition.step).toFixed(decimals));
        if (next >= definition.min - 1e-9 && next <= definition.max + 1e-9) onChange(next);
      };
      return (
        <View style={[ui.row, { justifyContent: 'flex-start' }]}>
          <StepButton label="−" onPress={() => stepTo(-1)} />
          <Text style={[ui.text, { minWidth: 56, textAlign: 'center' }]}>{current.toFixed(decimals)}</Text>
          <StepButton label="+" onPress={() => stepTo(1)} />
          <Text style={ui.muted}>
            {definition.min}–{definition.max}
          </Text>
        </View>
      );
    }
    case 'time':
    case 'text':
      return <TextSettingInput value={typeof value === 'string' ? value : ''} placeholder={definition.kind === 'time' ? 'HH:MM' : ''} onCommit={onChange} />;
  }
}

function TextSettingInput({ value, placeholder, onCommit }: { readonly value: string; readonly placeholder: string; readonly onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <TextInput
      style={ui.input}
      value={draft}
      placeholder={placeholder}
      autoCapitalize="none"
      autoCorrect={false}
      onChangeText={setDraft}
      onEndEditing={() => {
        if (draft !== value) onCommit(draft.trim());
      }}
      returnKeyType="done"
    />
  );
}

function ChipRow({
  options,
  isSelected,
  onPress,
}: {
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly isSelected: (value: string) => boolean;
  readonly onPress: (value: string) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map((option) => {
        const selected = isSelected(option.value);
        return (
          <Pressable key={option.value} style={[ui.chip, selected ? ui.chipSelected : null]} onPress={() => onPress(option.value)}>
            <Text style={[ui.chipText, selected ? ui.chipTextSelected : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StepButton({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  return (
    <Pressable style={[ui.chip, { minWidth: 40, alignItems: 'center' }]} onPress={onPress}>
      <Text style={[ui.text, { fontSize: 18 }]}>{label}</Text>
    </Pressable>
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
      <View style={ui.row}>
        <Text style={[ui.text, { flex: 1 }]}>Anthropic API key</Text>
        <Text style={ui.muted}>M4</Text>
      </View>
      <Text style={ui.muted}>
        {present === null ? 'Checking Keychain…' : present ? 'Stored in the Keychain.' : 'Not set.'} Saving an empty field removes it.
      </Text>
      <View style={[ui.row, { justifyContent: 'flex-start' }]}>
        <TextInput
          style={[ui.input, { flex: 1 }]}
          value={draft}
          onChangeText={setDraft}
          placeholder="sk-ant-…"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable style={[ui.chip]} onPress={() => void store()}>
          <Text style={ui.chipText}>Save</Text>
        </Pressable>
      </View>
    </View>
  );
}
