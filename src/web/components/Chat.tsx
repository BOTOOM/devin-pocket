import { ChevronLeft, MoreVertical } from 'lucide-react';
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

  // Open the session if the server has it listed but not loaded (e.g. deep link).
  useEffect(() => {
    if (hydrated && !state && summary && !summary.locked) {
      send({ type: 'session.open', sessionId, cwd: summary.cwd }).catch(() => {});
    }
  }, [hydrated, state, summary, sessionId]);

  const title = state?.title || summary?.title || t('session.untitled');
  const cwd = state?.cwd ?? summary?.cwd ?? '';

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
        ) : state.loading && state.items.length === 0 ? (
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
