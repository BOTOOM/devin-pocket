import type { ContentBlock, SessionState, TranscriptItem } from '@shared/protocol';
import { ArrowDown, ChevronRight, Loader2, Wrench } from 'lucide-react';
import { memo, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ToolCard } from '@/components/ToolCard';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useT } from '@/i18n';
import { Markdown } from '@/lib/markdown';
import { segmentStart, spanSeconds, visibleSegments } from '@/lib/work-groups';
import { useStore } from '@/store';

const PAGE = 60;

export function Transcript({
  state,
  scroller,
}: {
  state: SessionState;
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const t = useT();
  const showThoughts = useStore((s) => s.prefs.showThoughts);
  const [follow, setFollow] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const anchorRef = useRef<{ height: number; top: number } | null>(null);
  const hiddenRef = useRef(0);

  const items = state.items;
  const hidden = Math.max(0, items.length - limit);
  hiddenRef.current = hidden;
  const itemsLenRef = useRef(items.length);
  itemsLenRef.current = items.length;
  const working = state.turn === 'working' || state.turn === 'awaitingPermission';
  // grouping runs over the full history so work-run keys stay stable across
  // pagination — remounting a group the user opened would lose its state
  const segments = visibleSegments(items, limit);
  const lastSeg = segments.at(-1);

  const expand = () => {
    const el = scroller.current;
    if (el) anchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
    // itemsLenRef: the mount-once scroll listener captures this expand, so it
    // must read the current length, not the one from the first render.
    setLimit((l) => Math.min(l + PAGE, itemsLenRef.current));
  };

  // Keep the viewport anchored when prepending older items.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when limit changes
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchorRef.current;
    if (el && a) {
      anchorRef.current = null;
      el.scrollTop = el.scrollHeight - a.height + a.top;
    }
  }, [limit]);

  // Auto-scroll tail-follow; pause when the user scrolls up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every new/updated item
  useEffect(() => {
    const el = scroller.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [follow, items]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: expand reads refs only; mount once
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
      if (el.scrollTop < 160 && hiddenRef.current > 0) expand();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="relative px-3 py-4">
      <div className="space-y-3">
        {hidden > 0 && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={expand}>
              {t('chat.loadEarlier', { n: Math.min(hidden, PAGE) })}
            </Button>
          </div>
        )}
        {segments.map((seg, i) => {
          if (seg.type === 'item') return <Item key={seg.item.id} item={seg.item} />;
          const first = seg.items[0];
          if (!first) return null;
          const active = working && i === segments.length - 1;
          const next = segments[i + 1];
          const nextStart = next ? segmentStart(next) : undefined;
          // group end: next segment's start, else turn end / last item — only
          // used for finished durations; an active group shows a live label
          const endAt = nextStart ?? state.turnEndedAt ?? seg.items.at(-1)?.at ?? first.at;
          return (
            <WorkingSection
              key={seg.key}
              items={seg.items}
              active={active}
              endAt={endAt}
              cwd={state.cwd}
              showThoughts={showThoughts}
            />
          );
        })}
        {/* the active group carries its own spinner — show the generic loader
            only while answering (streaming text) or before the first work item */}
        {working && lastSeg?.type !== 'work' && (
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
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          <ArrowDown className="size-4" /> {t('chat.newMessages')}
        </Button>
      )}
    </div>
  );
}

/**
 * Collapsible run of work items (thoughts + tool calls) — desktop Devin style.
 * Open + "Working…" while the turn is live; auto-collapses to
 * "Worked for Ns" when the agent answers or the turn ends.
 */
function WorkingSection({
  items,
  active,
  endAt,
  cwd,
  showThoughts,
}: {
  items: TranscriptItem[];
  active: boolean;
  endAt: number;
  cwd: string;
  showThoughts: boolean;
}) {
  const t = useT();
  // the thoughts pref only auto-opens groups that actually have thoughts —
  // tool-only runs stay collapsed
  const keepOpen = showThoughts && items.some((it) => it.kind === 'thought');
  const [open, setOpen] = useState(active || keepOpen);
  // auto-syncs when the group stops being live or when thoughts enter the
  // visible slice (loading earlier items reveals thoughts the pref wants
  // shown) — but only until the user toggles the section: a manual close
  // wins over every later transition
  const manualRef = useRef(false);
  useEffect(() => {
    if (!manualRef.current) setOpen(active || keepOpen);
  }, [active, keepOpen]);
  const toggle = (v: boolean) => {
    manualRef.current = true;
    setOpen(v);
  };

  const startedAt = items[0]?.at ?? endAt;
  return (
    <Collapsible open={open} onOpenChange={toggle} className="space-y-1.5">
      <CollapsibleTrigger
        data-testid="working-section"
        className="flex min-h-8 w-full items-center gap-2 text-left text-sm text-muted-foreground"
      >
        {active ? (
          <Loader2 className="size-4 shrink-0 animate-spin" />
        ) : (
          <Wrench className="size-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">
          {active ? t('work.active') : t('work.done', { s: spanSeconds(startedAt, endAt) })}
        </span>
        <ChevronRight
          className={`size-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2.5 border-l-2 border-muted-foreground/20 pl-3">
        {items.map((item, i) => {
          const itemEnd = items[i + 1]?.at ?? endAt;
          if (item.kind === 'thought')
            return (
              <ThoughtItem key={item.id} item={item} endAt={itemEnd} showThoughts={showThoughts} />
            );
          if (item.kind === 'tool') return <ToolCard key={item.id} item={item} cwd={cwd} />;
          return null;
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Thought row inside the working section: open + pulsing "Thinking…" while
 * streaming, auto-collapses to "Thought for Ns" when the next item arrives.
 * The showThoughts pref keeps finished thoughts expanded.
 */
function ThoughtItem({
  item,
  endAt,
  showThoughts,
}: {
  item: Extract<TranscriptItem, { kind: 'thought' }>;
  endAt: number;
  showThoughts: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(item.streaming || showThoughts);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-sync when streaming flips
  useEffect(() => {
    setOpen(item.streaming || showThoughts);
  }, [item.streaming]);
  if (!item.text.trim()) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex min-h-8 items-center gap-2 text-sm text-muted-foreground">
        <ChevronRight className="size-4 transition-transform [[data-state=open]>&]:rotate-90" />
        <span className={item.streaming ? 'animate-pulse' : ''}>
          {item.streaming
            ? t('chat.thinking')
            : t('chat.thoughtFor', { s: spanSeconds(item.at, endAt) })}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-l-2 border-muted-foreground/30 pl-3 text-sm italic text-muted-foreground">
        <Markdown text={item.text} />
      </CollapsibleContent>
    </Collapsible>
  );
}

const Item = memo(function Item({ item }: { item: TranscriptItem }) {
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
      // thoughts render inside WorkingSection; this is a defensive fallback
      return item.text.trim() ? (
        <div className="border-l-2 border-muted-foreground/30 pl-3 text-sm italic text-muted-foreground">
          <Markdown text={item.text} />
        </div>
      ) : null;
    case 'tool':
      return <ToolCard item={item} cwd="" />;
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
