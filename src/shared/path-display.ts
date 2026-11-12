/** Native server paths are displayed in the browser, which has no node:path. */
function splitPath(value: string) {
  const drive = value.match(/^[a-z]:[\\/]/i);
  const unc = value.match(/^([\\/]{2}[^\\/]+[\\/][^\\/]+)(?:[\\/]|$)/);
  const windows = Boolean(drive || unc);
  const sep = windows && value.includes('\\') ? '\\' : '/';
  const root = drive
    ? `${value.slice(0, 2)}${sep}`
    : unc
      ? `${unc[1]}${sep}`
      : value.startsWith('/')
        ? '/'
        : '';
  const offset = drive ? drive[0].length : unc ? unc[0].length : root.length;
  const parts = value
    .slice(offset)
    .split(windows ? /[\\/]+/ : /\/+/)
    .filter(Boolean);
  return { root, parts, sep, windows };
}

export function baseName(value: string): string {
  const { root, parts } = splitPath(value);
  return parts.at(-1) || root || value;
}

export function pathBreadcrumbs(value: string): { label: string; path: string }[] {
  const { root, parts, sep, windows } = splitPath(value);
  return [
    ...(windows ? [{ label: root.replace(/[\\/]$/, ''), path: root }] : []),
    ...parts.map((label, i) => ({ label, path: root + parts.slice(0, i + 1).join(sep) })),
  ];
}
