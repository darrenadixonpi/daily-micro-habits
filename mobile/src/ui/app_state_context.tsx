import * as Application from 'expo-application';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState as NativeAppState } from 'react-native';
import { runDailyCycle, type DailyCycleReport } from '../daily/daily_cycle';
import { createAppDiagnosticEnvironment } from '../diagnostics/app_diagnostic_environment';
import type { DiagnosticResult } from '../diagnostics/diagnostic_environment';
import { runDiagnostics, type DiagnosticRun } from '../diagnostics/run_diagnostics';
import { openAppDatabase, type AppDatabase } from '../maintenance/open_app_database';
import { createAppBackupFileStore } from '../platform/app_backup_file_store';
import { appCryptoPrimitives } from '../platform/app_crypto_primitives';
import { configureForegroundNotifications, expoNotifier, readNotificationPermission, requestNotificationPermission } from '../platform/expo_notifier';
import { readBackupKey } from '../security/recovery_passphrase';
import type { DerivedKeyMaterial } from '../security/passphrase_encryption';
import { readInternalValue } from '../settings/settings_repository';

interface AppState {
  readonly database: AppDatabase | null;
  readonly openError: string | null;
  readonly daily: DailyCycleReport | null;
  readonly dailyError: string | null;
  readonly notificationsAllowed: boolean | null;
  readonly passphraseSet: boolean;
  /** Re-runs the daily cycle (status, streaks, backup, notifications). Calls are serialized. */
  refreshDaily(): Promise<void>;
  /** Re-reads the backup key after the passphrase is set. */
  reloadSecurity(): Promise<void>;
  /**
   * Asks for notification permission if iOS has not asked yet, then rebuilds the schedule.
   * Called by Today once first-launch setup is out of the way, so prompts never stack.
   */
  ensureNotificationPermission(): Promise<void>;
  readonly diagnostics: DiagnosticRun | null;
  readonly diagnosticsProgress: readonly DiagnosticResult[];
  readonly diagnosticsRunning: boolean;
  runDiagnosticsAgain(): void;
}

const AppStateContext = createContext<AppState | null>(null);

/** Opens the database, runs the daily cycle, then runs diagnostics; repeats the cycle on every return to the foreground. */
export function AppStateProvider({ children }: { readonly children: ReactNode }) {
  const [database, setDatabase] = useState<AppDatabase | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [daily, setDaily] = useState<DailyCycleReport | null>(null);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [notificationsAllowed, setNotificationsAllowed] = useState<boolean | null>(null);
  const [backupKey, setBackupKey] = useState<DerivedKeyMaterial | null>(null);
  const [passphraseSet, setPassphraseSet] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticRun | null>(null);
  const [progress, setProgress] = useState<DiagnosticResult[]>([]);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const cycleChain = useRef<Promise<void>>(Promise.resolve());
  const databaseRef = useRef<AppDatabase | null>(null);
  const backupKeyRef = useRef<DerivedKeyMaterial | null>(null);
  const allowedRef = useRef(false);

  const refreshDaily = useCallback((): Promise<void> => {
    const next = cycleChain.current.then(async () => {
      const opened = databaseRef.current;
      if (!opened) return;
      try {
        const report = await runDailyCycle({
          executor: opened.executor,
          crypto: appCryptoPrimitives,
          now: new Date(),
          appVersion: `${Application.nativeApplicationVersion ?? '?'} (${Application.nativeBuildVersion ?? '?'})`,
          notifier: allowedRef.current ? expoNotifier : null,
          backupStore: createAppBackupFileStore(),
          backupKey: backupKeyRef.current,
        });
        setDaily(report);
        setDailyError(null);
      } catch (error) {
        setDailyError(error instanceof Error ? error.message : String(error));
      }
    });
    cycleChain.current = next;
    return next;
  }, []);

  const reloadSecurity = useCallback(async () => {
    const key = await readBackupKey();
    backupKeyRef.current = key;
    setBackupKey(key);
    const opened = databaseRef.current;
    setPassphraseSet(Boolean(key && opened && readInternalValue(opened.executor, 'passphrase_set_at')));
  }, []);

  const ensureNotificationPermission = useCallback(async () => {
    if (allowedRef.current) return;
    const allowed = await requestNotificationPermission();
    allowedRef.current = allowed;
    setNotificationsAllowed(allowed);
    if (allowed) await refreshDaily();
  }, [refreshDaily]);

  const startDiagnostics = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setProgress([]);
    setTimeout(() => {
      runDiagnostics(createAppDiagnosticEnvironment(databaseRef.current?.executor ?? null), (result) =>
        setProgress((previous) => [...previous, result]),
      )
        .then(setDiagnostics)
        .finally(() => {
          runningRef.current = false;
          setRunning(false);
        });
    }, 50);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const opened = await openAppDatabase();
        if (cancelled) return;
        databaseRef.current = opened;
        setDatabase(opened);
        configureForegroundNotifications();
        const permission = await readNotificationPermission();
        allowedRef.current = permission.granted;
        // null = not asked yet; Today asks after first-launch setup.
        setNotificationsAllowed(permission.granted ? true : permission.canAsk ? null : false);
        await reloadSecurity();
        await refreshDaily();
        startDiagnostics();
      } catch (error) {
        setOpenError(error instanceof Error ? error.message : String(error));
      }
    })();
    const subscription = NativeAppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshDaily();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [refreshDaily, reloadSecurity, startDiagnostics]);

  return (
    <AppStateContext.Provider
      value={{
        database,
        openError,
        daily,
        dailyError,
        notificationsAllowed,
        passphraseSet: passphraseSet && backupKey !== null,
        refreshDaily,
        reloadSecurity,
        ensureNotificationPermission,
        diagnostics,
        diagnosticsProgress: progress,
        diagnosticsRunning: running,
        runDiagnosticsAgain: startDiagnostics,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (!state) throw new Error('useAppState must be used inside AppStateProvider');
  return state;
}
