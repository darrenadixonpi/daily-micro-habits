import { Text } from 'react-native';
import { Card, ScreenScrollView } from './screen_layout';
import { ui } from './ui_styles';

/** Placeholder for screens whose features arrive in a later milestone. */
export function MilestonePlaceholder({ title, milestone, summary, testID }: { readonly title: string; readonly milestone: string; readonly summary: string; readonly testID?: string }) {
  return (
    <ScreenScrollView testID={testID}>
      <Card title={title}>
        <Text style={ui.text}>{summary}</Text>
        <Text style={ui.muted}>Arrives in {milestone}.</Text>
      </Card>
    </ScreenScrollView>
  );
}
