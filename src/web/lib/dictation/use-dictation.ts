import { useCallback, useEffect, useReducer, useRef } from 'react';
import { getLang } from '@/i18n';
import { languageChoice, save, saved } from './preferences';
import {
  checkSpeechLanguages,
  findSpeechRecognitionApi,
  type SpeechRecognitionInstance,
  startLocalRecognition,
} from './speech';
import { dictationReducer, initialDictation, resolveLanguage } from './state';
import { type PcmCapture, startPcmCapture } from './whisper-audio';

export function useDictation(insert: (text: string) => void) {
  const [state, dispatch] = useReducer(dictationReducer, initialDictation);
  const insertRef = useRef(insert);
  insertRef.current = insert;
  const generation = useRef(0);
  const worker = useRef<Worker | null>(null);
  const capture = useRef<PcmCapture | null>(null);
  const speech = useRef<SpeechRecognitionInstance | null>(null);
  const speechFinals = useRef<string[]>([]);
  const speechStopped = useRef(false);
  const language = useRef(resolveLanguage('auto', getLang()));
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const limit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancel = useCallback(() => {
    generation.current++;
    speechFinals.current = [];
    speechStopped.current = false;
    clearTimeout(idle.current);
    clearTimeout(limit.current);
    worker.current?.terminate();
    worker.current = null;
    if (speech.current) {
      speech.current.onresult = null;
      speech.current.onend = null;
      speech.current.onerror = null;
      speech.current.abort();
      speech.current = null;
    }
    void capture.current?.cancel();
    capture.current = null;
    dispatch({ type: 'cancel' });
  }, []);

  useEffect(() => {
    window.addEventListener('dp.dictation.delete', cancel);
    return () => {
      window.removeEventListener('dp.dictation.delete', cancel);
      cancel();
    };
  }, [cancel]);

  const fail = useCallback(() => {
    cancel();
    dispatch({ type: 'phase', phase: 'error' });
  }, [cancel]);

  const startWhisper = async () => {
    const id = ++generation.current;
    clearTimeout(idle.current);
    dispatch({ type: 'phase', phase: 'preparing', engine: 'whisper' });
    save('engine', 'whisper');
    try {
      const host =
        worker.current ??
        new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
      worker.current = host;
      host.onerror = () => {
        if (id === generation.current) fail();
      };
      host.onmessage = async (
        event: MessageEvent<{ type: string; id: number; value?: number; text?: string }>,
      ) => {
        if (id !== generation.current || event.data.id !== id) return;
        const message = event.data;
        if (message.type === 'progress')
          dispatch({ type: 'progress', value: message.value ?? null });
        else if (message.type === 'ready') {
          save('downloaded', 'true');
          try {
            const recorder = await startPcmCapture();
            if (id !== generation.current) {
              await recorder.cancel();
              return;
            }
            capture.current = recorder;
            dispatch({ type: 'phase', phase: 'listening' });
          } catch {
            if (id === generation.current) fail();
          }
        } else if (message.type === 'result') {
          if (message.text?.trim()) insertRef.current(message.text.trim());
          dispatch({ type: 'phase', phase: 'idle' });
          idle.current = setTimeout(() => {
            host.terminate();
            if (worker.current === host) worker.current = null;
          }, 60_000);
        } else if (message.type === 'error') fail();
      };
      host.postMessage({ type: 'prepare', id });
    } catch {
      fail();
    }
  };

  const startSpeech = async (install: boolean) => {
    const id = ++generation.current;
    speechFinals.current = [];
    speechStopped.current = false;
    dispatch({ type: 'phase', phase: 'preparing', engine: 'speech' });
    const api = findSpeechRecognitionApi();
    if (!api) {
      await startWhisperOrConsent();
      return;
    }
    try {
      if (
        install &&
        !(await api.install({ langs: [language.current.speech], processLocally: true }))
      )
        throw new Error('pack');
      if (id !== generation.current) return;
      save('engine', 'speech');
      speech.current = startLocalRecognition(api, language.current.speech, {
        onResult: (text, final) => {
          if (id === generation.current && final) speechFinals.current.push(text);
        },
        onError: () => {
          if (id === generation.current) fail();
        },
        onEnd: () => {
          if (id === generation.current) {
            speech.current = null;
            if (speechStopped.current && speechFinals.current.length)
              insertRef.current(speechFinals.current.join(' '));
            speechFinals.current = [];
            dispatch({ type: 'phase', phase: 'idle' });
          }
        },
      });
      dispatch({ type: 'phase', phase: 'listening', engine: 'speech' });
    } catch {
      if (id === generation.current) await startWhisperOrConsent();
    }
  };

  const startWhisperOrConsent = async () => {
    if (saved('consent') !== 'true')
      dispatch({ type: 'phase', phase: 'consent', engine: 'whisper' });
    else await startWhisper();
  };

  const start = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: 'phase', phase: 'insecure' });
      return;
    }
    if (state.phase === 'idle') generation.current++;
    else cancel();
    language.current = resolveLanguage(languageChoice(), getLang());
    const id = generation.current;
    dispatch({ type: 'phase', phase: 'preparing' });
    const api = findSpeechRecognitionApi();
    const [available] = api ? await checkSpeechLanguages(api, [language.current.speech]) : [];
    if (id !== generation.current) return;
    if (api && available?.availability === 'available') await startSpeech(false);
    else if (
      api &&
      (available?.availability === 'downloadable' || available?.availability === 'downloading')
    )
      dispatch({ type: 'phase', phase: 'pack', engine: 'speech' });
    else await startWhisperOrConsent();
  };

  const stop = async () => {
    clearTimeout(limit.current);
    dispatch({ type: 'phase', phase: 'transcribing' });
    if (speech.current) {
      speechStopped.current = true;
      speech.current.stop();
      return;
    }
    const recorder = capture.current;
    capture.current = null;
    if (!recorder) return;
    const id = generation.current;
    try {
      const samples = await recorder.stop();
      if (id !== generation.current) return;
      worker.current?.postMessage(
        { type: 'transcribe', id, samples, language: language.current.whisper },
        [samples.buffer],
      );
    } catch {
      if (id === generation.current) fail();
    }
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    if (state.phase === 'listening')
      limit.current = setTimeout(() => void stopRef.current(), 60_000);
    return () => clearTimeout(limit.current);
  }, [state.phase]);

  return {
    state,
    start,
    stop,
    cancel,
    consent: async () => {
      save('consent', 'true');
      await startWhisper();
    },
    install: () => startSpeech(true),
  };
}
