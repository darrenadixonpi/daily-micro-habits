import type { PingState } from '../notifications/notification_ledger';
import { COLORS } from './ui_styles';

/** Ping log cell text and colour; 'untracked' marks days before tracking began. */
export const PING_LABEL: Record<PingState | 'untracked', string> = {
  fired: '✓ fired',
  suppressed: '– suppressed',
  scheduled: '… scheduled',
  none: '✗ none',
  untracked: '—',
};

export const PING_COLOR: Record<PingState | 'untracked', string> = {
  fired: COLORS.pass,
  suppressed: COLORS.muted,
  scheduled: COLORS.muted,
  none: COLORS.fail,
  untracked: COLORS.muted,
};
