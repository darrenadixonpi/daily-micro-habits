import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { markA5Opened, saveA5EventCard, savedA5Events } from '../src/learning/a5_on_this_day';
import { useAppState } from '../src/ui/app_state_context';
import { ActionButton, LinkText } from '../src/ui/controls';
import { formatMonthDay } from '../src/ui/date_format';
import { GeneratedBadge, ReportErrorAction } from '../src/ui/report_error_action';
import { Card, ScreenMessage, ScreenScrollView } from '../src/ui/screen_layout';
import { ui } from '../src/ui/ui_styles';

/** A5 On this day: read-only; opening it completes the task; any event can be saved as a card. */
export default function OnThisDayScreen() {
  const { database, daily, refreshDaily, getScheduler } = useAppState();
  const item = daily?.assignment.A5 ?? null;
  const [saved, setSaved] = useState<number[]>([]);

  useEffect(() => {
    if (!database || !daily || !item) return;
    markA5Opened(database.executor, { date: daily.today, item, now: new Date() });
    setSaved(savedA5Events(database.executor, item.row.id));
    if (daily.dayStatus.modules.A5 !== 'complete') void refreshDaily();
  }, [database, daily, item, refreshDaily]);

  if (!database || !daily) return <ScreenMessage loading />;
  if (!item) {
    return <ScreenMessage message="No entry for today yet. The bundled set covers some dates; for others the app fetches Wikipedia’s On this day feed when online. Reopen the app with a connection." />;
  }
  const day = item.payload;
  const save = async (index: number) => {
    saveA5EventCard(database.executor, await getScheduler(), { item, eventIndex: index, now: new Date(), dueAt: daily.review.dayEnd });
    setSaved(savedA5Events(database.executor, item.row.id));
  };

  return (
    <ScreenScrollView testID="screen-a5">
      <Text testID="a5-date" style={ui.h1}>{formatMonthDay(day.date_key)}</Text>
      <GeneratedBadge source={item.row.source} />
      {day.events.map((event, index) => (
        <Card key={`${event.year}-${index}`} title={String(event.year)} aside={event.category} testID={`a5-event-${index}`}>
          <Text style={[ui.text, { lineHeight: 21 }]}>{event.summary}</Text>
          <LinkText title={event.source.title} url={event.source.url} />
          <ActionButton
            testID={`a5-save-${index}`}
            label={saved.includes(index) ? 'Saved as a review card ✓' : 'Save as card'}
            disabled={saved.includes(index)}
            onPress={() => void save(index)}
          />
        </Card>
      ))}
      {day.attribution ? <Text style={ui.muted}>{day.attribution}</Text> : null}
      <Text style={ui.muted}>A5 is complete once opened.</Text>
      <ReportErrorAction itemId={item.row.id} moduleLabel="A5 entry" testID="a5-report" />
    </ScreenScrollView>
  );
}
