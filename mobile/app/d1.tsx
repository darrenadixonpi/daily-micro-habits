import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import {
  carryOverCandidates,
  listPriorities,
  PRIORITY_MAX_COUNT,
  PRIORITY_MAX_LENGTH,
  savePriorities,
  type Priority,
} from '../src/daily/reflection_repository';
import { useAppState } from '../src/ui/app_state_context';
import { ActionButton, ChipGroup, FormField } from '../src/ui/controls';
import { Card, ScreenMessage, ScreenScrollView } from '../src/ui/screen_layout';
import { COLORS, ui } from '../src/ui/ui_styles';

interface Slot {
  readonly text: string;
  readonly carriedFromId: number | null;
}

const EMPTY: Slot = { text: '', carriedFromId: null };

/** D1 Morning top-3: 1–3 priorities, with yesterday's unfinished items as one-tap prefills. */
export default function MorningTopThreeScreen() {
  const { database, daily, refreshDaily } = useAppState();
  const [slots, setSlots] = useState<Slot[]>([EMPTY, EMPTY, EMPTY]);
  const [candidates, setCandidates] = useState<Priority[]>([]);
  const [error, setError] = useState<string | null>(null);
  const today = daily?.today;

  useEffect(() => {
    if (!database || !today) return;
    const existing = listPriorities(database.executor, today);
    setSlots(Array.from({ length: PRIORITY_MAX_COUNT }, (_, i) => {
      const item = existing[i];
      return item ? { text: item.text, carriedFromId: item.carried_from_id } : EMPTY;
    }));
    setCandidates(carryOverCandidates(database.executor, today));
  }, [database, today]);

  if (!database || !today) return <ScreenMessage loading />;

  const offered = candidates.filter((candidate) => !slots.some((slot) => slot.carriedFromId === candidate.id));
  const carryOver = (id: string) => {
    const candidate = offered.find((c) => String(c.id) === id);
    const index = slots.findIndex((slot) => slot.text.trim() === '');
    if (!candidate || index < 0) return;
    setSlots(slots.map((slot, i) => (i === index ? { text: candidate.text, carriedFromId: candidate.id } : slot)));
  };
  const save = async () => {
    try {
      savePriorities(database.executor, today, slots);
      await refreshDaily();
      router.back();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  };

  return (
    <ScreenScrollView testID="screen-d1">
      <Text testID="d1-intro" style={ui.muted}>
        Up to {PRIORITY_MAX_COUNT} priorities for today, {PRIORITY_MAX_LENGTH} characters each. One is enough to complete D1.
      </Text>
      {offered.length > 0 ? (
        <Card title="Carry over from yesterday">
          <ChipGroup
            testIDPrefix="d1-carry"
            options={offered.map((c) => ({ value: String(c.id), label: `+ ${c.text} (${c.status === 'partial' ? 'partial' : 'not done'})` }))}
            isSelected={() => false}
            onPress={carryOver}
          />
        </Card>
      ) : null}
      <Card>
        {slots.map((slot, index) => (
          <FormField
            key={index}
            testID={`d1-priority-${index + 1}`}
            label={`Priority ${index + 1}${slot.carriedFromId !== null ? ' · carried over' : ''}`}
            value={slot.text}
            maxLength={PRIORITY_MAX_LENGTH}
            multiline
            blurOnSubmit
            returnKeyType="done"
            placeholder={index === 0 ? 'Most important thing today' : 'Optional'}
            onChangeText={(text) =>
              setSlots(slots.map((s, i) => (i === index ? { text: text.replace(/\n/g, ' '), carriedFromId: text === '' ? null : s.carriedFromId } : s)))
            }
          />
        ))}
        {error ? <Text style={[ui.muted, { color: COLORS.fail }]}>{error}</Text> : null}
        <ActionButton testID="d1-save" label="Save priorities" onPress={() => void save()} />
      </Card>
    </ScreenScrollView>
  );
}
