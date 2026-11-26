import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { setRecoveryPassphrase, validateNewPassphrase, MIN_PASSPHRASE_LENGTH } from '../../src/security/recovery_passphrase';
import { writeInternalValue } from '../../src/settings/settings_repository';
import { useAppState } from '../../src/ui/app_state_context';
import { COLORS, ui } from '../../src/ui/ui_styles';

/** One-time recovery passphrase setup (spec Section 9). The passphrase is never stored. */
export default function PassphraseSetupScreen() {
  const { database, passphraseSet, reloadSecurity, refreshDaily } = useAppState();
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!database) return null;

  const save = async () => {
    const problem = validateNewPassphrase(first, second);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await setRecoveryPassphrase(first, database.keyHex, database.location.directory);
      writeInternalValue(database.executor, 'passphrase_set_at', new Date().toISOString());
      await reloadSecurity();
      await refreshDaily();
      router.back();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const later = () => {
    writeInternalValue(database.executor, 'passphrase_setup_deferred_at', new Date().toISOString());
    router.back();
  };

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.body} keyboardShouldPersistTaps="handled">
      <View style={ui.card}>
        <Text style={ui.text}>
          {passphraseSet ? 'Choose a new recovery passphrase. ' : ''}
          The recovery passphrase encrypts your daily backup files and can reopen your data if the iPhone Keychain item is
          ever lost.
        </Text>
        <Text style={ui.text}>It is not stored anywhere and cannot be recovered. Keep it in your password manager.</Text>
        <Text style={ui.muted}>At least {MIN_PASSPHRASE_LENGTH} characters; a few unrelated words work well.</Text>
      </View>
      <TextInput style={ui.input} value={first} onChangeText={setFirst} secureTextEntry placeholder="Passphrase" autoCapitalize="none" autoCorrect={false} textContentType="newPassword" />
      <TextInput style={ui.input} value={second} onChangeText={setSecond} secureTextEntry placeholder="Repeat passphrase" autoCapitalize="none" autoCorrect={false} textContentType="newPassword" />
      {error ? <Text style={[ui.muted, { color: COLORS.fail }]}>{error}</Text> : null}
      {busy ? (
        <ActivityIndicator />
      ) : (
        <Pressable style={ui.button} onPress={() => void save()}>
          <Text style={ui.buttonText}>Save passphrase</Text>
        </Pressable>
      )}
      {!passphraseSet ? (
        <Pressable style={ui.button} onPress={later}>
          <Text style={[ui.buttonText, { color: COLORS.muted }]}>Set later (backups stay off)</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
