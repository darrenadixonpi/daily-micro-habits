import { useState, type ReactNode } from 'react';
import { Modal } from 'react-native';
import { readInternalValue } from '../settings/settings_repository';
import { useAppState } from './app_state_context';
import { PassphraseSetupForm } from './passphrase_setup_form';

/**
 * Presents the recovery passphrase form until a passphrase is set or deferred.
 *
 * A native full-screen Modal is used because (a) a router.push issued before the navigator
 * mounts is dropped, and (b) a JS overlay drawn as a sibling of the native stack can be
 * covered when the stack's native view is re-attached (both observed in the simulator
 * tour). `daily` is set only after the Keychain has been read, so passphraseSet is final.
 */
export function FirstLaunchGate({ children }: { readonly children: ReactNode }) {
  const { database, daily, passphraseSet } = useAppState();
  const [finished, setFinished] = useState(false);
  const deferred = database ? readInternalValue(database.executor, 'passphrase_setup_deferred_at') !== undefined : false;
  const show = Boolean(database && daily && !passphraseSet && !deferred && !finished);
  return (
    <>
      {children}
      <Modal visible={show} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => undefined}>
        <PassphraseSetupForm showTitle onDone={() => setFinished(true)} />
      </Modal>
    </>
  );
}
