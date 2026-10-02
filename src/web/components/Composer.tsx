import type { ContentBlock, FsEntry, SessionState } from '@shared/protocol';
import {
  AtSign,
  Check,
  ChevronDown,
  File as FileIcon,
  Folder,
  Image as ImageIcon,
  Pencil,
  Send,
  Square,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CommandPalette } from '@/components/CommandPalette';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/i18n';
import { send } from '@/lib/ws';
import { useStore } from '@/store';

interface Mention {
  name: string;
  uri: string;
}

const MENTION_MAX = 30;
const IMAGE_MAX_BYTES = 1.5 * 1024 * 1024;

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
  const enterToSend = useStore((s) => s.prefs.enterToSend);
  const [text, setText] = useState('');
  const [images, setImages] = useState<{ data: string; mimeType: string; name: string }[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQ, setMentionQ] = useState('');
  const [cmdOpen, setCmdOpen] = useState(false);
  const [fsResults, setFsResults] = useState<FsEntry[]>([]);
  const [fsLoading, setFsLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(true);
  const [overflow, setOverflow] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fsSeq = useRef(0);
  const submitting = useRef(false);
  // Bumped when the draft clears — stale FileReader results are dropped.
  const draftEpoch = useRef(0);

  const working =
    state?.turn === 'working' ||
    state?.turn === 'awaitingPermission' ||
    state?.turn === 'cancelling';
  const cwd = state?.cwd ?? '';

  // Debounced /api/fs lookup; fsSeq discards out-of-order responses.
  const fetchMention = useCallback(
    (q: string) => {
      if (debounce.current) clearTimeout(debounce.current);
      const seq = ++fsSeq.current;
      setFsLoading(true);
      debounce.current = setTimeout(() => {
        fetch(
          `/api/fs?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(q)}&limit=${MENTION_MAX}`,
        )
          .then((r) => (r.ok ? r.json() : Promise.reject()))
          .then((d: { entries: FsEntry[] }) => {
            if (fsSeq.current !== seq) return;
            setFsResults(
              [...d.entries].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'dir' ? -1 : 1)),
            );
            setFsLoading(false);
          })
          .catch(() => {
            if (fsSeq.current !== seq) return;
            setFsResults([]);
            setFsLoading(false);
          });
      }, 200);
    },
    [cwd],
  );

  const onTextChange = (v: string) => {
    setText(v);
    const caret = taRef.current?.selectionStart ?? v.length;
    const m = v.slice(0, caret).match(/@([\p{L}\p{N}_\-./]*)$/u);
    if (m) {
      setMentionOpen(true);
      setMentionQ(m[1] ?? '');
      fetchMention(m[1] ?? '');
    } else if (v.trim() === '/') {
      setCmdOpen(true);
      setText('');
    } else {
      setMentionOpen(false);
    }
  };

  // cwd arrives with the session snapshot — refresh an open mention list when it does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch only when cwd changes
  useEffect(() => {
    if (mentionOpen) fetchMention(mentionQ);
  }, [cwd]);

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
    if (submitting.current) return;
    const blocks: ContentBlock[] = [];
    const trimmed = text.trim();
    if (
      trimmed.startsWith('/btw ') &&
      state?.commands.some((c) => c.name === 'btw') &&
      !images.length &&
      !mentions.length
    ) {
      submitting.current = true;
      try {
        await send({ type: 'aside.ask', sessionId, question: trimmed.slice(5) });
        setText('');
      } catch (e) {
        void import('sonner').then(({ toast }) => toast.error((e as Error).message));
      } finally {
        submitting.current = false;
      }
      return;
    }
    if (trimmed) blocks.push({ type: 'text', text: trimmed });
    for (const m of mentions) blocks.push({ type: 'resource_link', uri: m.uri, name: m.name });
    for (const img of images)
      blocks.push({ type: 'image', data: img.data, mimeType: img.mimeType });
    if (blocks.length === 0) return;
    submitting.current = true;
    try {
      await send(
        editingId
          ? { type: 'prompt.update', sessionId, id: editingId, blocks }
          : { type: 'prompt.enqueue', sessionId, blocks },
      );
      draftEpoch.current++;
      setText('');
      setImages([]);
      setMentions([]);
      setEditingId(null);
    } catch (e) {
      const msg = (e as Error).message;
      void import('sonner').then(({ toast }) =>
        toast.error(editingId && /not found/i.test(msg) ? t('composer.editGone') : msg),
      );
      // The queued item may already have been sent; drop edit mode so a retry enqueues fresh.
      setEditingId(null);
    } finally {
      submitting.current = false;
    }
  }, [text, mentions, images, sessionId, state?.commands, editingId, t]);

  const cancelEdit = () => {
    draftEpoch.current++;
    setEditingId(null);
    setText('');
    setImages([]);
    setMentions([]);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const epoch = draftEpoch.current;
    const out: typeof images = [];
    for (const f of Array.from(files).slice(0, 8)) {
      if (f.size > IMAGE_MAX_BYTES) {
        void import('sonner').then(({ toast }) =>
          toast.warning(t('composer.imageTooLarge', { name: f.name })),
        );
        continue;
      }
      const data = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1] ?? '');
        r.readAsDataURL(f);
      });
      out.push({ data, mimeType: f.type || 'image/png', name: f.name });
    }
    if (draftEpoch.current === epoch) setImages((prev) => [...prev, ...out]);
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
    <div className="safe-x safe-bottom relative border-t bg-background px-3 pb-2 pt-2">
      {(state?.queue.length ?? 0) > 0 && (
        <Collapsible open={queueOpen} onOpenChange={setQueueOpen} className="mb-2">
          <CollapsibleTrigger className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent/60">
            {t('composer.queue', { count: state?.queue.length ?? 0 })}
            <ChevronDown
              className={`size-4 transition-transform ${queueOpen ? 'rotate-180' : ''}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1">
            <section
              className="max-h-[28dvh] space-y-1 overflow-y-auto"
              aria-label={t('composer.queue', { count: state?.queue.length ?? 0 })}
            >
              {state?.queue.map((item) => {
                const queuedText = item.blocks
                  .filter((b) => b.type === 'text')
                  .map((b) => b.text)
                  .join(' ');
                const imgCount = item.blocks.filter((b) => b.type === 'image').length;
                const fileCount = item.blocks.filter(
                  (b) => b.type !== 'text' && b.type !== 'image',
                ).length;
                const attachments = imgCount + fileCount;
                return (
                  <div
                    key={item.id}
                    className={`flex min-w-0 items-center gap-1 rounded-lg border px-2 py-1 ${
                      item.id === editingId ? 'border-primary bg-primary/5' : 'bg-muted/40'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm" title={queuedText}>
                      {queuedText || t('composer.attachments', { count: attachments })}
                    </span>
                    {imgCount > 0 && (
                      <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                        <ImageIcon className="size-3.5" />
                        {imgCount}
                      </span>
                    )}
                    {fileCount > 0 && (
                      <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                        <FileIcon className="size-3.5" />
                        {fileCount}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 shrink-0"
                      aria-label={t('composer.sendNow')}
                      title={t('composer.sendNow')}
                      disabled={!agentReady || item.id === editingId}
                      onClick={() =>
                        send({ type: 'prompt.sendNow', sessionId, id: item.id }).catch(
                          (e) =>
                            void import('sonner').then(({ toast }) =>
                              toast.error((e as Error).message),
                            ),
                        )
                      }
                    >
                      <Send className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 shrink-0"
                      aria-label={t('composer.editQueued')}
                      disabled={
                        editingId != null ||
                        !!text.trim() ||
                        images.length > 0 ||
                        mentions.length > 0
                      }
                      onClick={() => {
                        // Edit in place: keep the item queued; prompt.update preserves its position.
                        setEditingId(item.id);
                        setText(
                          item.blocks
                            .filter((b) => b.type === 'text')
                            .map((b) => b.text)
                            .join('\n'),
                        );
                        setImages(
                          item.blocks
                            .filter((b) => b.type === 'image')
                            .map((b) => ({ data: b.data, mimeType: b.mimeType, name: 'image' })),
                        );
                        setMentions(
                          item.blocks
                            .filter((b) => b.type === 'resource_link')
                            .map((b) => ({ name: b.name ?? b.uri, uri: b.uri })),
                        );
                        taRef.current?.focus();
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 shrink-0"
                      aria-label={t('composer.removeQueued')}
                      onClick={() => {
                        if (item.id === editingId) cancelEdit();
                        send({ type: 'prompt.remove', sessionId, id: item.id }).catch(
                          (e) =>
                            void import('sonner').then(({ toast }) =>
                              toast.error((e as Error).message),
                            ),
                        );
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </section>
          </CollapsibleContent>
        </Collapsible>
      )}
      {mentionOpen && (
        <div className="absolute inset-x-3 bottom-full mb-1 max-h-[40dvh] overflow-y-auto rounded-xl border bg-popover shadow-lg">
          {fsResults.length === 0 ? (
            <p className="px-4 py-4 text-center text-sm text-muted-foreground">
              {fsLoading ? t('common.loading') : t('composer.noMatches')}
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

      {editingId && (
        <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-primary/50 bg-primary/5 px-3 py-1.5 text-xs">
          <Pencil className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">{t('composer.editing')}</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={t('common.cancel')}
            onClick={cancelEdit}
          >
            ×
          </Button>
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
        {/* Utility buttons sit inside the input box so the textarea keeps room. */}
        <div className="flex min-h-11 min-w-0 flex-1 items-end rounded-xl border border-input shadow-xs transition-[color,box-shadow] has-[:disabled]:opacity-50 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
          <div className="flex items-center self-end pb-1 pl-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-10 shrink-0"
              aria-label={t('composer.attach')}
              onClick={() => fileRef.current?.click()}
            >
              <ImageIcon className="size-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 shrink-0"
              aria-label={t('composer.mention')}
              onClick={() => {
                setText((v) => `${v}@`);
                setMentionOpen(true);
                setMentionQ('');
                fetchMention('');
                taRef.current?.focus();
              }}
            >
              <AtSign className="size-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 shrink-0"
              aria-label={t('cmd.title')}
              onClick={() => setCmdOpen(true)}
            >
              <span
                aria-hidden="true"
                className="flex size-6 items-center justify-center rounded-md border text-sm font-semibold"
              >
                /
              </span>
            </Button>
          </div>
          <Textarea
            ref={taRef}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !mentionOpen && enterToSend) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={agentReady ? t('composer.placeholder') : t('chat.agentNotReady')}
            disabled={!agentReady}
            rows={1}
            className={`max-h-36 min-h-11 min-w-0 flex-1 resize-none rounded-xl border-0 bg-transparent px-1 py-2.5 shadow-none focus-visible:ring-0 dark:bg-transparent ${
              overflow ? 'overflow-y-auto' : 'overflow-y-hidden'
            }`}
          />
        </div>

        {working && (
          <Button
            variant="destructive"
            size="icon"
            className="size-10 shrink-0 rounded-full"
            aria-label={t('composer.stop')}
            onClick={() => send({ type: 'cancel', sessionId }).catch(() => {})}
          >
            <Square className="size-4 fill-current" />
          </Button>
        )}
        <Button
          size="icon"
          className="size-10 shrink-0 rounded-full"
          aria-label={
            editingId
              ? t('composer.saveEdit')
              : text.trim().startsWith('/btw ') && state?.commands.some((c) => c.name === 'btw')
                ? t('aside.ask')
                : working
                  ? t('composer.queued')
                  : t('composer.send')
          }
          disabled={!agentReady || (!text.trim() && images.length === 0 && mentions.length === 0)}
          onClick={submit}
        >
          {editingId ? <Check className="size-5" /> : <Send className="size-5" />}
        </Button>
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
