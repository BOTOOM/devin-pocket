import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { PairedDevice, PairingGrant } from '../shared/protocol.js';
import { stateDir } from './paths.js';

export const DEVICE_MAX_AGE = 30 * 24 * 3600;
const GRANT_TTL = 10 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const StoredDevices = z.array(
  z.object({
    id: z.string(),
    name: z.string().max(80),
    createdAt: z.number(),
    lastSeenAt: z.number(),
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
);
type StoredDevice = z.infer<typeof StoredDevices>[number];

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class AuthStore {
  private devices: StoredDevice[];
  private grants = new Map<string, PairingGrant>();
  private attempts = new Map<string, number[]>();
  private globalAttempts: number[] = [];
  private revoked = new Set<(id: string) => void>();
  private adminHash: string;

  constructor(
    private dir = stateDir(),
    private now = Date.now,
  ) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'devices.json');
    this.devices = fs.existsSync(file)
      ? StoredDevices.parse(JSON.parse(fs.readFileSync(file, 'utf8')))
      : [];
    const admin = randomBytes(32).toString('base64url');
    this.adminHash = hash(admin);
    this.write('admin.token', admin);
    this.sweep();
    this.save();
  }

  private write(name: string, data: string): void {
    const file = path.join(this.dir, name);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, data, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  private save(): void {
    this.write('devices.json', JSON.stringify(this.devices));
  }

  isAdmin(token: string): boolean {
    return timingSafeEqual(Buffer.from(hash(token), 'hex'), Buffer.from(this.adminHash, 'hex'));
  }

  onRevoke(callback: (id: string) => void): () => void {
    this.revoked.add(callback);
    return () => this.revoked.delete(callback);
  }

  sweep(): void {
    const now = this.now();
    for (const [token, grant] of this.grants) if (grant.expiresAt <= now) this.grants.delete(token);
    const expired = this.devices.filter(
      (device) => device.lastSeenAt + DEVICE_MAX_AGE * 1000 <= now,
    );
    if (expired.length) {
      this.devices = this.devices.filter((device) => !expired.includes(device));
      this.save();
      for (const device of expired) for (const callback of this.revoked) callback(device.id);
    }
    this.globalAttempts = this.globalAttempts.filter((at) => at > now - 60000);
    for (const [ip, attempts] of this.attempts) {
      const recent = attempts.filter((at) => at > now - 60000);
      if (recent.length) this.attempts.set(ip, recent);
      else this.attempts.delete(ip);
    }
  }

  createGrant(): PairingGrant {
    this.sweep();
    if (this.grants.size >= 32) throw new AuthError(429, 'too many active pairing grants');
    let code: string;
    do {
      const letters = [...randomBytes(8)].map((value) => ALPHABET[value & 31]).join('');
      code = `${letters.slice(0, 4)}-${letters.slice(4)}`;
    } while ([...this.grants.values()].some((grant) => grant.code === code));
    const grant = {
      token: randomBytes(16).toString('base64url'),
      code,
      expiresAt: this.now() + GRANT_TTL,
    };
    this.grants.set(grant.token, grant);
    return { ...grant };
  }

  redeem(
    input: { token?: string; code?: string; name?: string },
    ip: string,
  ): { token: string; device: PairedDevice } {
    this.sweep();
    const attempts = this.attempts.get(ip) ?? [];
    if (attempts.length >= 5 || this.globalAttempts.length >= 20)
      throw new AuthError(429, 'too many pairing attempts');
    const code = input.code?.toUpperCase().replace(/-/g, '');
    const grant = input.token
      ? this.grants.get(input.token)
      : [...this.grants.values()].find((value) => value.code.replace('-', '') === code);
    if (!grant || !!input.token === !!input.code) {
      attempts.push(this.now());
      this.attempts.set(ip, attempts);
      this.globalAttempts.push(this.now());
      throw new AuthError(400, 'invalid or expired pairing grant');
    }
    const token = randomBytes(32).toString('base64url');
    const device = {
      id: randomUUID(),
      name: (input.name ?? 'Device').replace(/\p{C}/gu, '').trim().slice(0, 80) || 'Device',
      createdAt: this.now(),
      lastSeenAt: this.now(),
    };
    this.devices.push({ ...device, tokenHash: hash(token) });
    this.save();
    this.grants.delete(grant.token);
    return { token, device };
  }

  authenticate(token: string | undefined): PairedDevice | undefined {
    this.sweep();
    if (!token) return;
    const tokenHash = Buffer.from(hash(token), 'hex');
    const device = this.devices.find((value) =>
      timingSafeEqual(Buffer.from(value.tokenHash, 'hex'), tokenHash),
    );
    if (!device) return;
    device.lastSeenAt = this.now();
    this.save();
    const { tokenHash: _, ...publicDevice } = device;
    return publicDevice;
  }

  hasDevice(id: string): boolean {
    this.sweep();
    return this.devices.some((device) => device.id === id);
  }

  touch(id: string): boolean {
    this.sweep();
    const device = this.devices.find((value) => value.id === id);
    if (!device) return false;
    device.lastSeenAt = this.now();
    this.save();
    return true;
  }

  list(current?: string): PairedDevice[] {
    this.sweep();
    return this.devices.map(({ tokenHash: _, ...device }) => ({
      ...device,
      current: device.id === current,
    }));
  }

  revoke(id: string): boolean {
    const previous = this.devices;
    this.devices = previous.filter((device) => device.id !== id);
    if (previous.length === this.devices.length) return false;
    this.save();
    for (const callback of this.revoked) callback(id);
    return true;
  }

  revokeOthers(current?: string): void {
    for (const device of [...this.devices]) if (device.id !== current) this.revoke(device.id);
  }
}

export function defaultDeviceName(userAgent = ''): string {
  const os = /Android/i.test(userAgent)
    ? 'Android'
    : /iPhone|iPad/i.test(userAgent)
      ? 'iOS'
      : /Windows/i.test(userAgent)
        ? 'Windows'
        : /Macintosh|Mac OS/i.test(userAgent)
          ? 'macOS'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : 'Device';
  const browser = /Edg\//i.test(userAgent)
    ? 'Edge'
    : /Firefox\//i.test(userAgent)
      ? 'Firefox'
      : /Chrome\//i.test(userAgent)
        ? 'Chrome'
        : /Safari\//i.test(userAgent)
          ? 'Safari'
          : '';
  return [os, browser].filter(Boolean).join(' · ');
}

export function deviceCookieToken(cookie = ''): string | undefined {
  const matches = cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('dp_device='));
  if (matches.length !== 1) return;
  const token = matches[0]?.slice('dp_device='.length);
  return token && /^[\w-]{43}$/.test(token) ? token : undefined;
}
