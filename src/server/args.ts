export interface Args {
  cmd: string;
  port?: number;
  host?: string;
  cwd?: string;
  agent?: string;
  open: boolean;
  dev: boolean;
  foreground: boolean;
  follow: boolean;
  lines: number;
  check?: boolean;
  version?: string;
  yes?: boolean;
  qr?: 'ascii';
  revoke?: string;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = {
    cmd: argv[0] && !argv[0].startsWith('-') ? argv[0] : 'start',
    open: true,
    dev: false,
    foreground: false,
    follow: false,
    lines: 100,
  };
  const rest =
    a.cmd === 'start' && argv[0] === 'start'
      ? argv.slice(1)
      : argv.slice(a.cmd === argv[0] ? 1 : 0);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === '--qr=ascii') {
      a.qr = 'ascii';
      continue;
    }
    if (a.cmd === 'devices' && t === 'revoke') {
      a.revoke = rest[++i];
      if (!a.revoke || a.revoke.startsWith('-'))
        throw new Error('revocar requiere un id o all / revoke requires an id or all');
      continue;
    }
    switch (t) {
      case '--port':
        a.port = Number(rest[++i]);
        break;
      case '--check':
        a.check = true;
        break;
      case '--yes':
        a.yes = true;
        break;
      case '--host':
        a.host = rest[++i];
        break;
      case '--cwd':
        a.cwd = rest[++i];
        break;
      case '--agent':
        a.agent = rest[++i];
        break;
      case '--no-open':
        a.open = false;
        break;
      case '--dev':
        a.dev = true;
        a.foreground = true;
        a.open = false;
        break;
      case '--foreground':
        a.foreground = true;
        break;
      case '-f':
      case '--follow':
        a.follow = true;
        break;
      case '-n':
        a.lines = Number(rest[++i]);
        break;
      case '-h':
      case '--help':
        a.cmd = 'help';
        break;
      case '-v':
      case '--version':
        if (a.cmd === 'update' && t === '--version') {
          const version = rest[++i];
          if (!version || version.startsWith('-')) throw new Error('--version requires a version');
          a.version = version;
        } else a.cmd = 'version';
        break;
      default:
        break;
    }
  }
  return a;
}

/**
 * Re-serialize an Args as a `start` command argv. Used to build supervisor and
 * supervised-child command lines so `restart` (or any cmd) always yields `start`.
 */
export function serializeArgs(a: Args): string[] {
  if (a.cmd === 'pair' || a.cmd === 'devices' || a.cmd === 'open') {
    return [
      a.cmd,
      ...(a.revoke ? ['revoke', a.revoke] : []),
      ...(a.port !== undefined ? ['--port', String(a.port)] : []),
      ...(a.host ? ['--host', a.host] : []),
      ...(a.qr ? ['--qr=ascii'] : []),
    ];
  }
  if (a.cmd === 'update') {
    return [
      'update',
      ...(a.check ? ['--check'] : []),
      ...(a.version ? ['--version', a.version] : []),
      ...(a.yes ? ['--yes'] : []),
    ];
  }
  const out = ['start'];
  if (a.port !== undefined) out.push('--port', String(a.port));
  if (a.host !== undefined) out.push('--host', a.host);
  if (a.cwd !== undefined) out.push('--cwd', a.cwd);
  if (a.agent !== undefined) out.push('--agent', a.agent);
  if (!a.open) out.push('--no-open');
  if (a.qr) out.push('--qr=ascii');
  return out;
}
