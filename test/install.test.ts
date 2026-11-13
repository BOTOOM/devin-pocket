import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const installer = path.join(import.meta.dirname, '..', 'install.sh');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(major?: number, platform = 'Linux', npm = true) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pocket-node-installer-')));
  dirs.push(root);
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const log = path.join(root, 'commands.log');
  writeFileSync(log, '');
  const record = `printf '%s|' "\${0##*/}" "$@" >> "$MOCK_ROOT/commands.log"; printf '\\n' >> "$MOCK_ROOT/commands.log"`;
  function executable(name: string, body: string) {
    writeFileSync(path.join(bin, name), `#!/bin/bash\nset -euo pipefail\n${body}\n`, {
      mode: 0o755,
    });
  }
  const node = '#!/bin/bash\nprintf "%s\\n" "$(< "$MOCK_ROOT/node-major")"\n';
  writeFileSync(path.join(root, 'node-template'), node, { mode: 0o755 });
  if (major !== undefined) {
    writeFileSync(path.join(root, 'node-major'), String(major));
    executable('node', node);
  }
  executable('id', 'printf "0\\n"');
  executable('uname', `printf '${platform}\\n'`);
  executable('devin', ':');
  executable('termux-wake-lock', ':');
  if (npm) executable('npm', record);
  symlinkSync('/bin/bash', path.join(bin, 'bash'));
  symlinkSync('/usr/bin/sed', path.join(bin, 'sed'));
  executable(
    'curl',
    `${record}
target=\${2##*setup_}; target=\${target%.x}
printf 'printf "%s" > "$MOCK_ROOT/node-target"\\n' "$target"`,
  );
  executable(
    'apt-get',
    `${record}
if [[ "$*" == *nodejs* ]]; then
  [[ "\${MOCK_INSTALL_FAIL:-0}" != 1 ]] || exit 1
  printf '%s' "$(< "$MOCK_ROOT/node-target")" > "$MOCK_ROOT/node-major"
  /bin/cp "$MOCK_ROOT/node-template" "$MOCK_ROOT/bin/node"
fi`,
  );
  if (platform === 'Darwin')
    executable(
      'brew',
      `${record}
case "$1" in
  info)
    [[ "$3" != node@26 ]] || exit 1
    if [[ "$3" == node ]]; then printf 'node: stable %s.13.1 (bottled), HEAD\\n' "\${MOCK_BREW_MAJOR:-26}"; fi ;;
  install)
    target=26; if [[ "$2" == node@24 ]]; then target=24; fi
    printf '%s' "$target" > "$MOCK_ROOT/node-major"
    /bin/mkdir -p "$MOCK_ROOT/brew-prefix/bin"
    /bin/cp "$MOCK_ROOT/node-template" "$MOCK_ROOT/brew-prefix/bin/node" ;;
  --prefix) printf '%s\\n' "$MOCK_ROOT/brew-prefix" ;;
esac`,
    );
  if (platform === 'Termux')
    executable(
      'pkg',
      `${record}
printf '%s' "\${MOCK_PKG_MAJOR:-26}" > "$MOCK_ROOT/node-major"
/bin/cp "$MOCK_ROOT/node-template" "$MOCK_ROOT/bin/node"`,
    );
  return {
    commands: () => readFileSync(log, 'utf8'),
    run: (extra: Record<string, string> = {}) =>
      spawnSync('/bin/bash', [installer], {
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: root,
          PATH: bin,
          TERMUX_VERSION: platform === 'Termux' ? 'mock' : '',
          DEVIN_POCKET_LOCAL: '0',
          MOCK_ROOT: root,
          ...extra,
        },
      }),
  };
}

describe.skipIf(process.platform === 'win32')('Node selection in the general installer', () => {
  it.each([
    [undefined, 26],
    [20, 24],
    [22, 24],
    [23, 24],
    [24, 0],
    [26, 0],
    [28, 0],
  ])('Linux major %s selects %s', (major, target) => {
    const f = fixture(major);
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    if (target) {
      expect(f.commands()).toContain(`curl|-fsSL|https://deb.nodesource.com/setup_${target}.x|`);
      expect(f.commands()).toContain('apt-get|install|-y|nodejs|');
    } else {
      expect(f.commands()).not.toContain('apt-get|');
      expect(f.commands()).not.toContain('curl|');
    }
    expect(f.commands()).toContain('npm|install|-g|devin-pocket@latest|');
  });
  it.each([
    [undefined, 'node'],
    [22, 'node@24'],
    [24, ''],
    [26, ''],
  ])('macOS major %s selects %s', (major, formula) => {
    const f = fixture(major, 'Darwin');
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    if (formula) {
      expect(f.commands()).toContain(`brew|install|${formula}|`);
      expect(result.stdout).toContain('Add to PATH / Añade al PATH:');
    } else expect(f.commands()).not.toContain('brew|');
  });
  it('does not silently install a future unversioned Homebrew major instead of 26', () => {
    const f = fixture(undefined, 'Darwin');
    const result = f.run({ MOCK_BREW_MAJOR: '28' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Install Node.js 26 manually');
    expect(f.commands()).not.toContain('brew|install|');
  });
  it.each([undefined, 22, 24, 26])('Termux host major %s uses pkg only when needed', (major) => {
    const f = fixture(major, 'Termux');
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    if (major === undefined || major < 24)
      expect(f.commands()).toContain('pkg|install|-y|nodejs-lts|');
    else expect(f.commands()).not.toContain('pkg|');
  });
  it('aborts on NodeSource installation failure before installing Pocket', () => {
    const f = fixture(22);
    expect(f.run({ MOCK_INSTALL_FAIL: '1' }).status).not.toBe(0);
    expect(f.commands()).not.toContain('npm|');
  });
  it('does not replace a supported Node installation when npm is missing', () => {
    const f = fixture(26, 'Linux', false);
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('npm is required');
    expect(f.commands()).not.toContain('apt-get|');
  });
});
