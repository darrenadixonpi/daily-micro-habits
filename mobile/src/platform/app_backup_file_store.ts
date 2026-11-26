import { Directory, File, Paths } from 'expo-file-system';
import type { BackupFileStore } from '../backup/daily_backup';

/** Backup files in a folder: the app's Documents folder (visible in Files) by default. */
export function createAppBackupFileStore(directory: Directory = Paths.document): BackupFileStore {
  const fileNamed = (name: string) => new File(directory, name);
  return {
    listNames() {
      if (!directory.exists) return [];
      return directory.list().filter((entry): entry is File => entry instanceof File).map((entry) => entry.name);
    },
    writeText(name, text) {
      if (!directory.exists) directory.create({ intermediates: true });
      const file = fileNamed(name);
      if (file.exists) file.delete();
      file.create();
      file.writeSync(text);
    },
    async readText(name) {
      return fileNamed(name).text();
    },
    remove(name) {
      const file = fileNamed(name);
      if (file.exists) file.delete();
    },
  };
}
