type SpeechAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
interface SpeechLanguageAvailability {
  language: string;
  availability: SpeechAvailability;
}

export interface SpeechRecognitionResult {
  isFinal: boolean;
  0?: { transcript?: string };
}

export interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResult>;
}

export interface SpeechRecognitionErrorEvent {
  error: string;
}

export interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  processLocally?: boolean;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
  available: (options: { langs: string[]; processLocally: true }) => Promise<SpeechAvailability>;
  install: (options: { langs: string[]; processLocally: true }) => Promise<boolean>;
}

export interface SpeechRecognitionHandlers {
  onResult: (transcript: string, final: boolean) => void;
  onError: (code: string) => void;
  onEnd: () => void;
}

function isSpeechRecognitionConstructor(value: unknown): value is SpeechRecognitionConstructor {
  return (
    typeof value === 'function' &&
    typeof Reflect.get(value, 'available') === 'function' &&
    typeof Reflect.get(value, 'install') === 'function'
  );
}

export function findSpeechRecognitionApi(
  scope: typeof globalThis = globalThis,
): SpeechRecognitionConstructor | null {
  const candidate: unknown =
    Reflect.get(scope, 'SpeechRecognition') ?? Reflect.get(scope, 'webkitSpeechRecognition');
  if (!isSpeechRecognitionConstructor(candidate)) return null;
  try {
    const recognition = new candidate();
    return 'processLocally' in recognition ? candidate : null;
  } catch {
    return null;
  }
}

export async function checkSpeechLanguages(
  api: SpeechRecognitionConstructor,
  languages: string[],
): Promise<SpeechLanguageAvailability[]> {
  const results: SpeechLanguageAvailability[] = [];
  for (const language of languages) {
    try {
      results.push({
        language,
        availability: await api.available({ langs: [language], processLocally: true }),
      });
    } catch {
      results.push({ language, availability: 'unavailable' });
    }
  }
  return results;
}

export function startLocalRecognition(
  api: SpeechRecognitionConstructor,
  language: string,
  handlers: SpeechRecognitionHandlers,
): SpeechRecognitionInstance {
  const recognition = new api();
  if (!('processLocally' in recognition)) throw new Error('Local recognition is not supported');
  recognition.processLocally = true;
  if (recognition.processLocally !== true)
    throw new Error('Local recognition could not be enabled');
  recognition.lang = language;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result?.[0]?.transcript?.trim();
      if (result && transcript) handlers.onResult(transcript, result.isFinal);
    }
  };
  recognition.onerror = (event) => handlers.onError(event.error);
  recognition.onend = handlers.onEnd;
  recognition.start();
  return recognition;
}
