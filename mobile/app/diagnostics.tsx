import { ScrollView, Text, View } from 'react-native';
import { useAppState } from '../src/ui/app_state_context';
import { STATUS_COLOR, ui } from '../src/ui/ui_styles';

/** Full diagnostic output, including which engine ran it and timings. */
export default function DiagnosticsScreen() {
  const { diagnostics, diagnosticsRunning, diagnosticsProgress } = useAppState();
  const results = diagnosticsRunning ? diagnosticsProgress : (diagnostics?.results ?? []);
  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.body}>
      <View style={ui.card}>
        <Text style={ui.h2}>Run</Text>
        <Text style={ui.text}>{diagnosticsRunning ? 'Running…' : diagnostics ? `Started ${diagnostics.startedAt}` : 'Not run yet'}</Text>
        {diagnostics ? (
          <Text style={ui.muted}>
            {diagnostics.engineLabel} · {diagnostics.passed} passed, {diagnostics.failed} failed, {diagnostics.skipped} skipped
          </Text>
        ) : null}
      </View>
      {results.map((result) => (
        <View key={result.id} style={ui.card}>
          <Text style={[ui.h2, { color: STATUS_COLOR[result.status] }]}>
            {result.id} · {result.status.toUpperCase()} · {result.durationMs} ms
          </Text>
          <Text style={ui.text}>{result.title}</Text>
          <Text selectable style={ui.mono}>
            {result.detail}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}
