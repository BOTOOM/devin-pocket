import type { DevicesResponse, PairedDevice, PairingResponse } from '@shared/protocol';
import { Copy, LoaderCircle, QrCode, ShieldCheck, Trash2 } from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getLang, useT } from '@/i18n';
import { AuthFailure, authRequest, refreshAuth, useAuth } from '@/lib/auth';
import { relTime } from '@/lib/format';

type Intent = { kind: 'one' | 'others' | 'logout'; device?: PairedDevice };

export function DevicesCard() {
  const t = useT();
  const auth = useAuth();
  const [devices, setDevices] = useState<PairedDevice[]>();
  const [error, setError] = useState<'invalid' | 'limited' | 'network'>();
  const [open, setOpen] = useState(false);
  const [grant, setGrant] = useState<PairingResponse>();
  const [generating, setGenerating] = useState(false);
  const [grantError, setGrantError] = useState<'invalid' | 'limited' | 'network'>();
  const [now, setNow] = useState(Date.now());
  const [intent, setIntent] = useState<Intent>();
  const [revoking, setRevoking] = useState(false);
  const load = useCallback(async () => {
    try {
      const result = await authRequest<DevicesResponse>('devices');
      setDevices(result.devices);
      setError(undefined);
    } catch (failure) {
      setError(failure instanceof AuthFailure ? failure.kind : 'network');
    }
  }, []);
  useEffect(() => {
    if (!auth.required) return;
    void load();
    const timer = setInterval(
      () => {
        setNow(Date.now());
        void load();
      },
      open ? 3000 : 30000,
    );
    return () => clearInterval(timer);
  }, [auth.required, load, open]);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);
  const url = grant ? `${location.origin}/#/pair?t=${encodeURIComponent(grant.token)}` : '';
  const matrix = useMemo(() => {
    if (!url) return;
    try {
      return QRCode.create(url, { errorCorrectionLevel: 'M' }).modules;
    } catch {
      return;
    }
  }, [url]);
  const qrPath = matrix
    ? Array.from({ length: matrix.size }, (_, y) =>
        Array.from({ length: matrix.size }, (_, x) =>
          matrix.get(y, x) ? `M${x + 4} ${y + 4}h1v1h-1z` : '',
        ).join(''),
      ).join('')
    : '';
  const seconds = Math.max(0, Math.ceil(((grant?.expiresAt ?? now) - now) / 1000));
  const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  async function generate() {
    setGenerating(true);
    setGrant(undefined);
    setGrantError(undefined);
    try {
      setGrant(await authRequest<PairingResponse>('pairings', 'POST'));
      setNow(Date.now());
    } catch (failure) {
      setGrantError(failure instanceof AuthFailure ? failure.kind : 'network');
    } finally {
      setGenerating(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('devices.copyError'));
    }
  }
  async function revoke() {
    if (!intent) return;
    setRevoking(true);
    setError(undefined);
    try {
      const route =
        intent.kind === 'logout'
          ? 'logout'
          : intent.kind === 'one'
            ? `devices/${encodeURIComponent(intent.device?.id ?? '')}`
            : 'devices';
      await authRequest(route, intent.kind === 'logout' ? 'POST' : 'DELETE');
      if (intent.kind === 'logout' || intent.device?.current) await refreshAuth();
      toast.success(t('devices.revoked'));
      setIntent(undefined);
      await load();
    } catch (failure) {
      setError(failure instanceof AuthFailure ? failure.kind : 'network');
    } finally {
      setRevoking(false);
    }
  }
  if (!auth.required) return null;
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
          {t('devices.title')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('devices.description')}</p>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t(`pair.error.${error}`)}{' '}
            <Button variant="link" size="sm" onClick={() => void load()}>
              {t('common.retry')}
            </Button>
          </p>
        )}
        {!devices && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('devices.loading')}
          </p>
        )}
        {devices?.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('devices.empty')}</p>
        )}
        <ul className="divide-y">
          {devices?.map((device) => (
            <li key={device.id} className="flex items-start gap-3 py-3" data-testid="paired-device">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words text-sm font-medium">{device.name}</span>
                  {device.current && <Badge variant="secondary">{t('devices.current')}</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('devices.created', {
                    date: new Date(device.createdAt).toLocaleDateString(getLang()),
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('devices.seen', { time: relTime(new Date(device.lastSeenAt).toISOString()) })}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('devices.revokeLabel', { name: device.name })}
                onClick={() => setIntent({ kind: 'one', device })}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          className="h-11 w-full"
          onClick={() => {
            setOpen(true);
            void generate();
          }}
        >
          <QrCode className="size-4" />
          {t('devices.new')}
        </Button>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            variant="outline"
            className="h-11"
            disabled={!devices?.some((device) => !device.current)}
            onClick={() => setIntent({ kind: 'others' })}
          >
            {t('devices.others')}
          </Button>
          <Button
            variant="ghost"
            className="h-11 text-destructive"
            onClick={() => setIntent({ kind: 'logout' })}
          >
            {t('devices.logout')}
          </Button>
        </div>
      </CardContent>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setGrant(undefined);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle>{t('devices.new')}</DialogTitle>
            <DialogDescription>{t('devices.qrDescription')}</DialogDescription>
          </DialogHeader>
          {generating && (
            <p role="status" className="flex items-center justify-center gap-2 py-12 text-sm">
              <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
              {t('devices.generating')}
            </p>
          )}
          {grantError && (
            <p role="alert" className="text-sm text-destructive">
              {t(grantError === 'limited' ? 'devices.limit' : `pair.error.${grantError}`)}
            </p>
          )}
          {grant && (
            <>
              {seconds > 0 && matrix && (
                <div className="mx-auto w-full max-w-[256px] rounded-xl bg-white p-2">
                  <svg
                    data-testid="access-qr"
                    role="img"
                    aria-label={t('devices.qrLabel')}
                    viewBox={`0 0 ${matrix.size + 8} ${matrix.size + 8}`}
                    className="block h-auto w-full"
                    shapeRendering="crispEdges"
                  >
                    <rect width="100%" height="100%" fill="#fff" />
                    <path d={qrPath} fill="#000" />
                  </svg>
                </div>
              )}
              {!matrix && (
                <p role="alert" className="text-sm text-destructive">
                  {t('pair.error.network')}
                </p>
              )}
              <div className="space-y-1 text-center">
                <p
                  className="select-all font-mono text-3xl font-semibold tracking-[0.15em]"
                  data-testid="access-code"
                >
                  {grant.code}
                </p>
                <p
                  className={`text-sm ${seconds ? 'text-muted-foreground' : 'font-medium text-destructive'}`}
                  role="timer"
                >
                  {seconds ? t('devices.expires', { time: countdown }) : t('devices.expired')}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('devices.url')}</p>
                <p
                  className="select-all break-all rounded-md bg-muted p-2 font-mono text-xs"
                  data-testid="access-url"
                >
                  {url}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" disabled={!seconds} onClick={() => void copy(url)}>
                  <Copy className="size-4" />
                  {t('devices.copyLink')}
                </Button>
                <Button variant="outline" disabled={!seconds} onClick={() => void copy(grant.code)}>
                  <Copy className="size-4" />
                  {t('devices.copyCode')}
                </Button>
              </div>
              {grant.urls.some((alternative) => alternative !== url) && (
                <details className="min-w-0 text-xs text-muted-foreground">
                  <summary className="cursor-pointer py-1">{t('devices.alternatives')}</summary>
                  <ul className="space-y-2 pt-2">
                    {grant.urls
                      .filter((alternative) => alternative !== url)
                      .map((alternative) => (
                        <li key={alternative} className="select-all break-all font-mono">
                          {alternative}
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </>
          )}
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">{t('common.close')}</Button>
            </DialogClose>
            <Button disabled={generating} onClick={() => void generate()}>
              {t(grantError ? 'common.retry' : 'devices.regenerate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!intent}
        onOpenChange={(value) => {
          if (!value && !revoking) setIntent(undefined);
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('devices.confirm')}</DialogTitle>
            <DialogDescription>
              {intent && t(`devices.confirm.${intent.kind}`, { name: intent.device?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t(`pair.error.${error}`)}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={revoking} onClick={() => setIntent(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" disabled={revoking} onClick={() => void revoke()}>
              {t('devices.revoke')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
