import type { BillingInfo, Workspace } from '@shared/protocol';
import { ChevronLeft, ExternalLink, FolderPlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { WorkspaceSheet } from '@/components/WorkspaceSheet';
import { setLang, useT } from '@/i18n';
import { navigate } from '@/lib/router';
import { setTheme, useTheme } from '@/lib/theme';
import { setPrefs, useStore } from '@/store';

const CAP_LABELS: Record<string, string> = {
  loadSession: 'loadSession',
  listSessions: 'listSessions',
  deleteSessions: 'deleteSessions',
  image: 'image',
  embeddedContext: 'embeddedContext',
  rename: 'rename',
  editableCommands: 'editableCommands',
};

function quotaColor(pct: number): string {
  if (pct > 50) return 'var(--usage-low)';
  if (pct > 25) return 'var(--usage-mid)';
  if (pct > 10) return 'var(--usage-warm)';
  return 'var(--usage-high)';
}

function QuotaRow({
  label,
  pct,
  resetAt,
  t,
}: {
  label: string;
  pct: number;
  resetAt?: number;
  t: ReturnType<typeof useT>;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="shrink-0 text-xs">
          {Math.round(clamped)}%
          {resetAt != null &&
            ` · ${t('settings.billing.reset', { date: new Date(resetAt * 1000).toLocaleDateString() })}`}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full"
        style={{ background: 'var(--usage-track)' }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${clamped}%`, background: quotaColor(clamped) }}
        />
      </div>
    </div>
  );
}

function BillingCard({ billing, t }: { billing: BillingInfo; t: ReturnType<typeof useT> }) {
  const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString() : Math.round(n * 100) / 100);
  return (
    <Card>
      <CardHeader className="p-4 pb-1">
        <CardTitle className="text-base">{t('settings.billing')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0 text-sm">
        {(billing.planName || billing.accountName) && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">{t('settings.billing.plan')}</span>
            <span className="truncate font-medium">
              {[billing.planName, billing.accountName].filter(Boolean).join(' · ')}
            </span>
          </div>
        )}
        {billing.dailyQuotaPct != null && (
          <QuotaRow
            label={t('settings.billing.daily')}
            pct={billing.dailyQuotaPct}
            resetAt={billing.dailyResetAt}
            t={t}
          />
        )}
        {billing.weeklyQuotaPct != null && (
          <QuotaRow
            label={t('settings.billing.weekly')}
            pct={billing.weeklyQuotaPct}
            resetAt={billing.weeklyResetAt}
            t={t}
          />
        )}
        {(billing.acuConsumed != null || billing.acuLimit != null) && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">{t('settings.billing.acu')}</span>
            <span className="font-mono">
              {fmt(billing.acuConsumed ?? 0)}
              {billing.acuLimit != null ? ` / ${fmt(billing.acuLimit)}` : ''}
            </span>
          </div>
        )}
        {billing.credits?.map((c) => (
          <div key={c.kind} className="flex justify-between gap-2">
            <span className="text-muted-foreground">
              {t('settings.billing.credits', { kind: c.kind })}
            </span>
            <span className="font-mono">
              {[
                c.available != null ? `${fmt(c.available)} ${t('settings.billing.left')}` : null,
                c.used != null ? `${fmt(c.used)} ${t('settings.billing.used')}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        ))}
        {billing.overageMicros != null && billing.overageMicros > 0 && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">{t('settings.billing.overage')}</span>
            <span className="font-mono">${(billing.overageMicros / 1e6).toFixed(2)}</span>
          </div>
        )}
        <p className="pt-1 text-xs text-muted-foreground">
          {t('settings.billing.updated', {
            time: new Date(billing.updatedAt).toLocaleTimeString(),
          })}
          {billing.source === 'cache' ? ` · ${t('settings.billing.cache')}` : ''}
        </p>
      </CardContent>
    </Card>
  );
}

export function SettingsScreen() {
  const t = useT();
  const { theme } = useTheme();
  const prefs = useStore((s) => s.prefs);
  const ports = useStore((s) => s.ports);
  const settings = useStore((s) => s.settings);
  const agentInfo = useStore((s) => s.agentInfo);
  const billing = useStore((s) => s.billing);
  const [wsOpen, setWsOpen] = useState(false);

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
        <h1 className="px-2 text-lg font-semibold">{t('settings.title')}</h1>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <Label>{t('settings.theme')}</Label>
              <ToggleGroup
                type="single"
                value={theme}
                onValueChange={(v) => v && setTheme(v as typeof theme)}
              >
                <ToggleGroupItem value="light" className="px-3">
                  {t('settings.theme.light')}
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" className="px-3">
                  {t('settings.theme.dark')}
                </ToggleGroupItem>
                <ToggleGroupItem value="system" className="px-3">
                  {t('settings.theme.system')}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-3">
              <Label>{t('settings.lang')}</Label>
              <ToggleGroup
                type="single"
                value={localStorage.getItem('dp.lang') === 'en' ? 'en' : 'es'}
                onValueChange={(v) => v && setLang(v as 'es' | 'en')}
              >
                <ToggleGroupItem value="es" className="px-4">
                  ES
                </ToggleGroupItem>
                <ToggleGroupItem value="en" className="px-4">
                  EN
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="thoughts">{t('settings.thoughts')}</Label>
              <Switch
                id="thoughts"
                checked={prefs.showThoughts}
                onCheckedChange={(v) => setPrefs({ showThoughts: v })}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor="enterSend">{t('settings.enterToSend')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.enterToSend.hint')}</p>
              </div>
              <Switch
                id="enterSend"
                checked={prefs.enterToSend}
                onCheckedChange={(v) => setPrefs({ enterToSend: v })}
              />
            </div>
          </CardContent>
        </Card>

        {billing && <BillingCard billing={billing} t={t} />}

        <Card>
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-base">{t('settings.workspaces')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-4 pt-0">
            {prefs.workspaces.map((w: Workspace) => (
              <div key={w.path} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{w.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{w.path}</div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common.delete')}
                  onClick={() =>
                    setPrefs({ workspaces: prefs.workspaces.filter((x) => x.path !== w.path) })
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" className="w-full gap-2" onClick={() => setWsOpen(true)}>
              <FolderPlus className="size-4" /> {t('settings.addFolder')}
            </Button>
            <p className="pt-1 text-xs text-muted-foreground">{t('settings.workspaces.note')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-base">{t('settings.ports')}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {ports.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('settings.ports.empty')}</p>
            ) : (
              ports.map((p) => (
                <div
                  key={p.port}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 mb-1"
                >
                  <div>
                    <span className="font-mono text-sm font-medium">:{p.port}</span>
                    {p.process && (
                      <span className="ml-2 text-xs text-muted-foreground">{p.process}</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1"
                    onClick={() => window.open(`http://localhost:${p.port}`, '_blank')}
                  >
                    {t('common.open')} <ExternalLink className="size-3.5" />
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-base">{t('settings.about')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('app.name')}</span>
              <span className="font-mono">v{settings?.version ?? '?'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('settings.agent')}</span>
              <span className="font-mono">
                {agentInfo?.title ?? agentInfo?.name ?? '—'} {agentInfo?.version ?? ''}
              </span>
            </div>
            {agentInfo && (
              <div>
                <div className="mb-1 text-muted-foreground">{t('settings.caps')}</div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(agentInfo.caps)
                    .filter(([k, v]) => k !== 'meta' && v === true)
                    .map(([k]) => (
                      <Badge key={k} variant="secondary">
                        {CAP_LABELS[k] ?? k}
                      </Badge>
                    ))}
                </div>
              </div>
            )}
            <div className="pt-1">
              <button
                type="button"
                className="text-sm text-primary"
                onClick={() => navigate('diagnostics')}
              >
                {t('diag.title')} →
              </button>
            </div>
          </CardContent>
        </Card>
      </div>

      <WorkspaceSheet
        open={wsOpen}
        onOpenChange={setWsOpen}
        onPick={(p) =>
          setPrefs({
            workspaces: [
              ...prefs.workspaces.filter((w) => w.path !== p),
              { path: p, name: p.split('/').filter(Boolean).pop() ?? p },
            ],
          })
        }
      />
    </div>
  );
}
