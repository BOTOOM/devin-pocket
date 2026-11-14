import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { startSession } from './session-helpers';

let child: ChildProcess;
let base: string;
test.beforeAll(async () => {
  fs.mkdirSync('test-results/dictation-server', { recursive: true });
  const state = fs.mkdtempSync(path.resolve('test-results/dictation-server/host-'));
  const out = fs.openSync(path.join(state, 'server.log'), 'a');
  child = spawn(
    process.execPath,
    ['bin/devin-pocket.mjs', 'start', '--port', '0', '--foreground', '--no-open'],
    {
      env: {
        ...process.env,
        XDG_STATE_HOME: state,
        XDG_CONFIG_HOME: state,
        XDG_CACHE_HOME: state,
        DEVIN_POCKET_NO_UPDATE_CHECK: '1',
        DEVIN_POCKET_AGENT: `"${process.execPath}" --import tsx test/fake-agent.ts`,
        FAKE_AGENT_AUTHED: '1',
        FAKE_AGENT_FAST: '1',
      },
      stdio: ['ignore', out, out],
    },
  );
  fs.closeSync(out);
  const info = path.join(state, 'devin-pocket', 'server.json');
  await expect.poll(() => fs.existsSync(info)).toBe(true);
  base = `http://127.0.0.1:${JSON.parse(fs.readFileSync(info, 'utf8')).port}`;
});
test.afterAll(async () => {
  if (child && child.exitCode === null) {
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    await stopped;
  }
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dp.lang', 'en');
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      value: undefined,
      configurable: true,
    });
    class StubWorker {
      constructor() {
        Reflect.set(
          window,
          '__dictationWorkers',
          (Reflect.get(window, '__dictationWorkers') ?? 0) + 1,
        );
      }
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror = null;
      stopped = false;
      postMessage(message: { type: string; id: number; language?: string }) {
        if (message.type === 'prepare') {
          this.onmessage?.({ data: { type: 'progress', id: message.id, value: 42 } });
          setTimeout(() => {
            if (!this.stopped) this.onmessage?.({ data: { type: 'ready', id: message.id } });
          }, 100);
        } else {
          if (localStorage.getItem('test.dictation.batch')) {
            for (const text of ['First fragment', 'second fragment'])
              this.onmessage?.({ data: { type: 'result', id: message.id, text } });
            return;
          }
          this.onmessage?.({
            data: {
              type: 'result',
              id: message.id,
              text: message.language === 'spanish' ? 'Buenos días' : 'Good morning',
            },
          });
        }
      }
      terminate() {
        this.stopped = true;
      }
    }
    Object.defineProperty(window, 'Worker', { value: StubWorker, configurable: true });
    navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    const RealContext = window.AudioContext;
    class StubContext extends RealContext {
      createMediaStreamSource() {
        return this.createGain() as unknown as MediaStreamAudioSourceNode;
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: StubContext });
  });
});

test('back-to-back transcript callbacks preserve both fragments and the caret', async ({
  page,
}) => {
  await page.goto(`${base}/#/`);
  await startSession(page);
  await page.evaluate(() => localStorage.setItem('test.dictation.batch', 'true'));
  const input = page.locator('textarea');
  await input.fill('Hello world');
  await input.evaluate((el) => el.setSelectionRange(5, 5));
  await page.getByRole('button', { name: 'Dictate by voice', exact: true }).click();
  await page.getByRole('button', { name: 'Download model', exact: true }).click();
  await page.getByRole('button', { name: 'Stop dictation', exact: true }).click();
  await expect(input).toHaveValue('Hello First fragment second fragment world');
});

test('mic shares the action row; consent, transcript insertion, reload and deletion', async ({
  page,
}) => {
  await page.goto(`${base}/#/`);
  await startSession(page);
  const input = page.locator('textarea').first();
  const mic = page.getByRole('button', { name: 'Dictate by voice', exact: true });
  const attach = page.getByRole('button', { name: 'Attach image' });
  expect((await mic.boundingBox())?.y).toBe((await attach.boundingBox())?.y);
  await input.fill('Hello world');
  await input.evaluate((el) => el.setSelectionRange(5, 5));
  await mic.click();
  await expect(page.getByRole('dialog')).toContainText('80–160 MB');
  await page.getByRole('button', { name: 'Download model', exact: true }).click();
  await page.getByRole('button', { name: 'Stop dictation', exact: true }).click();
  await expect(input).toHaveValue('Hello Good morning world');
  await expect(
    page.locator('div.bg-primary').filter({ hasText: 'Hello Good morning world' }),
  ).toHaveCount(0);
  await input.fill('');
  await mic.click();
  await page.getByRole('button', { name: 'Stop dictation', exact: true }).click();
  await expect(input).toHaveValue('Good morning');
  expect(await page.evaluate(() => Reflect.get(window, '__dictationWorkers'))).toBe(1);
  await page.reload();
  await expect(input).toBeVisible();
  await mic.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop dictation', exact: true }).click();
  await expect(input).toHaveValue('Good morning');
  await page.goto(`${base}/#/settings`);
  await page.getByLabel('Dictation language').selectOption('es');
  await expect(
    page.getByText('Whisper model downloaded in this browser.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete downloaded model' }).click();
  await expect(
    page.getByText('Whisper model not yet downloaded in this browser.', { exact: true }),
  ).toBeVisible();
});

test('cancel prevents a late worker from starting capture', async ({ page }) => {
  await page.goto(`${base}/#/`);
  await startSession(page);
  await page.getByRole('button', { name: 'Dictate by voice', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('textarea')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Dictate by voice', exact: true })).toBeVisible();
});

test('insecure LAN context keeps mic visible and explains keyboard dictation', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'isSecureContext', { value: false }),
  );
  await page.goto(`${base}/#/`);
  await startSession(page);
  await page.getByRole('button', { name: 'Dictate by voice', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Gboard/iOS');
  await expect(page.getByRole('dialog')).toContainText('Pairing does not add HTTPS');
});

for (const outcome of ['stop', 'cancel', 'empty', 'error', 'end'] as const) {
  test(`native speech buffers finals and handles ${outcome}`, async ({ page }) => {
    await page.addInitScript(() => {
      class LocalSpeech {
        static available = async () => 'available';
        static install = async () => true;
        processLocally = false;
        continuous = false;
        interimResults = false;
        lang = '';
        onresult: ((event: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        onerror: ((event: { error: string }) => void) | null = null;
        start() {
          Reflect.set(window, '__speech', this);
        }
        stop() {
          this.onresult?.({
            resultIndex: 0,
            results: [{ isFinal: true, 0: { transcript: 'last fragment' } }],
          });
          this.onend?.();
        }
        abort() {
          this.onend?.();
        }
      }
      Object.defineProperty(window, 'SpeechRecognition', { value: LocalSpeech });
    });
    await page.goto(`${base}/#/`);
    await startSession(page);
    const input = page.locator('textarea');
    await input.fill('Draft');
    await page.getByRole('button', { name: 'Dictate by voice', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
    await page.evaluate((empty) => {
      Reflect.get(window, '__speech').onresult({
        resultIndex: 0,
        results: empty
          ? []
          : [
              { isFinal: true, 0: { transcript: 'First fragment' } },
              { isFinal: true, 0: { transcript: 'second fragment' } },
              { isFinal: false, 0: { transcript: 'unfinished' } },
            ],
      });
    }, outcome === 'empty');
    await expect(input).toHaveValue('Draft');
    if (outcome === 'error' || outcome === 'end') {
      await page.evaluate((error) => {
        const speech = Reflect.get(window, '__speech');
        if (error) speech.onerror({ error: 'network' });
        else speech.onend();
      }, outcome === 'error');
    } else if (outcome === 'cancel') {
      await page.getByRole('button', { name: 'Cancel dictation', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Stop dictation', exact: true }).click();
    }
    await expect(input).toHaveValue(
      outcome === 'stop'
        ? 'Draft First fragment second fragment last fragment'
        : outcome === 'empty'
          ? 'Draft last fragment'
          : 'Draft',
    );
  });
}
