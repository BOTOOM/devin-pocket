import type { SessionSummary } from '@shared/protocol';
import { filterSessions, type SessionActivity, sessionActivity } from '@shared/session-activity';
import { Loader2, Lock, Plus, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { NewSessionSheet } from '@/components/NewSessionSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { type I18nKey, useT } from '@/i18n';
import { baseName, relTime } from '@/lib/format';
import { navigate } from '@/lib/router';
import { useStore } from '@/store';

const ACTIVITY_LABEL: Record<SessionActivity, I18nKey> = {
  permission: 'activity.permission',
  working: 'activity.working',
  unseen: 'activity.unseen',
};

/** Live state of a session: permission pending, working, or finished unseen. */
export function SessionActivityBadge({
  sessionId,
  open = false,
}: {
  sessionId: string;
  /** show the "open" dot when there is no activity to report */
  open?: boolean;
}) {
  const t = useT();
  const activity = useStore((s) => sessionActivity(s.open.get(sessionId), s.unseen.has(sessionId)));
  if (!activity) {
    return open ? (
      <span className="size-2 shrink-0 rounded-full bg-success" title={t('home.openBadge')} />
    ) : null;
  }
  const label = t(ACTIVITY_LABEL[activity]);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-activity={activity}
      className="inline-flex shrink-0 items-center"
    >
      {activity === 'permission' ? (
        <ShieldAlert className="size-4 text-warning" />
      ) : activity === 'working' ? (
        <Loader2 className="size-3.5 animate-spin text-info" />
      ) : (
        <span className="size-2.5 rounded-full bg-info" />
      )}
    </span>
  );
}

export function SessionSwitcher({
  open,
  onOpenChange,
  currentSessionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSessionId: string;
}) {
  const t = useT();
  const sessions = useStore((s) => s.sessions);
  const [query, setQuery] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const shown = filterSessions(sessions, query, t('session.untitled'));

  const setOpen = (v: boolean) => {
    if (!v) setQuery('');
    onOpenChange(v);
  };

  const go = (s: SessionSummary) => {
    setOpen(false);
    if (s.sessionId !== currentSessionId) navigate({ name: 'chat', sessionId: s.sessionId });
  };

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          data-testid="session-switcher"
          // Phones: don't pop the keyboard over the list until the user taps search.
          onOpenAutoFocus={(e) => {
            if (matchMedia('(pointer: coarse)').matches) e.preventDefault();
          }}
          className="safe-x safe-bottom flex max-h-[80dvh] flex-col gap-0 px-0 pb-2"
        >
          <SheetHeader className="px-4 pb-2">
            <SheetTitle>{t('switcher.title')}</SheetTitle>
            <SheetDescription className="sr-only">{t('switcher.description')}</SheetDescription>
          </SheetHeader>
          <div className="flex items-center gap-2 px-4 pb-2">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('switcher.search')}
              aria-label={t('switcher.search')}
              className="h-10 flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              className="size-10 shrink-0"
              aria-label={t('home.newSession')}
              onClick={() => {
                setOpen(false);
                setNewOpen(true);
              }}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-2">
            {shown.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t('switcher.empty')}
              </li>
            )}
            {shown.map((s) => {
              const current = s.sessionId === currentSessionId;
              return (
                <li key={s.sessionId}>
                  <button
                    type="button"
                    data-session-id={s.sessionId}
                    aria-current={current ? 'page' : undefined}
                    className={`flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring ${current ? 'bg-accent' : ''}`}
                    onClick={() => go(s)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">
                          {s.title || t('session.untitled')}
                        </span>
                        <SessionActivityBadge sessionId={s.sessionId} open={s.open} />
                        {s.locked && <Lock className="size-3.5 shrink-0 text-muted-foreground" />}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {relTime(s.updatedAt ?? s.createdAt)} · {baseName(s.cwd)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
      <NewSessionSheet open={newOpen} onOpenChange={setNewOpen} />
    </>
  );
}
