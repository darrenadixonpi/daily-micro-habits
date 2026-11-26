import * as Application from 'expo-application';
import { Link } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { DIAGNOSTIC_CASES } from '../src/diagnostics/diagnostic_cases';
import { useAppState } from '../src/ui/app_state_context';
import { COLORS, STATUS_COLOR, ui } from '../src/ui/ui_styles';

/** M1 home: install facts and the automatic diagnostics result (the M1 gate evidence). */
export default function HomeScreen() {
  const { database, openError, diagnostics, diagnosticsProgress, diagnosticsRunning, runDiagnosticsAgain } = useAppState();
  const results = diagnosticsRunning ? diagnosticsProgress : (diagnostics?.results ?? diagnosticsProgress);

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.body}>
      <Text style={ui.h1}>M1 foundation build</Text>

      <View style={ui.card}>
        <Text style={ui.h2}>Install</Text>
        <Text style={ui.text}>
          Version {Application.nativeApplicationVersion} (build {Application.nativeBuildVersion})
        </Text>
        <Text style={ui.muted}>{Application.applicationId}</Text>
        <Text style={ui.muted}>iOS {String(Platform.Version)}</Text>
      </View>

      <View style={ui.card}>
        <Text style={ui.h2}>Database</Text>
        {openError ? <Text style={[ui.text, { color: COLORS.fail }]}>Open failed: {openError}</Text> : null}
        {!database && !openError ? <ActivityIndicator /> : null}
        {database ? (
          <>
            <Text style={ui.text}>
              Encryption {database.cipherVersion ? `SQLCipher ${database.cipherVersion}` : 'NOT DETECTED'}
            </Text>
            <Text style={ui.text}>
              Schema version {database.migration.toVersion}
              {database.migration.applied.length > 0 ? ` (migrated from ${database.migration.fromVersion} this launch)` : ''}
            </Text>
            <Text style={ui.text}>First launch {database.firstLaunchAt}</Text>
            <Text style={ui.text}>Launch count {database.launchCount}</Text>
            <Text style={ui.muted}>
              {database.keyCreatedNow ? 'New database key created' : 'Database key loaded from Keychain'}
              {database.m0TestDataRemoved.length > 0 ? ` · removed M0 test data: ${database.m0TestDataRemoved.join(', ')}` : ''}
            </Text>
          </>
        ) : null}
      </View>

      <View style={ui.card}>
        <View style={ui.row}>
          <Text style={ui.h2}>Diagnostics</Text>
          {diagnosticsRunning ? (
            <Text style={ui.muted}>
              running {results.length}/{DIAGNOSTIC_CASES.length}…
            </Text>
          ) : diagnostics ? (
            <Text style={[ui.text, { fontWeight: '700', color: diagnostics.failed === 0 ? COLORS.pass : COLORS.fail }]}>
              {diagnostics.passed}/{diagnostics.results.length} passed
            </Text>
          ) : null}
        </View>
        {results.map((result) => (
          <View key={result.id} style={{ gap: 2 }}>
            <Text style={ui.text}>
              <Text style={{ color: STATUS_COLOR[result.status], fontWeight: '700' }}>
                {result.id} {result.status.toUpperCase()}
              </Text>
              {'  '}
              {result.title}
            </Text>
            <Text style={ui.muted}>
              {result.detail} · {result.durationMs} ms
            </Text>
          </View>
        ))}
        <Pressable style={ui.button} onPress={runDiagnosticsAgain} disabled={diagnosticsRunning || !database}>
          <Text style={[ui.buttonText, diagnosticsRunning ? { color: COLORS.muted } : null]}>Run diagnostics again</Text>
        </Pressable>
      </View>

      <View style={ui.card}>
        <Text style={ui.h2}>Screens</Text>
        <NavLink href="/settings" label="Settings" />
        <NavLink href="/diagnostics" label="Diagnostics detail" />
        <NavLink href="/review" label="Review (arrives in M3)" />
        <NavLink href="/journal" label="Journal (arrives in M2)" />
        <NavLink href="/stats" label="Stats (arrives after M4)" />
      </View>
    </ScrollView>
  );
}

function NavLink({ href, label }: { readonly href: '/settings' | '/diagnostics' | '/review' | '/journal' | '/stats'; readonly label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable style={ui.button}>
        <Text style={ui.buttonText}>{label}</Text>
      </Pressable>
    </Link>
  );
}
