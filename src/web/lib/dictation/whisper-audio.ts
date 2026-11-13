import { joinPcmChunks } from './helpers';

export interface PcmCapture {
  stop: () => Promise<Float32Array>;
  cancel: () => Promise<void>;
}

function resample(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return input.slice();
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.round(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = index * ratio;
    const end = Math.min(input.length, (index + 1) * ratio);
    let sum = 0;
    for (let sourceIndex = Math.floor(start); sourceIndex < end; sourceIndex += 1) {
      const overlap = Math.min(end, sourceIndex + 1) - Math.max(start, sourceIndex);
      sum += (input[sourceIndex] ?? 0) * overlap;
    }
    output[index] = end > start ? sum / (end - start) : 0;
  }
  return output;
}

export async function startPcmCapture(): Promise<PcmCapture> {
  const streamRequest = navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const stream = await streamRequest;
  let context: AudioContext | null = null;
  try {
    context = new AudioContext({ sampleRate: 16_000 });
    void context.resume().catch(() => undefined);
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain();
    const chunks: Float32Array[] = [];
    let stopped = false;
    mute.gain.value = 0;
    processor.onaudioprocess = (event) => {
      const samples = event.inputBuffer.getChannelData(0);
      chunks.push(resample(samples, context?.sampleRate ?? 16_000, 16_000));
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    const cleanup = async () => {
      if (stopped) return;
      stopped = true;
      processor.onaudioprocess = null;
      source.disconnect();
      processor.disconnect();
      mute.disconnect();
      for (const track of stream.getTracks()) track.stop();
      if (context?.state !== 'closed') await context?.close();
    };
    return {
      stop: async () => {
        await cleanup();
        return joinPcmChunks(chunks);
      },
      cancel: async () => {
        chunks.length = 0;
        await cleanup();
      },
    };
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    if (context && context.state !== 'closed') await context.close();
    throw error;
  }
}
