import { type SessionActivity, sessionActivity } from '@shared/session-activity';
import { Loader2, ShieldAlert } from 'lucide-react';
import { type I18nKey, useT } from '@/i18n';
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
