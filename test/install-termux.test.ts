import { spawnSync } from 'node:child_process';
import {
  existsSync,
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

const installer = path.join(import.meta.dirname, '..', 'install-termux.sh');
const script = readFileSync(installer, 'utf8');
const temporaryDirs: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(options: { legacy?: boolean; existing?: boolean; missingDevin?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pocket-installer-')));
  temporaryDirs.push(root);
  const prefix = path.join(root, 'termux');
  const home = path.join(root, 'host-home');
  const guestHome = path.join(root, 'guest-home');
  const hostBin = path.join(prefix, 'bin');
  const guestBin = path.join(guestHome, '.local', 'bin');
  const log = path.join(root, 'commands.log');
  for (const dir of [hostBin, home, guestBin]) mkdirSync(dir, { recursive: true });
  writeFileSync(log, '');
  const executable = (dir: string, name: string, contents: string) =>
    writeFileSync(path.join(dir, name), `#!/bin/bash\nset -euo pipefail\n${contents}\n`, {
      mode: 0o755,
    });
  const record = `printf '%s|' "$(basename "$0")" "$@" >> "$MOCK_ROOT/commands.log"; printf '\\n' >> "$MOCK_ROOT/commands.log"`;
  executable(hostBin, 'id', 'printf "10000\\n"');
  executable(hostBin, 'uname', `printf "%s\\n" "\${MOCK_ARCH:-aarch64}"`);
  executable(hostBin, 'pkg', `${record}\n[[ "\${MOCK_PKG_FAIL:-0}" != 1 ]]`);
  executable(
    hostBin,
    'proot-distro',
    `${record}
if [[ "$1" == install && "\${2:-}" == --help ]]; then
  printf '%s\\n' '${options.legacy ? '--override-alias ALIAS DISTRO' : '--name NAME IMAGE'}'
  exit
fi
if [[ "$1" == install ]]; then
  mkdir -p "$PREFIX/var/lib/proot-distro/containers/$3/rootfs"
  exit
fi
if [[ "\${MOCK_LOG_ONLY:-0}" == 1 ]]; then exit; fi
while [[ "$1" != -- ]]; do shift; done
shift
shift 3
cat > "$MOCK_ROOT/guest-input.sh"
sed -e 's@  \\. /etc/os-release@  ID=ubuntu@' -e 's@  \\[\\[ -r /etc/os-release \\]\\].*@  :@' "$MOCK_ROOT/guest-input.sh" > "$MOCK_ROOT/guest-script.sh"
export HOME="$MOCK_GUEST_HOME"
export PATH="$HOME/.local/bin:/usr/bin:/bin"
exec /bin/bash "$MOCK_ROOT/guest-script.sh" "$@"`,
  );
  executable(guestBin, 'id', 'printf "0\\n"');
  executable(
    guestBin,
    'apt-get',
    `${record}\nif [[ "$*" == *nodejs* ]]; then
  [[ "\${MOCK_NODE_INSTALL_FAIL:-0}" != 1 ]] || exit 1
  if [[ "\${MOCK_NODE_INSTALL_FAIL:-0}" != unchanged ]]; then cp "$MOCK_ROOT/node-target" "$MOCK_ROOT/node-installed"; fi
fi`,
  );
  executable(
    guestBin,
    'node',
    `if [[ "\${1:-}" == -p && "\${2:-}" == process.versions.node* ]]; then
  if [[ -f "$MOCK_ROOT/node-installed" ]]; then cat "$MOCK_ROOT/node-installed"
  elif [[ "\${MOCK_NODE_MAJOR:-24}" == missing ]]; then exit 127
  else printf '%s\\n' "\${MOCK_NODE_MAJOR:-24}"; fi
else exec '${process.execPath}' "$@"; fi`,
  );
  if (!options.missingDevin) executable(guestBin, 'devin', `${record}\nprintf 'devin mock\\n'`);
  executable(
    guestBin,
    'curl',
    `${record}
[[ "\${MOCK_CURL_FAIL:-0}" != 1 ]] || exit 1
url=''; output=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    https://*) url=$1; shift ;;
    -o) output=$2; shift 2 ;;
    *) shift ;;
  esac
done
case "$url" in
  */tarball/*) cp "$MOCK_ROOT/source.tar.gz" "$output" ;;
  */setup_24.x|*/setup_26.x)
    [[ "\${MOCK_NODE_SETUP_FAIL:-}" != download ]] || exit 1
    target=\${url##*setup_}; printf '%s\\n' "\${target%.x}" > "$MOCK_ROOT/node-target"
    if [[ "\${MOCK_NODE_SETUP_FAIL:-}" == script ]]; then printf 'exit 1\\n' > "$output"
    else printf 'true\\n' > "$output"; fi ;;
  https://cli.devin.ai/install.sh)
    printf '#!/bin/bash\\nprintf "#!/bin/bash\\\\nprintf devin-mock\\\\n" > "$HOME/.local/bin/devin"\\nchmod +x "$HOME/.local/bin/devin"\\n' > "$output" ;;
  *) printf 'mock package' > "$output" ;;
esac`,
  );
  executable(
    guestBin,
    'npm',
    `${record}
if [[ "$1" == view ]]; then
  case "\${MOCK_NPM:-ok}" in
    missing) printf 'npm error code E404\\n' >&2; exit 1 ;;
    network) printf 'npm error code ECONNREFUSED\\n' >&2; exit 1 ;;
    *) cat "$MOCK_ROOT/npm-time.json" ;;
  esac
else
  printf '#!/bin/bash\\nprintf "devin-pocket mock\\\\n"\\n' > "$HOME/.local/bin/devin-pocket"
  chmod +x "$HOME/.local/bin/devin-pocket"
fi`,
  );
  executable(
    guestBin,
    'pnpm',
    `${record}
if [[ "$1" == pack ]]; then printf 'mock package' > "$3/devin-pocket-0.1.5.tgz"; fi`,
  );
  writeFileSync(
    path.join(root, 'npm-time.json'),
    JSON.stringify({
      created: '2019-01-01T00:00:00Z',
      '0.1.4': '2020-01-01T00:00:00Z',
      '0.1.5': '2020-02-01T00:00:00Z',
      '0.1.6-beta.1': '2020-03-01T00:00:00Z',
      '9.0.0': '2099-01-01T00:00:00Z',
    }),
  );
  const source = path.join(root, 'archive', 'pocket');
  mkdirSync(source, { recursive: true });
  writeFileSync(
    path.join(source, 'package.json'),
    JSON.stringify({ packageManager: 'pnpm@12.6.0' }),
  );
  writeFileSync(path.join(source, 'pnpm-lock.yaml'), 'fixture');
  const archive = spawnSync('tar', [
    '-czf',
    path.join(root, 'source.tar.gz'),
    '-C',
    path.dirname(source),
    'pocket',
  ]);
  expect(archive.status).toBe(0);
  if (options.existing) {
    const relative = options.legacy ? 'installed-rootfs/ubuntu' : 'containers/ubuntu/rootfs';
    mkdirSync(path.join(prefix, 'var', 'lib', 'proot-distro', relative), { recursive: true });
  }
  const env = {
    ...process.env,
    HOME: home,
    PREFIX: prefix,
    TERMUX__PREFIX: prefix,
    TERMUX_VERSION: 'mock',
    PATH: `${hostBin}:/usr/bin:/bin`,
    XDG_STATE_HOME: path.join(guestHome, 'state'),
    MOCK_ROOT: root,
    MOCK_GUEST_HOME: guestHome,
  };
  return {
    root,
    prefix,
    home,
    guestHome,
    env,
    commands: () => readFileSync(log, 'utf8'),
    run: (args: string[] = [], extraEnv: Record<string, string> = {}) =>
      spawnSync('/bin/bash', ['-s', '--', ...args], {
        input: script,
        encoding: 'utf8',
        env: { ...env, ...extraEnv },
        timeout: 20_000,
      }),
  };
}

// Exercises Termux's POSIX shell/package manager, not the Windows installer.
describe.skipIf(process.platform === 'win32')('Termux bootstrap installer', () => {
  it('has valid shell syntax and help works outside Termux', () => {
    expect(spawnSync('bash', ['-n', installer]).status).toBe(0);
    const f = fixture();
    const result = f.run(['--help'], { TERMUX_VERSION: '', TERMUX_APP__APP_VERSION_NAME: '' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--source REF');
    expect(f.commands()).toBe('');
  });

  it('rejects non-Termux environments before making changes', () => {
    const f = fixture();
    const result = f.run([], { TERMUX_VERSION: '', TERMUX_APP__APP_VERSION_NAME: '' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Ejecuta este script en Termux');
    expect(f.commands()).toBe('');
  });

  it.each([
    ['--unknown'],
    ['--source'],
    ['--source', 'main', '--package', 'devin-pocket@0.1.5'],
    ['--distro', '../ubuntu'],
    ['--package', 'devin-pocket@latest'],
    ['--package', '/missing/package.tgz'],
    ['--package', 'http://example.com/pocket.tgz'],
  ])('rejects invalid arguments: %s', (...args) => {
    const f = fixture();
    expect(f.run(args).status).not.toBe(0);
    expect(f.commands()).toBe('');
  });

  it('rejects 32-bit devices before making changes', () => {
    const f = fixture();
    expect(f.run([], { MOCK_ARCH: 'armv7l' }).status).not.toBe(0);
    expect(f.commands()).toBe('');
  });

  it('installs modern Ubuntu and selects a mature stable npm version, without starting the app', () => {
    const f = fixture();
    const result = f.run();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const commands = f.commands();
    expect(commands).toContain('pkg|upgrade|-y|');
    expect(commands).toContain('proot-distro|install|--override-alias|ubuntu|ubuntu:24.04|');
    expect(commands).toContain('apt-get|upgrade|-y|');
    expect(commands).toContain('npm|install|-g|devin-pocket@0.1.5|');
    expect(commands).not.toContain('devin-pocket|start');
    expect(commands).not.toContain('auth|login');
    expect(existsSync(path.join(f.prefix, 'bin', 'devin-pocket-ubuntu'))).toBe(true);
    expect(readFileSync(path.join(f.prefix, 'bin', 'devin-pocket'), 'utf8')).toBe(
      readFileSync(path.join(f.prefix, 'bin', 'devin-pocket-ubuntu'), 'utf8'),
    );
    expect(existsSync(path.join(f.home, '.shortcuts', 'Devin Pocket'))).toBe(true);
    expect(result.stdout).toContain('No se inicia ni se reinicia');
  });

  it('supports legacy proot-distro install syntax', () => {
    const f = fixture({ legacy: true });
    expect(f.run(['--package', 'devin-pocket@0.1.5']).status).toBe(0);
    expect(f.commands()).toContain('proot-distro|install|--override-alias|ubuntu|ubuntu|');
    expect(f.commands()).not.toContain('ubuntu:24.04');
  });

  it.each([
    [],
    ['update', '--check'],
    ['doctor'],
    ['logs', '-n', '10'],
    ['start', '--cwd', '/a folder'],
  ])('forwards host command arguments into a custom distro: %j', (...args) => {
    const f = fixture();
    expect(f.run(['--distro', 'my-ubuntu', '--package', 'devin-pocket@0.1.5']).status).toBe(0);
    for (const name of ['devin-pocket', 'devin-pocket-ubuntu']) {
      const before = f.commands().length;
      const result = spawnSync('/bin/bash', [path.join(f.prefix, 'bin', name), ...args], {
        env: { ...f.env, MOCK_LOG_ONLY: '1' },
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      const commands = f.commands().slice(before);
      expect(commands).toContain('proot-distro|login|my-ubuntu|--|/bin/bash|-lc|');
      expect(commands).toContain(`devin-pocket|${args.length ? `${args.join('|')}|` : ''}\n`);
    }
  });

  it.each(['file', 'symlink', 'dangling symlink', 'directory'])(
    'preserves an unrelated host command (%s) and explains the fallback',
    (kind) => {
      const f = fixture();
      const command = path.join(f.prefix, 'bin', 'devin-pocket');
      const original = '#!/bin/bash\n# not our wrapper\nprintf custom\n';
      const target = path.join(f.root, 'other-command');
      if (kind === 'file') writeFileSync(command, original);
      else if (kind === 'directory') mkdirSync(command);
      else {
        if (kind === 'symlink') writeFileSync(target, original);
        symlinkSync(target, command);
      }
      const result = f.run(['--package', 'devin-pocket@0.1.5']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('no es uno de nuestros lanzadores');
      expect(result.stdout).toContain('devin-pocket-ubuntu sigue funcionando');
      expect(result.stdout).toContain('Para abrir la app desde Termux: devin-pocket-ubuntu');
      if (kind === 'file' || kind === 'symlink') {
        expect(readFileSync(command, 'utf8')).toBe(original);
      }
      expect(existsSync(path.join(f.prefix, 'bin', 'devin-pocket-ubuntu'))).toBe(true);
    },
  );

  it('recognizes its marked command and preserves existing wrappers and widget on rerun', () => {
    const f = fixture();
    expect(f.run(['--package', 'devin-pocket@0.1.5']).status).toBe(0);
    const command = path.join(f.prefix, 'bin', 'devin-pocket');
    const original = readFileSync(command, 'utf8');
    expect(original.split('\n')).toContain('# devin-pocket Termux/proot launcher');
    const widget = path.join(f.home, '.shortcuts', 'Devin Pocket');
    writeFileSync(widget, 'custom widget');
    const result = f.run(['--package', 'devin-pocket@0.1.5']);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('no es uno de nuestros lanzadores');
    expect(result.stdout).toContain('Para abrir la app desde Termux: devin-pocket\n');
    expect(readFileSync(command, 'utf8')).toBe(original);
    expect(readFileSync(widget, 'utf8')).toBe('custom widget');
  });

  it.each([true, false])('reuses existing Ubuntu (legacy=%s) and preserves launchers', (legacy) => {
    const f = fixture({ existing: true, legacy });
    const launcher = path.join(f.prefix, 'bin', 'devin-pocket-ubuntu');
    writeFileSync(launcher, 'user launcher');
    expect(f.run(['--no-upgrade', '--package', 'devin-pocket@0.1.5']).status).toBe(0);
    expect(f.commands()).not.toContain('proot-distro|install|');
    expect(f.commands()).not.toContain('|upgrade|');
    expect(readFileSync(launcher, 'utf8')).toBe('user launcher');
  });

  it('builds a source archive with frozen dependencies and npm, without git clone', () => {
    const f = fixture();
    const result = f.run(['--source', 'devin/branch with spaces']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(f.commands()).toContain('/tarball/devin%2Fbranch%20with%20spaces|');
    expect(f.commands()).toContain('npm|install|-g|pnpm@12.6.0|');
    expect(f.commands()).toContain('pnpm|install|--frozen-lockfile|');
    expect(f.commands()).toContain('pnpm|pack|--pack-destination|');
    expect(f.commands()).toMatch(/npm\|install\|-g\|[^\n]+devin-pocket-0\.1\.5\.tgz\|/);
    expect(f.commands()).not.toContain('git|clone');
  });

  it('falls back to main only when the npm package does not exist', () => {
    const f = fixture();
    expect(f.run([], { MOCK_NPM: 'missing' }).status).toBe(0);
    expect(f.commands()).toContain('/tarball/main|');
  });

  it('explains inaccessible source downloads instead of continuing with a partial archive', () => {
    const f = fixture();
    const result = f.run(['--source', 'main'], { MOCK_CURL_FAIL: '1' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--source requiere un repo público');
    expect(f.commands()).not.toContain('npm|install|');
    expect(existsSync(path.join(f.prefix, 'bin', 'devin-pocket-ubuntu'))).toBe(false);
  });

  it('does not mask npm connection errors as an unpublished package', () => {
    const f = fixture();
    const result = f.run([], { MOCK_NPM: 'network' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('No se pudo consultar npm');
    expect(f.commands()).not.toContain('/tarball/');
  });

  it('binds a local tarball with spaces and forwards launcher arguments without splitting them', () => {
    const f = fixture();
    const file = path.join(f.root, 'pocket package.tgz');
    writeFileSync(file, 'fixture');
    expect(f.run(['--package', file, '--distro', 'pocket-ubuntu']).status).toBe(0);
    expect(f.commands()).toContain(`--bind|${file}:/tmp/devin-pocket-package.tgz|`);
    expect(f.commands()).toContain('npm|install|-g|/tmp/devin-pocket-package.tgz|');
    const launcher = spawnSync(
      '/bin/bash',
      [path.join(f.prefix, 'bin', 'devin-pocket-ubuntu'), 'logs', '-n', '10'],
      {
        env: { ...f.env, MOCK_LOG_ONLY: '1' },
        encoding: 'utf8',
      },
    );
    expect(launcher.status).toBe(0);
    expect(f.commands()).toContain('proot-distro|login|pocket-ubuntu|');
    expect(f.commands()).toContain('devin-pocket|logs|-n|10|');
  });

  it('stops before touching Ubuntu packages if Pocket is running', () => {
    const f = fixture({ existing: true });
    const state = path.join(f.guestHome, 'state', 'devin-pocket');
    mkdirSync(state, { recursive: true });
    writeFileSync(path.join(state, 'server.pid'), String(process.pid));
    const result = f.run(['--package', 'devin-pocket@0.1.5']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Devin Pocket está corriendo');
    expect(f.commands()).not.toContain('apt-get|');
  });

  it('installs Devin only when missing, downloading its entire installer before execution', () => {
    const f = fixture({ missingDevin: true });
    const result = f.run(['--package', 'devin-pocket@0.1.5']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(f.commands()).toContain('https://cli.devin.ai/install.sh|-o|');
  });

  it.each([
    ['missing', 26],
    ['20', 24],
    ['22', 24],
    ['23', 24],
    ['24', 0],
    ['26', 0],
    ['28', 0],
  ])('selects Node for existing major %s (target %s)', (major, target) => {
    const f = fixture();
    const result = f.run(['--package', 'devin-pocket@0.1.5'], { MOCK_NODE_MAJOR: String(major) });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    if (target) {
      expect(f.commands()).toContain(`https://deb.nodesource.com/setup_${target}.x|-o|`);
      expect(f.commands()).toContain('apt-get|install|-y|nodejs|');
    } else {
      expect(f.commands()).not.toContain('deb.nodesource.com');
      expect(f.commands()).not.toContain('apt-get|install|-y|nodejs|');
    }
  });

  it.each(['download', 'script', 'install', 'unchanged'])(
    'warns and continues after a NodeSource %s failure on supported Node',
    (stage) => {
      for (const major of ['22', '23']) {
        const f = fixture();
        const result = f.run(['--package', 'devin-pocket@0.1.5'], {
          MOCK_NODE_MAJOR: major,
          MOCK_NODE_INSTALL_FAIL:
            stage === 'install' ? '1' : stage === 'unchanged' ? 'unchanged' : '0',
          MOCK_NODE_SETUP_FAIL: stage,
        });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr).toContain('Aviso: se continúa con Node.js 22/23 compatible');
        expect(result.stderr).toContain('Warning:');
        expect(result.stderr).toContain('https://deb.nodesource.com/setup_24.x');
        expect(f.commands()).toContain('npm|install|-g|devin-pocket@0.1.5|');
        if (stage === 'download' || stage === 'script')
          expect(f.commands()).not.toContain('apt-get|install|-y|nodejs|');
      }
    },
  );
  it.each(['missing', '20', '21'])(
    'rejects unsupported Node %s after a failed installation',
    (major) => {
      const f = fixture();
      const result = f.run(['--package', 'devin-pocket@0.1.5'], {
        MOCK_NODE_MAJOR: major,
        MOCK_NODE_INSTALL_FAIL: '1',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Node.js 22 or later is required');
      expect(f.commands()).not.toContain('npm|install|');
    },
  );

  it('downloads an HTTPS tarball before installing it with npm', () => {
    const f = fixture();
    const result = f.run(['--package', 'https://example.com/pocket.tgz']);
    expect(result.status).toBe(0);
    expect(f.commands()).toContain('https://example.com/pocket.tgz|-o|');
    expect(f.commands()).toMatch(/npm\|install\|-g\|[^\n]+devin-pocket\.tgz\|/);
  });

  it('rejects auto-install when all stable npm versions are too new', () => {
    const f = fixture();
    writeFileSync(path.join(f.root, 'npm-time.json'), JSON.stringify({ '0.1.5': '2099-01-01' }));
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Todavía no hay una versión npm estable con 7 días');
    expect(f.commands()).not.toContain('npm|install|');
  });

  it('aborts without creating launchers when host package installation fails', () => {
    const f = fixture();
    expect(f.run([], { MOCK_PKG_FAIL: '1' }).status).not.toBe(0);
    expect(f.commands()).not.toContain('proot-distro|');
    expect(existsSync(path.join(f.prefix, 'bin', 'devin-pocket-ubuntu'))).toBe(false);
  });
});
