import { Directory, File, Paths } from 'expo-file-system';

/**
 * Files in the app's Documents folder, which the Files app shows under On My iPhone →
 * Micro-Habits (UIFileSharingEnabled). Exports go to Exports/<timestamp>/; the Restore
 * screen reads backup and export files the user placed anywhere in the folder.
 */
export interface DocumentFileInfo {
  readonly name: string;
  /** Path relative to Documents, e.g. "Exports/2026-11-27_0815/microhabits_export_2026-11-27.json". */
  readonly relativePath: string;
  readonly uri: string;
  readonly size: number | null;
}

export function writeExportFolder(stamp: string, files: readonly { readonly name: string; readonly text: string }[]): { folder: string; written: DocumentFileInfo[] } {
  const exports = new Directory(Paths.document, 'Exports');
  if (!exports.exists) exports.create({ intermediates: true });
  const folder = new Directory(exports, stamp);
  if (!folder.exists) folder.create({ intermediates: true });
  const written = files.map((entry) => {
    const file = new File(folder, entry.name);
    if (file.exists) file.delete();
    file.create();
    file.writeSync(entry.text);
    return { name: entry.name, relativePath: `Exports/${stamp}/${entry.name}`, uri: file.uri, size: file.size ?? null };
  });
  return { folder: `Exports/${stamp}`, written };
}

/** Backup (.mhbak) and export (.json) files in Documents and one folder level below it, newest name last. */
export function listRestorableFiles(): DocumentFileInfo[] {
  const out: DocumentFileInfo[] = [];
  const visit = (directory: Directory, prefix: string, depth: number) => {
    if (!directory.exists) return;
    for (const entry of directory.list()) {
      if (entry instanceof File) {
        if (/\.(mhbak|json)$/i.test(entry.name) && /^microhabits_/.test(entry.name)) {
          out.push({ name: entry.name, relativePath: `${prefix}${entry.name}`, uri: entry.uri, size: entry.size ?? null });
        }
      } else if (entry instanceof Directory && depth < 2) {
        visit(entry, `${prefix}${entry.name}/`, depth + 1);
      }
    }
  };
  visit(Paths.document, '', 0);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readDocumentText(uri: string): Promise<string> {
  return new File(uri).text();
}
