import { router } from 'expo-router';
import { PassphraseSetupForm } from '../../src/ui/passphrase_setup_form';

/** Settings → Recovery passphrase. The first-launch prompt uses the same form via FirstLaunchGate. */
export default function PassphraseSetupScreen() {
  return <PassphraseSetupForm onDone={() => router.back()} />;
}
