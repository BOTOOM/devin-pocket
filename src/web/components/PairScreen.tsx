import { formatPairingCode } from '@shared/pairing-code';
import { LoaderCircle, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setLang, useT } from '@/i18n';
import { AuthFailure, redeemPairing, retryAuth, useAuth } from '@/lib/auth';
import { setTheme, useTheme } from '@/lib/theme';

export function PairScreen() {
  const t = useT();
  const auth = useAuth();
  const { resolved } = useTheme();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<'invalid' | 'limited' | 'network'>();
  const busy = submitting || auth.phase === 'checking' || auth.phase === 'redeeming';
  const problem = error ?? auth.error;

  return (
    <main
      className="safe-top safe-x flex h-dvh flex-col overflow-y-auto bg-background px-5 pb-8"
      data-testid="pair-screen"
    >
      <header className="mx-auto flex w-full max-w-5xl shrink-0 items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-2 font-semibold">
          <BrandMark className="size-9" />
          {t('app.name')}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('pair.spanish')}
            onClick={() => setLang('es')}
          >
            ES
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('pair.english')}
            onClick={() => setLang('en')}
          >
            EN
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t(resolved === 'dark' ? 'settings.theme.light' : 'settings.theme.dark')}
            onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
          >
            {resolved === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </header>
      <div className="mx-auto my-auto grid w-full max-w-4xl items-center gap-6 py-6 md:grid-cols-2 md:gap-12">
        <section className="space-y-4">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck aria-hidden="true" className="size-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t('pair.title')}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
            {t('pair.intro')}{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">
              devin-pocket pair
            </code>{' '}
            {t('pair.introEnd')}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('pair.security')}</p>
        </section>
        <Card>
          <CardContent className="p-5">
            <form
              className="space-y-5"
              onSubmit={async (event) => {
                event.preventDefault();
                setSubmitting(true);
                setError(undefined);
                try {
                  await redeemPairing({ code, ...(name.trim() ? { name: name.trim() } : {}) });
                } catch (failure) {
                  setError(failure instanceof AuthFailure ? failure.kind : 'network');
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {busy && (
                <p role="status" className="flex items-center gap-2 text-sm">
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  {t(auth.phase === 'redeeming' ? 'pair.redeeming' : 'pair.connecting')}
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="pair-code">{t('pair.code')}</Label>
                <Input
                  id="pair-code"
                  value={code}
                  onChange={(event) => {
                    setCode(formatPairingCode(event.target.value));
                    setError(undefined);
                  }}
                  inputMode="text"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder={t('pair.placeholder')}
                  disabled={busy}
                  className="h-12 font-mono text-xl tracking-widest md:text-xl"
                  aria-invalid={!!problem}
                  aria-describedby={problem ? 'pair-error' : undefined}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pair-name">{t('pair.name')}</Label>
                <Input
                  id="pair-name"
                  value={name}
                  maxLength={80}
                  autoComplete="off"
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy}
                  placeholder={t('pair.namePlaceholder')}
                />
              </div>
              {problem && (
                <p id="pair-error" role="alert" className="text-sm text-destructive">
                  {t(`pair.error.${problem}`)}
                </p>
              )}
              <Button type="submit" className="h-11 w-full" disabled={busy || code.length !== 9}>
                {t('pair.submit')}
              </Button>
              {problem === 'network' && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setError(undefined);
                    void retryAuth();
                  }}
                >
                  {t('common.retry')}
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
