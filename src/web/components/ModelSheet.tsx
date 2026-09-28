import type { CatalogEntry, SessionConfigOption } from '@shared/protocol';
import { Check, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { selectOptions } from '@/components/StatusStrip';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useT } from '@/i18n';
import { fmtTokens } from '@/lib/format';
import { send } from '@/lib/ws';
import { useStore } from '@/store';

const TIER_COLOR: Record<string, string> = {
  free: 'var(--success)',
  low: 'var(--success)',
  standard: 'var(--info)',
  medium: 'var(--info)',
  high: 'var(--warning)',
  premium: 'var(--usage-high)',
};

export function ModelSheet({
  open,
  onOpenChange,
  option,
  sessionId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  option: SessionConfigOption;
  sessionId: string;
}) {
  const t = useT();
  const catalog = useStore((s) => s.catalog);
  const [q, setQ] = useState('');
  const [compare, setCompare] = useState(false);

  const entries = catalog.status === 'ready' ? catalog.entries : [];
  const byLabel = useMemo(() => {
    const m = new Map<string, CatalogEntry>();
    for (const e of entries) m.set(e.label.toLowerCase(), e);
    return m;
  }, [entries]);

  const flat = selectOptions(option).map((o) => ({
    ...o,
    entry: byLabel.get(o.name.toLowerCase()),
  }));
  const filtered = q ? flat.filter((o) => o.name.toLowerCase().includes(q.toLowerCase())) : flat;

  // group by family label when catalog data exists
  const groups = useMemo(() => {
    const g = new Map<string, typeof filtered>();
    for (const o of filtered) {
      const key = o.entry?.familyLabel ?? '';
      if (!g.has(key)) g.set(key, []);
      g.get(key)?.push(o);
    }
    return [...g.entries()];
  }, [filtered]);

  const current = (option as { currentValue?: string }).currentValue;

  const pick = async (value: string) => {
    await send({ type: 'config.set', sessionId, configId: option.id, value }).catch(() => {});
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="safe-x safe-bottom flex max-h-[85dvh] flex-col px-4">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2">
            <SheetTitle>{t('model.title')}</SheetTitle>
            <ToggleGroup
              type="single"
              size="sm"
              value={compare ? 'compare' : 'list'}
              onValueChange={(v) => setCompare(v === 'compare')}
            >
              <ToggleGroupItem value="list" aria-label={t('model.list')}>
                {t('model.list')}
              </ToggleGroupItem>
              <ToggleGroupItem value="compare" aria-label={t('model.compare')}>
                {t('model.compare')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <SheetDescription className="sr-only">{t('model.title')}</SheetDescription>
        </SheetHeader>

        <div className="relative mb-2">
          <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('model.search')}
            className="pl-9"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {flat.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t('model.empty')}</p>
          ) : compare ? (
            <CompareTable rows={filtered} current={current} onPick={pick} />
          ) : (
            groups.map(([family, rows]) => (
              <div key={family || '_'}>
                {family && (
                  <h4 className="px-1 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {family}
                  </h4>
                )}
                {rows.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="flex min-h-14 w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent"
                    onClick={() => pick(o.value)}
                  >
                    <span
                      className="mt-1.5 size-2.5 shrink-0 rounded-full"
                      style={{
                        background:
                          TIER_COLOR[o.entry?.costTier?.toLowerCase() ?? ''] ??
                          'var(--muted-foreground)',
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{o.name}</span>
                        {o.entry?.isNew && <Badge variant="secondary">{t('model.new')}</Badge>}
                        {o.entry?.isBeta && <Badge variant="outline">{t('model.beta')}</Badge>}
                        {/fusion/i.test(o.entry?.familyLabel ?? o.name) && (
                          <Badge variant="outline">Fusion</Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {o.entry?.costSummary ??
                          (o.entry?.prices
                            ? t('model.price', {
                                in: o.entry.prices.input,
                                out: o.entry.prices.output,
                              })
                            : t('model.noPrice'))}
                        {o.entry?.maxContext ? ` · ${fmtTokens(o.entry.maxContext)}` : ''}
                      </span>
                    </span>
                    {o.value === current && <Check className="mt-1 size-4 shrink-0" />}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CompareTable({
  rows,
  current,
  onPick,
}: {
  rows: { value: string; name: string; entry?: CatalogEntry }[];
  current?: string;
  onPick: (v: string) => void;
}) {
  const t = useT();
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1 font-normal">{t('model.table.model')}</th>
          <th className="py-1 text-right font-normal">{t('model.table.input')}</th>
          <th className="py-1 text-right font-normal">{t('model.table.output')}</th>
          <th className="py-1 text-right font-normal">{t('model.table.context')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr
            key={o.value}
            className={`border-t tabular-nums ${o.value === current ? 'bg-accent/50' : ''}`}
            onClick={() => onPick(o.value)}
          >
            <td className="max-w-[40%] truncate py-2 pr-2 font-medium">{o.name}</td>
            <td className="py-2 text-right">
              {o.entry?.prices ? `$${o.entry.prices.input}` : '—'}
            </td>
            <td className="py-2 text-right">
              {o.entry?.prices ? `$${o.entry.prices.output}` : '—'}
            </td>
            <td className="py-2 text-right">
              {o.entry?.maxContext ? fmtTokens(o.entry.maxContext) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
