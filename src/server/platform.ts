import { execFileSync } from 'node:child_process';

export function openUrlCommand(
  platform: NodeJS.Platform,
  url: string,
  termux = false,
): [string, string[]] {
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  if (termux) return ['termux-open-url', [url]];
  return [platform === 'darwin' ? 'open' : 'xdg-open', [url]];
}

export function stopDaemon(
  pid: number,
  platform = process.platform,
  run: (command: string, args: string[]) => void = (command, args) => {
    execFileSync(command, args, { windowsHide: true, stdio: 'ignore' });
  },
  kill: (pid: number, signal: NodeJS.Signals) => void = process.kill,
): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid daemon pid');
  if (platform === 'win32') run('taskkill', ['/pid', String(pid), '/T', '/F']);
  else kill(pid, 'SIGTERM');
}
