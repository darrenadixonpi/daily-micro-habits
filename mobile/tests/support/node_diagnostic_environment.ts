import * as nodeCrypto from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiagnosticEnvironment } from '../../src/diagnostics/diagnostic_environment';
import { createNodeStyleCryptoPrimitives, type NodeStyleCrypto } from '../../src/platform/crypto_primitives';
import type { ReferenceVectorFile } from '../../src/srs/fsrs_reference_cases';
import { createAppScheduler } from '../../src/srs/fsrs_scheduler';
import referenceVectors from '../../src/srs/fsrs_reference_vectors.json';
import { openNodeDatabase } from './node_sqlite_executor';

export const nodeCryptoPrimitives = createNodeStyleCryptoPrimitives(nodeCrypto as unknown as NodeStyleCrypto);

/** Diagnostic environment over node:sqlite, node:crypto and a temporary directory. */
export function createNodeDiagnosticEnvironment(): DiagnosticEnvironment & { dispose(): void } {
  const directory = mkdtempSync(join(tmpdir(), 'dmh-diagnostics-'));
  return {
    engineLabel: `Node ${process.version}`,
    crypto: nodeCryptoPrimitives,
    supportsEncryption: false,
    openScratchDatabase(name) {
      return openNodeDatabase(join(directory, name));
    },
    deleteScratchDatabase(name) {
      rmSync(join(directory, name), { force: true });
    },
    createScheduler: createAppScheduler,
    referenceVectors: referenceVectors as unknown as ReferenceVectorFile,
    async writeAndReadBackFile(name, text) {
      const path = join(directory, name);
      writeFileSync(path, text, 'utf8');
      const read = readFileSync(path, 'utf8');
      rmSync(path, { force: true });
      return read;
    },
    createScratchBackupStore() {
      const folder = join(directory, `backups_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      mkdirSync(folder, { recursive: true });
      return {
        listNames: () => readdirSync(folder),
        writeText: (name: string, text: string) => writeFileSync(join(folder, name), text, 'utf8'),
        readText: async (name: string) => readFileSync(join(folder, name), 'utf8'),
        remove: (name: string) => rmSync(join(folder, name), { force: true }),
        dispose: () => rmSync(folder, { recursive: true, force: true }),
      };
    },
    dispose() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
