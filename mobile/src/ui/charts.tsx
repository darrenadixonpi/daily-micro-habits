import { Text, View } from 'react-native';
import { COLORS, ui } from './ui_styles';

/**
 * A 30-day trend as thin vertical bars (spec Section 10: current value + 30-day trend).
 * Days without data show as a faint stub, so gaps are visible rather than hidden.
 */
export function TrendBars({
  values,
  max,
  height = 36,
  testID,
  caption,
}: {
  readonly values: readonly (number | null)[];
  readonly max?: number;
  readonly height?: number;
  readonly testID?: string;
  readonly caption?: string;
}) {
  const top = max ?? Math.max(1e-9, ...values.filter((v): v is number => v !== null));
  return (
    <View testID={testID} style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: 2 }}>
        {values.map((value, index) => (
          <View
            key={index}
            style={{
              flex: 1,
              height: value === null ? 2 : Math.max(2, (Math.min(value, top) / top) * height),
              backgroundColor: value === null ? COLORS.border : COLORS.accent,
              opacity: value === null ? 0.6 : 1,
              borderRadius: 1,
            }}
          />
        ))}
      </View>
      {caption ? <Text style={ui.muted}>{caption}</Text> : null}
    </View>
  );
}
