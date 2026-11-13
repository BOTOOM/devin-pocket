import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AuthError,
  AuthStore,
  DEVICE_MAX_AGE,
  defaultDeviceName,
  deviceCookieToken,
} from '../src/server/auth.js';
import { isLoopback, loopbackHostAllowed, pairingUrls } from '../src/server/network.js';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-auth-'));
  directories.push(dir);
  let now = 1000000;
  const store = new AuthStore(dir, () => now);
  return {
    dir,
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('pairing grants', () => {
  it('issues independent single-use URL tokens and human codes', () => {
    const { store } = fixture();
    const first = store.createGrant();
    const second = store.createGrant();
    expect(Buffer.from(first.token, 'base64url').length).toBeGreaterThanOrEqual(16);
    expect(first.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const device = store.redeem({ token: first.token, name: 'Phone' }, 'one');
    expect(Buffer.from(device.token, 'base64url')).toHaveLength(32);
    expect(() => store.redeem({ code: first.code }, 'one')).toThrow('invalid or expired');
    expect(
      store.redeem({ code: second.code.toLowerCase().replace('-', '') }, 'one').device.name,
    ).toBe('Device');
    expect(store.list()).toHaveLength(2);
  });
  it('expires grants at ten minutes and bounds the live grant count', () => {
    const { store, advance } = fixture();
    const first = store.createGrant();
    for (let i = 1; i < 32; i++) store.createGrant();
    expect(() => store.createGrant()).toThrow('too many active');
    advance(10 * 60 * 1000);
    expect(() => store.redeem({ token: first.token }, 'one')).toThrow('invalid or expired');
    expect(store.createGrant()).toHaveProperty('token');
  });
  it('limits failed attempts per IP and globally, then resets after a minute', () => {
    const { store, advance } = fixture();
    for (let i = 0; i < 20; i++)
      expect(() => store.redeem({ code: 'INVALID' }, `ip-${Math.floor(i / 5)}`)).toThrow(
        'invalid or expired',
      );
    expect(() => store.redeem({}, 'ip-0')).toThrow('too many pairing attempts');
    try {
      store.redeem({}, 'fresh');
    } catch (error) {
      expect(error).toMatchObject({ status: 429 });
    }
    advance(60000);
    expect(() => store.redeem({}, 'ip-0')).toThrow('invalid or expired');
  });
  it('rejects both credentials, empty input and unknown tokens without consuming a grant', () => {
    const { store } = fixture();
    const grant = store.createGrant();
    for (const value of [{ token: grant.token, code: grant.code }, {}, { token: 'bogus' }]) {
      expect(() => store.redeem(value, 'one')).toThrow(AuthError);
    }
    expect(store.redeem({ token: grant.token }, 'one')).toHaveProperty('device.id');
  });
});

describe('persistent device credentials', () => {
  it('persists only hashes, restricts permissions and rotates the local admin secret on restart', () => {
    const { dir, store } = fixture();
    const paired = store.redeem({ token: store.createGrant().token, name: 'Android' }, 'one');
    const file = path.join(dir, 'devices.json');
    expect(fs.readFileSync(file, 'utf8')).not.toContain(paired.token);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const admin = fs.readFileSync(path.join(dir, 'admin.token'), 'utf8');
    expect(store.isAdmin(admin)).toBe(true);
    expect(store.isAdmin('bad')).toBe(false);
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.join(dir, 'admin.token')).mode & 0o777).toBe(0o600);
    }
    const restored = new AuthStore(dir, () => paired.device.createdAt);
    expect(restored.authenticate(paired.token)?.id).toBe(paired.device.id);
    expect(restored.isAdmin(admin)).toBe(false);
    expect(restored.list()[0]).not.toHaveProperty('tokenHash');
  });
  it('refreshes activity, expires unused devices and revokes others without removing current', () => {
    const { store, advance } = fixture();
    const first = store.redeem({ token: store.createGrant().token }, 'one');
    const second = store.redeem({ token: store.createGrant().token }, 'one');
    const removed: string[] = [];
    store.onRevoke((id) => removed.push(id));
    expect(store.authenticate('wrong')).toBeUndefined();
    expect(store.authenticate(undefined)).toBeUndefined();
    advance(DEVICE_MAX_AGE * 1000 - 1);
    expect(store.authenticate(first.token)?.id).toBe(first.device.id);
    advance(1);
    expect(store.authenticate(second.token)).toBeUndefined();
    expect(removed).toContain(second.device.id);
    const third = store.redeem({ code: store.createGrant().code }, 'one');
    store.revokeOthers(first.device.id);
    expect(store.list(first.device.id)).toEqual([
      expect.objectContaining({ id: first.device.id, current: true }),
    ]);
    expect(store.authenticate(third.token)).toBeUndefined();
    expect(store.revoke(first.device.id)).toBe(true);
    expect(store.revoke(first.device.id)).toBe(false);
  });
  it('fails closed for a corrupted credential file', () => {
    const { dir } = fixture();
    fs.writeFileSync(path.join(dir, 'devices.json'), 'not JSON');
    expect(() => new AuthStore(dir)).toThrow();
  });
  it('refreshes WebSocket activity and strips terminal controls from names', () => {
    const { store, advance } = fixture();
    const paired = store.redeem(
      { token: store.createGrant().token, name: '\x1b[31mPhone\n' },
      'one',
    );
    expect(paired.device.name).toBe('[31mPhone');
    advance(DEVICE_MAX_AGE * 1000 - 1);
    expect(store.touch(paired.device.id)).toBe(true);
    advance(1);
    expect(store.hasDevice(paired.device.id)).toBe(true);
    expect(store.touch('missing')).toBe(false);
    advance(DEVICE_MAX_AGE * 1000);
    expect(store.touch(paired.device.id)).toBe(false);
  });
});

it('extracts unambiguous device cookies and derives useful default names', () => {
  const token = 'a'.repeat(43);
  expect(deviceCookieToken(`other=1; dp_device=${token}`)).toBe(token);
  expect(deviceCookieToken(`dp_device=${token}; dp_device=${token}`)).toBeUndefined();
  expect(deviceCookieToken('dp_device=short')).toBeUndefined();
  expect(defaultDeviceName('Mozilla Android Chrome/1')).toBe('Android · Chrome');
  expect(defaultDeviceName()).toBe('Device');
});

it('recognizes loopback sockets, rejects rebinding hosts and builds private-first URLs', () => {
  expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
  expect(isLoopback('192.168.1.2')).toBe(false);
  for (const host of ['localhost:7777', '127.0.0.1:7777', '[::1]:7777'])
    expect(loopbackHostAllowed(host)).toBe(true);
  for (const host of ['evil.test:7777', 'localhost.evil.test', '127.0.0.1@evil.test', undefined])
    expect(loopbackHostAllowed(host)).toBe(false);
  const interfaces = {
    eth: [
      { address: '8.8.8.8', family: 'IPv4', internal: false },
      { address: '192.168.1.2', family: 'IPv4', internal: false },
      { address: '127.0.0.1', family: 'IPv4', internal: true },
    ],
  };
  const complete = Object.fromEntries(
    Object.entries(interfaces).map(([name, entries]) => [
      name,
      entries.map((entry) => ({
        ...entry,
        family: 'IPv4' as const,
        netmask: '255.255.255.0',
        mac: '00:00:00:00:00:00',
        cidr: null,
      })),
    ]),
  );
  expect(pairingUrls('0.0.0.0', 7777, 'secret', complete)).toEqual([
    'http://192.168.1.2:7777/#/pair?t=secret',
    'http://8.8.8.8:7777/#/pair?t=secret',
  ]);
  expect(pairingUrls('::', 7777, 'secret', {})).toEqual(['http://127.0.0.1:7777/#/pair?t=secret']);
  expect(pairingUrls('::1', 7777, 'secret')).toEqual(['http://[::1]:7777/#/pair?t=secret']);
});

function interfaceAddress(address: string, internal = false): os.NetworkInterfaceInfo {
  const info = { address, internal, netmask: '', mac: '00:00:00:00:00:00', cidr: null };
  return address.includes(':')
    ? { ...info, family: 'IPv6', scopeid: 0 }
    : { ...info, family: 'IPv4' };
}

it.each(['::', '[::]'])('discovers usable IPv6-only pairing addresses on %s', (host) => {
  const interfaces = {
    eth0: [
      interfaceAddress('fe80::1'),
      interfaceAddress('febf::1'),
      interfaceAddress('2001:db8::1'),
      interfaceAddress('fd12:3456::2'),
      interfaceAddress('::1', true),
      interfaceAddress('ff02::1'),
    ],
  };
  expect(pairingUrls(host, 7777, 'secret', interfaces)).toEqual([
    'http://[2001:db8::1]:7777/#/pair?t=secret',
    'http://[fd12:3456::2]:7777/#/pair?t=secret',
  ]);
});

it('keeps private IPv4 first and only offers IPv6 for IPv6 listeners', () => {
  const interfaces = {
    eth0: [
      interfaceAddress('2001:db8::1'),
      interfaceAddress('8.8.8.8'),
      interfaceAddress('192.168.1.2'),
      interfaceAddress('2001:db8::1'),
    ],
    empty: undefined,
  };
  expect(pairingUrls('::', 7777, 'secret', interfaces)).toEqual([
    'http://192.168.1.2:7777/#/pair?t=secret',
    'http://[2001:db8::1]:7777/#/pair?t=secret',
    'http://8.8.8.8:7777/#/pair?t=secret',
  ]);
  expect(pairingUrls('0.0.0.0', 7777, 'secret', interfaces)).toEqual([
    'http://192.168.1.2:7777/#/pair?t=secret',
    'http://8.8.8.8:7777/#/pair?t=secret',
  ]);
  expect(pairingUrls('2001:db8::2', 7777, 'secret', interfaces)).toEqual([
    'http://[2001:db8::2]:7777/#/pair?t=secret',
  ]);
});
