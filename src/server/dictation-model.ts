import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MODEL_PREFIX, WHISPER_MODEL, WHISPER_REVISION } from '../shared/dictation.js';
import { cacheDir } from './paths.js';

const files = new Set([
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'added_tokens.json',
  'vocab.json',
  'merges.txt',
  'normalizer.json',
  ...['encoder_model', 'decoder_model_merged'].flatMap((name) =>
    ['fp16', 'quantized'].map((dtype) => `onnx/${name}_${dtype}.onnx`),
  ),
]);

export function modelFile(rawUrl: string): string | null {
  if (rawUrl.includes('?') || rawUrl.includes('%') || rawUrl.includes('\\')) return null;
  const prefix = `${MODEL_PREFIX}${WHISPER_MODEL}/${WHISPER_REVISION}/`;
  if (!rawUrl.startsWith(prefix)) return null;
  const file = rawUrl.slice(prefix.length);
  return files.has(file) ? file : null;
}

export class DictationModels {
  private pending = new Map<string, Promise<void>>();

  constructor(
    private root = path.join(cacheDir(), 'models', WHISPER_MODEL, WHISPER_REVISION),
    private upstream: typeof fetch = fetch,
    private log: (message: string) => void = () => {},
  ) {}

  private async download(file: string, target: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      this.log(`dictation model upstream: ${file}`);
      const response = await this.upstream(
        `https://huggingface.co/${WHISPER_MODEL}/resolve/${WHISPER_REVISION}/${file}`,
        { signal: AbortSignal.timeout(300_000), headers: { 'Accept-Encoding': 'identity' } },
      );
      if (!response.ok || !response.body) throw new Error('Model download failed');
      await pipeline(
        Readable.fromWeb(response.body),
        fs.createWriteStream(tmp, { flags: 'wx', mode: 0o600 }),
      );
      const size = (await fs.promises.stat(tmp)).size;
      const expected = response.headers.get('content-length');
      if (!size || (expected && size !== Number(expected))) throw new Error('Incomplete model');
      await fs.promises.rename(tmp, target);
    } finally {
      await fs.promises.rm(tmp, { force: true });
    }
  }

  async serve(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const file = modelFile(req.url ?? '');
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    const target = path.join(this.root, file);
    try {
      if (!fs.existsSync(target)) {
        let pending = this.pending.get(file);
        if (!pending) {
          pending = this.download(file, target).finally(() => this.pending.delete(file));
          this.pending.set(file, pending);
        }
        await pending;
      } else this.log(`dictation model disk: ${file}`);
      if (res.destroyed) return;
      res.writeHead(200, {
        'Content-Type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        'Content-Length': (await fs.promises.stat(target)).size,
        // Pairing is checked even on disk hits; browser Cache Storage is managed explicitly.
        'Cache-Control': 'private, no-store',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      await pipeline(fs.createReadStream(target), res);
    } catch {
      if (!res.headersSent) res.writeHead(502).end();
      else res.destroy();
    }
  }
}
