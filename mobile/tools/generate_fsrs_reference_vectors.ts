/**
 * Generates src/srs/fsrs_reference_vectors.json by running the deterministic FSRS
 * reference cases under Node. With --check, exits non-zero if the committed file is stale.
 *
 *   npm run generate:fsrs-vectors
 *   npm run check:fsrs-vectors
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeAllReferenceCases, type ReferenceVectorFile } from '../src/srs/fsrs_reference_cases';
import { createAppScheduler, FSRS_MODEL_VERSION } from '../src/srs/fsrs_scheduler';

async function main(): Promise<void> {
  const outputPath = join(__dirname, '..', 'src', 'srs', 'fsrs_reference_vectors.json');
  // ts-fsrs does not export its package.json, so read it from node_modules directly.
  const packagePath = join(__dirname, '..', 'node_modules', 'ts-fsrs', 'package.json');
  const tsFsrsVersion = process.env.TS_FSRS_VERSION_OVERRIDE
    ?? (JSON.parse(readFileSync(packagePath, 'utf8')) as { version: string }).version;
  const file: ReferenceVectorFile = {
    format: 'dmh-fsrs-reference-vectors-1',
    tsFsrsVersion,
    modelVersion: FSRS_MODEL_VERSION,
    cases: await computeAllReferenceCases(createAppScheduler),
  };
  const text = `${JSON.stringify(file, null, 1)}\n`;
  if (process.argv.includes('--check')) {
    const committed = readFileSync(outputPath, 'utf8');
    if (committed !== text) {
      console.error('fsrs_reference_vectors.json is stale; run: npm run generate:fsrs-vectors');
      process.exit(1);
    }
    console.log(`fsrs_reference_vectors.json is current (ts-fsrs ${tsFsrsVersion}).`);
    return;
  }
  writeFileSync(outputPath, text);
  const steps = file.cases.reduce((sum, c) => sum + c.steps.length, 0);
  console.log(`Wrote ${file.cases.length} cases, ${steps} steps (ts-fsrs ${tsFsrsVersion}, ${FSRS_MODEL_VERSION}).`);
}

void main();
