export interface DiffLine {
  type: 'ctx' | 'add' | 'del';
  text: string;
}

/** Tiny LCS line diff for ToolCall diff content (oldText → newText). */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;
  // LCS table; cap size to avoid pathological memory on large files.
  if (n * m > 1_000_000) {
    return [
      ...a.map((t): DiffLine => ({ type: 'del', text: t })),
      ...b.map((t): DiffLine => ({ type: 'add', text: t })),
    ];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const cur = dp[i] ?? [];
    const next = dp[i + 1] ?? [];
    for (let j = m - 1; j >= 0; j--) {
      cur[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, cur[j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i] ?? '' });
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      out.push({ type: 'del', text: a[i] ?? '' });
      i++;
    } else {
      out.push({ type: 'add', text: b[j] ?? '' });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] ?? '' });
  while (j < m) out.push({ type: 'add', text: b[j++] ?? '' });
  return out;
}
