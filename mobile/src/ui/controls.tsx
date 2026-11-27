import { router, type Href } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, Switch, Text, TextInput, View, type TextInputProps } from 'react-native';
import { LabelValueRow } from './screen_layout';
import { COLORS, ui } from './ui_styles';

/**
 * Interactive building blocks. Screens use these instead of Pressable, Link or TextInput
 * directly (docs/ui_conventions.md, R2/R4/R6), so layout and touch behaviour are defined once.
 */

function navigate(href: Href) {
  router.push(href);
}

/** "Label …… value ›" row that opens another screen. */
export function NavigationRow({
  label,
  value,
  valueColor,
  href,
  testID,
}: {
  readonly label: string;
  readonly value?: string;
  readonly valueColor?: string;
  readonly href: Href;
  readonly testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={() => navigate(href)}
      style={({ pressed }) => ({ paddingVertical: 8, opacity: pressed ? 0.5 : 1 })}
    >
      <LabelValueRow label={label} value={`${value ?? ''} ›`.trim()} valueColor={valueColor ?? COLORS.accent} />
    </Pressable>
  );
}

/** A whole card that opens another screen. */
export function PressableCard({ href, children, testID }: { readonly href: Href; readonly children: ReactNode; readonly testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={() => navigate(href)}
      style={({ pressed }) => [ui.card, { opacity: pressed ? 0.6 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

/** Text button; `href` navigates, `onPress` runs an action. */
export function ActionButton({
  label,
  onPress,
  href,
  disabled,
  tone = 'accent',
  align = 'center',
  testID,
}: {
  readonly label: string;
  readonly onPress?: () => void;
  readonly href?: Href;
  readonly disabled?: boolean;
  readonly tone?: 'accent' | 'muted';
  readonly align?: 'center' | 'right';
  readonly testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => (href ? navigate(href) : onPress?.())}
      hitSlop={8}
      style={({ pressed }) => [
        ui.button,
        align === 'right' ? { alignItems: 'flex-end', paddingVertical: 4 } : null,
        { opacity: disabled ? 0.4 : pressed ? 0.5 : 1 },
      ]}
    >
      <Text style={[ui.buttonText, tone === 'muted' ? { color: COLORS.muted } : null]}>{label}</Text>
    </Pressable>
  );
}

/** Wrapping row of selectable chips. */
export function ChipGroup({
  options,
  isSelected,
  onPress,
  testIDPrefix,
}: {
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly isSelected: (value: string) => boolean;
  readonly onPress: (value: string) => void;
  readonly testIDPrefix?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map((option) => {
        const selected = isSelected(option.value);
        return (
          <Pressable
            key={option.value}
            testID={testIDPrefix ? `${testIDPrefix}-${option.value}` : undefined}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[ui.chip, selected ? ui.chipSelected : null]}
            onPress={() => onPress(option.value)}
          >
            <Text style={[ui.chipText, selected ? ui.chipTextSelected : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Labeled text field with an optional error line. The only place TextInput is used. */
export function FormField({
  label,
  error,
  testID,
  trailingAction,
  minHeight,
  ...inputProps
}: Omit<TextInputProps, 'style'> & {
  readonly label?: string;
  readonly error?: string | null;
  readonly testID?: string;
  readonly trailingAction?: { readonly label: string; readonly onPress: () => void; readonly testID?: string };
  readonly minHeight?: number;
}) {
  return (
    <View style={{ gap: 4 }}>
      {label ? <Text style={ui.muted}>{label}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          testID={testID}
          accessibilityLabel={label ?? inputProps.placeholder}
          placeholderTextColor={COLORS.muted}
          autoCorrect={inputProps.autoCorrect ?? !inputProps.secureTextEntry}
          {...inputProps}
          style={[
            ui.input,
            { flex: 1, flexShrink: 1 },
            minHeight ? { minHeight, textAlignVertical: 'top' } : null,
          ]}
        />
        {trailingAction ? (
          <Pressable testID={trailingAction.testID} accessibilityRole="button" style={ui.chip} onPress={trailingAction.onPress}>
            <Text style={ui.chipText}>{trailingAction.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={[ui.muted, { color: COLORS.fail }]}>{error}</Text> : null}
    </View>
  );
}

/** "− value +" control with the allowed range. */
export function Stepper({
  value,
  decimals,
  rangeLabel,
  onStep,
  testID,
}: {
  readonly value: number;
  readonly decimals: number;
  readonly rangeLabel: string;
  readonly onStep: (direction: 1 | -1) => void;
  readonly testID?: string;
}) {
  const button = (label: string, direction: 1 | -1) => (
    <Pressable
      testID={testID ? `${testID}-${direction === 1 ? 'increase' : 'decrease'}` : undefined}
      accessibilityRole="button"
      accessibilityLabel={direction === 1 ? 'Increase' : 'Decrease'}
      style={[ui.chip, { minWidth: 44, alignItems: 'center' }]}
      onPress={() => onStep(direction)}
    >
      <Text style={[ui.text, { fontSize: 18 }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {button('−', -1)}
      <Text testID={testID ? `${testID}-value` : undefined} style={[ui.text, { minWidth: 56, textAlign: 'center' }]}>
        {value.toFixed(decimals)}
      </Text>
      {button('+', 1)}
      <Text style={ui.muted}>{rangeLabel}</Text>
    </View>
  );
}

/** Label with a switch on the right. */
export function SwitchRow({ label, value, onChange, testID }: { readonly label: string; readonly value: boolean; readonly onChange: (next: boolean) => void; readonly testID?: string }) {
  return <LabelValueRow label={label} value={<Switch testID={testID} value={value} onValueChange={onChange} />} />;
}

export type ChoiceMark = 'correct' | 'incorrect' | null;

/**
 * Full-width list of answer options (A3 questions). Before an answer, every option can be
 * pressed; afterwards `markFor` colours the correct option and a wrong pick, and presses stop.
 */
export function ChoiceList({
  options,
  selected,
  onSelect,
  markFor,
  disabled,
  testIDPrefix,
}: {
  readonly options: readonly { readonly id: string; readonly text: string }[];
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
  readonly markFor?: (id: string) => ChoiceMark;
  readonly disabled?: boolean;
  readonly testIDPrefix?: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      {options.map((option) => {
        const mark = markFor?.(option.id) ?? null;
        const isSelected = selected === option.id;
        const borderColor = mark === 'correct' ? COLORS.pass : mark === 'incorrect' ? COLORS.fail : isSelected ? COLORS.accent : COLORS.border;
        return (
          <Pressable
            key={option.id}
            testID={testIDPrefix ? `${testIDPrefix}-${option.id}` : undefined}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected, disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={() => onSelect(option.id)}
            style={({ pressed }) => ({
              borderWidth: mark || isSelected ? 2 : 1,
              borderColor,
              borderRadius: 8,
              paddingVertical: 10,
              paddingHorizontal: 12,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={ui.text}>
              <Text style={{ fontWeight: '600' }}>{option.id.toUpperCase()}. </Text>
              {option.text}
              {mark === 'correct' ? '  ✓' : mark === 'incorrect' ? '  ✗' : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A row of equal-width buttons (A2 grades). `highlight` marks a suggested button. */
export function ButtonRow({
  buttons,
  testIDPrefix,
}: {
  readonly buttons: readonly { readonly value: string; readonly label: string; readonly color?: string; readonly highlight?: boolean; readonly onPress: () => void }[];
  readonly testIDPrefix?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {buttons.map((button) => (
        <Pressable
          key={button.value}
          testID={testIDPrefix ? `${testIDPrefix}-${button.value}` : undefined}
          accessibilityRole="button"
          onPress={button.onPress}
          style={({ pressed }) => ({
            flex: 1,
            flexBasis: 0,
            alignItems: 'center',
            paddingVertical: 10,
            borderRadius: 8,
            borderWidth: button.highlight ? 2 : 1,
            borderColor: button.highlight ? (button.color ?? COLORS.accent) : COLORS.border,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text numberOfLines={1} style={[ui.text, { color: button.color ?? COLORS.accent, fontWeight: '600' }]}>
            {button.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * An action that needs a second tap to confirm (Report error, Restore). The first tap shows
 * the consequence and a confirm button; the prompt closes again after 8 seconds.
 */
export function ConfirmActionButton({
  label,
  confirmLabel,
  consequence,
  onConfirm,
  disabled,
  tone = 'accent',
  testID,
}: {
  readonly label: string;
  readonly confirmLabel: string;
  readonly consequence: string;
  readonly onConfirm: () => void;
  readonly disabled?: boolean;
  readonly tone?: 'accent' | 'muted';
  readonly testID?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 8000);
    return () => clearTimeout(timer);
  }, [armed]);
  if (!armed) return <ActionButton testID={testID} label={label} tone={tone} disabled={disabled} onPress={() => setArmed(true)} />;
  return (
    <View style={{ gap: 4, alignItems: 'center' }}>
      <Text style={[ui.muted, { textAlign: 'center' }]}>{consequence}</Text>
      <ActionButton
        testID={testID ? `${testID}-confirm` : undefined}
        label={confirmLabel}
        onPress={() => {
          setArmed(false);
          onConfirm();
        }}
      />
      <ActionButton testID={testID ? `${testID}-cancel` : undefined} label="Cancel" tone="muted" onPress={() => setArmed(false)} />
    </View>
  );
}

/** A source link: the title, opened in Safari. */
export function LinkText({ title, url, testID }: { readonly title: string; readonly url: string; readonly testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="link" onPress={() => void Linking.openURL(url)} hitSlop={6}>
      {({ pressed }) => <Text style={[ui.muted, { color: COLORS.accent, opacity: pressed ? 0.5 : 1 }]}>{title} ↗</Text>}
    </Pressable>
  );
}
