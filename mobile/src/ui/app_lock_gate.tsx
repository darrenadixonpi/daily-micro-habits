import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { readAllSettings } from '../settings/settings_repository';
import { useAppState } from './app_state_context';
import { COLORS, ui } from './ui_styles';

const RELOCK_AFTER_MS = 5 * 60 * 1000;

/**
 * Optional app lock (spec Section 9): when Settings → Privacy → App lock is on, the app
 * asks for Face ID (or the device passcode) at launch and after 5 minutes in the background.
 */
export function AppLockGate({ children }: { readonly children: ReactNode }) {
  const { database } = useAppState();
  const [locked, setLocked] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const backgroundedAt = useRef<number | null>(null);

  const lockMode = useCallback((): string => {
    if (!database) return 'off';
    return String(readAllSettings(database.executor).get('privacy.app_lock') ?? 'off');
  }, [database]);

  const unlock = useCallback(async () => {
    // Both lock modes use Face ID with the device passcode as fallback, so a failed
    // face scan can never lock the owner out; "Device PIN" differs only in its label.
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Micro-Habits',
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });
    if (result.success) {
      setLocked(false);
      setMessage(null);
    } else {
      setMessage(result.error === 'user_cancel' ? null : `Not unlocked (${result.error})`);
    }
  }, []);

  useEffect(() => {
    if (!database || locked !== null) return;
    const needsLock = lockMode() !== 'off';
    setLocked(needsLock);
    if (needsLock) void unlock();
  }, [database, locked, lockMode, unlock]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') backgroundedAt.current = Date.now();
      if (next === 'active' && backgroundedAt.current !== null) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (lockMode() !== 'off' && away >= RELOCK_AFTER_MS) {
          setLocked(true);
          void unlock();
        }
      }
    });
    return () => subscription.remove();
  }, [lockMode, unlock]);

  if (locked) {
    return (
      <View style={[ui.screen, { justifyContent: 'center', alignItems: 'center', gap: 12 }]}>
        <Text style={ui.h1}>Micro-Habits is locked</Text>
        {message ? <Text style={[ui.muted, { color: COLORS.fail }]}>{message}</Text> : null}
        <Pressable style={ui.button} onPress={() => void unlock()}>
          <Text style={ui.buttonText}>Unlock</Text>
        </Pressable>
      </View>
    );
  }
  return <>{children}</>;
}
