import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { listPriorities, setPriorityStatus, type Priority, type PriorityStatus } from '../src/daily/reflection_repository';
import { useAppState } from '../src/ui/app_state_context';
import { COLORS, ui } from '../src/ui/ui_styles';

const STATUSES: readonly { readonly value: Exclude<PriorityStatus, 'open'>; readonly label: string }[] = [
  { value: 'done', label: 'Done' },
  { value: 'partial', label: 'Partial' },
  { value: 'not_done', label: 'Not done' },
];

/** D2 Evening review: mark each of today's priorities, with an optional one-line note. Saved on every change. */
export default function EveningReviewScreen() {
  const { database, daily, refreshDaily } = useAppState();
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const today = daily?.today;

  const reload = useCallback(() => {
    if (!database || !today) return;
    const items = listPriorities(database.executor, today);
    setPriorities(items);
    setNotes(Object.fromEntries(items.map((item) => [item.id, item.note ?? ''])));
  }, [database, today]);

  useEffect(reload, [reload]);

  if (!database || !today) return null;

  const update = (item: Priority, status: PriorityStatus, note: string) => {
    setPriorityStatus(database.executor, item.id, status, note);
    reload();
    void refreshDaily();
  };

  if (priorities.length === 0) {
    return (
      <View style={[ui.screen, ui.body]}>
        <View style={ui.card}>
          <Text style={ui.text}>No priorities were set this morning, so D2 is recorded as not applicable today, not as a miss.</Text>
        </View>
      </View>
    );
  }

  const remaining = priorities.filter((item) => item.status === 'open').length;
  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.body} keyboardShouldPersistTaps="handled">
      <Text style={[ui.muted, remaining === 0 ? { color: COLORS.pass } : null]}>
        {remaining === 0 ? 'Every priority has a status: D2 complete.' : `${remaining} left to mark.`}
      </Text>
      {priorities.map((item) => (
        <View key={item.id} style={ui.card}>
          <Text style={ui.text}>
            {item.position}. {item.text}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {STATUSES.map((status) => {
              const selected = item.status === status.value;
              return (
                <Pressable
                  key={status.value}
                  style={[ui.chip, selected ? ui.chipSelected : null]}
                  onPress={() => update(item, status.value, notes[item.id] ?? '')}
                >
                  <Text style={[ui.chipText, selected ? ui.chipTextSelected : null]}>{status.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            style={ui.input}
            value={notes[item.id] ?? ''}
            placeholder="Optional note"
            maxLength={200}
            onChangeText={(text) => setNotes({ ...notes, [item.id]: text })}
            onEndEditing={() => update(item, item.status, notes[item.id] ?? '')}
          />
        </View>
      ))}
    </ScrollView>
  );
}
