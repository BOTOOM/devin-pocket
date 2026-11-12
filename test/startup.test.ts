import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/server/args.js';
import { DEFAULT_CONFIG } from '../src/server/paths.js';
import { savedStartArgs } from '../src/server/startup.js';

describe('saved startup options', () => {
  it('anchors relative cwd to the startup directory, not the update directory', () => {
    const original = path.resolve('original');
    const saved = parseArgs(
      savedStartArgs(parseArgs(['start', '--cwd', 'project']), DEFAULT_CONFIG, original),
    );
    expect(saved.cwd).toBe(path.join(original, 'project'));
  });
  it('records the default cwd and preserves explicit absolute paths and config', () => {
    const cwd = path.resolve('original');
    expect(parseArgs(savedStartArgs(parseArgs([]), DEFAULT_CONFIG, cwd)).cwd).toBe(cwd);
    expect(
      parseArgs(
        savedStartArgs(
          parseArgs(['start', '--cwd', cwd]),
          { ...DEFAULT_CONFIG, port: 7780 },
          path.resolve('elsewhere'),
        ),
      ),
    ).toMatchObject({ cwd, port: 7780 });
  });
});
