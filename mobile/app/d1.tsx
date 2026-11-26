import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  carryOverCandidates,
  listPriorities,
  PRIORITY_MAX_COUNT,
  PRIORITY_MAX_LENGTH,
  savePriorities,
  type Priority,
} from '../src/daily/reflection_repository';
import { useAppState } from '../src/ui/app_state_context';
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

  if (!database || !today) return null;

  const offered = candidates.filter((candidate) => !slots.some((slot) => slot.carriedFromId === candidate.id));
  const carryOver = (candidate: Priority) => {
    const index = slots.findIndex((slot) => slot.text.trim() === '');
    if (index < 0) return;
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
    <ScrollView style={ui.screen} contentContainerStyle={ui.body} keyboardShouldPersistTaps="handled">
      <Text style={ui.muted}>Up to {PRIORITY_MAX_COUNT} priorities for today, {PRIORITY_MAX_LENGTH} characters each. One is enough to complete D1.</Text>
      {offered.length > 0 ? (
        <View style={ui.card}>
          <Text style={ui.h2}>Carry over from yesterday</Text>
          {offered.map((candidate) => (
            <Pressable key={candidate.id} style={[ui.chip, { alignSelf: 'flex-start' }]} onPress={() => carryOver(candidate)}>
              <Text style={ui.chipText}>
                + {candidate.text} ({candidate.status === 'partial' ? 'partial' : 'not done'})
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={ui.card}>
        {slots.map((slot, index) => (
          <View key={index} style={{ gap: 4 }}>
            <Text style={ui.muted}>
              Priority {index + 1}
              {slot.carriedFromId !== null ? ' · carried over' : ''}
            </Text>
            <TextInput
              style={ui.input}
              value={slot.text}
              maxLength={PRIORITY_MAX_LENGTH}
              placeholder={index === 0 ? 'Most important thing today' : 'Optional'}
              onChangeText={(text) =>
                setSlots(slots.map((s, i) => (i === index ? { text, carriedFromId: text === '' ? null : s.carriedFromId } : s)))
              }
            />
          </View>
        ))}
        {error ? <Text style={[ui.muted, { color: COLORS.fail }]}>{error}</Text> : null}
        <Pressable style={ui.button} onPress={() => void save()}>
          <Text style={ui.buttonText}>Save priorities</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
