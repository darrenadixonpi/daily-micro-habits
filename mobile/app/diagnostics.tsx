import * as Application from 'expo-application';
import { Platform, Text } from 'react-native';
import { DIAGNOSTIC_CASES } from '../src/diagnostics/diagnostic_cases';
import { useAppState } from '../src/ui/app_state_context';
import { ActionButton } from '../src/ui/controls';
import { Card, ScreenScrollView } from '../src/ui/screen_layout';
import { COLORS, STATUS_COLOR, ui } from '../src/ui/ui_styles';

/** Install facts, database facts and the diagnostic results (gate evidence). */
export default function DiagnosticsScreen() {
  const { database, daily, diagnostics, diagnosticsRunning, diagnosticsProgress, runDiagnosticsAgain } = useAppState();
  const results = diagnosticsRunning ? diagnosticsProgress : (diagnostics?.results ?? []);
  const summary = diagnosticsRunning
    ? `running ${results.length}/${DIAGNOSTIC_CASES.length}…`
    : diagnostics
      ? `${diagnostics.passed}/${diagnostics.results.length} passed`
      : undefined;
  return (
    <ScreenScrollView testID="screen-diagnostics">
      <Card
        title="Diagnostics"
        aside={
          summary ? (
            <Text
              testID="diagnostics-summary"
              style={[ui.text, { fontWeight: '700', color: diagnostics && !diagnosticsRunning ? (diagnostics.failed === 0 ? COLORS.pass : COLORS.fail) : COLORS.muted }]}
            >
              {summary}
            </Text>
          ) : undefined
        }
      >
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
            {database.safetyBackup ? <Text testID="diagnostics-safety-backup" style={ui.muted}>Safety backup before migration: {database.safetyBackup}</Text> : null}
            <Text testID="diagnostics-content-import" style={ui.muted}>
              Content {database.contentImport.skipped ? 'up to date' : `imported: ${database.contentImport.inserted} new, ${database.contentImport.updated} updated`} · bundle{' '}
              {database.contentImport.fingerprint} · A1 {database.contentImport.byModule.A1}, A3 {database.contentImport.byModule.A3}, A4{' '}
              {database.contentImport.byModule.A4}, A5 {database.contentImport.byModule.A5}
            </Text>
            <Text style={ui.muted}>
              First launch {database.firstLaunchAt} · launch {database.launchCount} · key {database.keyCreatedNow ? 'created' : 'from Keychain'}
            </Text>
          </>
        ) : null}
        {daily ? (
          <Text style={ui.muted}>
            Today {daily.today} ({daily.timeZone}) · notifications {daily.notifications ? `${daily.notifications.scheduled} scheduled` : 'off'} · backup{' '}
            {typeof daily.backup === 'string' ? daily.backup.replace('_', ' ') : daily.backup.fileName}
          </Text>
        ) : null}
      </Card>
      {results.map((result) => (
        <Card key={result.id} testID={`diagnostic-${result.id}`}>
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
        </Card>
      ))}
      <ActionButton testID="diagnostics-run-again" label="Run diagnostics again" onPress={runDiagnosticsAgain} disabled={diagnosticsRunning || !database} />
    </ScreenScrollView>
  );
}
