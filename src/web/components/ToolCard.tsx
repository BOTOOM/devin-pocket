import type { TranscriptItem } from '@shared/protocol';
import {
  Brain,
  Check,
  ChevronRight,
  FilePen,
  FileText,
  Globe,
  Loader2,
  Search,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import { memo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useT } from '@/i18n';
import { lineDiff } from '@/lib/diff';

type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>;

const ICONS: Record<string, typeof Terminal> = {
  execute: Terminal,
  read: FileText,
  edit: FilePen,
  delete: FilePen,
  move: FilePen,
  search: Search,
  fetch: Globe,
  think: Brain,
};

function statusDot(status: string) {
  if (status === 'completed') return <Check className="size-3.5 text-success" />;
  if (status === 'failed') return <X className="size-3.5 text-destructive" />;
  if (status === 'pending' || status === 'in_progress')
    return <Loader2 className="size-3.5 animate-spin text-info" />;
  return <span className="size-2 rounded-full bg-muted-foreground" />;
}

export function rel(cwd: string, p: string): string {
  const base = cwd.replace(/\/+$/, '');
  return base && p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p;
}

export const ToolCard = memo(function ToolCard({ item, cwd }: { item: ToolItem; cwd: string }) {
  const t = useT();
  const Icon = ICONS[item.toolKind] ?? Wrench;
  const done = item.status === 'completed' || item.status === 'failed';
  // Completed execute tools collapse by default; everything else open.
  const [open, setOpen] = useState(!(item.toolKind === 'execute' && done));
  const diffs = item.content.filter((c) => c.type === 'diff');
  const texts = item.content.filter((c) => c.type === 'content' && c.content?.type === 'text');

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
          {item.exitCode !== undefined && (
            <Badge variant={item.exitCode === 0 ? 'secondary' : 'destructive'} className="shrink-0">
              {t('tool.exitCode', { code: item.exitCode })}
            </Badge>
          )}
          {statusDot(item.status)}
          <ChevronRight
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 border-t px-3 py-2.5">
            {item.command && (
              <code className="block overflow-x-auto rounded-md bg-muted px-2.5 py-1.5 text-[13px]">
                $ {item.command}
              </code>
            )}
            {item.cwd && <div className="text-xs text-muted-foreground">{item.cwd}</div>}
            {diffs.map((c) =>
              c.type === 'diff' ? (
                <DiffView
                  key={c.path}
                  path={c.path}
                  relPath={rel(cwd, c.path)}
                  oldText={c.oldText ?? ''}
                  newText={c.newText}
                />
              ) : null,
            )}
            {texts.map((c) => {
              if (c.type !== 'content' || c.content?.type !== 'text') return null;
              return (
                <pre
                  key={c.content.text.slice(0, 64)}
                  className="max-h-64 overflow-auto rounded-md bg-muted px-2.5 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap"
                >
                  {c.content.text}
                </pre>
              );
            })}
            {item.locations.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {item.locations.map((l) => (
                  <Badge
                    key={`${l.path}:${l.line ?? 0}`}
                    variant="outline"
                    className="font-normal"
                    title={l.path}
                  >
                    {rel(cwd, l.path)}
                    {l.line ? `:${l.line}` : ''}
                  </Badge>
                ))}
              </div>
            )}
            {item.rawOutput !== undefined && (
              <Collapsible>
                <CollapsibleTrigger className="text-xs text-muted-foreground underline underline-offset-4">
                  {t('tool.details')}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted px-2.5 py-1.5 text-xs">
                    {typeof item.rawOutput === 'string'
                      ? item.rawOutput
                      : JSON.stringify(item.rawOutput, null, 2)}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});

export function DiffView({
  path,
  relPath,
  oldText,
  newText,
}: {
  path: string;
  /** display path relative to the session cwd (falls back to `path`) */
  relPath?: string;
  oldText: string;
  newText: string;
}) {
  const lines = lineDiff(oldText, newText);
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="border-b bg-muted/50 px-2.5 py-1 text-xs font-medium" title={path}>
        {relPath ?? path}
      </div>
      <pre className="max-h-72 overflow-auto text-[12.5px] leading-relaxed">
        {lines.map((l, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional by nature
            key={i}
            className={
              l.type === 'add'
                ? 'bg-[var(--diff-add-bg)] text-[var(--diff-add-fg)]'
                : l.type === 'del'
                  ? 'bg-[var(--diff-del-bg)] text-[var(--diff-del-fg)]'
                  : 'text-muted-foreground'
            }
          >
            <span className="inline-block w-5 select-none text-center opacity-60">
              {l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}
            </span>
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
