import type { Workspace } from '@shared/protocol';
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

export function SettingsScreen() {
  const t = useT();
  const { theme } = useTheme();
  const prefs = useStore((s) => s.prefs);
  const ports = useStore((s) => s.ports);
  const settings = useStore((s) => s.settings);
  const agentInfo = useStore((s) => s.agentInfo);
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
          </CardContent>
        </Card>

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
