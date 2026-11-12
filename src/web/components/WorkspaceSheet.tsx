import { pathBreadcrumbs } from '@shared/path-display';
import type { FsEntry } from '@shared/protocol';
import { ChevronLeft, Folder, FolderOpen, Home } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import { baseName } from '@/lib/format';
import { useStore } from '@/store';

interface BrowseResp {
  entries: FsEntry[];
  path: string;
  home: string;
}

export function WorkspaceSheet({
  open,
  onOpenChange,
  current,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  current?: string;
  onPick: (path: string) => void;
}) {
  const t = useT();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        panelSize="workspace"
        className="safe-x safe-bottom max-h-[80dvh] overflow-y-auto px-4"
      >
        <SheetHeader className="px-0">
          <SheetTitle>{t('home.workspaces')}</SheetTitle>
          <SheetDescription className="sr-only">{t('home.workspaces')}</SheetDescription>
        </SheetHeader>
        <FolderPicker
          open={open}
          current={current}
          onPick={(path) => {
            onPick(path);
            onOpenChange(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

export function FolderPicker({
  open,
  current,
  onPick,
}: {
  open: boolean;
  current?: string;
  onPick: (path: string) => void;
}) {
  const t = useT();
  const workspaces = useStore((s) => s.workspaces);
  const prefs = useStore((s) => s.prefs);
  const [browse, setBrowse] = useState<string | null>(null);
  const [resp, setResp] = useState<BrowseResp | null>(null);
  const [err, setErr] = useState(false);

  const saved = [
    ...workspaces,
    ...prefs.workspaces.filter((w) => !workspaces.some((x) => x.path === w.path)),
  ];

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-init when the sheet opens
  useEffect(() => {
    if (!open) return;
    // No saved folders → go straight to the browser; otherwise show the list.
    setBrowse(saved.length === 0 ? (current ?? '') : null);
    setResp(null);
    setErr(false);
  }, [open]);

  useEffect(() => {
    if (browse === null || !open) return;
    const controller = new AbortController();
    setResp(null);
    setErr(false);
    fetch(`/api/workspaces/browse?path=${encodeURIComponent(browse)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: BrowseResp) => setResp(d))
      .catch(() => {
        if (!controller.signal.aborted) setErr(true);
      });
    return () => controller.abort();
  }, [browse, open]);

  const crumbs = resp ? pathBreadcrumbs(resp.path) : [];

  return (
    <div>
      {browse === null ? (
        <div className="space-y-1 pb-4">
          {saved.length > 0 && (
            <p className="px-1 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('ws.saved')}
            </p>
          )}
          {saved.map((w) => (
            <button
              key={w.path}
              type="button"
              className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-accent ${current === w.path ? 'bg-accent' : ''}`}
              onClick={() => {
                onPick(w.path);
                setBrowse(null);
              }}
            >
              <FolderOpen className="size-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <div className="truncate font-medium">{w.name || baseName(w.path)}</div>
                <div className="truncate text-xs text-muted-foreground">{w.path}</div>
              </div>
            </button>
          ))}
          <button
            type="button"
            className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-primary hover:bg-accent"
            onClick={() => setBrowse(current ?? '')}
          >
            <Folder className="size-5 shrink-0" />
            {t('ws.browseOther')}
          </button>
        </div>
      ) : (
        <div className="pb-4">
          <div className="mb-1 flex items-center gap-1 overflow-x-auto text-sm">
            {saved.length > 0 && (
              <button
                type="button"
                className="mr-1 flex shrink-0 items-center gap-1 text-primary"
                onClick={() => setBrowse(null)}
              >
                <ChevronLeft className="size-4" />
              </button>
            )}
            <button type="button" className="shrink-0 text-primary" onClick={() => setBrowse('')}>
              <Home className="size-4" />
            </button>
            {crumbs.map((crumb) => (
              <span key={crumb.path} className="flex shrink-0 items-center gap-1">
                <span className="text-muted-foreground">/</span>
                <button
                  type="button"
                  className="text-primary"
                  onClick={() => setBrowse(crumb.path)}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </div>
          {resp && (
            <p
              className="mb-2 truncate text-xs text-muted-foreground"
              style={{ direction: 'rtl', textAlign: 'left' }}
            >
              {resp.path}
            </p>
          )}
          <Button
            className="mb-3 w-full"
            disabled={!resp?.path}
            onClick={() => {
              if (!resp?.path) return;
              onPick(resp.path);
              setBrowse(null);
            }}
          >
            {t('ws.useFolder')}
            {resp?.path ? ` — ${baseName(resp.path) || '~'}` : ''}
          </Button>
          {resp === null && !err ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : err ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('common.error')}</p>
          ) : (
            (resp?.entries ?? []).map((d) => (
              <button
                key={d.path}
                type="button"
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-accent"
                onClick={() => setBrowse(d.path)}
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{d.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
