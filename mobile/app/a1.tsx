import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { completeA1, A1_SENTENCE_MAX_LENGTH, type A1Response } from '../src/learning/a1_word';
import { completionFor } from '../src/learning/task_completion_repository';
import { readAllSettings } from '../src/settings/settings_repository';
import { useAppState } from '../src/ui/app_state_context';
import { ActionButton, FormField } from '../src/ui/controls';
import { GeneratedBadge, ReportErrorAction } from '../src/ui/report_error_action';
import { Card, ScreenMessage, ScreenScrollView } from '../src/ui/screen_layout';
import { COLORS, ui } from '../src/ui/ui_styles';

/** A1 Word of the day: the word, then an original sentence that uses it (spec Section 2). */
export default function WordOfTheDayScreen() {
  const { database, daily, refreshDaily, getScheduler } = useAppState();
  const item = daily?.assignment.A1 ?? null;
  const [sentence, setSentence] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!database || !daily || !item) return;
    const done = completionFor(database.executor, daily.today, 'A1', item.row.id);
    if (done?.response_json) {
      setSentence((JSON.parse(done.response_json) as A1Response).sentence);
      setSaved(true);
    } else {
      setSaved(false);
    }
  }, [database, daily, item]);

  if (!database || !daily) return <ScreenMessage loading />;
  if (!item) {
    const tier = String(readAllSettings(database.executor).get('a1.tier'));
    return <ScreenMessage message={`No word for today: tier ${tier} has no unserved words. Choose another tier in Settings, or add an API key so new words can be generated.`} />;
  }
  const word = item.payload;

  const save = async () => {
    try {
      completeA1(database.executor, await getScheduler(), {
        date: daily.today,
        item,
        sentence,
        now: new Date(),
        dueAt: daily.review.dayEnd,
      });
      setError(null);
      setSaved(true);
      await refreshDaily();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  };

  return (
    <ScreenScrollView testID="screen-a1">
      <Card testID="a1-word">
        <Text testID="a1-headword" style={ui.h1}>{word.headword}</Text>
        <Text style={ui.muted}>
          {word.part_of_speech} · {word.ipa} · tier {word.tier}
        </Text>
        <GeneratedBadge source={item.row.source} />
        <Text style={ui.text}>{word.definition}</Text>
        <Text style={[ui.text, { fontStyle: 'italic' }]}>“{word.example_sentence}”</Text>
        <Text style={ui.muted}>{word.etymology}</Text>
        <Text style={ui.muted}>Accepted forms: {word.inflections.join(', ')}</Text>
      </Card>
      <Card title="Your sentence" testID="a1-sentence-card">
        <Text style={ui.muted}>Write an original sentence that uses the word or one of its forms.</Text>
        <FormField
          testID="a1-sentence"
          value={sentence}
          onChangeText={(text) => {
            setSentence(text.replace(/\n/g, ' '));
            setSaved(false);
          }}
          maxLength={A1_SENTENCE_MAX_LENGTH}
          multiline
          blurOnSubmit
          returnKeyType="done"
          placeholder={`A sentence with “${word.headword}”`}
          error={error}
        />
        <ActionButton testID="a1-save" label={saved ? 'Saved · update sentence' : 'Save sentence'} disabled={sentence.trim() === ''} onPress={() => void save()} />
        {saved ? (
          <Text testID="a1-done" style={[ui.muted, { color: COLORS.pass }]}>
            A1 complete. The word joins your review cards tomorrow, with this sentence as its cue.
          </Text>
        ) : null}
      </Card>
      <ReportErrorAction itemId={item.row.id} moduleLabel="A1 word" testID="a1-report" />
    </ScreenScrollView>
  );
}
