import path from 'node:path';
import { type Args, serializeArgs } from './args.js';
import type { Config } from './paths.js';

export function savedStartArgs(
  args: Args,
  config: Config,
  cwd = process.cwd(),
  env = process.env,
): string[] {
  return serializeArgs({
    ...args,
    port: args.port ?? config.port,
    host: args.host ?? config.host,
    cwd: path.resolve(cwd, args.cwd ?? '.'),
    agent: args.agent ?? env.DEVIN_POCKET_AGENT ?? config.agentCommand,
  });
}
