import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { LANGUAGE_NAMES } from '../src/generation/generation_prompts';
import { completeA4, matchPhrase, type A4Attempt, type A4Response } from '../src/learning/a4_phrase';
import { completionFor } from '../src/learning/task_completion_repository';
import { speakPhrase } from '../src/platform/speech';
import { readAllSettings } from '../src/settings/settings_repository';
import { useAppState } from '../src/ui/app_state_context';
import { ActionButton, FormField } from '../src/ui/controls';
import { GeneratedBadge, ReportErrorAction } from '../src/ui/report_error_action';
import { Card, ScreenMessage, ScreenScrollView } from '../src/ui/screen_layout';
import { COLORS, ui } from '../src/ui/ui_styles';

const RESULT_TEXT = { exact: 'Exact match ✓', close: 'Close enough ✓', fail: 'Not quite' } as const;

/** A4 Phrase: the English meaning, the user types the phrase, then the reveal with audio (spec Section 2). */
export default function PhraseOfTheDayScreen() {
  const { database, daily, refreshDaily, getScheduler } = useAppState();
  const item = daily?.assignment.A4 ?? null;
  const [typed, setTyped] = useState('');
  const [attempts, setAttempts] = useState<A4Attempt[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!database || !daily || !item) return;
    const completion = completionFor(database.executor, daily.today, 'A4', item.row.id);
    if (completion?.response_json) {
      const response = JSON.parse(completion.response_json) as A4Response;
      setAttempts([...response.attempts]);
      setRevealed(true);
      setDone(true);
    }
  }, [database, daily, item]);

  if (!database || !daily) return <ScreenMessage loading />;
  const settings = readAllSettings(database.executor);
  const language = String(settings.get('a4.target_language'));
  const level = String(settings.get('a4.level'));
  if (!item) {
    const reason =
      language === 'es-419'
        ? `No phrase for today: no unserved Spanish phrases at or below ${level}. Raise the level in Settings, or add an API key so new phrases can be generated.`
        : `${LANGUAGE_NAMES[language] ?? language} has no bundled phrases. They are generated: add an Anthropic API key in Settings → Generation, then reopen the app.`;
    return <ScreenMessage message={reason} />;
  }
  const phrase = item.payload;
  const accentsOptional = settings.get('a4.accent_strictness') !== 'exact';
  const speak = () =>
    speakPhrase(phrase.phrase, {
      voiceSetting: String(settings.get('a4.speech_voice')),
      targetLanguage: item.row.language ?? language,
      rate: Number(settings.get('a4.speech_rate')),
    });
  const last = attempts[attempts.length - 1];

  const check = async () => {
    const match = matchPhrase(typed, phrase.phrase, accentsOptional);
    const attempt: A4Attempt = { typed: typed.trim(), result: match.result, distance: match.distance, normalized_distance: Number(match.normalizedDistance.toFixed(4)) };
    const next = [...attempts, attempt];
    setAttempts(next);
    if (match.result === 'fail') return;
    const wasRevealed = revealed;
    setRevealed(true);
    speak();
    completeA4(database.executor, await getScheduler(), {
      date: daily.today,
      item,
      attempts: next,
      revealedBeforePass: wasRevealed,
      now: new Date(),
      dueAt: daily.review.dayEnd,
    });
    setDone(true);
    await refreshDaily();
  };

  return (
    <ScreenScrollView testID="screen-a4">
      <Card testID="a4-prompt">
        <Text style={ui.muted}>
          Say it in {LANGUAGE_NAMES[item.row.language ?? language] ?? item.row.language} · {phrase.cefr} · {phrase.register}
        </Text>
        <GeneratedBadge source={item.row.source} />
        <Text testID="a4-meaning" style={ui.h1}>{phrase.idiomatic_translation}</Text>
      </Card>
      <Card title="Your answer" testID="a4-answer-card">
        <FormField
          testID="a4-answer"
          value={typed}
          onChangeText={setTyped}
          editable={!done}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="done"
          onSubmitEditing={() => void check()}
          placeholder="Type the phrase"
        />
        <Text style={ui.muted}>
          Case and punctuation are ignored{accentsOptional ? ', accents are optional' : ''}; small typos (up to 15% of the phrase) still pass.
        </Text>
        {!done ? <ActionButton testID="a4-check" label="Check" disabled={typed.trim() === ''} onPress={() => void check()} /> : null}
        {last ? (
          <Text testID="a4-result" style={[ui.text, { fontWeight: '600', color: last.result === 'fail' ? COLORS.fail : COLORS.pass }]}>
            {RESULT_TEXT[last.result]}
            {last.result === 'close' ? ` (${last.distance} edit${last.distance === 1 ? '' : 's'})` : ''}
            {attempts.length > 1 ? ` · attempt ${attempts.length}` : ''}
          </Text>
        ) : null}
        {last?.result === 'fail' && !revealed ? (
          <ActionButton testID="a4-reveal" label="Show the answer" tone="muted" onPress={() => {
            setRevealed(true);
            speak();
          }} />
        ) : null}
        {revealed && !done ? <Text style={ui.muted}>Now type it once more to complete A4.</Text> : null}
      </Card>
      {revealed ? (
        <Card title="Answer" testID="a4-reveal-card">
          <Text testID="a4-phrase" style={ui.h1}>{phrase.phrase}</Text>
          {phrase.transliteration ? <Text style={ui.muted}>{phrase.transliteration}</Text> : null}
          <Text style={ui.text}>Literally: {phrase.literal_translation}</Text>
          <Text style={ui.muted}>{phrase.usage_note}</Text>
          <ActionButton testID="a4-play" label="▶︎ Play again" onPress={speak} />
          {done ? (
            <Text testID="a4-done" style={[ui.muted, { color: COLORS.pass }]}>
              A4 complete. You will type this phrase again in Review.
            </Text>
          ) : null}
        </Card>
      ) : null}
      <ReportErrorAction itemId={item.row.id} moduleLabel="A4 phrase" testID="a4-report" />
    </ScreenScrollView>
  );
}
