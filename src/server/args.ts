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
    switch (t) {
      case '--port':
        a.port = Number(rest[++i]);
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
        a.cmd = 'version';
        break;
      default:
        break;
    }
  }
  return a;
}
