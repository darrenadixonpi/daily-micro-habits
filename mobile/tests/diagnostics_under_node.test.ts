import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { runDiagnostics } from '../src/diagnostics/run_diagnostics';
import { createNodeDiagnosticEnvironment } from './support/node_diagnostic_environment';

/**
 * Runs the same diagnostic cases the phone runs (T1–T7). T3 (SQLCipher) is skipped
 * under Node, which has no SQLCipher; every other case must pass.
 */
const environment = createNodeDiagnosticEnvironment();
after(() => environment.dispose());

test('diagnostics T1–T7 pass under Node', async () => {
  const run = await runDiagnostics(environment);
  for (const result of run.results) {
    console.log(`${result.id} ${result.status.padEnd(7)} ${result.durationMs} ms  ${result.title}: ${result.detail}`);
  }
  const failures = run.results.filter((r) => r.status === 'failed');
  assert.deepEqual(failures, [], 'no diagnostic may fail');
  assert.deepEqual(
    run.results.filter((r) => r.status === 'skipped').map((r) => r.id),
    ['T3'],
    'only T3 may be skipped under Node',
  );
});
