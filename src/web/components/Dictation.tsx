import { Loader2, Mic, Square, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useT } from '@/i18n';
import { deleteBrowserModel, save, useDictationPreference } from '@/lib/dictation/preferences';
import type { useDictation } from '@/lib/dictation/use-dictation';

type Controller = ReturnType<typeof useDictation>;
export function DictationButton({
  dictation,
  disabled,
}: {
  dictation: Controller;
  disabled: boolean;
}) {
  const t = useT();
  const phase = dictation.state.phase;
  const busy = phase === 'preparing' || phase === 'transcribing';
  const listening = phase === 'listening';
  return (
    <Button
      variant={listening ? 'destructive' : 'ghost'}
      size="icon"
      className="size-10 shrink-0"
      disabled={disabled}
      aria-label={t(listening ? 'dictation.stop' : busy ? 'dictation.cancel' : 'dictation.start')}
      title={t(listening ? 'dictation.stop' : 'dictation.start')}
      onClick={() => {
        if (listening) void dictation.stop();
        else if (busy) dictation.cancel();
        else void dictation.start();
      }}
    >
      {listening ? (
        <Square className="size-4 fill-current" />
      ) : busy ? (
        <Loader2 className="size-5 animate-spin" />
      ) : (
        <Mic className="size-5" />
      )}
    </Button>
  );
}
export function DictationStatus({ dictation }: { dictation: Controller }) {
  const t = useT();
  const { phase, progress } = dictation.state;
  const dialog = phase === 'consent' || phase === 'pack' || phase === 'insecure';
  return (
    <>
      {!dialog && phase !== 'idle' && (
        <div className="flex min-h-10 min-w-0 items-center gap-2 px-2 text-xs" role="status">
          <span className="min-w-0 flex-1">
            {t(
              phase === 'error'
                ? 'dictation.error'
                : phase === 'listening'
                  ? 'dictation.listening'
                  : phase === 'transcribing'
                    ? 'dictation.transcribing'
                    : 'dictation.preparing',
            )}
            {phase === 'preparing' && progress != null ? ` ${progress}%` : ''}
          </span>
          {phase === 'preparing' && progress != null && (
            <progress
              className="w-16 shrink-0"
              max={100}
              value={progress}
              aria-label={t('dictation.preparing')}
            />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0"
            aria-label={t('dictation.cancel')}
            onClick={dictation.cancel}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
      <Dialog
        open={dialog}
        onOpenChange={(open) => {
          if (!open) dictation.cancel();
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t(phase === 'insecure' ? 'dictation.insecureTitle' : 'dictation.title')}
            </DialogTitle>
            <DialogDescription>
              {t(
                phase === 'insecure'
                  ? 'dictation.insecure'
                  : phase === 'pack'
                    ? 'dictation.pack'
                    : 'dictation.consent',
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="min-h-10" onClick={dictation.cancel}>
              {t('common.cancel')}
            </Button>
            {phase !== 'insecure' && (
              <Button
                className="min-h-10"
                onClick={() => void (phase === 'pack' ? dictation.install() : dictation.consent())}
              >
                {t(phase === 'pack' ? 'dictation.install' : 'dictation.download')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DictationSettings() {
  const t = useT();
  const choice = useDictationPreference('language');
  const downloaded = useDictationPreference('downloaded') === 'true';
  const engine = useDictationPreference('engine');
  const [error, setError] = useState(false);
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base">{t('dictation.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0 text-sm">
        <p>
          {t('dictation.engine')}:{' '}
          {t(
            engine === 'speech'
              ? 'dictation.speech'
              : engine === 'whisper'
                ? 'dictation.whisper'
                : 'dictation.engineAuto',
          )}
        </p>
        <p>{t(downloaded ? 'dictation.downloaded' : 'dictation.notDownloaded')}</p>
        <label className="flex flex-wrap items-center justify-between gap-2">
          {t('dictation.language')}
          <select
            className="min-h-10 rounded-md border bg-background px-3"
            value={choice === 'es' || choice === 'en' ? choice : 'auto'}
            onChange={(event) => save('language', event.target.value)}
          >
            <option value="auto">{t('dictation.auto')}</option>
            <option value="es">{t('dictation.spanish')}</option>
            <option value="en">{t('dictation.english')}</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground">{t('dictation.privacy')}</p>
        <Button
          variant="outline"
          className="min-h-10"
          onClick={() => {
            setError(false);
            void deleteBrowserModel().catch(() => setError(true));
          }}
        >
          {t('dictation.delete')}
        </Button>
        {error && <p role="alert">{t('dictation.error')}</p>}
      </CardContent>
    </Card>
  );
}
