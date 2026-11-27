import * as Speech from 'expo-speech';

/**
 * A4 pronunciation through the device's text-to-speech (spec Section 2, A4 Audio). The
 * Speech voice setting holds either a language tag (default "es-MX": the system's voice for
 * it) or the identifier of an installed voice picked in Settings.
 */
export interface InstalledVoice {
  readonly identifier: string;
  readonly name: string;
  readonly language: string;
  readonly quality: string;
}

const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/;

/** Speech language for an A4 target language (es-419 has no voices of its own; es-MX is used). */
export function speechLanguageFor(targetLanguage: string): string {
  if (targetLanguage === 'es-419') return 'es-MX';
  if (targetLanguage === 'zh-Hans') return 'zh-CN';
  if (targetLanguage === 'ja') return 'ja-JP';
  if (targetLanguage === 'ko') return 'ko-KR';
  return targetLanguage;
}

export function speakPhrase(text: string, options: { readonly voiceSetting: string; readonly targetLanguage: string; readonly rate: number }): void {
  Speech.stop();
  const voiceIsLanguage = LANGUAGE_TAG.test(options.voiceSetting);
  Speech.speak(text, {
    language: voiceIsLanguage ? options.voiceSetting : speechLanguageFor(options.targetLanguage),
    voice: voiceIsLanguage ? undefined : options.voiceSetting,
    rate: options.rate,
  });
}

export async function installedVoices(targetLanguage: string): Promise<InstalledVoice[]> {
  const prefix = speechLanguageFor(targetLanguage).slice(0, 2);
  const voices = await Speech.getAvailableVoicesAsync();
  return voices
    .filter((voice) => voice.language.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((voice) => ({ identifier: voice.identifier, name: voice.name, language: voice.language, quality: String(voice.quality) }))
    .sort((a, b) => a.language.localeCompare(b.language) || a.name.localeCompare(b.name));
}
