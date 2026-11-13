import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const installer = path.join(import.meta.dirname, '..', 'install.ps1').replaceAll("'", "''");
const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const available =
  spawnSync(shell, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']).status === 0;

// PowerShell is provided by Windows CI; these tests never run the real installers.
describe.skipIf(!available)('PowerShell installer', () => {
  function run(version: string, node = 'v24.0.0', npmExit = 0, devin = true) {
    return spawnSync(
      shell,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `
      function global:node.exe { $global:LASTEXITCODE = 0; '${node}' }
      function global:npm.cmd { $global:LASTEXITCODE = ${npmExit}; Write-Output ('NPM: ' + ($args -join '|')) }
      ${devin ? 'function global:devin.exe {}' : ''}
      function global:Get-Command {
        param([string]$Name, $ErrorAction)
        if ($Name -eq 'node.exe' -and '${node}' -eq '') { return }
        if ($Name -ne 'devin.exe' -or $${devin ? 'true' : 'false'}) { 'mock executable' }
      }
      function global:Invoke-RestMethod { throw 'Unexpected network request' }
      & '${installer}' -Version '${version}'
    `,
      ],
      { encoding: 'utf8', timeout: 15_000 },
    );
  }

  it.each(['latest', '0.5.0', '0.6.0-beta.1'])(
    'installs the requested Pocket version %s',
    (version) => {
      const result = run(version);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`NPM: install|-g|devin-pocket@${version}`);
      expect(result.stdout).toContain('experimental native Windows');
    },
  );
  it.each(['v20.0.0', 'v21.0.0'])('rejects unsupported Node %s and suggests 24', (node) => {
    const result = run('latest', node);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('winget upgrade OpenJS.NodeJS.LTS --version 24.22.1');
    expect(result.stdout).not.toContain('NPM:');
  });
  it.each(['v22.0.0', 'v23.0.0'])('warns and continues with supported Node %s', (node) => {
    const result = run('latest', node);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Continuing with supported Node.js');
    expect(result.stdout).toContain('Node.js 22/23 es compatible');
    expect(result.stdout).toContain('winget upgrade OpenJS.NodeJS.LTS --version 24.22.1');
    expect(result.stdout).toContain('NPM: install|-g|devin-pocket@latest');
  });
  it('suggests Node 26 when Node is absent, without auto-installing it', () => {
    const result = run('latest', '');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('winget install OpenJS.NodeJS.LTS --version 26.13.1');
    expect(result.stdout).not.toContain('NPM:');
  });
  it.each(['v24.0.0', 'v26.0.0', 'v28.0.0'])('leaves supported Node %s alone', (node) => {
    expect(run('latest', node).status).toBe(0);
  });
  it('does not install Devin without consent', () => {
    const result = run('latest', 'v24.0.0', 0, false);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('irm https://static.devin.ai/cli/setup.ps1 | iex');
    expect(result.stderr).not.toContain('Unexpected network request');
    expect(result.stdout).not.toContain('NPM:');
  });
  it('surfaces npm errors and rejects invalid package versions', () => {
    const failed = run('latest', 'v24.0.0', 1);
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain('npm install failed');
    const invalid = run('not-a-version');
    expect(invalid.status).not.toBe(0);
    expect(invalid.stdout).not.toContain('NPM:');
  });
});
