import { stripVTControlCharacters } from 'node:util';
import { expect, it } from 'vitest';
import { qrMatrix, renderTerminalQr } from '../src/server/qr-terminal.js';

const url = 'http://192.168.123.123:7790/#/pair?t=abcdefghijklmnopqrstuv';
it('renders an M-level matrix with a two-module quiet zone that fits a phone terminal', () => {
  const matrix = qrMatrix(url);
  expect(matrix.length).toBeLessThanOrEqual(45);
  expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
  matrix.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (x < 2 || y < 2 || x >= matrix.length - 2 || y >= matrix.length - 2)
        expect(cell).toBe(false);
    });
  });
});

it('uses explicit black/white foreground and background, with half-block dimensions', () => {
  const rendered = renderTerminalQr(url, { tty: true, noColor: false, term: 'xterm' });
  expect(rendered).toContain('\x1b[38;2;255;255;255;48;2;255;255;255m▀');
  expect(rendered).toContain('38;2;0;0;0');
  expect(rendered).toContain('48;2;0;0;0');
  const lines = rendered.trimEnd().split('\n');
  expect(lines).toHaveLength(Math.ceil(qrMatrix(url).length / 2));
  expect(
    lines.every((line) => stripVTControlCharacters(line).length === qrMatrix(url).length),
  ).toBe(true);
});

it('falls back for NO_COLOR, ASCII and dumb terminals and skips non-TTY output', () => {
  for (const options of [{ noColor: true }, { ascii: true }, { term: 'dumb' }]) {
    const rendered = renderTerminalQr(url, { tty: true, ...options });
    expect(rendered).not.toContain('\x1b');
    expect(rendered).toContain('██');
    const lines = rendered.slice(0, -1).split('\n');
    expect(lines).toHaveLength(qrMatrix(url).length);
    expect(lines[0]).toBe(' '.repeat(qrMatrix(url).length * 2));
  }
  expect(renderTerminalQr(url, { tty: false })).toBe('');
});
