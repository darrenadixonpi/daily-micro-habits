import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { enabledModulesFrom } from '../../src/daily/daily_cycle';
import { readPingLog, type PingDay } from '../../src/notifications/notification_ledger';
import { readAllSettings, readInternalValue } from '../../src/settings/settings_repository';
import { computeStats, SPEARMAN_MIN_PAIRS, type Share, type StatsReport } from '../../src/stats/adherence_metrics';
import { useAppState } from '../../src/ui/app_state_context';
import { TrendBars } from '../../src/ui/charts';
import { formatShortDate } from '../../src/ui/date_format';
import { plural } from '../../src/ui/plural';
import { PING_COLOR, PING_LABEL } from '../../src/ui/ping_labels';
import { Card, LabelValueRow, ScreenMessage, ScreenScrollView, TableRow } from '../../src/ui/screen_layout';
import { ui } from '../../src/ui/ui_styles';

interface FreezeRow {
  readonly earned_on: string;
  readonly used_on: string | null;
}

const percent = (value: number | null | undefined, digits = 0) => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(digits)}%`);
const shareText = (s: Share) => (s.value === null ? 'no data yet' : `${percent(s.value)} (${s.numerator}/${s.denominator})`);
const number = (value: number | null, digits = 1) => (value === null ? '—' : value.toFixed(digits));

/** Stats (spec Section 10): every metric's current value over the last 30 days, with trends; then streak, freezes and pings. */
export default function StatsScreen() {
  const { database, daily } = useAppState();
  const [report, setReport] = useState<StatsReport | null>(null);
  const [freezes, setFreezes] = useState<FreezeRow[]>([]);
  const [pings, setPings] = useState<PingDay[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!database || !daily) return;
      const settings = readAllSettings(database.executor);
      const start = readInternalValue(database.executor, 'cycle_start_date');
      setReport(
        computeStats(database.executor, {
          today: daily.today,
          trackingStart: typeof start === 'string' ? start : null,
          enabledModules: enabledModulesFrom(settings),
          targetRetention: Number(settings.get('a2.target_retention')),
          moodEnabled: settings.get('d3.mood_score') === true,
        }),
      );
      setFreezes(database.executor.all<FreezeRow>('SELECT earned_on, used_on FROM streak_freeze ORDER BY earned_on DESC'));
      setPings(readPingLog(database.executor, daily.today, 14).reverse());
    }, [database, daily]),
  );

  if (!database || !daily || !report) return <ScreenMessage loading />;
  const trackingStart = readInternalValue(database.executor, 'cycle_start_date');
  const fired = pings.reduce((n, day) => n + (day.morning === 'fired' ? 1 : 0) + (day.evening === 'fired' ? 1 : 0), 0);
  const r = report;

  return (
    <ScreenScrollView testID="screen-stats">
      <Text testID="stats-range" style={ui.muted}>
        {formatShortDate(r.from)} – {formatShortDate(r.to)} ({plural(r.days.length, 'day')}). Each bar is one day.
      </Text>

      <Card title="Streak" testID="stats-streak">
        <LabelValueRow label="Current" value={plural(daily.streak.currentStreak, 'day')} />
        <LabelValueRow label="Longest" value={plural(daily.streak.longestStreak, 'day')} />
        <LabelValueRow label="Freezes banked" value={`${daily.streak.bankedFreezes} of 2`} />
      </Card>

      <Card title="Daily adherence" aside={percent(r.adherence.mean)} testID="stats-adherence">
        <Text style={ui.muted}>
          Completed modules ÷ modules that applied that day (a review with nothing due, or an evening review without priorities, does not count against you).
          {r.adherence.basis.enabled > 0
            ? ` ${plural(r.adherence.basis.enabled, 'earlier day')} before v0.3.1 ${r.adherence.basis.enabled === 1 ? 'uses' : 'use'} completed ÷ enabled.`
            : ''}
        </Text>
        <TrendBars values={r.adherence.series} max={1} />
      </Card>

      <Card title="Window completion" testID="stats-windows">
        <LabelValueRow label="Morning" value={shareText(r.windowCompletion.morning)} />
        <LabelValueRow label="Evening" value={shareText(r.windowCompletion.evening)} />
      </Card>

      <Card title="A2 retrieval" aside={shareText(r.retrieval.overall)} testID="stats-retrieval">
        <Text style={ui.muted}>Reviews of mature cards not graded Again. Calibration gap = retrieval − target retention.</Text>
        <LabelValueRow
          label="Calibration gap"
          value={r.retrieval.calibrationGap === null ? '—' : `${r.retrieval.calibrationGap >= 0 ? '+' : ''}${(r.retrieval.calibrationGap * 100).toFixed(1)} pts`}
        />
        {Object.entries(r.retrieval.byModule).map(([module, value]) => (
          <LabelValueRow key={module} label={`From ${module}`} value={shareText(value)} />
        ))}
        {Object.entries(r.retrieval.byElapsed).map(([bucket, value]) => (
          <LabelValueRow key={bucket} label={`${bucket} ${bucket === '1' ? 'day' : 'days'} since last review`} value={shareText(value)} />
        ))}
      </Card>

      <Card title="A3 delayed recall" aside={shareText(r.delayedRecall)} testID="stats-recall">
        <Text style={ui.muted}>Next-day multiple-choice accuracy.</Text>
      </Card>

      <Card title="A4 production" testID="stats-production">
        <LabelValueRow label="Exact" value={shareText(r.production.exact)} />
        <LabelValueRow label="Close" value={shareText(r.production.close)} />
        <LabelValueRow label="Fail (first try)" value={shareText(r.production.fail)} />
        <LabelValueRow label="I don’t know" value={shareText(r.production.skipped)} />
        <LabelValueRow label="Mean edit distance (typed)" value={percent(r.production.meanNormalizedDistance, 1)} />
      </Card>

      <Card title="Priority completion" aside={r.priorities.meanScore === null ? '—' : r.priorities.meanScore.toFixed(2)} testID="stats-priorities">
        <Text style={ui.muted}>Mean per day: done 1, partial 0.5, not done 0. Carried over: {r.priorities.carriedOver}.</Text>
        <TrendBars values={r.priorities.series} max={1} />
      </Card>

      <Card title="Journal" testID="stats-journal">
        <LabelValueRow label="Entries per week" value={number(r.journal.entriesPerWeek)} />
        <LabelValueRow label="Words per entry" value={number(r.journal.wordsPerEntry, 0)} />
        <TrendBars values={r.journal.series} caption="Words per day" />
      </Card>

      <Card title="Mood and adherence" testID="stats-mood">
        <Text style={ui.muted}>
          {!r.moodAdherence.enabled
            ? 'Turn on Mood score (Settings → D3 Journal) to track this.'
            : r.moodAdherence.rho === null
              ? `Spearman correlation appears after ${SPEARMAN_MIN_PAIRS} days with a mood score (${r.moodAdherence.pairs} so far).`
              : `Spearman ρ = ${r.moodAdherence.rho.toFixed(2)} over ${plural(r.moodAdherence.pairs, 'day')}.`}
        </Text>
      </Card>

      <Card title="Response latency" aside={r.latency.medianMinutes === null ? '—' : `${Math.round(r.latency.medianMinutes)} min`} testID="stats-latency">
        <Text style={ui.muted}>Median minutes from a delivered ping to the first task done in that window ({r.latency.samples} pings).</Text>
        <LabelValueRow label="Morning" value={r.latency.byWindow.morning === null ? '—' : `${Math.round(r.latency.byWindow.morning)} min`} />
        <LabelValueRow label="Evening" value={r.latency.byWindow.evening === null ? '—' : `${Math.round(r.latency.byWindow.evening)} min`} />
      </Card>

      <Card title="Freeze log" testID="stats-freezes">
        {freezes.length === 0 ? <Text style={ui.muted}>No freezes earned yet (one per 7 counted days).</Text> : null}
        {freezes.map((freeze) => (
          <Text key={freeze.earned_on} style={ui.text}>
            Earned {formatShortDate(freeze.earned_on)} · {freeze.used_on ? `used for ${formatShortDate(freeze.used_on)}` : 'banked'}
          </Text>
        ))}
      </Card>

      <Card title={`Pings, last 14 days (${fired} fired)`} testID="stats-pings">
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
    </ScreenScrollView>
  );
}
