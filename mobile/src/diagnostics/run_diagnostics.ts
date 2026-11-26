import { DIAGNOSTIC_CASES } from './diagnostic_cases';
import type { DiagnosticEnvironment, DiagnosticResult } from './diagnostic_environment';

export interface DiagnosticRun {
  readonly startedAt: string;
  readonly engineLabel: string;
  readonly results: readonly DiagnosticResult[];
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

/** Runs every case in order; a thrown error marks that case failed and the run continues. */
export async function runDiagnostics(
  environment: DiagnosticEnvironment,
  onProgress?: (result: DiagnosticResult) => void,
): Promise<DiagnosticRun> {
  const startedAt = new Date().toISOString();
  const results: DiagnosticResult[] = [];
  for (const diagnostic of DIAGNOSTIC_CASES) {
    const started = Date.now();
    let result: DiagnosticResult;
    try {
      const outcome = await diagnostic.run(environment);
      result = typeof outcome === 'string'
        ? { id: diagnostic.id, title: diagnostic.title, status: 'passed', detail: outcome, durationMs: Date.now() - started }
        : { id: diagnostic.id, title: diagnostic.title, status: 'skipped', detail: outcome.skipped, durationMs: Date.now() - started };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      result = { id: diagnostic.id, title: diagnostic.title, status: 'failed', detail: message, durationMs: Date.now() - started };
    }
    results.push(result);
    onProgress?.(result);
  }
  return {
    startedAt,
    engineLabel: environment.engineLabel,
    results,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
  };
}
