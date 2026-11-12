import { matchEntry } from '@shared/catalog-match';
import type { CatalogDebug, DoctorCheck, DoctorReport, LogsResponse } from '@shared/protocol';
import { pickModelOptions } from '@shared/reducer';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  CircleSlash,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { selectOptions } from '@/components/StatusStrip';
import { UpdateNotice } from '@/components/UpdateNotice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useT } from '@/i18n';
import { fmtTokens } from '@/lib/format';
import { CopyButton } from '@/lib/markdown';
import { navigate } from '@/lib/router';
import { send } from '@/lib/ws';
import { useStore } from '@/store';

function CheckIcon({ status }: { status: string }) {
  if (status === 'ok') return <CheckCircle2 className="size-5 shrink-0 text-success" />;
  if (status === 'warn') return <AlertTriangle className="size-5 shrink-0 text-warning" />;
  if (status === 'fail') return <XCircle className="size-5 shrink-0 text-destructive" />;
  return <CircleSlash className="size-5 shrink-0 text-muted-foreground" />;
}

function fixText(
  t: (k: Parameters<typeof import('@/i18n').t>[0]) => string,
  c: DoctorCheck,
): string {
  const key = `doctor.fix.${c.id}` as Parameters<typeof import('@/i18n').t>[0];
  const translated = t(key);
  return translated === key ? (c.fix ?? '') : translated;
}

export function DiagnosticsScreen() {
  const t = useT();
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [logs, setLogs] = useState<LogsResponse | null>(null);
  const [logsErr, setLogsErr] = useState(false);
  const [busy, setBusy] = useState(false);

  const runDoctor = useCallback(() => {
    setBusy(true);
    fetch('/api/doctor')
      .then((r) => r.json())
      .then(setReport)
      .catch(() => {})
      .finally(() => setBusy(false));
  }, []);
  const loadLogs = useCallback(() => {
    setLogsErr(false);
    fetch('/api/logs?lines=200')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setLogs)
      .catch(() => setLogsErr(true));
  }, []);

  useEffect(() => {
    runDoctor();
    loadLogs();
  }, [runDoctor, loadLogs]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="safe-top safe-x flex items-center gap-1 border-b px-2 py-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('common.back')}
          onClick={() => navigate('home')}
        >
          <ChevronLeft className="size-5" />
        </Button>
        <h1 className="flex-1 px-2 text-lg font-semibold">{t('diag.title')}</h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('diag.rerun')}
          onClick={runDoctor}
          disabled={busy}
        >
          <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0 lg:[&>*]:min-w-0">
        <UpdateNotice />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('diag.doctor')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {report === null ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
              </div>
            ) : (
              report.checks.map((c) => (
                <div key={c.id} className="flex items-start gap-2.5 rounded-lg px-1 py-1.5">
                  <CheckIcon status={c.status} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {c.id === 'pocket-update' ? t('doctor.label.pocket-update') : c.label}
                    </div>
                    {c.detail && (
                      <div className="text-xs text-muted-foreground">
                        {c.id === 'pocket-update' && c.update
                          ? t('doctor.detail.pocket-update', {
                              current: c.update.current,
                              latest: c.update.latest,
                            })
                          : c.detail}
                      </div>
                    )}
                    {c.fix && (
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-primary">
                        <span>{fixText(t, c)}</span>
                        <CopyButton
                          text={fixText(t, c).replace(/^[^:]+:\s*/, '')}
                          className="h-6 w-6"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <CatalogCard />

        <Collapsible>
          <Card>
            <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3">
              <span className="text-base font-semibold">{t('diag.logs')}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('common.refresh')}
                onClick={(e) => {
                  e.stopPropagation();
                  loadLogs();
                }}
              >
                <RefreshCw className="size-4" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                {logsErr ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t('common.error')}
                  </p>
                ) : logs === null ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t('common.loading')}
                  </p>
                ) : logs.lines.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t('logs.empty')}
                  </p>
                ) : (
                  <pre className="max-h-[40dvh] overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed">
                    {logs.lines.join('\n')}
                  </pre>
                )}
                {logs && logs.files.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {logs.files.map((f) => `${f.name} (${Math.round(f.size / 1024)}k)`).join(' · ')}
                  </p>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => window.open('/api/report', '_blank')}
          >
            <Download className="size-4" /> {t('diag.report')}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => send({ type: 'agent.restart' }).catch(() => {})}
          >
            <RotateCcw className="size-4" /> {t('diag.restart')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Strip keys that could carry secrets before copying a report. */
const SENSITIVE = /token|key|secret|password|authorization/i;
function sanitize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sanitize);
  if (typeof v === 'object' && v !== null) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!SENSITIVE.test(k)) o[k] = sanitize(x);
    return o;
  }
  return v;
}

function fmtAge(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function CatalogCard() {
  const t = useT();
  const catalog = useStore((s) => s.catalog);
  const modelOption = useStore((s) => {
    const first = s.open.values().next().value;
    return first ? pickModelOptions(first).model : undefined;
  });
  const [refreshing, setRefreshing] = useState(false);

  const entries = catalog.status === 'ready' ? catalog.entries : [];
  const debug: CatalogDebug | undefined =
    catalog.status === 'ready' || catalog.status === 'unavailable' ? catalog.debug : undefined;
  const options = modelOption ? selectOptions(modelOption) : [];
  const rows = options.map((o) => ({ o, entry: matchEntry(o, entries) }));

  const refresh = () => {
    setRefreshing(true);
    send({ type: 'catalog.refresh' })
      .catch(() => {})
      .finally(() => setRefreshing(false));
  };

  const copyReport = () => {
    void navigator.clipboard.writeText(
      JSON.stringify(
        sanitize({
          catalog,
          options: rows.map((r) => ({
            name: r.o.name,
            value: r.o.value,
            match: r.entry
              ? { label: r.entry.label, uid: r.entry.modelUid, tier: r.entry.costTier }
              : null,
          })),
        }),
        null,
        2,
      ),
    );
  };

  const field = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline gap-2 py-0.5 text-xs">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-all font-mono">{value}</span>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{t('diag.catalog')}</CardTitle>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('diag.catalog.refresh')}
              onClick={refresh}
              disabled={refreshing}
            >
              <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('diag.catalog.copy')}
              onClick={copyReport}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {debug ? (
          <div>
            {field(t('diag.catalog.source'), `${debug.source} · ${debug.entryCount}`)}
            {debug.fetchedAt !== undefined &&
              field(t('diag.catalog.fetchedAt'), new Date(debug.fetchedAt).toLocaleString())}
            {debug.cacheAgeMs !== undefined &&
              field(t('diag.catalog.cacheAge'), fmtAge(debug.cacheAgeMs))}
            {field(t('diag.catalog.command'), debug.command)}
            {field(
              t('diag.catalog.exit'),
              `${debug.exitCode ?? '—'}${debug.signal ? ` (${debug.signal})` : ''}`,
            )}
            {field(t('diag.catalog.duration'), `${debug.durationMs}ms`)}
            {debug.parseError && field(t('diag.catalog.parseError'), debug.parseError)}
            {debug.stderrHead && (
              <details className="py-1 text-xs">
                <summary className="cursor-pointer text-muted-foreground">stderr</summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px]">
                  {debug.stderrHead}
                </pre>
              </details>
            )}
            {debug.stdoutHead && (
              <details className="py-1 text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  {t('diag.catalog.stdout')}
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px]">
                  {debug.stdoutHead}
                </pre>
              </details>
            )}
          </div>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">{t('common.loading')}</p>
        )}

        <p className="pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('diag.catalog.options')}
        </p>
        {rows.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t('diag.catalog.empty')}</p>
        ) : (
          <div className="space-y-1.5">
            {rows.map(({ o, entry }) => (
              <div key={o.value} className="rounded-lg border px-2.5 py-1.5 text-xs">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{o.name}</span>
                  {!entry && (
                    <span className="shrink-0 text-warning">{t('diag.catalog.noMatch')}</span>
                  )}
                </div>
                <div className="break-all font-mono text-muted-foreground">{o.value}</div>
                {entry && (
                  <div className="break-all text-muted-foreground">
                    {entry.label} · {entry.modelUid}
                    {entry.costTier ? ` · ${entry.costTier}` : ''}
                    {entry.prices
                      ? ` · $${entry.prices.input}/$${entry.prices.output}` +
                        (entry.prices.cached !== undefined
                          ? ` (cached $${entry.prices.cached})`
                          : '')
                      : ''}
                    {entry.maxContext ? ` · ${fmtTokens(entry.maxContext)}` : ''}
                    {entry.mods?.length ? ` · ${entry.mods.join(', ')}` : ''}
                    {entry.level ? ` · ${entry.level}` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
