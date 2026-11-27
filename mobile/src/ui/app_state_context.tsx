import * as Application from 'expo-application';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState as NativeAppState, Platform, Settings as UserDefaults } from 'react-native';
import { runDailyCycle, type DailyCycleReport } from '../daily/daily_cycle';
import { createAppDiagnosticEnvironment } from '../diagnostics/app_diagnostic_environment';
import type { DiagnosticResult } from '../diagnostics/diagnostic_environment';
import { runDiagnostics, type DiagnosticRun } from '../diagnostics/run_diagnostics';
import type { FetchLike } from '../generation/anthropic_client';
import { runBackgroundContentWork, type BackgroundContentReport } from '../generation/background_content';
import { openAppDatabase, type AppDatabase } from '../maintenance/open_app_database';
import { createAppBackupFileStore } from '../platform/app_backup_file_store';
import { appCryptoPrimitives } from '../platform/app_crypto_primitives';
import { configureForegroundNotifications, expoNotifier, readNotificationPermission, requestNotificationPermission } from '../platform/expo_notifier';
import type { SqlExecutor } from '../platform/sql_executor';
import { readBackupKey } from '../security/recovery_passphrase';
import type { DerivedKeyMaterial } from '../security/passphrase_encryption';
import { readAllSettings, readInternalValue } from '../settings/settings_repository';
import { readAnthropicApiKey } from '../settings/settings_secrets';
import { createAppScheduler, type AppScheduler } from '../srs/fsrs_scheduler';

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
  /** FSRS scheduler for the current Target retention setting (created once per value). */
  getScheduler(): Promise<AppScheduler>;
  /** Result of the last background content run (A5 fetch, generation refill). */
  readonly background: BackgroundContentReport | null;
  /** Runs the background content work now (Settings → Generation, "Check now"). */
  runBackgroundNow(): Promise<void>;
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
  const schedulers = useRef(new Map<number, Promise<AppScheduler>>());
  const [background, setBackground] = useState<BackgroundContentReport | null>(null);
  const backgroundRunning = useRef(false);
  const backgroundLastRun = useRef(0);

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

  const getScheduler = useCallback((): Promise<AppScheduler> => {
    const opened = databaseRef.current;
    const retention = opened ? Number(readAllSettings(opened.executor).get('a2.target_retention') ?? 0.9) : 0.9;
    let scheduler = schedulers.current.get(retention);
    if (!scheduler) {
      scheduler = createAppScheduler(retention);
      schedulers.current.set(retention, scheduler);
    }
    return scheduler;
  }, []);

  /** Background content work, at most every 15 minutes unless forced; never blocks the daily cycle. */
  const runBackground = useCallback(
    async (force: boolean) => {
      const opened = databaseRef.current;
      if (!opened || backgroundRunning.current) return;
      if (!force && Date.now() - backgroundLastRun.current < 15 * 60_000) return;
      backgroundRunning.current = true;
      backgroundLastRun.current = Date.now();
      try {
        await cycleChain.current;
        const settings = readAllSettings(opened.executor);
        const today = readInternalValue(opened.executor, 'last_cycle_today');
        const report = await runBackgroundContentWork({
          executor: opened.executor,
          fetchImpl: fetch as unknown as FetchLike,
          apiKey: await readAnthropicApiKey(),
          settings,
          today: typeof today === 'string' ? today : new Date().toISOString().slice(0, 10),
          now: new Date(),
        });
        setBackground(report);
        if (report.todayChanged) await refreshDaily();
      } catch {
        // Background work is best effort; bundled content keeps every task usable.
      } finally {
        backgroundRunning.current = false;
      }
    },
    [refreshDaily],
  );

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
        applyUiTourHooks(opened.executor);
        setDatabase(opened);
        configureForegroundNotifications();
        const permission = await readNotificationPermission();
        allowedRef.current = permission.granted;
        // null = not asked yet; Today asks after first-launch setup.
        setNotificationsAllowed(permission.granted ? true : permission.canAsk ? null : false);
        await reloadSecurity();
        await refreshDaily();
        startDiagnostics();
        void runBackground(false);
      } catch (error) {
        setOpenError(error instanceof Error ? error.message : String(error));
      }
    })();
    const subscription = NativeAppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshDaily().then(() => runBackground(false));
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [refreshDaily, reloadSecurity, startDiagnostics, runBackground]);

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
        getScheduler,
        background,
        runBackgroundNow: () => runBackground(true),
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

/**
 * Simulator screenshot tour only (tools/run_ui_screenshots.sh): when the app is launched with
 * the argument -dmhUiTourMakeCardsDue 1, every review card becomes due now, so the tour can
 * photograph the Review screen on the day the cards were created. A sideloaded app is never
 * launched with arguments, so this does nothing on the phone.
 */
function applyUiTourHooks(executor: SqlExecutor): void {
  if (Platform.OS !== 'ios') return;
  let flag: unknown;
  try {
    flag = UserDefaults.get('dmhUiTourMakeCardsDue');
  } catch {
    return;
  }
  if (String(flag) !== '1') return;
  const now = new Date(Date.now() - 60_000).toISOString();
  executor.run("UPDATE srs_card SET due = ?, scheduler_card_json = json_set(scheduler_card_json, '$.dueAt', ?)", [now, now]);
}

export function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (!state) throw new Error('useAppState must be used inside AppStateProvider');
  return state;
}
