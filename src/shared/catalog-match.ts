import type { CatalogEntry } from './protocol.js';

const norm = (s: string): string => s.toLowerCase().replace(/[\s.\-_]+/g, '');

/**
 * Join an ACP config option to its catalog entry: exact modelUid, case-insensitive
 * uid, exact label, then normalized (spaces/dots/dashes/underscores stripped) on
 * both uid/value and label/name. Returns undefined when nothing matches — the UI
 * shows "no price" rather than guessing.
 */
export function matchEntry(
  option: { value?: string; name?: string },
  entries: readonly CatalogEntry[],
): CatalogEntry | undefined {
  const v = option.value ?? '';
  const n = option.name ?? '';
  for (const e of entries) if (e.modelUid === v) return e;
  for (const e of entries) if (e.modelUid.toLowerCase() === v.toLowerCase()) return e;
  for (const e of entries) if (e.label.toLowerCase() === n.toLowerCase()) return e;
  const nv = norm(v);
  const nn = norm(n);
  for (const e of entries) {
    if ((nv && norm(e.modelUid) === nv) || (nn && norm(e.label) === nn)) return e;
  }
  return undefined;
}
