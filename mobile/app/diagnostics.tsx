import * as Application from 'expo-application';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { DIAGNOSTIC_CASES } from '../src/diagnostics/diagnostic_cases';
import { useAppState } from '../src/ui/app_state_context';
import { COLORS, STATUS_COLOR, ui } from '../src/ui/ui_styles';

/** Install facts, database facts and the diagnostic results (gate evidence). */
export default function DiagnosticsScreen() {
  const { database, daily, diagnostics, diagnosticsRunning, diagnosticsProgress, runDiagnosticsAgain } = useAppState();
  const results = diagnosticsRunning ? diagnosticsProgress : (diagnostics?.results ?? []);
  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.body}>
      <View style={ui.card}>
        <View style={ui.row}>
          <Text style={ui.h2}>Diagnostics</Text>
          {diagnosticsRunning ? (
            <Text style={ui.muted}>running {results.length}/{DIAGNOSTIC_CASES.length}…</Text>
          ) : diagnostics ? (
            <Text style={[ui.text, { fontWeight: '700', color: diagnostics.failed === 0 ? COLORS.pass : COLORS.fail }]}>
              {diagnostics.passed}/{diagnostics.results.length} passed
            </Text>
          ) : null}
        </View>
        <Text style={ui.muted}>
          Version {Application.nativeApplicationVersion} (build {Application.nativeBuildVersion}) · iOS {String(Platform.Version)}
        </Text>
        {database ? (
          <>
            <Text style={ui.muted}>
              SQLCipher {database.cipherVersion ?? 'NOT DETECTED'} · schema v{database.migration.toVersion}
              {database.migration.applied.length > 0 ? ` (migrated from v${database.migration.fromVersion} this launch)` : ''}
            </Text>
            <Text style={ui.muted}>
              Database folder: {database.location.hidden ? 'private (Library)' : 'Documents/SQLite'}
              {database.location.movedThisLaunch ? ' · moved this launch' : ''}
              {database.location.note ? ` · ${database.location.note}` : ''}
            </Text>
            <Text style={ui.muted}>
              First launch {database.firstLaunchAt} · launch {database.launchCount} · key{' '}
              {database.keyCreatedNow ? 'created' : 'from Keychain'}
            </Text>
          </>
        ) : null}
        {daily ? (
          <Text style={ui.muted}>
            Today {daily.today} ({daily.timeZone}) · notifications {daily.notifications ? `${daily.notifications.scheduled} scheduled` : 'off'} ·
            backup {typeof daily.backup === 'string' ? daily.backup.replace('_', ' ') : daily.backup.fileName}
          </Text>
        ) : null}
      </View>
      {results.map((result) => (
        <View key={result.id} style={{ gap: 2, paddingHorizontal: 4 }}>
          <Text style={ui.text}>
            <Text style={{ color: STATUS_COLOR[result.status], fontWeight: '700' }}>
              {result.id} {result.status.toUpperCase()}
            </Text>
            {'  '}
            {result.title}
          </Text>
          <Text selectable style={ui.muted}>
            {result.detail} · {result.durationMs} ms
          </Text>
        </View>
      ))}
      <Pressable style={ui.button} onPress={runDiagnosticsAgain} disabled={diagnosticsRunning || !database}>
        <Text style={[ui.buttonText, diagnosticsRunning ? { color: COLORS.muted } : null]}>Run diagnostics again</Text>
      </Pressable>
    </ScrollView>
  );
}
