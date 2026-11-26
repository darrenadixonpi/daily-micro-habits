import { Platform, StyleSheet } from 'react-native';

export const COLORS = {
  text: '#1a1a1a',
  muted: '#5f6368',
  border: '#c8c8cc',
  accent: '#0a64d8',
  pass: '#1e7e34',
  fail: '#c62828',
  skip: '#8a6d00',
  background: '#f6f6f8',
  card: '#ffffff',
} as const;

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  body: { padding: 16, gap: 12, paddingBottom: 48 },
  h1: { fontSize: 22, fontWeight: '700', color: COLORS.text },
  h2: { fontSize: 16, fontWeight: '600', color: COLORS.text, marginBottom: 4 },
  text: { fontSize: 15, color: COLORS.text },
  muted: { fontSize: 13, color: COLORS.muted },
  card: {
    backgroundColor: COLORS.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12, color: COLORS.text },
  button: { paddingVertical: 10, alignItems: 'center' },
  buttonText: { fontSize: 16, color: COLORS.accent, fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipSelected: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { fontSize: 13, color: COLORS.text },
  chipTextSelected: { color: '#ffffff' },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    minWidth: 90,
    color: COLORS.text,
  },
});

export const STATUS_COLOR = { passed: COLORS.pass, failed: COLORS.fail, skipped: COLORS.skip } as const;
