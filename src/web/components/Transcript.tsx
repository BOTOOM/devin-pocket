import type { ContentBlock, SessionState, TranscriptItem } from '@shared/protocol';
import { ArrowDown, ChevronRight, Loader2 } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ToolCard } from '@/components/ToolCard';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useT } from '@/i18n';
import { Markdown } from '@/lib/markdown';
import { useStore } from '@/store';

const PAGE = 60;

export function Transcript({ state }: { state: SessionState }) {
  const t = useT();
  const showThoughts = useStore((s) => s.prefs.showThoughts);
  const ref = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const anchorRef = useRef<{ height: number; top: number } | null>(null);
  const hiddenRef = useRef(0);

  const items = state.items;
  const hidden = Math.max(0, items.length - limit);
  hiddenRef.current = hidden;
  const visible = hidden > 0 ? items.slice(-limit) : items;
  const working = state.turn === 'working' || state.turn === 'awaitingPermission';

  const expand = () => {
    const el = ref.current?.parentElement;
    if (el) anchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
    setLimit((l) => Math.min(l + PAGE, items.length));
  };

  // Keep the viewport anchored when prepending older items.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when limit changes
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    const a = anchorRef.current;
    if (el && a) {
      anchorRef.current = null;
      el.scrollTop = el.scrollHeight - a.height + a.top;
    }
  }, [limit]);

  // Auto-scroll tail-follow; pause when the user scrolls up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every new/updated item
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [follow, items]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: expand reads refs only; mount once
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const onScroll = () => {
      setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
      if (el.scrollTop < 160 && hiddenRef.current > 0) expand();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div ref={ref} className="relative px-3 py-4">
      <div className="space-y-3">
        {hidden > 0 && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={expand}>
              {t('chat.loadEarlier', { n: Math.min(hidden, PAGE) })}
            </Button>
          </div>
        )}
        {visible.map((item) => (
          <Item key={item.id} item={item} showThoughts={showThoughts} cwd={state.cwd} />
        ))}
        {working && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('chat.working')}
          </div>
        )}
      </div>
      {!follow && (
        <Button
          size="sm"
          className="sticky bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
          onClick={() => {
            setFollow(true);
            const el = ref.current?.parentElement;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          <ArrowDown className="size-4" /> {t('chat.newMessages')}
        </Button>
      )}
    </div>
  );
}

const Item = memo(function Item({
  item,
  showThoughts,
  cwd,
}: {
  item: TranscriptItem;
  showThoughts: boolean;
  cwd: string;
}) {
  const t = useT();
  switch (item.kind) {
    case 'user':
      return (
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-primary-foreground">
          {item.blocks.map((b, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks are an ordered message
            <UserBlock key={i} block={b} />
          ))}
        </div>
      );
    case 'agent':
      return (
        <div className="prose max-w-none text-[15px] leading-relaxed">
          <Markdown text={item.text} />
        </div>
      );
    case 'thought':
      if (!item.text.trim()) return null;
      return showThoughts ? (
        <div className="rounded-lg border-l-2 border-muted-foreground/30 pl-3 text-sm italic text-muted-foreground">
          <Markdown text={item.text} />
        </div>
      ) : (
        <Collapsible>
          <CollapsibleTrigger className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
            <ChevronRight className="size-4 transition-transform [[data-state=open]>&]:rotate-90" />
            <span className={item.streaming ? 'animate-pulse' : ''}>
              {item.streaming ? t('chat.thinking') : t('chat.thoughtDone')}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-l-2 border-muted-foreground/30 pl-3 text-sm italic text-muted-foreground">
            <Markdown text={item.text} />
          </CollapsibleContent>
        </Collapsible>
      );
    case 'tool':
      return <ToolCard item={item} cwd={cwd} />;
    case 'system':
      return (
        <div
          className={`text-center text-xs ${
            item.level === 'error'
              ? 'text-destructive'
              : item.level === 'warn'
                ? 'text-warning'
                : 'text-muted-foreground'
          }`}
        >
          {item.text}
        </div>
      );
  }
});

function UserBlock({ block }: { block: ContentBlock }) {
  if (block.type === 'text') return <p className="whitespace-pre-wrap">{block.text}</p>;
  if (block.type === 'image')
    return (
      <img
        src={`data:${block.mimeType};base64,${block.data}`}
        alt=""
        className="mt-1 max-h-48 rounded-lg"
      />
    );
  if (block.type === 'resource_link')
    return (
      <span className="mr-1 inline-flex items-center rounded-md bg-primary-foreground/15 px-2 py-0.5 text-xs">
        @{block.name ?? block.uri}
      </span>
    );
  if (block.type === 'resource' && 'text' in block.resource)
    return <p className="whitespace-pre-wrap">{String(block.resource.text).slice(0, 4000)}</p>;
  return null;
}
