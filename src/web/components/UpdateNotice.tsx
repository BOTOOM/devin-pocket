import type { UpdateInfo } from '@shared/protocol';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';

export function UpdateNotice() {
  const t = useT();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState('');
  useEffect(() => {
    let active = true;
    try {
      setDismissed(localStorage.getItem('dp.update.dismissed') ?? '');
    } catch {}
    const refresh = async () => {
      try {
        const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
        if (!response.ok) return;
        const data = (await response.json()) as { update?: UpdateInfo };
        if (active && data.update) setUpdate(data.update);
      } catch {}
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  if (!update?.updateAvailable || update.latest === dismissed) return null;
  return (
    <aside
      className="flex min-w-0 items-start gap-2 rounded-xl border bg-accent p-3 text-sm"
      aria-label={t('update.title')}
    >
      <p className="min-w-0 flex-1 break-words">
        {t('update.notice', { version: update.latest })}{' '}
        <code className="break-all font-mono">devin-pocket update</code>
      </p>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0"
        aria-label={t('common.close')}
        onClick={() => {
          setDismissed(update.latest);
          try {
            localStorage.setItem('dp.update.dismissed', update.latest);
          } catch {}
        }}
      >
        <X className="size-4" />
      </Button>
    </aside>
  );
}
