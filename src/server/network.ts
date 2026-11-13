import os from 'node:os';

export function isLoopback(host: string): boolean {
  const address = host.toLowerCase().replace(/^::ffff:/, '');
  return (
    address === 'localhost' ||
    address === '::1' ||
    address === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)
  );
}

export function loopbackHostAllowed(host: string | undefined): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host ?? '');
}

export function pairingUrls(
  host: string,
  port: number,
  token: string,
  interfaces = os.networkInterfaces(),
): string[] {
  let hosts = [host];
  if (host === '0.0.0.0' || host === '::' || host === '[::]') {
    hosts = Object.values(interfaces).flatMap((entries) =>
      (entries ?? [])
        .filter((entry) => entry.family === 'IPv4' && !entry.internal)
        .map((entry) => entry.address),
    );
    const privateAddress = (address: string) =>
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
    hosts = [...new Set(hosts)].sort(
      (a, b) => Number(privateAddress(b)) - Number(privateAddress(a)),
    );
    if (!hosts.length) hosts = ['127.0.0.1'];
  }
  return hosts.map(
    (address) =>
      `http://${address.includes(':') && !address.startsWith('[') ? `[${address}]` : address}:${port}/#/pair?t=${encodeURIComponent(token)}`,
  );
}
