import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { browse, browsePath, cwdAllowed } from '../src/server/fs-search.js';
import { validateCwd } from '../src/server/workspace.js';

describe('working folder validation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-workspace-'));
  const home = path.join(root, 'home');
  const outside = path.join(root, 'outside');
  const project = path.join(home, 'project');
  beforeAll(() => {
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(home, 'file.txt'), 'text');
    fs.symlinkSync(outside, path.join(home, 'escape'), 'dir');
    fs.symlinkSync(project, path.join(home, 'alias'), 'dir');
    vi.spyOn(os, 'homedir').mockReturnValue(home);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ['relative', 'project'],
    ['empty', ''],
    ['missing', path.join(home, 'missing')],
    ['file', path.join(home, 'file.txt')],
    ['outside home', outside],
    ['escaping symlink', path.join(home, 'escape')],
    ['non-string', null],
  ])('rejects %s', (_, cwd) => {
    expect(() => validateCwd(cwd, [])).toThrow('invalid_cwd');
  });
  it('accepts home, subdirectories and internal symlinks, returning real paths', () => {
    expect(validateCwd(home, [])).toBe(home);
    expect(validateCwd(project, [])).toBe(project);
    expect(validateCwd(path.join(home, 'alias'), [])).toBe(project);
  });
  it('accepts configured roots resolved through symlinks, but not siblings', () => {
    const workspaces = [{ path: path.join(home, 'escape'), name: 'external project' }];
    expect(validateCwd(outside, workspaces)).toBe(outside);
    expect(() => validateCwd(root, workspaces)).toThrow('invalid_cwd');
  });
  it('applies realpath restrictions to browsing and file search roots', () => {
    const escapingLink = path.join(home, 'escape');
    expect(cwdAllowed(escapingLink, [])).toBe(false);
    expect(cwdAllowed(project, [])).toBe(true);
    expect(browsePath(escapingLink)).toBe(home);
    expect(browse(escapingLink).every((entry) => entry.path.startsWith(`${home}${path.sep}`))).toBe(
      true,
    );
    expect(browse(home).some((entry) => entry.name === 'escape')).toBe(false);
    expect(browsePath(outside, [{ path: outside, name: 'external' }])).toBe(outside);
  });
});
