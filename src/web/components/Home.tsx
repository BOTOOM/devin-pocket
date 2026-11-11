import type { SessionSummary } from '@shared/protocol';
import {
  FolderOpen,
  Loader2,
  Lock,
  LockOpen,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { RenameDialog } from '@/components/RenameDialog';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { WorkspaceSheet } from '@/components/WorkspaceSheet';
import { useT } from '@/i18n';
import { baseName, dayGroup, relTime } from '@/lib/format';
import { navigate } from '@/lib/router';
import { send } from '@/lib/ws';
import { setPrefs, useStore } from '@/store';

export function HomeScreen() {
  const t = useT();
  const sessions = useStore((s) => s.sessions);
  const hydrated = useStore((s) => s.hydrated);
  const workspaces = useStore((s) => s.workspaces);
  const prefs = useStore((s) => s.prefs);
  const openMap = useStore((s) => s.open);
  const serverCwd = useStore((s) => s.settings?.cwd);
  const [wsOpen, setWsOpen] = useState(false);
  const [rename, setRename] = useState<SessionSummary | null>(null);
  const [del, setDel] = useState<SessionSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Content search is agent-side (sessionListContentSearch); debounce it.
  useEffect(() => {
    if (!hydrated) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(
      () => void send({ type: 'sessions.refresh', query }).catch(() => {}),
      query ? 300 : 0,
    );
    return () => clearTimeout(debounce.current);
  }, [query, hydrated]);

  // Workspace pick only affects "Nueva sesión" — the list itself is global.
  const cwd = prefs.workspace ?? workspaces[0]?.path ?? serverCwd ?? '';

  const pickFolder = (p: string) => {
    if (!p) return;
    if (!prefs.workspaces.some((w) => w.path === p)) {
      setPrefs({
        workspaces: [...prefs.workspaces, { path: p, name: baseName(p), lastUsedAt: Date.now() }],
      });
    }
    setPrefs({ workspace: p });
  };

  const newSession = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = (await send({ type: 'session.new', cwd })) as { sessionId?: string } | undefined;
      if (res?.sessionId) {
        navigate({ name: 'chat', sessionId: res.sessionId });
        return;
      }
      setCreating(false);
    } catch (e) {
      setCreating(false);
      void import('sonner').then(({ toast }) =>
        toast.error(t('home.newSession.error'), { description: (e as Error).message }),
      );
    }
  };

  const groups: Record<'today' | 'yesterday' | 'older', SessionSummary[]> = {
    today: [],
    yesterday: [],
    older: [],
  };
  for (const s of sessions) groups[dayGroup(s.updatedAt ?? s.createdAt)].push(s);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="safe-top safe-x flex items-center gap-2 border-b px-4 py-3">
        <h1 className="flex-1 text-lg font-semibold tracking-tight">{t('app.name')}</h1>
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('settings.title')}
          onClick={() => navigate('settings')}
        >
          <SettingsIcon className="size-5" />
        </Button>
      </header>

      <div className="safe-x flex items-center gap-2 px-4 py-3">
        <Button
          variant="outline"
          data-chip="workspace"
          className="h-10 max-w-[55%] justify-start gap-2 truncate"
          onClick={() => setWsOpen(true)}
        >
          <FolderOpen className="size-4 shrink-0" />
          <span className="truncate">{cwd ? baseName(cwd) : t('home.chooseFolder')}</span>
        </Button>
        <div className="flex-1" />
        <Button
          className="h-10 gap-2"
          disabled={!cwd || creating}
          aria-busy={creating}
          onClick={newSession}
        >
          {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {creating ? t('home.newSession.creating') : t('home.newSession')}
        </Button>
      </div>

      <div className="safe-x px-4 pb-2">
        <div className="relative">
          <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('home.search')}
            className="h-9 pl-9"
          />
        </div>
      </div>

      <div className="safe-x flex items-center justify-between px-4 pb-1">
        <h2 className="text-sm font-medium text-muted-foreground">{t('home.sessions')}</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('common.refresh')}
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            await send({ type: 'sessions.refresh' }).catch(() => {});
            setTimeout(() => setRefreshing(false), 500);
          }}
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="safe-x min-h-0 flex-1 overflow-y-auto px-2 pb-8">
        {!hydrated ? (
          <div className="space-y-2 p-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="mx-2 mt-10 flex flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Sparkles className="size-6" />
            </div>
            <h3 className="text-lg font-semibold">{t('home.start.title')}</h3>
            <p className="text-sm text-muted-foreground">{t('home.start.body')}</p>
            <Button
              className="mt-1 gap-2"
              disabled={!cwd || creating}
              aria-busy={creating}
              onClick={newSession}
            >
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {creating ? t('home.newSession.creating') : t('home.newSession')}
            </Button>
          </div>
        ) : (
          (Object.entries(groups) as [keyof typeof groups, SessionSummary[]][]).map(
            ([g, list]) =>
              list.length > 0 && (
                <section key={g}>
                  <h3 className="px-3 pt-4 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t(
                      `common.${g === 'today' ? 'today' : g === 'yesterday' ? 'yesterday' : 'older'}`,
                    )}
                  </h3>
                  {list.map((s) => (
                    <SessionRow
                      key={s.sessionId}
                      s={s}
                      open={openMap.has(s.sessionId)}
                      onRename={() => setRename(s)}
                      onDelete={() => setDel(s)}
                    />
                  ))}
                </section>
              ),
          )
        )}
      </div>

      <WorkspaceSheet open={wsOpen} onOpenChange={setWsOpen} current={cwd} onPick={pickFolder} />
      {rename && (
        <RenameDialog
          sessionId={rename.sessionId}
          current={rename.title}
          open
          onOpenChange={(o) => !o && setRename(null)}
        />
      )}
      <DeleteDialog s={del} onClose={() => setDel(null)} />
    </div>
  );
}

function SessionRow({
  s,
  open,
  onRename,
  onDelete,
}: {
  s: SessionSummary;
  open: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  // "Forzar cierre" needs the agent's cognition.ai/force close capability.
  const canForceClose = useStore((s) => s.agentInfo?.caps.forceClose === true);
  const title = s.title || t('session.untitled');
  return (
    <div className="flex min-h-14 w-full items-center rounded-lg hover:bg-accent/60">
      <button
        type="button"
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => navigate({ name: 'chat', sessionId: s.sessionId })}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{title}</span>
            {open && (
              <span
                className="size-2 shrink-0 rounded-full bg-success"
                title={t('home.openBadge')}
              />
            )}
            {s.locked && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>{t('home.locked')}</TooltipContent>
              </Tooltip>
            )}
            {s.hasUserMessages === false && (
              <span className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground">
                {t('home.emptySession')}
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {relTime(s.updatedAt ?? s.createdAt)} · {baseName(s.cwd)}
            {s.locked && ` · ${t('home.locked')}`}
          </span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onRename}>{t('common.rename')}</DropdownMenuItem>
          {s.locked && canForceClose && (
            <DropdownMenuItem
              onClick={async () => {
                try {
                  await send({ type: 'session.forceClose', sessionId: s.sessionId });
                  void import('sonner').then(({ toast }) => toast.success(t('home.unlockDone')));
                } catch (e) {
                  void import('sonner').then(({ toast }) => toast.error((e as Error).message));
                }
              }}
            >
              <LockOpen className="size-4" />
              {t('home.unlock')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            {t('common.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function DeleteDialog({ s, onClose }: { s: SessionSummary | null; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog open={!!s} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('home.delete.title')}</DialogTitle>
          <DialogDescription>{t('home.delete.body')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (s)
                await send({
                  type: 'session.delete',
                  sessionId: s.sessionId,
                  cwd: s.cwd,
                }).catch(() => {});
              onClose();
            }}
          >
            {t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
