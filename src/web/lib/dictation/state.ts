export type LanguageChoice = 'auto' | 'es' | 'en';
export type Engine = 'speech' | 'whisper';
export type Phase =
  | 'idle'
  | 'preparing'
  | 'consent'
  | 'pack'
  | 'listening'
  | 'transcribing'
  | 'error'
  | 'insecure';
export interface DictationState {
  phase: Phase;
  engine: Engine | null;
  progress: number | null;
}
export const initialDictation: DictationState = { phase: 'idle', engine: null, progress: null };
export type DictationEvent =
  | { type: 'phase'; phase: Phase; engine?: Engine }
  | { type: 'progress'; value: number | null }
  | { type: 'cancel' };
export function dictationReducer(state: DictationState, event: DictationEvent): DictationState {
  if (event.type === 'cancel') return initialDictation;
  if (event.type === 'progress') {
    if (state.phase !== 'preparing') return state;
    return {
      ...state,
      progress:
        event.value == null || !Number.isFinite(event.value)
          ? null
          : Math.max(0, Math.min(100, Math.round(event.value))),
    };
  }
  return { phase: event.phase, engine: event.engine ?? state.engine, progress: null };
}
export function resolveLanguage(choice: LanguageChoice, appLanguage: 'es' | 'en') {
  const lang = choice === 'auto' ? appLanguage : choice;
  return {
    lang,
    speech: lang === 'es' ? 'es-ES' : 'en-US',
    whisper: lang === 'es' ? 'spanish' : 'english',
  };
}
