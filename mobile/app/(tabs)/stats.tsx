import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { readPingLog, type PingDay } from '../../src/notifications/notification_ledger';
import { useAppState } from '../../src/ui/app_state_context';
import { formatShortDate } from '../../src/ui/date_format';
import { COLORS, ui } from '../../src/ui/ui_styles';

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

  if (!daily) return null;
  const fired = pings.reduce((n, day) => n + (day.morning === 'fired' ? 1 : 0) + (day.evening === 'fired' ? 1 : 0), 0);
  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.body}>
      <View style={ui.card}>
        <Text style={ui.h2}>Streak</Text>
        <Text style={ui.text}>Current {daily.streak.currentStreak} · longest {daily.streak.longestStreak}</Text>
        <Text style={ui.text}>Days with a complete window: {countedDays}</Text>
        <Text style={ui.text}>Freezes banked: {daily.streak.bankedFreezes} of 2</Text>
      </View>
      <View style={ui.card}>
        <Text style={ui.h2}>Freeze log</Text>
        {freezes.length === 0 ? <Text style={ui.muted}>No freezes earned yet (one per 7 counted days).</Text> : null}
        {freezes.map((freeze) => (
          <Text key={freeze.earned_on} style={ui.text}>
            Earned {formatShortDate(freeze.earned_on)} ·{' '}
            {freeze.used_on ? `used for ${formatShortDate(freeze.used_on)}` : 'banked'}
          </Text>
        ))}
      </View>
      <View style={ui.card}>
        <Text style={ui.h2}>Pings, last 14 days ({fired} fired)</Text>
        {pings.map((day) => (
          <View key={day.date} style={ui.row}>
            <Text style={[ui.text, { flex: 1 }]}>{formatShortDate(day.date)}</Text>
            <Text style={[ui.muted, { width: 90, color: day.morning === 'fired' ? COLORS.pass : COLORS.muted }]}>{day.morning}</Text>
            <Text style={[ui.muted, { width: 90, color: day.evening === 'fired' ? COLORS.pass : COLORS.muted }]}>{day.evening}</Text>
          </View>
        ))}
      </View>
      <Text style={ui.muted}>Adherence and learning metrics (spec Section 10) arrive with the learning modules.</Text>
    </ScrollView>
  );
}
