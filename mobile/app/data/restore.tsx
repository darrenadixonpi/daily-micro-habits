import * as Application from 'expo-application';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import {
  backupTextKind,
  decryptBackup,
  parseExportText,
  restoreBackupDocument,
  verifyBackupDocument,
  type BackupDocument,
  type RestoreReport,
} from '../../src/backup/backup_codec';
import { writeSafetyBackup } from '../../src/backup/daily_backup';
import { BUNDLED_CONTENT } from '../../src/content/bundled_content';
import { importBundledContent } from '../../src/content/content_import';
import { createAppBackupFileStore } from '../../src/platform/app_backup_file_store';
import { appCryptoPrimitives } from '../../src/platform/app_crypto_primitives';
import { listRestorableFiles, readDocumentText, type DocumentFileInfo } from '../../src/platform/app_document_files';
import { deleteExpoDatabase, openExpoDatabase } from '../../src/platform/expo_sqlite_executor';
import { readBackupKey } from '../../src/security/recovery_passphrase';
import { useAppState } from '../../src/ui/app_state_context';
import { ActionButton, ChoiceList, ConfirmActionButton, FormField } from '../../src/ui/controls';
import { Card, LabelValueRow, ScreenMessage, ScreenScrollView } from '../../src/ui/screen_layout';
import { COLORS, ui } from '../../src/ui/ui_styles';
import { bytesToHex } from '../../src/util/byte_encoding';

/**
 * Restore and verify (spec Section 9). Lists .mhbak backups and .json exports in the app's
 * Documents folder. Verify only restores into a scratch database and checks every table's
 * checksum; Restore first writes a safety backup of the current data, then replaces it.
 */
export default function RestoreScreen() {
  const { database, refreshDaily } = useAppState();
  const [files, setFiles] = useState<DocumentFileInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ readonly mode: 'verified' | 'restored'; readonly report: RestoreReport; readonly safety: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFiles(listRestorableFiles().reverse());
  }, []);

  if (!database) return <ScreenMessage loading />;
  const file = files.find((entry) => entry.relativePath === selected) ?? null;
  const encrypted = file?.name.endsWith('.mhbak') ?? false;

  const readDocument = async (): Promise<BackupDocument> => {
    if (!file) throw new Error('Choose a file first.');
    const text = await readDocumentText(file.uri);
    const kind = backupTextKind(text);
    if (kind === 'encrypted') {
      if (passphrase.length === 0) throw new Error('Enter the recovery passphrase this backup was made with.');
      return decryptBackup(appCryptoPrimitives, passphrase, text);
    }
    if (kind === 'export') return parseExportText(text);
    throw new Error('This file is not a Micro-Habits backup or export.');
  };

  const run = async (mode: 'verify' | 'restore') => {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const document = await readDocument();
      if (mode === 'verify') {
        const name = `restore_verify_${Date.now()}.db`;
        const result = verifyBackupDocument(
          () => {
            const executor = openExpoDatabase(name, bytesToHex(appCryptoPrimitives.randomBytes(32)));
            return {
              executor,
              dispose() {
                executor.close();
                deleteExpoDatabase(name);
              },
            };
          },
          appCryptoPrimitives,
          document,
        );
        setReport({ mode: 'verified', report: result, safety: null });
      } else {
        const key = await readBackupKey();
        const safety = key
          ? writeSafetyBackup(database.executor, appCryptoPrimitives, createAppBackupFileStore(), {
              keyMaterial: key,
              reason: 'before-restore',
              appVersion: `${Application.nativeApplicationVersion ?? '?'} (${Application.nativeBuildVersion ?? '?'})`,
              now: new Date(),
            }).fileName
          : null;
        const result = restoreBackupDocument(database.executor, appCryptoPrimitives, document);
        importBundledContent(database.executor, BUNDLED_CONTENT, new Date(), { force: true });
        await refreshDaily();
        setReport({ mode: 'restored', report: result, safety });
        setFiles(listRestorableFiles().reverse());
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  };

  const totalRows = report ? Object.values(report.report.rowsByTable).reduce((sum, n) => sum + n, 0) : 0;

  return (
    <ScreenScrollView testID="screen-restore">
      <Card title="Choose a file" testID="restore-files">
        <Text style={ui.muted}>
          Backups (.mhbak, encrypted) and exports (.json) in Files → On My iPhone → Micro-Habits. To use a file from elsewhere, copy it into
          that folder first.
        </Text>
        {files.length === 0 ? <Text style={ui.text}>No backup or export files found.</Text> : null}
        <ChoiceList
          showIds={false}
          testIDPrefix="restore-file"
          options={files.slice(0, 30).map((entry) => ({ id: entry.relativePath, text: entry.relativePath }))}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            setReport(null);
            setError(null);
          }}
        />
      </Card>
      {file ? (
        <Card title={encrypted ? 'Encrypted backup' : 'Plain JSON export'} testID="restore-actions">
          {encrypted ? (
            <FormField
              testID="restore-passphrase"
              label="Recovery passphrase"
              value={passphrase}
              onChangeText={setPassphrase}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : null}
          <ActionButton testID="restore-verify" label={busy ? 'Working…' : 'Verify only'} disabled={busy} onPress={() => void run('verify')} />
          <ConfirmActionButton
            testID="restore-run"
            label="Restore this file"
            confirmLabel="Replace all current data"
            consequence="Every table is replaced by this file’s contents. A safety backup of the current data is written first."
            disabled={busy}
            onConfirm={() => void run('restore')}
          />
        </Card>
      ) : null}
      {error ? (
        <Card tone="warning" testID="restore-error">
          <Text style={[ui.text, { color: COLORS.fail }]}>{error}</Text>
        </Card>
      ) : null}
      {report ? (
        <Card title={report.mode === 'verified' ? 'Verified (nothing changed)' : 'Restored'} testID="restore-report">
          <Text testID="restore-result" style={[ui.text, { fontWeight: '600', color: report.report.checksumsMatch ? COLORS.pass : COLORS.fail }]}>
            {report.report.checksumsMatch ? 'All table checksums match.' : 'Checksum mismatch: the file is damaged or incomplete.'}
          </Text>
          <LabelValueRow label="Rows" value={String(totalRows)} />
          <LabelValueRow label="Schema" value={`v${report.report.fromSchemaVersion}${report.report.upgraded ? ' → current' : ''}`} />
          {Object.entries(report.report.rowsByTable).map(([table, rows]) => (
            <LabelValueRow key={table} label={table} value={String(rows)} />
          ))}
          {report.safety ? <Text style={ui.muted}>Safety backup: {report.safety}</Text> : null}
          {report.mode === 'restored' && !report.safety ? <Text style={ui.muted}>No safety backup: no recovery passphrase is set.</Text> : null}
        </Card>
      ) : null}
    </ScreenScrollView>
  );
}
