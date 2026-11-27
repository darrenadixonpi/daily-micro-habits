import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { describeCard, type CardFace } from '../../src/learning/card_faces';
import { matchPhrase, type MatchResult } from '../../src/learning/a4_phrase';
import { reviewProgress, type ReviewProgress } from '../../src/learning/review_queue';
import { speakPhrase } from '../../src/platform/speech';
import { readAllSettings } from '../../src/settings/settings_repository';
import { GRADES, Rating, type SchedulerGrade } from '../../src/srs/fsrs_scheduler';
import { recordReview } from '../../src/srs/review_service';
import { useAppState } from '../../src/ui/app_state_context';
import { ActionButton, ButtonRow, ChoiceList, FormField } from '../../src/ui/controls';
import { Card, LabelValueRow, ScreenMessage, ScreenScrollView } from '../../src/ui/screen_layout';
import { COLORS, ui } from '../../src/ui/ui_styles';

const GRADE_LABEL: Record<number, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
const GRADE_COLOR: Record<number, string> = { 1: COLORS.fail, 2: COLORS.skip, 3: COLORS.pass, 4: COLORS.accent };
/** Suggested grade after a typed answer; the user can still pick any grade. */
const SUGGESTED: Record<MatchResult, number> = { exact: Rating.Good, close: Rating.Hard, fail: Rating.Again };

/** A2 Review: today's due cards, oldest first, up to the daily cap (spec Sections 2 and 5). */
export default function ReviewScreen() {
  const { database, daily, refreshDaily, getScheduler } = useAppState();
  const [progress, setProgress] = useState<ReviewProgress | null>(null);
  const [face, setFace] = useState<CardFace | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(Date.now());

  const load = useCallback(() => {
    if (!database || !daily) return;
    const next = reviewProgress(database.executor, daily.review);
    setProgress(next);
    const card = next.queue[0];
    setFace(card ? describeCard(database.executor, card.id) : null);
    setRevealed(false);
    setChoice(null);
    setTyped('');
    setMatch(null);
    shownAt.current = Date.now();
  }, [database, daily]);

  useFocusEffect(load);
  useEffect(load, [load]);

  if (!database || !daily || !progress) return <ScreenMessage loading />;
  const settings = readAllSettings(database.executor);
  const card = progress.queue[0];
  const speak = (text: string, language: string) =>
    speakPhrase(text, { voiceSetting: String(settings.get('a4.speech_voice')), targetLanguage: language, rate: Number(settings.get('a4.speech_rate')) });

  const grade = async (value: SchedulerGrade) => {
    if (!card) return;
    try {
      recordReview(database.executor, await getScheduler(), { cardId: card.id, grade: value, now: new Date(), responseMs: Date.now() - shownAt.current });
      setError(null);
      await refreshDaily();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  };
  const reveal = () => {
    if (face?.production) {
      setMatch(typed.trim() === '' ? 'fail' : matchPhrase(typed, face.production.target, settings.get('a4.accent_strictness') !== 'exact').result);
      speak(face.production.target, face.production.language);
    }
    setRevealed(true);
  };

  const summary = (
    <Card title="Today" testID="review-summary">
      <LabelValueRow label="Cards in queue" value={String(progress.queue.length)} />
      <LabelValueRow label="Cards reviewed today" value={`${progress.reviewedCards} of cap ${daily.review.cap}`} />
      {progress.deferred > 0 ? <Text style={ui.muted}>{progress.deferred} more due today wait for tomorrow (daily cap).</Text> : null}
    </Card>
  );

  if (!card || !face) {
    return (
      <ScreenScrollView testID="screen-review">
        {summary}
        <Card testID="review-empty">
          <Text style={ui.text}>
            {progress.reviews > 0
              ? progress.capReached
                ? 'Daily cap reached. A2 is complete for today.'
                : 'Queue empty. A2 is complete for today.'
              : 'Nothing is due today. Cards made from today’s A1, A3, A4 and A5 are first due tomorrow.'}
          </Text>
          {card && !face ? <Text style={[ui.muted, { color: COLORS.fail }]}>The next card’s content is missing; it was skipped.</Text> : null}
        </Card>
      </ScreenScrollView>
    );
  }

  return (
    <ScreenScrollView testID="screen-review">
      {summary}
      <Card title={face.label} aside={face.generated ? 'Generated' : undefined} testID="review-card">
        <Text testID="review-prompt" style={face.module === 'A1' ? ui.h1 : [ui.text, { fontWeight: '600' }]}>{face.prompt}</Text>
        {face.promptDetail ? <Text style={ui.muted}>{face.promptDetail}</Text> : null}
        {face.choices.length > 0 ? (
          <ChoiceList
            testIDPrefix="review-option"
            options={face.choices}
            selected={choice}
            disabled={revealed}
            onSelect={setChoice}
            markFor={(id) => (!revealed ? null : face.choices.find((c) => c.text === face.answer)?.id === id ? 'correct' : id === choice ? 'incorrect' : null)}
          />
        ) : null}
        {face.production ? (
          <FormField
            testID="review-answer"
            value={typed}
            onChangeText={setTyped}
            editable={!revealed}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="done"
            onSubmitEditing={reveal}
            placeholder="Type the phrase, then reveal"
          />
        ) : null}
        {!revealed ? <ActionButton testID="review-reveal" label={face.production ? 'Check and reveal' : 'Reveal answer'} onPress={reveal} /> : null}
      </Card>
      {revealed ? (
        <Card title="Answer" testID="review-answer-card">
          {match ? (
            <Text testID="review-match" style={[ui.text, { fontWeight: '600', color: match === 'fail' ? COLORS.fail : COLORS.pass }]}>
              {match === 'exact' ? 'Exact ✓' : match === 'close' ? 'Close ✓' : 'Not quite'}
            </Text>
          ) : null}
          <Text testID="review-answer-text" style={face.production ? ui.h1 : ui.text}>{face.answer}</Text>
          {face.answerDetail ? <Text style={ui.muted}>{face.answerDetail}</Text> : null}
          {face.cue ? <Text style={[ui.text, { fontStyle: 'italic' }]}>Your sentence: “{face.cue}”</Text> : null}
          {face.production ? <ActionButton testID="review-play" label="▶︎ Play" onPress={() => face.production && speak(face.production.target, face.production.language)} /> : null}
          <Text style={ui.muted}>How well did you recall it?</Text>
          <ButtonRow
            testIDPrefix="review-grade"
            buttons={GRADES.map((value) => ({
              value: String(value),
              label: GRADE_LABEL[value] ?? String(value),
              color: GRADE_COLOR[value],
              highlight: match !== null && SUGGESTED[match] === value,
              onPress: () => void grade(value),
            }))}
          />
          {error ? <Text style={[ui.muted, { color: COLORS.fail }]}>{error}</Text> : null}
        </Card>
      ) : null}
    </ScreenScrollView>
  );
}
