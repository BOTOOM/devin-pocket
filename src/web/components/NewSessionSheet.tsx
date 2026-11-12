import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { FolderPicker } from '@/components/WorkspaceSheet';
import { useT } from '@/i18n';
import { baseName } from '@/lib/format';
import { navigate } from '@/lib/router';
import { send } from '@/lib/ws';
import { getState, setPrefs, useStore } from '@/store';

export function NewSessionSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const suggested = useStore((s) => s.prefs.workspace ?? s.settings?.cwd ?? '');
  const [cwd, setCwd] = useState(suggested);
  const [creating, setCreating] = useState(false);
  const starting = useRef(false);
  const startButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) setCwd(suggested);
  }, [open, suggested]);

  const pick = (path: string) => {
    setCwd(path);
    const prefs = getState().prefs;
    const saved = prefs.workspaces.find((w) => w.path === path);
    setPrefs({
      workspace: path,
      workspaces: [
        { ...saved, path, name: saved?.name || baseName(path), lastUsedAt: Date.now() },
        ...prefs.workspaces.filter((w) => w.path !== path),
      ],
    });
  };
  const start = async () => {
    if (!cwd || starting.current) return;
    starting.current = true;
    setCreating(true);
    try {
      const res = (await send({ type: 'session.new', cwd })) as { sessionId: string; cwd: string };
      pick(res.cwd);
      onOpenChange(false);
      navigate({ name: 'chat', sessionId: res.sessionId });
    } catch (error) {
      const { toast } = await import('sonner');
      toast.error(t('home.newSession.error'), {
        description:
          (error as Error).message === 'invalid_cwd'
            ? t('sessionFolder.invalid')
            : (error as Error).message,
      });
    } finally {
      starting.current = false;
      setCreating(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!starting.current) onOpenChange(next);
      }}
    >
      <SheetContent
        side="bottom"
        panelSize="workspace"
        className="safe-x safe-bottom max-h-[85dvh] px-4"
        showCloseButton={!creating}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          startButton.current?.focus();
        }}
      >
        <SheetHeader className="px-0 pr-8">
          <SheetTitle>{t('home.newSession')}</SheetTitle>
          <SheetDescription>{t('sessionFolder.description')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 overflow-y-auto">
          <p className="mb-2 text-sm font-medium">{t('sessionFolder.selected')}</p>
          <p
            data-testid="selected-folder"
            className="mb-4 break-all rounded-lg border bg-muted p-3 text-sm"
            title={cwd}
          >
            {cwd || t('home.chooseFolder')}
          </p>
          <fieldset disabled={creating}>
            <FolderPicker open={open} current={cwd} onPick={pick} />
          </fieldset>
        </div>
        <div className="flex shrink-0 gap-2 border-t py-4">
          <Button
            className="h-11"
            variant="outline"
            disabled={creating}
            onClick={() => onOpenChange(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button
            ref={startButton}
            className="h-11 flex-1"
            disabled={!cwd || creating}
            aria-busy={creating}
            onClick={() => void start()}
          >
            {creating && <Loader2 className="size-4 animate-spin" />}
            {creating ? t('home.newSession.creating') : t('sessionFolder.start')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
