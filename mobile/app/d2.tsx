import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import { listPriorities, setPriorityStatus, type Priority, type PriorityStatus } from '../src/daily/reflection_repository';
import { useAppState } from '../src/ui/app_state_context';
import { ChipGroup, FormField } from '../src/ui/controls';
import { Card, ScreenMessage, ScreenScrollView } from '../src/ui/screen_layout';
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

  if (!database || !today) return <ScreenMessage loading />;

  const update = (item: Priority, status: PriorityStatus, note: string) => {
    setPriorityStatus(database.executor, item.id, status, note);
    reload();
    void refreshDaily();
  };

  if (priorities.length === 0) {
    return (
      <ScreenScrollView testID="screen-d2">
        <Card>
          <Text style={ui.text}>No priorities were set this morning, so D2 is recorded as not applicable today, not as a miss.</Text>
        </Card>
      </ScreenScrollView>
    );
  }

  const remaining = priorities.filter((item) => item.status === 'open').length;
  return (
    <ScreenScrollView testID="screen-d2">
      <Text testID="d2-summary" style={[ui.muted, remaining === 0 ? { color: COLORS.pass } : null]}>
        {remaining === 0 ? 'Every priority has a status: D2 complete.' : `${remaining} left to mark.`}
      </Text>
      {priorities.map((item) => (
        <Card key={item.id}>
          <Text style={ui.text}>
            {item.position}. {item.text}
          </Text>
          <ChipGroup
            testIDPrefix={`d2-status-${item.position}`}
            options={STATUSES}
            isSelected={(value) => item.status === value}
            onPress={(value) => update(item, value as PriorityStatus, notes[item.id] ?? '')}
          />
          <FormField
            testID={`d2-note-${item.position}`}
            value={notes[item.id] ?? ''}
            placeholder="Optional note"
            maxLength={200}
            onChangeText={(text) => setNotes({ ...notes, [item.id]: text })}
            onEndEditing={() => update(item, item.status, notes[item.id] ?? '')}
          />
        </Card>
      ))}
    </ScreenScrollView>
  );
}
