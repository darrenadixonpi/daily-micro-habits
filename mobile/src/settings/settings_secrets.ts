import * as SecureStore from 'expo-secure-store';

/** Keychain item for the Anthropic API key (spec Section 3: "stored in secure storage"). */
const ANTHROPIC_API_KEY_ITEM = 'dmh_anthropic_api_key_v1';

export async function readAnthropicApiKeyPresent(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ANTHROPIC_API_KEY_ITEM)) !== null;
}

export async function saveAnthropicApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (trimmed === '') {
    await SecureStore.deleteItemAsync(ANTHROPIC_API_KEY_ITEM);
    return;
  }
  await SecureStore.setItemAsync(ANTHROPIC_API_KEY_ITEM, trimmed, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}
