import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useT } from '@/i18n';
import { send } from '@/lib/ws';
import { useStore } from '@/store';

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
  const [generating, setGenerating] = useState(false);
  // `/rename` with no title asks the agent to generate one (CLI ≥3000.11.205)
  // — it needs the session open so the prompt goes through.
  const isOpen = useStore((s) => s.open.has(sessionId));
  useEffect(() => {
    if (open) setValue(current ?? '');
  }, [open, current]);

  const generate = async () => {
    setGenerating(true);
    try {
      await send({ type: 'session.rename', sessionId, title: '' });
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };
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
          <div className="flex items-center gap-2">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t('rename.placeholder')}
              autoFocus
            />
            {isOpen && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={generating}
                    onClick={() => void generate()}
                  >
                    <Sparkles className={`size-4 ${generating ? 'animate-pulse' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('rename.generate')}</TooltipContent>
              </Tooltip>
            )}
          </div>
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
