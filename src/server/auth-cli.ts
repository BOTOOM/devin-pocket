import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AuthStatus, DevicesResponse, PairingResponse } from '../shared/protocol.js';
import type { Args } from './args.js';
import { stateDir } from './paths.js';
import { renderTerminalQr } from './qr-terminal.js';

export function runningServerUrl(options: Partial<Args> = {}): URL {
  const info = JSON.parse(fs.readFileSync(path.join(stateDir(), 'server.json'), 'utf8')) as {
    host: string;
    port: number;
  };
  const host = options.host ?? info.host;
  const hostname =
    host === '0.0.0.0' || host === 'localhost'
      ? '127.0.0.1'
      : host === '::' || host === '[::]' || host === '[::1]'
        ? '::1'
        : host;
  return new URL(
    `http://${hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname}:${options.port || info.port}`,
  );
}

export function adminRequest<T>(
  route: string,
  method = 'GET',
  options: Partial<Args> = {},
): Promise<T> {
  const url = runningServerUrl(options);
  const token = fs.readFileSync(path.join(stateDir(), 'admin.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const req = http.request(
      new URL(route, url),
      {
        method,
        localAddress: url.hostname.includes(':') ? '::1' : '127.0.0.1',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(method === 'POST' || method === 'DELETE' ? { 'Content-Length': '2' } : {}),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () => {
          try {
            const body = JSON.parse(text);
            if ((res.statusCode ?? 500) >= 400)
              reject(new Error(body.error ?? `HTTP ${res.statusCode}`));
            else resolve(body as T);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.setTimeout(5000, () => req.destroy(new Error('server timeout')));
    req.on('error', reject);
    req.end(method === 'POST' || method === 'DELETE' ? '{}' : undefined);
  });
}

export async function pairing(options: Partial<Args> = {}): Promise<PairingResponse | undefined> {
  const status = await adminRequest<AuthStatus>('/api/auth/status', 'GET', options);
  if (!status.required) {
    process.stdout.write(
      'Emparejamiento no requerido en loopback / Pairing is not required on loopback.\n',
    );
    return;
  }
  return adminRequest<PairingResponse>('/api/auth/pairings', 'POST', options);
}

export function printPairing(grant: PairingResponse, ascii = false): void {
  process.stdout.write('\nEmparejar dispositivo / Pair a device\n');
  if (grant.urls[0]) process.stdout.write(renderTerminalQr(grant.urls[0], { ascii }));
  process.stdout.write(
    `${grant.urls.join('\n')}\nCódigo / Code: ${grant.code}\nCaduca / Expires: ${new Date(grant.expiresAt).toISOString()} (10 min)\n`,
  );
}

export async function listDevices(options: Partial<Args>): Promise<void> {
  const { devices } = await adminRequest<DevicesResponse>('/api/auth/devices', 'GET', options);
  process.stdout.write('Dispositivos emparejados / Paired devices\n');
  if (!devices.length) process.stdout.write('Ninguno / None\n');
  for (const device of devices)
    process.stdout.write(
      `${device.id}  ${device.name}  Último uso / Last seen: ${new Date(device.lastSeenAt).toISOString()}\n`,
    );
}
