import { env, pipeline } from '@huggingface/transformers';
import { MODEL_PREFIX, WHISPER_MODEL, WHISPER_REVISION } from '@shared/dictation';
import { coalescedModelFetch } from './model-fetch';

env.allowLocalModels = false;
env.remoteHost = `${self.location.origin}${MODEL_PREFIX}`;
env.remotePathTemplate = '{model}/{revision}/';
env.useBrowserCache = true;
env.useFSCache = false;
self.fetch = coalescedModelFetch(
  self.fetch.bind(self),
  `${self.location.origin}${MODEL_PREFIX}`,
  async (url, response) => {
    const cache = await caches.open('transformers-cache');
    await cache.put(url, response);
  },
);
const wasm = env.backends.onnx.wasm;
if (wasm) {
  wasm.wasmPaths = `${self.location.origin}/onnx/`;
  wasm.numThreads = 1;
  wasm.proxy = false;
}

async function createPipeline(id: number) {
  const gpu: unknown = Reflect.get(navigator, 'gpu');
  let hasAdapter = false;
  try {
    if (gpu && typeof gpu === 'object') {
      const request = Reflect.get(gpu, 'requestAdapter');
      if (typeof request === 'function') hasAdapter = !!(await Reflect.apply(request, gpu, []));
    }
  } catch {
    /* WASM is the portable fallback. */
  }
  const progress = (event: unknown) => {
    const value = event && typeof event === 'object' ? Reflect.get(event, 'progress') : null;
    self.postMessage({ type: 'progress', id, value: typeof value === 'number' ? value : null });
  };
  const load = (device: 'webgpu' | 'wasm', dtype: 'fp16' | 'q8') =>
    pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      revision: WHISPER_REVISION,
      device,
      dtype,
      progress_callback: progress,
    });
  if (hasAdapter) {
    try {
      return await load('webgpu', 'fp16');
    } catch {
      /* Retry with quantized WASM. */
    }
  }
  return load('wasm', 'q8');
}
let model: ReturnType<typeof createPipeline> | null = null;
self.onmessage = async (
  event: MessageEvent<{
    type: 'prepare' | 'transcribe';
    id: number;
    samples?: Float32Array;
    language?: string;
  }>,
) => {
  const { type, id, samples, language } = event.data;
  try {
    model ??= createPipeline(id);
    const transcriber = await model;
    if (type === 'prepare') self.postMessage({ type: 'ready', id });
    else if (samples && (language === 'spanish' || language === 'english')) {
      const result = await transcriber(samples, {
        language,
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      self.postMessage({
        type: 'result',
        id,
        text: Array.isArray(result) ? (result[0]?.text ?? '') : result.text,
      });
    }
  } catch {
    model = null;
    self.postMessage({ type: 'error', id });
  }
};
