import { ScrollView, Text, View } from 'react-native';
import { ui } from './ui_styles';

/** Placeholder for screens whose features arrive in a later milestone. */
export function MilestonePlaceholder({ title, milestone, summary }: { readonly title: string; readonly milestone: string; readonly summary: string }) {
  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.body}>
      <View style={ui.card}>
        <Text style={ui.h2}>{title}</Text>
        <Text style={ui.text}>{summary}</Text>
        <Text style={ui.muted}>Arrives in {milestone}.</Text>
      </View>
    </ScrollView>
  );
}
