import type { ContentBlock, FsEntry, SessionState } from '@shared/protocol';
import { AtSign, File as FileIcon, Folder, Image as ImageIcon, Send, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CommandPalette } from '@/components/CommandPalette';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/i18n';
import { send } from '@/lib/ws';

interface Mention {
  name: string;
  uri: string;
}

const MENTION_MAX = 30;

export function Composer({
  sessionId,
  state,
  agentReady,
}: {
  sessionId: string;
  state?: SessionState;
  agentReady: boolean;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const [images, setImages] = useState<{ data: string; mimeType: string; name: string }[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [fsResults, setFsResults] = useState<FsEntry[]>([]);
  const [overflow, setOverflow] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const working =
    state?.turn === 'working' ||
    state?.turn === 'awaitingPermission' ||
    state?.turn === 'cancelling';
  const cwd = state?.cwd ?? '';

  const onTextChange = (v: string) => {
    setText(v);
    const caret = taRef.current?.selectionStart ?? v.length;
    const m = v.slice(0, caret).match(/@([\p{L}\p{N}_\-./]*)$/u);
    if (m) {
      setMentionOpen(true);
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        fetch(
          `/api/fs?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(m[1] ?? '')}&limit=${MENTION_MAX}`,
        )
          .then((r) => (r.ok ? r.json() : Promise.reject()))
          .then((d: { entries: FsEntry[] }) =>
            setFsResults(
              [...d.entries].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'dir' ? -1 : 1)),
            ),
          )
          .catch(() => setFsResults([]));
      }, 200);
    } else if (v.trim() === '/') {
      setCmdOpen(true);
      setText('');
    } else {
      setMentionOpen(false);
    }
  };

  const pickMention = (e: FsEntry) => {
    const caret = taRef.current?.selectionStart ?? text.length;
    const replaced = text.slice(0, caret).replace(/@[\p{L}\p{N}_\-./]*$/u, '');
    setText(replaced + text.slice(caret));
    setMentions((ms) => [
      ...ms,
      { name: e.path, uri: `file://${cwd.replace(/\/+$/, '')}/${e.path}` },
    ]);
    setMentionOpen(false);
    taRef.current?.focus();
  };

  const submit = useCallback(async () => {
    const blocks: ContentBlock[] = [];
    const trimmed = text.trim();
    if (trimmed) blocks.push({ type: 'text', text: trimmed });
    for (const m of mentions) blocks.push({ type: 'resource_link', uri: m.uri, name: m.name });
    for (const img of images)
      blocks.push({ type: 'image', data: img.data, mimeType: img.mimeType });
    if (blocks.length === 0) return;
    setText('');
    setImages([]);
    setMentions([]);
    await send({ type: 'prompt', sessionId, blocks }).catch(() => {});
  }, [text, mentions, images, sessionId]);

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const out: typeof images = [];
    for (const f of Array.from(files).slice(0, 8)) {
      const data = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1] ?? '');
        r.readAsDataURL(f);
      });
      out.push({ data, mimeType: f.type || 'image/png', name: f.name });
    }
    setImages((prev) => [...prev, ...out]);
  };

  // Auto-grow up to ~6 lines; scrollbar only once overflowing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: recalc only when text changes
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = 6 * 24;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    setOverflow(el.scrollHeight > max);
  }, [text]);

  return (
    <div className="safe-x safe-bottom relative border-t bg-background px-4 pb-2 pt-2">
      {mentionOpen && (
        <div className="absolute inset-x-4 bottom-full mb-1 max-h-[40dvh] overflow-y-auto rounded-xl border bg-popover shadow-lg">
          {fsResults.length === 0 ? (
            <p className="px-4 py-4 text-center text-sm text-muted-foreground">
              {t('common.loading')}
            </p>
          ) : (
            fsResults.map((e) => (
              <button
                key={e.path}
                type="button"
                className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left hover:bg-accent"
                onClick={() => pickMention(e)}
              >
                {e.kind === 'dir' ? (
                  <Folder className="size-4 shrink-0 text-primary" />
                ) : (
                  <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {e.path.split('/').pop()}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{e.path}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {mentions.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {mentions.map((m) => (
            <button
              key={m.uri}
              type="button"
              className="rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground"
              onClick={() => setMentions((ms) => ms.filter((x) => x.uri !== m.uri))}
            >
              @{m.name} ×
            </button>
          ))}
        </div>
      )}
      {images.length > 0 && (
        <div className="mb-1.5 flex gap-2 overflow-x-auto">
          {images.map((img) => (
            <button
              key={`${img.name}-${img.data.length}`}
              type="button"
              className="relative shrink-0"
              onClick={() => setImages((im) => im.filter((x) => x !== img))}
            >
              <img
                src={`data:${img.mimeType};base64,${img.data}`}
                alt={img.name}
                className="size-14 rounded-lg border object-cover"
              />
              <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-foreground text-[10px] text-background">
                ×
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => onFiles(e.target.files)}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label={t('composer.attach')}
          onClick={() => fileRef.current?.click()}
        >
          <ImageIcon className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label={t('composer.mention')}
          onClick={() => {
            setText((v) => `${v}@`);
            setMentionOpen(true);
            taRef.current?.focus();
          }}
        >
          <AtSign className="size-5" />
        </Button>

        <Textarea
          ref={taRef}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !mentionOpen) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={agentReady ? t('composer.placeholder') : t('chat.agentNotReady')}
          disabled={!agentReady}
          rows={1}
          className={`max-h-36 min-h-11 flex-1 resize-none rounded-xl py-2.5 ${
            overflow ? 'overflow-y-auto' : 'overflow-y-hidden'
          }`}
        />

        {working ? (
          <Button
            variant="destructive"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-full"
            aria-label={t('composer.stop')}
            onClick={() => send({ type: 'cancel', sessionId }).catch(() => {})}
          >
            <Square className="size-4 fill-current" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="h-11 w-11 shrink-0 rounded-full"
            aria-label={t('composer.send')}
            disabled={!agentReady || (!text.trim() && images.length === 0 && mentions.length === 0)}
            onClick={submit}
          >
            <Send className="size-5" />
          </Button>
        )}
      </div>

      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        commands={state?.commands ?? []}
        onPick={(name) => {
          setText(`/${name} `);
          taRef.current?.focus();
        }}
      />
    </div>
  );
}
