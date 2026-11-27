import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { getContentItem, variantsOf } from '../src/content/content_repository';
import { formulaToText } from '../src/content/formula_text';
import type { ContentItem } from '../src/content/content_types';
import type { FetchLike } from '../src/generation/anthropic_client';
import { A3_DOMAIN_NAMES } from '../src/generation/generation_prompts';
import { generateConceptVariant } from '../src/generation/generation_service';
import {
  adjustTagWeights,
  answerRecall,
  conceptReadOn,
  markConceptRead,
  pendingRecall,
  type A3RecallResponse,
} from '../src/learning/a3_concept';
import { completionFor } from '../src/learning/task_completion_repository';
import { readAllSettings } from '../src/settings/settings_repository';
import { readAnthropicApiKey } from '../src/settings/settings_secrets';
import { useAppState } from '../src/ui/app_state_context';
import { ActionButton, ChoiceList, LinkText } from '../src/ui/controls';
import { GeneratedBadge, ReportErrorAction } from '../src/ui/report_error_action';
import { Card, ScreenMessage, ScreenScrollView } from '../src/ui/screen_layout';
import { COLORS, ui } from '../src/ui/ui_styles';

/**
 * A3 Concept of the day: yesterday's recall question first, then today's explainer, read to
 * the end; per-concept tweaks underneath (spec Section 2).
 */
export default function ConceptOfTheDayScreen() {
  const { database, daily, refreshDaily, getScheduler } = useAppState();
  const item = daily?.assignment.A3 ?? null;
  const [recall, setRecall] = useState<ContentItem<'A3'> | null>(null);
  const [recallAnswer, setRecallAnswer] = useState<A3RecallResponse | null>(null);
  const [read, setRead] = useState(false);
  const [tweakMessage, setTweakMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [variants, setVariants] = useState<ContentItem<'A3'>[]>([]);

  useEffect(() => {
    if (!database || !daily) return;
    const pending = pendingRecall(database.executor, daily.today);
    const answered = completionFor(database.executor, daily.today, 'A3R');
    if (pending) {
      setRecall(pending);
      setRecallAnswer(null);
    } else if (answered?.content_item_id && answered.response_json) {
      // Answered earlier today: show the question again, already answered.
      setRecall(getContentItem<'A3'>(database.executor, answered.content_item_id) ?? null);
      setRecallAnswer(JSON.parse(answered.response_json) as A3RecallResponse);
    } else {
      setRecall(null);
    }
    if (item) {
      setRead(conceptReadOn(database.executor, daily.today, item.row.id));
      setVariants(variantsOf(database.executor, item.row.id));
    }
  }, [database, daily, item]);

  if (!database || !daily) return <ScreenMessage loading />;
  const settings = readAllSettings(database.executor);
  const showFormula = settings.get('a3.include_formulas') === true;

  const answer = async (choice: string) => {
    if (!recall || recallAnswer) return;
    const result = answerRecall(database.executor, await getScheduler(), { date: daily.today, item: recall, choice, now: new Date(), dueAt: daily.review.dayEnd });
    setRecallAnswer(result);
    await refreshDaily();
  };
  const markRead = async () => {
    if (!item) return;
    markConceptRead(database.executor, { date: daily.today, item, now: new Date() });
    setRead(true);
    await refreshDaily();
  };
  const tweakWeights = (delta: 1 | -1) => {
    if (!item) return;
    adjustTagWeights(database.executor, item.payload.tags, delta, new Date());
    setTweakMessage(delta === 1 ? `More concepts tagged ${item.payload.tags.join(', ')} will come up.` : `Concepts tagged ${item.payload.tags.join(', ')} will come up less.`);
  };
  const generateVariant = async (kind: 'simpler' | 'deeper') => {
    if (!item || generating) return;
    const apiKey = await readAnthropicApiKey();
    if (!apiKey) {
      setTweakMessage('Simpler and Go deeper are generated: add an Anthropic API key in Settings → Generation first.');
      return;
    }
    setGenerating(true);
    setTweakMessage(kind === 'simpler' ? 'Writing a simpler version…' : 'Writing a deeper version…');
    try {
      const outcome = await generateConceptVariant(
        { executor: database.executor, fetchImpl: fetch as unknown as FetchLike, apiKey, settings, now: new Date() },
        { concept: item, kind, today: daily.today },
      );
      setTweakMessage(outcome.status === 'succeeded' ? null : `Could not generate it: ${outcome.error ?? outcome.status}`);
      setVariants(variantsOf(database.executor, item.row.id));
    } catch (error) {
      setTweakMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  };

  const recallCard = recall ? (
    <Card title="Yesterday’s question" testID="a3-recall">
      <Text style={ui.text}>{recall.payload.question.prompt}</Text>
      <ChoiceList
        testIDPrefix="a3-recall-option"
        options={recall.payload.question.options}
        selected={recallAnswer?.choice ?? null}
        disabled={recallAnswer !== null}
        onSelect={(choice) => void answer(choice)}
        markFor={(id) =>
          recallAnswer === null ? null : id === recall.payload.question.correct_option_id ? 'correct' : id === recallAnswer.choice ? 'incorrect' : null
        }
      />
      {recallAnswer ? (
        <>
          <Text testID="a3-recall-result" style={[ui.text, { color: recallAnswer.correct ? COLORS.pass : COLORS.fail, fontWeight: '600' }]}>
            {recallAnswer.correct ? 'Correct.' : 'Not this time.'}
          </Text>
          <Text style={ui.muted}>{recall.payload.question.explanation}</Text>
          <Text style={ui.muted}>From “{recall.payload.title}”. The question is now a review card.</Text>
        </>
      ) : null}
    </Card>
  ) : null;

  if (!item) {
    return (
      <ScreenScrollView testID="screen-a3">
        {recallCard}
        <ScreenMessageCard text="No concept for today: the enabled domains have no unserved concepts. Enable more domains in Settings, or allow generated concepts." />
      </ScreenScrollView>
    );
  }
  const concept = item.payload;
  const recallOpen = recall !== null && recallAnswer === null;

  return (
    <ScreenScrollView testID="screen-a3">
      {recallCard}
      {recallOpen ? <Text style={ui.muted}>Answer yesterday’s question first; today’s concept follows.</Text> : null}
      {!recallOpen ? (
        <Card testID="a3-concept">
          <Text testID="a3-title" style={ui.h1}>{concept.title}</Text>
          <Text style={ui.muted}>
            {A3_DOMAIN_NAMES[concept.domain] ?? concept.domain} · {concept.depth}
          </Text>
          <GeneratedBadge source={item.row.source} />
          <Text style={[ui.text, { lineHeight: 22 }]}>{concept.explainer}</Text>
          {showFormula && concept.formula ? (
            <Text testID="a3-formula" style={[ui.text, { fontSize: 17, paddingVertical: 6 }]}>
              {formulaToText(concept.formula)}
            </Text>
          ) : null}
          {concept.source ? <LinkText title={concept.source.title} url={concept.source.url} testID="a3-source" /> : null}
          <ActionButton testID="a3-read" label={read ? 'Read ✓' : 'I’ve read it'} disabled={read} onPress={() => void markRead()} />
          {read ? (
            <Text testID="a3-done" style={[ui.muted, { color: COLORS.pass }]}>
              Done. Tomorrow starts with this concept’s question.
            </Text>
          ) : null}
        </Card>
      ) : null}
      {variants.map((variant) => (
        <Card key={variant.row.id} title={variant.payload.variant === 'simpler' ? 'Simpler version' : 'Deeper version'} testID={`a3-variant-${variant.payload.variant ?? 'x'}`}>
          <GeneratedBadge source={variant.row.source} />
          <Text style={[ui.text, { lineHeight: 22 }]}>{variant.payload.explainer}</Text>
          {showFormula && variant.payload.formula ? <Text style={[ui.text, { fontSize: 17 }]}>{formulaToText(variant.payload.formula)}</Text> : null}
          <ReportErrorAction itemId={variant.row.id} moduleLabel="A3 variant" />
        </Card>
      ))}
      {!recallOpen ? (
        <Card title="Tweak" testID="a3-tweaks">
          <ActionButton testID="a3-simpler" label="Simpler" disabled={generating} onPress={() => void generateVariant('simpler')} />
          <ActionButton testID="a3-deeper" label="Go deeper" disabled={generating} onPress={() => void generateVariant('deeper')} />
          <ActionButton testID="a3-more" label="More like this" onPress={() => tweakWeights(1)} />
          <ActionButton testID="a3-not-interested" label="Not interested" tone="muted" onPress={() => tweakWeights(-1)} />
          {tweakMessage ? <Text testID="a3-tweak-message" style={ui.muted}>{tweakMessage}</Text> : null}
        </Card>
      ) : null}
      {!recallOpen ? <ReportErrorAction itemId={item.row.id} moduleLabel="A3 concept" testID="a3-report" /> : null}
    </ScreenScrollView>
  );
}

function ScreenMessageCard({ text }: { readonly text: string }) {
  return (
    <Card>
      <Text style={ui.muted}>{text}</Text>
    </Card>
  );
}
