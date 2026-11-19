export interface DraftMention {
  name: string;
  uri: string;
}
export interface DraftImage {
  data: string;
  mimeType: string;
  name: string;
}
export interface Draft {
  text: string;
  mentions: DraftMention[];
  images: DraftImage[];
}

// Unsent composer text per session id. Not a session list: entries only hold
// what the user typed and are dropped once sent or emptied.
const KEY = 'dp.drafts';
const MAX = 30;
// Images stay in memory only: base64 payloads would blow the localStorage quota.
const images = new Map<string, DraftImage[]>();

type Stored = Record<string, { text: string; mentions: DraftMention[]; at: number }>;

function read(): Stored {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as Stored) : {};
  } catch {
    return {};
  }
}

function write(all: Stored) {
  const kept = Object.entries(all)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX);
  try {
    if (kept.length) localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
    else localStorage.removeItem(KEY);
  } catch {
    // Quota or private mode: the draft still lives until reload.
  }
}

export function loadDraft(sessionId: string): Draft {
  const d = read()[sessionId];
  return {
    text: typeof d?.text === 'string' ? d.text : '',
    mentions: Array.isArray(d?.mentions) ? d.mentions : [],
    images: images.get(sessionId) ?? [],
  };
}

export function saveDraft(sessionId: string, d: Draft) {
  if (d.images.length) images.set(sessionId, d.images);
  else images.delete(sessionId);
  const all = read();
  const prev = all[sessionId];
  if (d.text || d.mentions.length) {
    if (prev?.text === d.text && JSON.stringify(prev.mentions) === JSON.stringify(d.mentions))
      return;
    all[sessionId] = { text: d.text, mentions: d.mentions, at: Date.now() };
  } else if (prev) delete all[sessionId];
  else return;
  write(all);
}

export function clearDraft(sessionId: string) {
  saveDraft(sessionId, { text: '', mentions: [], images: [] });
}
