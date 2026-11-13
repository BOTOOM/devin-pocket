import { expect, it } from 'vitest';
import { formatPairingCode } from '../src/shared/pairing-code.js';

it.each([
  ['', ''],
  ['   - ', ''],
  ['abcd', 'ABCD'],
  ['abcde', 'ABCD-E'],
  ['abcdefgh', 'ABCD-EFGH'],
  ['abcd-efgh', 'ABCD-EFGH'],
  [' ab cd ef gh ', 'ABCD-EFGH'],
  ['ab!cd\nef-gh', 'ABCD-EFGH'],
  ['ABCD-EFGH2345', 'ABCD-EFGH'],
  ['23456789', '2345-6789'],
  ['01abcd', 'ABCD'],
])('formats pairing code %j as %j', (input, expected) => {
  expect(formatPairingCode(input)).toBe(expected);
  expect(formatPairingCode(expected)).toBe(expected);
});
