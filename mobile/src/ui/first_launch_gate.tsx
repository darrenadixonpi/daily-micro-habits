import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { readInternalValue } from '../settings/settings_repository';
import { useAppState } from './app_state_context';
import { PassphraseSetupForm } from './passphrase_setup_form';

/**
 * Covers the app with the recovery passphrase form until a passphrase is set or deferred.
 * The navigator stays mounted underneath, so nothing depends on when it is ready.
 * `daily` is set only after the Keychain has been read, so passphraseSet is final by then.
 */
export function FirstLaunchGate({ children }: { readonly children: ReactNode }) {
  const { database, daily, passphraseSet } = useAppState();
  const [finished, setFinished] = useState(false);
  const deferred = database ? readInternalValue(database.executor, 'passphrase_setup_deferred_at') !== undefined : false;
  const show = Boolean(database && daily && !passphraseSet && !deferred && !finished);
  return (
    <View style={{ flex: 1 }}>
      {children}
      {show ? (
        <View style={StyleSheet.absoluteFill}>
          <PassphraseSetupForm showTitle onDone={() => setFinished(true)} />
        </View>
      ) : null}
    </View>
  );
}
