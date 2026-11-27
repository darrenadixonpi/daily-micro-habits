import * as Application from 'expo-application';
import { useState } from 'react';
import { Share, Text } from 'react-native';
import { buildExportFiles } from '../../src/backup/export_files';
import { appCryptoPrimitives } from '../../src/platform/app_crypto_primitives';
import { writeExportFolder, type DocumentFileInfo } from '../../src/platform/app_document_files';
import { useAppState } from '../../src/ui/app_state_context';
import { ActionButton } from '../../src/ui/controls';
import { Card, LabelValueRow, ScreenMessage, ScreenScrollView } from '../../src/ui/screen_layout';
import { COLORS, ui } from '../../src/ui/ui_styles';

/**
 * Manual export (spec Section 9): JSON of every table plus the journal as monthly Markdown,
 * written to Files → On My iPhone → Micro-Habits → Exports, each file shareable.
 */
export default function ExportScreen() {
  const { database, daily } = useAppState();
  const [files, setFiles] = useState<DocumentFileInfo[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!database || !daily) return <ScreenMessage loading />;

  const exportNow = () => {
    try {
      const now = new Date();
      const built = buildExportFiles(database.executor, appCryptoPrimitives, {
        appVersion: `${Application.nativeApplicationVersion ?? '?'} (${Application.nativeBuildVersion ?? '?'})`,
        localDate: daily.today,
        now,
      });
      const stamp = `${daily.today}_${now.toISOString().slice(11, 16).replace(':', '')}Z`;
      const result = writeExportFolder(stamp, built);
      setFiles(result.written);
      setFolder(result.folder);
      setError(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  };

  return (
    <ScreenScrollView testID="screen-export">
      <Card title="Export" testID="export-intro">
        <Text style={ui.text}>
          Writes one JSON file with every table and one Markdown file per month of journal entries. The JSON can be imported again on
          the Restore screen.
        </Text>
        <Text style={[ui.muted, { color: COLORS.skip }]}>
          Export files are not encrypted: they contain your journal in plain text. Daily .mhbak backups stay encrypted.
        </Text>
        <ActionButton testID="export-run" label="Export now" onPress={exportNow} />
        {error ? <Text style={[ui.muted, { color: COLORS.fail }]}>{error}</Text> : null}
      </Card>
      {folder ? (
        <Card title="Written" testID="export-files">
          <Text style={ui.muted}>Files → On My iPhone → Micro-Habits → {folder}</Text>
          {files.map((file) => (
            <Card key={file.name} testID={`export-file-${file.name}`}>
              <LabelValueRow label={file.name} value={file.size === null ? undefined : `${Math.max(1, Math.round(file.size / 1024))} KB`} />
              <ActionButton label="Share…" align="right" onPress={() => void Share.share({ url: file.uri, title: file.name })} />
            </Card>
          ))}
        </Card>
      ) : null}
    </ScreenScrollView>
  );
}
