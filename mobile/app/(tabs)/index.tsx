import type { Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { enabledModulesFrom } from '../../src/daily/daily_cycle';
import type { DayStatus, ModuleState } from '../../src/daily/day_status';
import { MODULES, type ModuleId, type WindowId } from '../../src/daily/module_catalog';
import { readPingLog } from '../../src/notifications/notification_ledger';
import { readAllSettings, readInternalValue } from '../../src/settings/settings_repository';
import { useAppState } from '../../src/ui/app_state_context';
import { ActionButton, NavigationRow } from '../../src/ui/controls';
import { formatLongDate, formatShortDate } from '../../src/ui/date_format';
import { PassphraseSetupForm } from '../../src/ui/passphrase_setup_form';
import { PING_COLOR, PING_LABEL } from '../../src/ui/ping_labels';
import { Card, ScreenMessage, ScreenScrollView, TableRow } from '../../src/ui/screen_layout';
import { COLORS, ui } from '../../src/ui/ui_styles';

const ROUTE_BY_MODULE: Partial<Record<ModuleId, (date: string) => Href>> = {
  A1: () => '/a1',
  A2: () => '/review',
  A3: () => '/a3',
  A4: () => '/a4',
  A5: () => '/a5',
  D1: () => '/d1',
  D2: () => '/d2',
  D3: (date) => `/journal-entry/${date}`,
};

const MODULE_STATE_LABEL: Record<ModuleState, string> = {
  complete: 'Done',
  incomplete: 'To do',
  not_applicable: 'Not applicable',
  no_content: 'No content',
  disabled: 'Off',
  not_implemented: '',
};

/** Today: both windows with their tasks in the recommended order, the streak, and the 7-day ping log (M2 gate evidence). */
export default function TodayScreen() {
  const {
    database, openError, daily, dailyError, notificationsAllowed, passphraseSet, diagnostics, diagnosticsRunning, ensureNotificationPermission,
  } = useAppState();
  const [setupClosed, setSetupClosed] = useState(false);
  const deferred = database ? readInternalValue(database.executor, 'passphrase_setup_deferred_at') !== undefined : false;
  const showSetup = Boolean(database && daily && !passphraseSet && !deferred && !setupClosed);
  const todayVisible = Boolean(database && daily && !showSetup);

  // One prompt at a time: the iOS notification prompt waits until first-launch setup is done.
  useEffect(() => {
    if (todayVisible && notificationsAllowed === null) void ensureNotificationPermission();
  }, [todayVisible, notificationsAllowed, ensureNotificationPermission]);

  if (openError) return <ScreenMessage tone="error" message={`The database could not be opened: ${openError}`} />;
  if (!database || !daily) return <ScreenMessage loading message={dailyError ?? undefined} tone={dailyError ? 'error' : 'muted'} />;

  // First launch: the recovery passphrase form is rendered here, in place of Today, until a
  // passphrase is set or deferred. No push or modal is involved, so nothing depends on when
  // the navigator mounts (docs/ui_conventions.md, "First-launch prompts").
  if (showSetup) {
    return <PassphraseSetupForm showTitle onDone={() => setSetupClosed(true)} />;
  }

  const enabled = enabledModulesFrom(readAllSettings(database.executor));
  const trackingStart = readInternalValue(database.executor, 'cycle_start_date');
  const pings = readPingLog(database.executor, daily.today, 7);

  return (
    <ScreenScrollView testID="screen-today">
      <Text style={ui.h1}>{formatLongDate(daily.today)}</Text>
      <Text style={ui.muted}>
        Streak {daily.streak.currentStreak} day{daily.streak.currentStreak === 1 ? '' : 's'} · {daily.streak.bankedFreezes} freeze
        {daily.streak.bankedFreezes === 1 ? '' : 's'} banked · longest {daily.streak.longestStreak}
      </Text>

      {!passphraseSet ? (
        <Card tone="warning">
          <Text style={ui.text}>No recovery passphrase yet, so daily backups are off.</Text>
          <ActionButton label="Set passphrase" href="/setup/passphrase" testID="today-set-passphrase" />
        </Card>
      ) : null}
      {notificationsAllowed === false ? (
        <Card tone="warning">
          <Text style={ui.text}>Notifications are turned off for Micro-Habits in iOS Settings, so no pings will arrive.</Text>
        </Card>
      ) : null}
      {dailyError ? (
        <Card tone="warning">
          <Text style={ui.text}>Daily update failed: {dailyError}</Text>
        </Card>
      ) : null}

      {(['morning', 'evening'] as const).map((window) => (
        <WindowCard key={window} window={window} enabled={enabled} status={daily.dayStatus} today={daily.today} />
      ))}

      <Card title="Pings, last 7 days" testID="today-ping-log">
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
        <Text style={ui.muted}>
          Fired = delivered by iOS. Suppressed = the window was already complete, so no ping was needed. — = before tracking began.
        </Text>
      </Card>

      <ActionButton
        testID="today-diagnostics"
        href="/diagnostics"
        label={
          diagnosticsRunning
            ? 'Diagnostics running…'
            : diagnostics
              ? `Diagnostics ${diagnostics.passed}/${diagnostics.results.length} passed`
              : 'Diagnostics'
        }
      />
    </ScreenScrollView>
  );
}

function WindowCard({
  window,
  enabled,
  status,
  today,
}: {
  readonly window: WindowId;
  readonly enabled: readonly string[];
  readonly status: DayStatus;
  readonly today: string;
}) {
  const state = status.windows[window];
  // Recommended session order (spec Section 4): the morning opens with A3 (yesterday's question).
  const ORDER: Record<WindowId, readonly ModuleId[]> = { morning: ['A3', 'A1', 'A4', 'A5', 'D1'], evening: ['A2', 'D2', 'D3'] };
  const modules = ORDER[window]
    .map((id) => MODULES.find((module) => module.id === id))
    .filter((module): module is (typeof MODULES)[number] => module !== undefined && enabled.includes(module.id));
  return (
    <Card
      testID={`today-${window}`}
      title={window === 'morning' ? 'Morning' : 'Evening'}
      aside={
        <Text style={[ui.muted, state === 'complete' ? { color: COLORS.pass, fontWeight: '600' } : null]}>
          {state === 'complete' ? 'Complete' : state === 'no_tasks' ? 'No tasks enabled' : 'In progress'}
        </Text>
      }
    >
      {modules.map((module) => {
        const moduleState = status.modules[module.id];
        const route = ROUTE_BY_MODULE[module.id];
        if (!module.implemented || !route) {
          return (
            <Text key={module.id} style={ui.muted}>
              {module.id} {module.name} · arrives in {module.arrivesIn}
            </Text>
          );
        }
        return (
          <NavigationRow
            key={module.id}
            testID={`today-module-${module.id}`}
            label={`${module.id} ${module.name}`}
            value={MODULE_STATE_LABEL[moduleState]}
            valueColor={moduleState === 'complete' ? COLORS.pass : COLORS.accent}
            href={route(today)}
          />
        );
      })}
    </Card>
  );
}
