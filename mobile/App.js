// M0 "pipeline proof" test app.
// Verifies on a SideStore-signed iPhone build that:
//   1. an encrypted SQLite database persists across re-signs and updates,
//   2. its random key persists in the iOS Keychain (expo-secure-store),
//   3. local notifications fire with the app closed,
//   4. a backup file lands in the app's Documents folder (visible in Files),
//   5. the installed version/build is visible for update testing.
import { useCallback, useEffect, useState } from 'react';
import { Button, Platform, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import * as Application from 'expo-application';

const KEY_NAME = 'dmh_db_key_v1';
const DB_NAME = 'dmh_m0.db';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const nowIso = () => new Date().toISOString();

// Returns [key, created] where created is true on the very first launch.
async function getOrCreateDbKey() {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) return [existing, false];
  const key = toHex(await Crypto.getRandomBytesAsync(32));
  await SecureStore.setItemAsync(KEY_NAME, key, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return [key, true];
}

async function openDb() {
  const [key, keyCreated] = await getOrCreateDbKey();
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // SQLCipher raw-key syntax: x'<64 hex chars>'
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      note TEXT NOT NULL
    );
  `);
  await db.runAsync("INSERT OR IGNORE INTO meta (k, v) VALUES ('first_launch_at', ?)", nowIso());
  await db.runAsync("INSERT OR IGNORE INTO meta (k, v) VALUES ('launch_count', '0')");
  await db.runAsync("UPDATE meta SET v = CAST(CAST(v AS INTEGER) + 1 AS TEXT) WHERE k = 'launch_count'");
  const cipher = await db.getFirstAsync('PRAGMA cipher_version;');
  return { db, keyCreated, cipherVersion: cipher ? Object.values(cipher)[0] : null };
}

async function writeBackupFile(payload) {
  const name = `m0_backup_${nowIso().slice(0, 10)}.json`;
  const text = JSON.stringify(payload, null, 2);
  try {
    // expo-file-system object API (SDK 54+).
    const { File, Paths } = require('expo-file-system');
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
    file.create();
    file.write(text);
    return file.uri;
  } catch (objectApiError) {
    // Fallback to the legacy function API if the object API is unavailable.
    const legacy = require('expo-file-system/legacy');
    const uri = legacy.documentDirectory + name;
    await legacy.writeAsStringAsync(uri, text);
    return uri;
  }
}

export default function App() {
  const [state, setState] = useState({ db: null, keyCreated: false, cipherVersion: null });
  const [meta, setMeta] = useState({});
  const [entries, setEntries] = useState([]);
  const [log, setLog] = useState([]);

  const addLog = useCallback((line) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 30));
  }, []);

  const refresh = useCallback(async (db) => {
    const rows = await db.getAllAsync('SELECT k, v FROM meta');
    setMeta(Object.fromEntries(rows.map((r) => [r.k, r.v])));
    setEntries(await db.getAllAsync('SELECT id, created_at, note FROM entries ORDER BY id DESC'));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const opened = await openDb();
        setState(opened);
        await refresh(opened.db);
        addLog(opened.keyCreated ? 'New database key created (first launch)' : 'Existing database key loaded from Keychain');
        addLog(opened.cipherVersion ? `SQLCipher active: ${opened.cipherVersion}` : 'WARNING: SQLCipher not detected');
      } catch (e) {
        addLog(`DB ERROR: ${e?.message ?? e}`);
      }
    })();
  }, [addLog, refresh]);

  const addEntry = async () => {
    if (!state.db) return;
    const n = entries.length + 1;
    await state.db.runAsync('INSERT INTO entries (created_at, note) VALUES (?, ?)', nowIso(), `Test entry ${n}`);
    await refresh(state.db);
    addLog(`Saved test entry ${n}`);
  };

  const scheduleNotification = async () => {
    try {
      const perm = await Notifications.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        addLog(`Notification permission: ${perm.status}`);
        return;
      }
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Micro-Habits M0', body: 'Test notification: local scheduling works.' },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 60 },
      });
      addLog('Notification scheduled for 60 s from now - close the app to test');
    } catch (e) {
      addLog(`NOTIFICATION ERROR: ${e?.message ?? e}`);
    }
  };

  const writeBackup = async () => {
    if (!state.db) return;
    try {
      const uri = await writeBackupFile({
        schema: 'dmh-m0-backup-1',
        written_at: nowIso(),
        app_version: Application.nativeApplicationVersion,
        build: Application.nativeBuildVersion,
        meta,
        entries,
      });
      addLog(`Backup written: ${uri.split('/').pop()}`);
    } catch (e) {
      addLog(`BACKUP ERROR: ${e?.message ?? e}`);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.h1}>Micro-Habits - M0 pipeline test</Text>

        <View style={styles.card}>
          <Text style={styles.h2}>Install</Text>
          <Text>Version {Application.nativeApplicationVersion} (build {Application.nativeBuildVersion})</Text>
          <Text>Bundle ID {Application.applicationId}</Text>
          <Text>{Platform.OS} {Platform.Version}</Text>
          <Text>First launch {meta.first_launch_at ?? '-'}</Text>
          <Text>Launch count {meta.launch_count ?? '-'}</Text>
          <Text>Encryption {state.cipherVersion ? `SQLCipher ${state.cipherVersion}` : 'not detected'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.h2}>Tests</Text>
          <Button title="C3 - Save a test entry" onPress={addEntry} />
          <Button title="C2 - Notify me in 60 seconds" onPress={scheduleNotification} />
          <Button title="C6 - Write backup file to Documents" onPress={writeBackup} />
        </View>

        <View style={styles.card}>
          <Text style={styles.h2}>Saved entries ({entries.length})</Text>
          {entries.length === 0 ? <Text>None yet</Text> : null}
          {entries.map((e) => (
            <Text key={e.id}>#{e.id}  {e.created_at}  {e.note}</Text>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.h2}>Log</Text>
          {log.map((line, i) => (
            <Text key={i} style={styles.mono}>{line}</Text>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { padding: 16, gap: 12 },
  h1: { fontSize: 20, fontWeight: '600' },
  h2: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#888', borderRadius: 8, padding: 12, gap: 6 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12 },
});
