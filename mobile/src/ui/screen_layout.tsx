import type { ReactNode } from 'react';
import { ActivityIndicator, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { COLORS, ui } from './ui_styles';

/**
 * The only scroll container screens may use (docs/ui_conventions.md, R1).
 *
 * - contentInsetAdjustmentBehavior="automatic": on iOS 26 the navigation bar is
 *   translucent and screens extend beneath it; this insets content below the bar and
 *   above the tab bar (fix for U1).
 * - automaticallyAdjustKeyboardInsets: keeps the focused field above the keyboard.
 */
export function ScreenScrollView({
  children,
  testID,
  contentStyle,
}: {
  readonly children: ReactNode;
  readonly testID?: string;
  readonly contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      testID={testID}
      style={ui.screen}
      contentContainerStyle={[ui.body, contentStyle]}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {children}
    </ScrollView>
  );
}

/** Full-screen loading or error state. */
export function ScreenMessage({ loading, message, tone = 'muted' }: { readonly loading?: boolean; readonly message?: string; readonly tone?: 'muted' | 'error' }) {
  return (
    <ScreenScrollView contentStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}>
      {loading ? <ActivityIndicator /> : null}
      {message ? (
        <Text style={[ui.muted, { textAlign: 'center' }, tone === 'error' ? { color: COLORS.fail } : null]}>{message}</Text>
      ) : null}
    </ScreenScrollView>
  );
}

/** A titled card section. */
export function Card({ title, aside, children, testID, tone }: { readonly title?: string; readonly aside?: ReactNode; readonly children?: ReactNode; readonly testID?: string; readonly tone?: 'warning' }) {
  return (
    <View testID={testID} style={[ui.card, tone === 'warning' ? { borderColor: COLORS.skip } : null]}>
      {title ? <LabelValueRow label={title} labelStyle="heading" value={aside} /> : null}
      {children}
    </View>
  );
}

/**
 * A label on the left and a value (text or element) on the right. The label shrinks and
 * wraps; the value keeps its natural width up to half the row (fix for R5/U2).
 */
export function LabelValueRow({
  label,
  value,
  labelStyle = 'text',
  valueColor,
  testID,
}: {
  readonly label: ReactNode;
  readonly value?: ReactNode;
  readonly labelStyle?: 'text' | 'heading' | 'muted';
  readonly valueColor?: string;
  readonly testID?: string;
}) {
  const labelTextStyle = labelStyle === 'heading' ? ui.h2 : labelStyle === 'muted' ? ui.muted : ui.text;
  return (
    <View testID={testID} style={[ui.row, { alignItems: 'flex-start' }]}>
      <View style={{ flexShrink: 1, flexGrow: 1 }}>
        {typeof label === 'string' ? <Text style={labelTextStyle}>{label}</Text> : label}
      </View>
      {value === undefined || value === null ? null : (
        <View style={{ flexShrink: 0, maxWidth: '50%', alignItems: 'flex-end' }}>
          {typeof value === 'string' || typeof value === 'number' ? (
            <Text style={[ui.muted, valueColor ? { color: valueColor, fontWeight: '600' } : null, { textAlign: 'right' }]}>{value}</Text>
          ) : (
            value
          )}
        </View>
      )}
    </View>
  );
}

export interface TableCell {
  readonly text: string;
  readonly color?: string;
  /** Fixed width; omit for the flexible first column. */
  readonly width?: number;
}

/** One row of a small fixed-column table; the first flexible cell shrinks. */
export function TableRow({ cells, header, testID }: { readonly cells: readonly TableCell[]; readonly header?: boolean; readonly testID?: string }) {
  return (
    <View testID={testID} style={ui.row}>
      {cells.map((cell, index) => (
        <Text
          key={index}
          numberOfLines={1}
          style={[
            header ? ui.muted : index === 0 ? ui.text : ui.muted,
            cell.width ? { width: cell.width, flexShrink: 0 } : { flex: 1, flexShrink: 1 },
            cell.color ? { color: cell.color } : null,
          ]}
        >
          {cell.text}
        </Text>
      ))}
    </View>
  );
}
