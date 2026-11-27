import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { readPingLog, type PingDay } from '../../src/notifications/notification_ledger';
import { readInternalValue } from '../../src/settings/settings_repository';
import { useAppState } from '../../src/ui/app_state_context';
import { formatShortDate } from '../../src/ui/date_format';
import { PING_COLOR, PING_LABEL } from '../../src/ui/ping_labels';
import { Card, ScreenMessage, ScreenScrollView, TableRow } from '../../src/ui/screen_layout';
import { ui } from '../../src/ui/ui_styles';

interface FreezeRow {
  readonly earned_on: string;
  readonly used_on: string | null;
}

/** M2 stats: streak, the freeze log (spec Section 4) and a 14-day ping history. Full metrics come later. */
export default function StatsScreen() {
  const { database, daily } = useAppState();
  const [freezes, setFreezes] = useState<FreezeRow[]>([]);
  const [pings, setPings] = useState<PingDay[]>([]);
  const [countedDays, setCountedDays] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!database || !daily) return;
      setFreezes(database.executor.all<FreezeRow>('SELECT earned_on, used_on FROM streak_freeze ORDER BY earned_on DESC'));
      setPings(readPingLog(database.executor, daily.today, 14).reverse());
      setCountedDays(
        database.executor.get<{ n: number }>(
          'SELECT count(*) AS n FROM daily_session WHERE morning_completed_at IS NOT NULL OR evening_completed_at IS NOT NULL',
        )?.n ?? 0,
      );
    }, [database, daily]),
  );

  if (!database || !daily) return <ScreenMessage loading />;
  const trackingStart = readInternalValue(database.executor, 'cycle_start_date');
  const fired = pings.reduce((n, day) => n + (day.morning === 'fired' ? 1 : 0) + (day.evening === 'fired' ? 1 : 0), 0);
  return (
    <ScreenScrollView testID="screen-stats">
      <Card title="Streak">
        <Text style={ui.text}>Current {daily.streak.currentStreak} · longest {daily.streak.longestStreak}</Text>
        <Text style={ui.text}>Days with a complete window: {countedDays}</Text>
        <Text style={ui.text}>Freezes banked: {daily.streak.bankedFreezes} of 2</Text>
      </Card>
      <Card title="Freeze log">
        {freezes.length === 0 ? <Text style={ui.muted}>No freezes earned yet (one per 7 counted days).</Text> : null}
        {freezes.map((freeze) => (
          <Text key={freeze.earned_on} style={ui.text}>
            Earned {formatShortDate(freeze.earned_on)} · {freeze.used_on ? `used for ${formatShortDate(freeze.used_on)}` : 'banked'}
          </Text>
        ))}
      </Card>
      <Card title={`Pings, last 14 days (${fired} fired)`}>
        <TableRow header cells={[{ text: 'Day' }, { text: 'Morning', width: 104 }, { text: 'Evening', width: 104 }]} />
        {pings.map((day) => {
          const untracked = typeof trackingStart === 'string' && day.date < trackingStart;
          const morning = untracked ? 'untracked' : day.morning;
          const evening = untracked ? 'untracked' : day.evening;
          return (
            <TableRow
              key={day.date}
              cells={[
                { text: formatShortDate(day.date) },
                { text: PING_LABEL[morning], color: PING_COLOR[morning], width: 104 },
                { text: PING_LABEL[evening], color: PING_COLOR[evening], width: 104 },
              ]}
            />
          );
        })}
      </Card>
      <Text style={ui.muted}>Adherence and learning metrics (spec Section 10) arrive with the learning modules.</Text>
    </ScreenScrollView>
  );
}
