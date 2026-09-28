import type { CatalogEntry, SessionConfigOption } from '@shared/protocol';
import { Check, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { type FlatOption, selectOptions } from '@/components/StatusStrip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
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

type Row = FlatOption & { entry?: CatalogEntry };

const isFast = (o: Row): boolean =>
  o.entry?.mods?.includes('Fast') === true || /\bfast\b/i.test(o.name) || /-fast$/i.test(o.value);

const baseName = (name: string): string => name.replace(/\s+fast\b/i, '').toLowerCase();

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
  const [comparing, setComparing] = useState<Row | null>(null);

  const entries = catalog.status === 'ready' ? catalog.entries : [];
  const byLabel = useMemo(() => {
    const m = new Map<string, CatalogEntry>();
    for (const e of entries) m.set(e.label.toLowerCase(), e);
    return m;
  }, [entries]);

  const flat: Row[] = selectOptions(option).map((o) => ({
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
  const currentRow = flat.find((o) => o.value === current);
  const hasFast = flat.some(isFast);

  const pick = async (value: string) => {
    await send({ type: 'config.set', sessionId, configId: option.id, value }).catch(() => {});
    setComparing(null);
    onOpenChange(false);
  };

  // tapping a non-current model opens the comparison panel; current closes
  const select = (o: Row) => {
    if (o.value === current) onOpenChange(false);
    else setComparing(o);
  };

  const toggleFast = () => {
    if (!currentRow) return;
    const wantFast = !isFast(currentRow);
    const candidates = flat.filter(
      (o) =>
        o.value !== currentRow.value &&
        isFast(o) === wantFast &&
        ((o.entry?.family && o.entry.family === currentRow.entry?.family) ||
          baseName(o.name) === baseName(currentRow.name)),
    );
    // keep the same reasoning level when the family has several
    const sibling =
      candidates.find((o) => o.entry?.level === currentRow.entry?.level) ?? candidates[0];
    if (!sibling) {
      toast.warning(t('model.noFastVariant'));
      return;
    }
    setComparing(sibling);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="safe-x safe-bottom flex max-h-[85dvh] flex-col px-4">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2">
            <SheetTitle>{t('model.title')}</SheetTitle>
            <div className="flex items-center gap-3">
              {hasFast && (
                <label className="flex items-center gap-1.5 text-xs font-medium">
                  Fast
                  <Switch
                    checked={currentRow ? isFast(currentRow) : false}
                    onCheckedChange={toggleFast}
                    aria-label="Fast"
                  />
                </label>
              )}
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
            <CompareTable
              rows={filtered}
              current={current}
              onPick={(v) => {
                const row = flat.find((o) => o.value === v);
                if (row) select(row);
              }}
            />
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
                    onClick={() => select(o)}
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
                        {isFast(o) && <Badge variant="outline">Fast</Badge>}
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

        {comparing && (
          <ComparePanel
            from={currentRow}
            to={comparing}
            onConfirm={() => pick(comparing.value)}
            onCancel={() => setComparing(null)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Price cell with "old → new (±%)" delta on the new side. */
function PriceCell({ from, to }: { from?: number; to?: number }) {
  const t = useT();
  if (from === undefined || to === undefined)
    return <span className="text-muted-foreground">{t('model.noPrice')}</span>;
  if (from === to) return <span className="tabular-nums">${to}</span>;
  const pct = Math.round(((to - from) / from) * 100);
  const color = to < from ? 'var(--success)' : 'var(--usage-high)';
  return (
    <span className="tabular-nums" style={{ color }}>
      ${from} → ${to} ({pct > 0 ? '+' : '−'}
      {Math.abs(pct)} %)
    </span>
  );
}

function ComparePanel({
  from,
  to,
  onConfirm,
  onCancel,
}: {
  from?: Row;
  to: Row;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const showCached =
    from?.entry?.prices?.cached !== undefined || to.entry?.prices?.cached !== undefined;
  return (
    <div className="mb-1 rounded-xl border bg-card p-3">
      <div className="grid grid-cols-[auto_1fr_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm">
        <span />
        <span className="text-xs font-medium uppercase text-muted-foreground">
          {t('model.current')}
        </span>
        <span className="text-xs font-medium uppercase text-muted-foreground">
          {t('model.new')}
        </span>

        <span className="text-xs text-muted-foreground">{t('model.table.model')}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{
              background:
                TIER_COLOR[from?.entry?.costTier?.toLowerCase() ?? ''] ?? 'var(--muted-foreground)',
            }}
          />
          <span className="truncate font-medium">{from?.name ?? '—'}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{
              background:
                TIER_COLOR[to.entry?.costTier?.toLowerCase() ?? ''] ?? 'var(--muted-foreground)',
            }}
          />
          <span className="truncate font-medium">{to.name}</span>
        </span>

        <span className="text-xs text-muted-foreground">{t('model.table.input')}</span>
        <span>{from?.entry?.prices ? `$${from.entry.prices.input}` : t('model.noPrice')}</span>
        <span>
          <PriceCell from={from?.entry?.prices?.input} to={to.entry?.prices?.input} />
        </span>

        {showCached && (
          <>
            <span className="text-xs text-muted-foreground">{t('model.cached')}</span>
            <span>
              {from?.entry?.prices?.cached !== undefined
                ? `$${from.entry.prices.cached}`
                : t('model.noPrice')}
            </span>
            <span>
              <PriceCell from={from?.entry?.prices?.cached} to={to.entry?.prices?.cached} />
            </span>
          </>
        )}

        <span className="text-xs text-muted-foreground">{t('model.table.output')}</span>
        <span>{from?.entry?.prices ? `$${from.entry.prices.output}` : t('model.noPrice')}</span>
        <span>
          <PriceCell from={from?.entry?.prices?.output} to={to.entry?.prices?.output} />
        </span>

        <span className="text-xs text-muted-foreground">{t('model.table.context')}</span>
        <span>{from?.entry?.maxContext ? fmtTokens(from.entry.maxContext) : '—'}</span>
        <span>{to.entry?.maxContext ? fmtTokens(to.entry.maxContext) : '—'}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <Button className="flex-1" onClick={onConfirm}>
          {t('model.switchTo', { name: to.name })}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          {t('model.cancel')}
        </Button>
      </div>
    </div>
  );
}

function CompareTable({
  rows,
  current,
  onPick,
}: {
  rows: Row[];
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
