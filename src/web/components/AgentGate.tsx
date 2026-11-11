import type { AgentStatus } from '@shared/protocol';
import { AlertCircle, Loader2, RotateCcw, Stethoscope } from 'lucide-react';
import { BrandMark } from '@/components/BrandMark';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { getLang, useT } from '@/i18n';
import { CopyButton } from '@/lib/markdown';
import { navigate } from '@/lib/router';
import { send } from '@/lib/ws';

export function AgentGate({ status }: { status: AgentStatus }) {
  const t = useT();
  if (status.phase === 'ready') return null;

  if (status.phase === 'starting') {
    return (
      <Overlay>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('gate.starting')}</p>
          <div className="w-64 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </Overlay>
    );
  }

  if (status.phase === 'needsAuth') {
    return (
      <Overlay>
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center gap-3 pb-2 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
              <BrandMark className="size-14" />
            </div>
            <h1 className="text-xl font-semibold">{t('gate.login.title')}</h1>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              {getLang() === 'es'
                ? 'Devin Pocket necesita permiso para usar tu cuenta de Devin.'
                : t('gate.login.body')}
            </p>
            {status.error && <p className="text-sm text-destructive">{status.error}</p>}
            <div className="space-y-2">
              {status.methods.map((m) => (
                <Button
                  key={m.id}
                  className="h-12 w-full text-base"
                  onClick={() => send({ type: 'auth.login', methodId: m.id }).catch(() => {})}
                >
                  {m.id === 'devin-browser'
                    ? getLang() === 'es'
                      ? 'Iniciar sesión con el navegador'
                      : 'Log in with browser'
                    : (m.name ?? m.id)}
                </Button>
              ))}
            </div>
            <Collapsible>
              <CollapsibleTrigger className="text-sm text-muted-foreground underline underline-offset-4">
                {t('gate.problems')}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <div className="flex items-center justify-between gap-2 rounded-md border bg-muted px-3 py-2">
                  <code className="text-sm">devin auth login</code>
                  <CopyButton text="devin auth login" />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      </Overlay>
    );
  }

  if (status.phase === 'authenticating') {
    return (
      <Overlay>
        <div className="flex max-w-xs flex-col items-center gap-4 text-center">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('gate.authenticating')}</p>
        </div>
      </Overlay>
    );
  }

  if (status.phase === 'error') {
    return (
      <Overlay>
        <Alert variant="destructive" className="w-full max-w-sm bg-card">
          <AlertCircle className="size-4" />
          <AlertTitle>{t('gate.error.title')}</AlertTitle>
          <AlertDescription>
            <p className="mb-1">{status.message}</p>
            {status.hint && <p className="text-xs opacity-80">{status.hint}</p>}
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => send({ type: 'agent.restart' }).catch(() => {})}
              >
                <RotateCcw className="size-4" /> {t('gate.restart')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('diagnostics')}>
                <Stethoscope className="size-4" /> {t('gate.diagnostics')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </Overlay>
    );
  }

  // restarting — non-blocking banner
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center">
      <div className="safe-top mt-2 flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm shadow-md">
        <Loader2 className="size-4 animate-spin text-primary" />
        {t('gate.restarting', { n: status.attempt })}
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="safe-x safe-bottom fixed inset-0 z-40 flex items-center justify-center bg-background/95 p-6 backdrop-blur-sm">
      {children}
    </div>
  );
}
