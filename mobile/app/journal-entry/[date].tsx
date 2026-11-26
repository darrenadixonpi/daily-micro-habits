import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { promptForDate } from '../../src/daily/journal_prompts';
import { getJournalEntry, journalEntryCounts, saveJournalEntry } from '../../src/daily/reflection_repository';
import { readAllSettings, readInternalValue, writeInternalValue } from '../../src/settings/settings_repository';
import { useAppState } from '../../src/ui/app_state_context';
import { formatLocalTime, formatLongDate } from '../../src/ui/date_format';
import { LightMarkdown } from '../../src/ui/light_markdown';
import { COLORS, ui } from '../../src/ui/ui_styles';

const AUTOSAVE_MS = 5000;

/** D3 editor: autosaves every 5 s and on leaving; light Markdown preview; optional prompt and mood. */
export default function JournalEntryScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const navigation = useNavigation();
  const { database, daily, refreshDaily } = useAppState();
  const [body, setBody] = useState('');
  const [mood, setMood] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [lastEditedAt, setLastEditedAt] = useState<string | null>(null);
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef<{ body: string; mood: number | null }>({ body: '', mood: null });
  const latest = useRef<{ body: string; mood: number | null }>({ body: '', mood: null });

  const settings = database ? readAllSettings(database.executor) : null;
  const showPrompt = settings?.get('d3.daily_prompt') === true;
  const showMood = settings?.get('d3.mood_score') === true;
  const prompt = date ? promptForDate(date) : null;

  useEffect(() => {
    if (!database || !date) return;
    const entry = getJournalEntry(database.executor, date);
    const initial = { body: entry?.body_md ?? '', mood: entry?.mood ?? null };
    saved.current = initial;
    latest.current = initial;
    setBody(initial.body);
    setMood(initial.mood);
    setLastEditedAt(entry?.last_edited_at ?? null);
    setPromptDismissed(readInternalValue(database.executor, 'prompt_dismissed_date') === date);
  }, [database, date]);

  const saveIfChanged = useCallback(() => {
    if (!database || !daily || !date) return false;
    const current = latest.current;
    if (current.body === saved.current.body && current.mood === saved.current.mood) return false;
    if (current.body.trim() === '' && saved.current.body === '') return false;
    try {
      const entry = saveJournalEntry(database.executor, {
        date,
        today: daily.today,
        body: current.body,
        mood: current.mood,
        promptId: showPrompt && !promptDismissed && prompt ? prompt.id : null,
        now: new Date(),
      });
      saved.current = current;
      setSavedAt(entry.updated_at);
      setLastEditedAt(entry.last_edited_at);
      setError(null);
      return true;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
      return false;
    }
  }, [database, daily, date, showPrompt, promptDismissed, prompt]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (saveIfChanged()) void refreshDaily();
    }, AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, [saveIfChanged, refreshDaily]);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', () => {
        saveIfChanged();
        void refreshDaily();
      }),
    [navigation, saveIfChanged, refreshDaily],
  );

  if (!database || !daily || !date) return null;
  const isPast = date < daily.today;

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.body} keyboardShouldPersistTaps="handled">
      <View style={ui.row}>
        <Text style={ui.h2}>{formatLongDate(date)}</Text>
        <Pressable onPress={() => setPreview(!preview)}>
          <Text style={ui.buttonText}>{preview ? 'Edit' : 'Preview'}</Text>
        </Pressable>
      </View>
      <Text style={ui.muted}>
        {savedAt ? `Saved ${formatLocalTime(savedAt)}` : 'Autosaves every 5 seconds and when you leave.'}
        {isPast && lastEditedAt ? ` · Last edited ${new Date(lastEditedAt).toLocaleString('en-US')}` : ''}
      </Text>

      {showPrompt && !promptDismissed && prompt ? (
        <View style={[ui.card, { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }]}>
          <Text style={[ui.text, { flex: 1, fontStyle: 'italic' }]}>{prompt.text}</Text>
          <Pressable
            onPress={() => {
              writeInternalValue(database.executor, 'prompt_dismissed_date', date);
              setPromptDismissed(true);
            }}
          >
            <Text style={ui.muted}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}

      {preview ? (
        <View style={ui.card}>
          <LightMarkdown source={body === '' ? '*Nothing written yet.*' : body} />
        </View>
      ) : (
        <TextInput
          style={[ui.input, { minHeight: 260, textAlignVertical: 'top' }]}
          value={body}
          multiline
          autoFocus={body === ''}
          placeholder="One line or several paragraphs. **bold**, *italic*, - lists"
          onChangeText={(text) => {
            setBody(text);
            latest.current = { ...latest.current, body: text };
          }}
        />
      )}

      {showMood ? (
        <View style={ui.card}>
          <Text style={ui.text}>Mood</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[1, 2, 3, 4, 5].map((value) => {
              const selected = mood === value;
              return (
                <Pressable
                  key={value}
                  style={[ui.chip, selected ? ui.chipSelected : null, { minWidth: 40, alignItems: 'center' }]}
                  onPress={() => {
                    const next = selected ? null : value;
                    setMood(next);
                    latest.current = { ...latest.current, mood: next };
                  }}
                >
                  <Text style={[ui.chipText, selected ? ui.chipTextSelected : null]}>{value}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <Text style={[ui.muted, journalEntryCounts(body) ? { color: COLORS.pass } : null]}>
        {journalEntryCounts(body) ? 'This entry completes D3.' : 'Write at least one line to complete D3.'}
      </Text>
      {error ? <Text style={[ui.muted, { color: COLORS.fail }]}>{error}</Text> : null}
    </ScrollView>
  );
}
