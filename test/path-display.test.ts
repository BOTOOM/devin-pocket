import { describe, expect, it } from 'vitest';
import { baseName, pathBreadcrumbs } from '../src/shared/path-display.js';

describe('native paths displayed in the folder picker', () => {
  it('links Windows breadcrumbs to absolute native paths', () => {
    expect(pathBreadcrumbs('C:\\Users\\Me\\My project\\')).toEqual([
      { label: 'C:', path: 'C:\\' },
      { label: 'Users', path: 'C:\\Users' },
      { label: 'Me', path: 'C:\\Users\\Me' },
      { label: 'My project', path: 'C:\\Users\\Me\\My project' },
    ]);
    expect(baseName('C:\\Users\\Me\\My project\\')).toBe('My project');
    expect(baseName('C:\\')).toBe('C:\\');
  });
  it('preserves forward-slash drive paths and UNC share roots', () => {
    expect(pathBreadcrumbs('D:/Projects/app')).toEqual([
      { label: 'D:', path: 'D:/' },
      { label: 'Projects', path: 'D:/Projects' },
      { label: 'app', path: 'D:/Projects/app' },
    ]);
    expect(pathBreadcrumbs('\\\\server\\share\\app')).toEqual([
      { label: '\\\\server\\share', path: '\\\\server\\share\\' },
      { label: 'app', path: '\\\\server\\share\\app' },
    ]);
    expect(baseName('\\\\server\\share\\app')).toBe('app');
  });
  it('preserves POSIX paths, root and backslashes inside POSIX names', () => {
    expect(pathBreadcrumbs('/home/me/project')).toEqual([
      { label: 'home', path: '/home' },
      { label: 'me', path: '/home/me' },
      { label: 'project', path: '/home/me/project' },
    ]);
    expect(pathBreadcrumbs('/')).toEqual([]);
    expect(baseName('/')).toBe('/');
    expect(baseName('/home/me/project/')).toBe('project');
    expect(baseName('/home/me/folder\\name')).toBe('folder\\name');
  });
});
