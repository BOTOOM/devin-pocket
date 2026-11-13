export type DictationEngineChoice = 'auto' | 'chrome-local' | 'whisper';
export type DictationEngine = 'chrome-local' | 'whisper' | 'unsupported';

function normalizeLanguageTag(value: string): string | null {
  const parts = value.trim().replaceAll('_', '-').split('-');
  const language = parts[0]?.toLowerCase();
  if (!language) return null;
  if (parts.length === 1 && language === 'es') return 'es-ES';
  if (parts.length === 1 && language === 'en') return 'en-US';
  const normalized = parts.slice(1).map((part) => {
    if (part.length === 2) return part.toUpperCase();
    if (part.length === 4) return `${part[0]?.toUpperCase()}${part.slice(1).toLowerCase()}`;
    return part.toLowerCase();
  });
  return [language, ...normalized].join('-');
}

export function speechLanguageCandidates(uiLocale: string, navigatorLanguages: string[]): string[] {
  const preferred = normalizeLanguageTag(uiLocale);
  const preferredLanguage = preferred?.split('-')[0];
  const browserLanguages = navigatorLanguages
    .map(normalizeLanguageTag)
    .filter((language): language is string => language !== null);
  const regionalPreferences =
    preferredLanguage === undefined
      ? []
      : browserLanguages.filter((language) => language.split('-')[0] === preferredLanguage);
  return [
    ...new Set([
      ...(regionalPreferences ?? []),
      ...(preferred ? [preferred] : []),
      ...browserLanguages,
    ]),
  ];
}

export function selectDictationEngine(
  choice: DictationEngineChoice,
  chromeLocalAvailable: boolean,
): DictationEngine {
  if (choice === 'whisper') return 'whisper';
  if (choice === 'chrome-local') return chromeLocalAvailable ? 'chrome-local' : 'unsupported';
  return chromeLocalAvailable ? 'chrome-local' : 'whisper';
}

export function chunkPcm(samples: Float32Array, chunkSize = 16_384): Float32Array[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0)
    throw new RangeError('chunkSize must be positive');
  const chunks: Float32Array[] = [];
  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    chunks.push(samples.slice(offset, offset + chunkSize));
  }
  return chunks;
}

export function joinPcmChunks(chunks: readonly Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((length, chunk) => length + chunk.length, 0);
  const samples = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

export function encodePcmChunk(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

export function decodePcmChunk(encoded: string): Float32Array {
  const binary = atob(encoded);
  if (binary.length % Float32Array.BYTES_PER_ELEMENT !== 0)
    throw new RangeError('PCM byte length must be aligned to Float32 samples');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Float32Array(bytes.buffer);
}

export interface CaretInsertion {
  value: string;
  caret: number;
}

export function insertAtCaret(
  value: string,
  inserted: string,
  selectionStart: number,
  selectionEnd = selectionStart,
): CaretInsertion {
  const start = Math.min(Math.max(selectionStart, 0), value.length);
  const end = Math.min(Math.max(selectionEnd, start), value.length);
  const phrase = inserted.trim();
  if (!phrase) return { value, caret: start };
  const before = value.slice(0, start);
  const after = value.slice(end);
  const beforeSpace = before && !/\s$/.test(before) && !/^[,.;:!?)]/.test(phrase) ? ' ' : '';
  const afterSpace = after && !/^\s/.test(after) && !/^[,.;:!?)]/.test(after) ? ' ' : '';
  return {
    value: `${before}${beforeSpace}${phrase}${afterSpace}${after}`,
    caret: before.length + beforeSpace.length + phrase.length,
  };
}
