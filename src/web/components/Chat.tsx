import { ChevronLeft, Loader2, MessageCircleQuestion, MoreVertical, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Composer } from '@/components/Composer';
import { PermissionSheet } from '@/components/PermissionSheet';
import { PlanPanel } from '@/components/PlanPanel';
import { RenameDialog } from '@/components/RenameDialog';
import { StatusStrip } from '@/components/StatusStrip';
import { Transcript } from '@/components/Transcript';
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
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import { baseName } from '@/lib/format';
import { Markdown } from '@/lib/markdown';
import { navigate } from '@/lib/router';
import { send } from '@/lib/ws';
import { useStore } from '@/store';

export function ChatScreen({ sessionId }: { sessionId: string }) {
  const t = useT();
  const state = useStore((s) => s.open.get(sessionId));
  const summary = useStore((s) => s.sessions.find((x) => x.sessionId === sessionId));
  const hydrated = useStore((s) => s.hydrated);
  const agent = useStore((s) => s.agent);
  const [renameOpen, setRenameOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [asideOpen, setAsideOpen] = useState(false);
  const [asideQuestion, setAsideQuestion] = useState('');

  // Open the session if the server has it listed but not loaded (e.g. deep link).
  useEffect(() => {
    if (hydrated && !state && summary && !summary.locked) {
      send({ type: 'session.open', sessionId, cwd: summary.cwd }).catch(() => {});
    }
  }, [hydrated, state, summary, sessionId]);

  useEffect(() => {
    if (state?.aside?.status === 'working') setAsideOpen(true);
  }, [state?.aside?.status]);

  const title = state?.title || summary?.title || t('session.untitled');
  const cwd = state?.cwd ?? summary?.cwd ?? '';

  const askAside = async () => {
    const question = asideQuestion.trim();
    if (!question || state?.aside?.status === 'working') return;
    try {
      await send({ type: 'aside.ask', sessionId, question });
      setAsideQuestion('');
    } catch (e) {
      void import('sonner').then(({ toast }) => toast.error((e as Error).message));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="safe-top safe-x flex items-center gap-1 border-b px-4 py-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('common.back')}
          onClick={() => {
            if (history.length > 1) history.back();
            else navigate('home');
          }}
        >
          <ChevronLeft className="size-5" />
        </Button>
        <button
          type="button"
          className="min-w-0 flex-1 rounded-md px-2 py-1 text-left"
          onClick={() => setRenameOpen(true)}
        >
          <div className="truncate font-semibold">{title}</div>
          <div className="truncate text-xs text-muted-foreground">{baseName(cwd) || cwd}</div>
        </button>
        {state?.commands.some((c) => c.name === 'btw') && (
          <Button
            variant={asideOpen ? 'secondary' : 'ghost'}
            size="icon"
            aria-label={t('aside.title')}
            onClick={() => setAsideOpen((v) => !v)}
          >
            <MessageCircleQuestion className="size-5" />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="menu">
              <MoreVertical className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setRenameOpen(true)}>
              {t('common.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => navigator.clipboard.writeText(sessionId).catch(() => {})}
            >
              {t('session.copyId')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                send({ type: 'session.close', sessionId }).catch(() => {});
                navigate('home');
              }}
            >
              {t('chat.closeSession')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open('/api/report', '_blank')}>
              {t('chat.shareReport')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setDelOpen(true)}>
              {t('chat.deleteSession')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <StatusStrip state={state} sessionId={sessionId} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!state ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : state.loading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : state.items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 p-8 text-center">
            <div className="text-sm font-medium text-muted-foreground">
              {baseName(cwd) || cwd}
              {state.currentMode ? ` · ${state.currentMode}` : ''}
            </div>
            <p className="text-sm text-muted-foreground">{t('chat.emptyHint')}</p>
          </div>
        ) : (
          <Transcript state={state} />
        )}
      </div>

      {state?.commands.some((c) => c.name === 'btw') && asideOpen && (
        <section
          className="safe-x max-h-[42dvh] space-y-2 overflow-y-auto border-t bg-card px-4 py-2"
          aria-label={t('aside.title')}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{t('aside.title')}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              aria-label={t('common.close')}
              onClick={() => setAsideOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
          {state.aside && (
            <div className="space-y-2 rounded-lg border bg-background p-2 text-sm">
              <p className="break-words font-medium">{state.aside.question}</p>
              {state.aside.answer && <Markdown text={state.aside.answer} />}
              {state.aside.status === 'working' && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t('aside.working')}
                </p>
              )}
              {state.aside.error && <p className="text-destructive">{state.aside.error}</p>}
              {state.aside.status === 'done' && !state.aside.answer && (
                <p className="text-muted-foreground">{t('aside.empty')}</p>
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={asideQuestion}
              onChange={(e) => setAsideQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void askAside();
                }
              }}
              aria-label={t('aside.placeholder')}
              placeholder={t('aside.placeholder')}
              rows={2}
              className="min-w-0 flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm"
            />
            <Button
              size="sm"
              className="min-h-11 shrink-0"
              disabled={
                agent.phase !== 'ready' ||
                state.aside?.status === 'working' ||
                !asideQuestion.trim()
              }
              onClick={() => void askAside()}
            >
              {t('aside.ask')}
            </Button>
          </div>
        </section>
      )}

      {state && state.plan.length > 0 && <PlanPanel plan={state.plan} />}

      {summary?.locked && !state ? (
        <div className="safe-bottom border-t bg-muted px-4 py-3 text-center text-sm text-muted-foreground">
          {t('chat.locked')}
        </div>
      ) : (
        <Composer sessionId={sessionId} state={state} agentReady={agent.phase === 'ready'} />
      )}

      {state?.permission && <PermissionSheet request={state.permission} sessionId={sessionId} />}

      <RenameDialog
        sessionId={sessionId}
        current={state?.title ?? summary?.title}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <Dialog open={delOpen} onOpenChange={setDelOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('home.delete.title')}</DialogTitle>
            <DialogDescription>{t('home.delete.body')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await send({ type: 'session.delete', sessionId, cwd }).catch(() => {});
                navigate('home');
              }}
            >
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
