import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { send } from '@/lib/ws';

export function RenameDialog({
  sessionId,
  current,
  open,
  onOpenChange,
}: {
  sessionId: string;
  current?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useT();
  const [value, setValue] = useState(current ?? '');
  useEffect(() => {
    if (open) setValue(current ?? '');
  }, [open, current]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('rename.title')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!value.trim()) return;
            await send({ type: 'session.rename', sessionId, title: value.trim() }).catch(() => {});
            onOpenChange(false);
          }}
        >
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('rename.placeholder')}
            autoFocus
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!value.trim()}>
              {t('common.rename')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
