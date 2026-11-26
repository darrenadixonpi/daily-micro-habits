import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppLockGate } from '../src/ui/app_lock_gate';
import { AppStateProvider } from '../src/ui/app_state_context';

export default function RootLayout() {
  return (
    <AppStateProvider>
      <StatusBar style="dark" />
      <AppLockGate>
        <Stack screenOptions={{ headerBackTitle: 'Back' }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="d1" options={{ title: 'Morning top-3' }} />
          <Stack.Screen name="d2" options={{ title: 'Evening review' }} />
          <Stack.Screen name="journal-entry/[date]" options={{ title: 'Journal' }} />
          <Stack.Screen name="setup/passphrase" options={{ title: 'Recovery passphrase', presentation: 'modal' }} />
          <Stack.Screen name="diagnostics" options={{ title: 'Diagnostics' }} />
        </Stack>
      </AppLockGate>
    </AppStateProvider>
  );
}
