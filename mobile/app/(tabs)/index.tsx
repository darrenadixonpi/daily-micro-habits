import { Link, router, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { ModuleState } from '../../src/daily/day_status';
import { MODULES, type WindowId } from '../../src/daily/module_catalog';
import { enabledModulesFrom } from '../../src/daily/daily_cycle';
import { readPingLog, type PingState } from '../../src/notifications/notification_ledger';
import { readAllSettings, readInternalValue } from '../../src/settings/settings_repository';
import { useAppState } from '../../src/ui/app_state_context';
import { formatLongDate, formatShortDate } from '../../src/ui/date_format';
import { COLORS, ui } from '../../src/ui/ui_styles';

const ROUTE_BY_MODULE: Partial<Record<string, (date: string) => Href>> = {
  D1: () => '/d1',
  D2: () => '/d2',
  D3: (date) => `/journal-entry/${date}`,
};

const MODULE_STATE_LABEL: Record<ModuleState, string> = {
  complete: 'Done',
  incomplete: 'To do',
  not_applicable: 'Not applicable',
  disabled: 'Off',
  not_implemented: '',
};

/** Today: the two windows with their tasks, the streak, and the 7-day ping log (M2 gate evidence). */
export default function TodayScreen() {
  const { database, openError, daily, dailyError, notificationsAllowed, passphraseSet, diagnostics, diagnosticsRunning } = useAppState();
  const promptedRef = useRef(false);

  useEffect(() => {
    if (!database || passphraseSet || promptedRef.current) return;
    if (readInternalValue(database.executor, 'passphrase_setup_deferred_at') !== undefined) return;
    promptedRef.current = true;
    router.push('/setup/passphrase');
  }, [database, passphraseSet]);

  if (openError) {
    return (
      <View style={[ui.screen, ui.body]}>
        <Text style={[ui.text, { color: COLORS.fail }]}>The database could not be opened: {openError}</Text>
      </View>
    );
  }
  if (!database || !daily) {
    return (
      <View style={[ui.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator />
        {dailyError ? <Text style={[ui.muted, { textAlign: 'center', color: COLORS.fail }]}>{dailyError}</Text> : null}
      </View>
    );
  }

  const enabled = enabledModulesFrom(readAllSettings(database.executor));
  const pings = readPingLog(database.executor, daily.today, 7);

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.body}>
      <Text style={ui.h1}>{formatLongDate(daily.today)}</Text>
      <Text style={ui.muted}>
        Streak {daily.streak.currentStreak} day{daily.streak.currentStreak === 1 ? '' : 's'} · {daily.streak.bankedFreezes} freeze
        {daily.streak.bankedFreezes === 1 ? '' : 's'} banked · longest {daily.streak.longestStreak}
      </Text>

      {!passphraseSet ? (
        <Banner text="No recovery passphrase yet, so daily backups are off." action="Set passphrase" href="/setup/passphrase" />
      ) : null}
      {notificationsAllowed === false ? (
        <Banner text="Notifications are turned off for Micro-Habits in iOS Settings, so no pings will arrive." />
      ) : null}
      {dailyError ? <Banner text={`Daily update failed: ${dailyError}`} /> : null}

      {(['morning', 'evening'] as const).map((window) => (
        <WindowCard key={window} window={window} enabled={enabled} />
      ))}

      <View style={ui.card}>
        <Text style={ui.h2}>Pings, last 7 days</Text>
        <View style={ui.row}>
          <Text style={[ui.muted, { flex: 1 }]}>Day</Text>
          <Text style={[ui.muted, { width: 90 }]}>Morning</Text>
          <Text style={[ui.muted, { width: 90 }]}>Evening</Text>
        </View>
        {pings.map((day) => (
          <View key={day.date} style={ui.row}>
            <Text style={[ui.text, { flex: 1 }]}>{formatShortDate(day.date)}</Text>
            <PingCell state={day.morning} />
            <PingCell state={day.evening} />
          </View>
        ))}
        <Text style={ui.muted}>Fired = delivered by iOS; suppressed = window already complete, so no ping was needed.</Text>
      </View>

      <Link href="/diagnostics" asChild>
        <Pressable style={ui.button}>
          <Text style={ui.buttonText}>
            {diagnosticsRunning
              ? 'Diagnostics running…'
              : diagnostics
                ? `Diagnostics ${diagnostics.passed}/${diagnostics.results.length} passed`
                : 'Diagnostics'}
          </Text>
        </Pressable>
      </Link>
    </ScrollView>
  );

  function WindowCard({ window, enabled: enabledModules }: { readonly window: WindowId; readonly enabled: readonly string[] }) {
    const state = daily?.dayStatus.windows[window];
    const modules = MODULES.filter((module) => module.window === window && enabledModules.includes(module.id));
    return (
      <View style={ui.card}>
        <View style={ui.row}>
          <Text style={ui.h2}>{window === 'morning' ? 'Morning' : 'Evening'}</Text>
          <Text style={[ui.muted, state === 'complete' ? { color: COLORS.pass, fontWeight: '600' } : null]}>
            {state === 'complete' ? 'Complete' : state === 'no_tasks' ? 'No tasks enabled' : 'In progress'}
          </Text>
        </View>
        {modules.map((module) => {
          const moduleState = daily?.dayStatus.modules[module.id] ?? 'incomplete';
          const route = ROUTE_BY_MODULE[module.id];
          if (!module.implemented || !route) {
            return (
              <Text key={module.id} style={ui.muted}>
                {module.id} {module.name} · arrives in {module.arrivesIn}
              </Text>
            );
          }
          return (
            <Link key={module.id} href={route(daily?.today ?? '')} asChild>
              <Pressable style={[ui.row, { paddingVertical: 8 }]}>
                <Text style={ui.text}>
                  {module.id} {module.name}
                </Text>
                <Text style={[ui.text, { color: moduleState === 'complete' ? COLORS.pass : COLORS.accent }]}>
                  {MODULE_STATE_LABEL[moduleState]} ›
                </Text>
              </Pressable>
            </Link>
          );
        })}
      </View>
    );
  }
}

function PingCell({ state }: { readonly state: PingState }) {
  const label: Record<PingState, string> = { fired: '✓ fired', suppressed: '– suppressed', scheduled: '… scheduled', none: '✗ none' };
  const color: Record<PingState, string> = { fired: COLORS.pass, suppressed: COLORS.muted, scheduled: COLORS.muted, none: COLORS.fail };
  return <Text style={[ui.muted, { width: 90, color: color[state] }]}>{label[state]}</Text>;
}

function Banner({ text, action, href }: { readonly text: string; readonly action?: string; readonly href?: Href }) {
  return (
    <View style={[ui.card, { borderColor: COLORS.skip }]}>
      <Text style={ui.text}>{text}</Text>
      {action && href ? (
        <Link href={href} asChild>
          <Pressable style={ui.button}>
            <Text style={ui.buttonText}>{action}</Text>
          </Pressable>
        </Link>
      ) : null}
    </View>
  );
}
