import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://127.0.0.1:7789',
    trace: 'retain-on-failure',
  },
  webServer: {
    env: { DEVIN_POCKET_NO_UPDATE_CHECK: '1' },
    command:
      'DEVIN_POCKET_AGENT="npx tsx test/fake-agent.ts" FAKE_AGENT_AUTHED=1 FAKE_AGENT_REPLAY_ITEMS=80 XDG_STATE_HOME=/tmp/devin-pocket-e2e-state node bin/devin-pocket.mjs start --foreground --no-open --port 7789',
    url: 'http://127.0.0.1:7789/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
