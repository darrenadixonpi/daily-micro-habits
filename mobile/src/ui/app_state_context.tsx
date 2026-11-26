import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { appDiagnosticEnvironment } from '../diagnostics/app_diagnostic_environment';
import type { DiagnosticResult } from '../diagnostics/diagnostic_environment';
import { runDiagnostics, type DiagnosticRun } from '../diagnostics/run_diagnostics';
import { openAppDatabase, type AppDatabase } from '../maintenance/open_app_database';

interface AppState {
  readonly database: AppDatabase | null;
  readonly openError: string | null;
  readonly diagnostics: DiagnosticRun | null;
  readonly diagnosticsProgress: readonly DiagnosticResult[];
  readonly diagnosticsRunning: boolean;
  runDiagnosticsAgain(): void;
}

const AppStateContext = createContext<AppState | null>(null);

/** Opens the database once per launch, then runs the diagnostics automatically. */
export function AppStateProvider({ children }: { readonly children: ReactNode }) {
  const [database, setDatabase] = useState<AppDatabase | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticRun | null>(null);
  const [progress, setProgress] = useState<DiagnosticResult[]>([]);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const startDiagnostics = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setProgress([]);
    // Yield one frame so the "running" state renders before synchronous database work starts.
    setTimeout(() => {
      runDiagnostics(appDiagnosticEnvironment, (result) => setProgress((previous) => [...previous, result]))
        .then(setDiagnostics)
        .finally(() => {
          runningRef.current = false;
          setRunning(false);
        });
    }, 50);
  }, []);

  useEffect(() => {
    openAppDatabase()
      .then((opened) => {
        setDatabase(opened);
        startDiagnostics();
      })
      .catch((error: unknown) => setOpenError(error instanceof Error ? error.message : String(error)));
  }, [startDiagnostics]);

  return (
    <AppStateContext.Provider
      value={{
        database,
        openError,
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
