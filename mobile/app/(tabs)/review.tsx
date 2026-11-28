import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { describeCard, type CardFace } from '../../src/learning/card_faces';
import { matchPhrase, type MatchResult } from '../../src/learning/a4_phrase';
import { a2State, reviewProgress, type QueuedCard, type ReviewProgress } from '../../src/learning/review_queue';
import { speakPhrase } from '../../src/platform/speech';
import { readAllSettings } from '../../src/settings/settings_repository';
import { GRADES, Rating, type SchedulerGrade } from '../../src/srs/fsrs_scheduler';
import { formatTime } from '../../src/ui/date_format';
import { formatInterval, previewIntervals, recordReview } from '../../src/srs/review_service';
import { useAppState } from '../../src/ui/app_state_context';
import { ActionButton, ButtonRow, ChoiceList, FormField } from '../../src/ui/controls';
import { Card, LabelValueRow, ScreenMessage, ScreenScrollView } from '../../src/ui/screen_layout';
import { COLORS, ui } from '../../src/ui/ui_styles';

const GRADE_LABEL: Record<number, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
const GRADE_COLOR: Record<number, string> = { 1: COLORS.fail, 2: COLORS.skip, 3: COLORS.pass, 4: COLORS.accent };
/** Suggested grade after a typed answer; the user can still pick any grade. */
const SUGGESTED: Record<MatchResult, number> = { exact: Rating.Good, close: Rating.Hard, fail: Rating.Again };

/**
 * A2 Review (spec Sections 2 and 5): today's due cards once each, oldest first, up to the
 * daily cap; then any learning repeats whose step has passed. When the first pass is done,
 * A2 is complete; cards still in a learning step can be reviewed early on request.
 */
export default function ReviewScreen() {
  const { database, daily, refreshDaily, getScheduler } = useAppState();
  const [progress, setProgress] = useState<ReviewProgress | null>(null);
  const [face, setFace] = useState<CardFace | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [early, setEarly] = useState(false);
  const [intervals, setIntervals] = useState<Map<SchedulerGrade, number> | null>(null);
  const shownAt = useRef(Date.now());

  const load = useCallback(() => {
    if (!database || !daily) return;
    const next = reviewProgress(database.executor, daily.review, new Date());
    setProgress(next);
    const card = currentCard(next, early);
    setFace(card ? describeCard(database.executor, card.id) : null);
    setIntervals(null);
    setRevealed(false);
    setChoice(null);
    setTyped('');
    setMatch(null);
    shownAt.current = Date.now();
  }, [database, daily, early]);

  useFocusEffect(load);
  useEffect(load, [load]);

  if (!database || !daily || !progress) return <ScreenMessage loading />;
  const settings = readAllSettings(database.executor);
  const card = currentCard(progress, early);
  const speak = (text: string, language: string) =>
    speakPhrase(text, { voiceSetting: String(settings.get('a4.speech_voice')), targetLanguage: language, rate: Number(settings.get('a4.speech_rate')) });

  const grade = async (value: SchedulerGrade) => {
    if (!card) return;
    try {
      recordReview(database.executor, await getScheduler(), { cardId: card.id, grade: value, now: new Date(), responseMs: Date.now() - shownAt.current });
      setError(null);
      if (early && progress.learningLater.length <= 1) setEarly(false);
      await refreshDaily();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  };
  const reveal = async () => {
    if (card) setIntervals(previewIntervals(database.executor, await getScheduler(), card.id, new Date(), GRADES));
    if (face?.production) {
      setMatch(typed.trim() === '' ? 'fail' : matchPhrase(typed, face.production.target, settings.get('a4.accent_strictness') !== 'exact').result);
      speak(face.production.target, face.production.language);
    }
    setRevealed(true);
  };

  const summary = (
    <Card title="Today" testID="review-summary">
      <LabelValueRow label="Still to review today" value={String(progress.firstPass.length)} />
      <LabelValueRow label="Cards reviewed today" value={`${progress.reviewedCards} of cap ${daily.review.cap}`} />
      {progress.deferred > 0 ? <Text style={ui.muted}>{progress.deferred} more due today wait for tomorrow (daily cap).</Text> : null}
    </Card>
  );

  if (!card || !face) {
    const state = a2State(progress);
    const nextLearning = progress.learningLater[0];
    return (
      <ScreenScrollView testID="screen-review">
        {summary}
        <Card testID="review-empty">
          <Text testID="review-end-text" style={ui.text}>
            {state === 'complete'
              ? progress.capReached
                ? 'Daily cap reached. A2 is complete for today.'
                : 'All of today’s cards are reviewed. A2 is complete for today.'
              : 'Nothing is due today. Cards made from today’s A1, A3, A4 and A5 are first due tomorrow.'}
          </Text>
          {nextLearning ? (
            <>
              <Text testID="review-learning-later" style={ui.muted}>
                {progress.learningLater.length} card{progress.learningLater.length === 1 ? ' is' : 's are'} in a short learning step and come
                {progress.learningLater.length === 1 ? 's' : ''} back around {formatTime(new Date(nextLearning.due))}. Reviewing them is optional.
              </Text>
              <ActionButton testID="review-early" label="Review them now" onPress={() => setEarly(true)} />
            </>
          ) : null}
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
            onSubmitEditing={() => void reveal()}
            placeholder="Type the phrase, then reveal"
          />
        ) : null}
        {!revealed ? <ActionButton testID="review-reveal" label={face.production ? 'Check and reveal' : 'Reveal answer'} onPress={() => void reveal()} /> : null}
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
          <Text style={ui.muted}>How well did you recall it? Each button shows when the card comes back.</Text>
          <ButtonRow
            testIDPrefix="review-grade"
            buttons={GRADES.map((value) => ({
              value: String(value),
              label: intervals?.has(value) ? `${GRADE_LABEL[value] ?? value} · ${formatInterval(intervals.get(value) ?? 0)}` : (GRADE_LABEL[value] ?? String(value)),
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

/** The card on screen: the session queue, or, after "Review them now", cards still in a learning step. */
function currentCard(progress: ReviewProgress, early: boolean): QueuedCard | undefined {
  return progress.queue[0] ?? (early ? progress.learningLater[0] : undefined);
}
