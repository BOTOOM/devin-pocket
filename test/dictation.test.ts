import { expect, it } from 'vitest';
import { insertAtCaret } from '../src/web/lib/dictation/helpers.js';
import {
  dictationReducer,
  initialDictation,
  resolveLanguage,
} from '../src/web/lib/dictation/state.js';

it('resolves Auto from app locale and honors explicit language overrides', () => {
  expect(resolveLanguage('auto', 'es')).toEqual({
    lang: 'es',
    speech: 'es-ES',
    whisper: 'spanish',
  });
  expect(resolveLanguage('auto', 'en').whisper).toBe('english');
  expect(resolveLanguage('en', 'es').speech).toBe('en-US');
  expect(resolveLanguage('es', 'en').whisper).toBe('spanish');
});
it('handles preparation, bounded progress, listening, transcription, errors and cancel', () => {
  let state = dictationReducer(initialDictation, {
    type: 'phase',
    phase: 'consent',
    engine: 'whisper',
  });
  state = dictationReducer(state, { type: 'phase', phase: 'preparing' });
  expect(state.engine).toBe('whisper');
  expect(dictationReducer(state, { type: 'progress', value: 110 }).progress).toBe(100);
  expect(dictationReducer(state, { type: 'progress', value: Number.NaN }).progress).toBeNull();
  state = dictationReducer(state, { type: 'phase', phase: 'listening' });
  expect(dictationReducer(state, { type: 'progress', value: 50 })).toEqual(state);
  state = dictationReducer(state, { type: 'phase', phase: 'transcribing' });
  state = dictationReducer(state, { type: 'phase', phase: 'error' });
  expect(dictationReducer(state, { type: 'cancel' })).toEqual(initialDictation);
});
it('inserts editable transcripts at the selection without sending or losing surrounding text', () => {
  expect(insertAtCaret('Hola mundo', 'buenos días', 4)).toEqual({
    value: 'Hola buenos días mundo',
    caret: 16,
  });
  expect(insertAtCaret('Hello old world', 'new', 6, 9).value).toBe('Hello new world');
  expect(insertAtCaret('Hello', '', 5).value).toBe('Hello');
  expect(insertAtCaret('', 'hola', 0)).toEqual({ value: 'hola', caret: 4 });
});
