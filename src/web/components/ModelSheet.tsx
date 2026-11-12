import { matchEntry } from '@shared/catalog-match';
import type { CatalogEntry, SessionConfigOption } from '@shared/protocol';
import { pickModelOptions } from '@shared/reducer';
import { Check, ImageOff, Search, Zap } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { RelativeCostBar } from '@/components/RelativeCostBar';
import { currentValue, type FlatOption, selectOptions } from '@/components/StatusStrip';
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
  const flat: Row[] = selectOptions(option).map((o) => ({
    ...o,
    entry: matchEntry(o, entries),
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
  // CLI ≥3000.11 exposes `speed` (standard/fast) as its own config option;
  // older agents folded Fast into `-fast` model variants.
  const sessionState = useStore((s) => s.open.get(sessionId));
  const speedOpt = sessionState ? pickModelOptions(sessionState).speed : undefined;
  const speedValue = speedOpt ? currentValue(speedOpt) : undefined;
  const fastOn = speedOpt ? speedValue === 'fast' : currentRow ? isFast(currentRow) : false;
  const hasFast = !!speedOpt || flat.some(isFast);

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

  const toggleFast = async () => {
    if (speedOpt) {
      await send({
        type: 'config.set',
        sessionId,
        configId: speedOpt.id,
        value: fastOn ? 'standard' : 'fast',
      }).catch(() => {});
      return;
    }
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
      <SheetContent
        side="bottom"
        panelSize="wide"
        className="safe-x safe-bottom flex max-h-[85dvh] flex-col px-4 md:overflow-hidden"
      >
        <SheetHeader>
          <div className="flex items-center justify-between gap-2">
            <SheetTitle>{t('model.title')}</SheetTitle>
            <div className="flex items-center gap-3">
              {hasFast && (
                <label
                  htmlFor="model-fast"
                  className="flex items-center gap-1.5 text-xs font-medium"
                >
                  Fast
                  <Switch
                    id="model-fast"
                    checked={fastOn}
                    onCheckedChange={() => void toggleFast()}
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

        {catalog.status === 'unavailable' && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground">
            <span className="min-w-0">{t('model.catalogDown')}</span>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => void send({ type: 'catalog.refresh' }).catch(() => {})}
            >
              {t('common.retry')}
            </Button>
          </div>
        )}
        <div className="relative mb-2">
          <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('model.search')}
            className="pl-9"
          />
        </div>

        {compare && !comparing && (
          <RelativeCostBar models={flat} current={current} catalog={catalog} />
        )}

        <div className="contents md:block md:min-h-0 md:flex-1 md:overflow-y-auto">
          <div className="min-h-0 flex-1 overflow-y-auto pb-4 md:overflow-visible">
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
                          {isFast(o) && <Zap className="size-3.5 shrink-0 text-warning" />}
                          {o.supportsImages === false && (
                            <span title={t('model.noImages')}>
                              <ImageOff className="size-3.5 shrink-0 text-muted-foreground" />
                            </span>
                          )}
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
              key={comparing.value}
              costBar={
                <RelativeCostBar
                  models={flat}
                  current={current}
                  candidate={comparing.value}
                  catalog={catalog}
                />
              }
              from={currentRow}
              to={comparing}
              onConfirm={() => pick(comparing.value)}
              onCancel={() => setComparing(null)}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Structured $ price, falling back to the raw cost summary, else `empty`. */
function SidePrice({
  entry,
  field,
  empty,
}: {
  entry?: CatalogEntry;
  field: 'input' | 'cached' | 'output';
  empty: ReactNode;
}) {
  const price = entry?.prices?.[field];
  if (price !== undefined) return <span className="tabular-nums">${price}</span>;
  if (entry?.costSummary)
    return (
      <span
        className="inline-block max-w-28 truncate align-middle text-[11px] leading-tight text-muted-foreground"
        title={entry.costSummary}
      >
        {entry.costSummary}
      </span>
    );
  return <>{empty}</>;
}

/** Price cell with "old → new (±%)" delta on the new side. */
function PriceCell({ from, to, toSummary }: { from?: number; to?: number; toSummary?: string }) {
  const t = useT();
  if (to === undefined)
    return toSummary ? (
      <span
        className="inline-block max-w-28 truncate align-middle text-[11px] leading-tight text-muted-foreground"
        title={toSummary}
      >
        {toSummary}
      </span>
    ) : (
      <span className="text-muted-foreground">{t('model.noPrice')}</span>
    );
  // comparing from a free model: show the new price on its own
  if (from === undefined || from === to) return <span className="tabular-nums">${to}</span>;
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
  costBar,
  from,
  to,
  onConfirm,
  onCancel,
}: {
  costBar: ReactNode;
  from?: Row;
  to: Row;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const showCached =
    from?.entry?.prices?.cached !== undefined || to.entry?.prices?.cached !== undefined;
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (matchMedia('(min-width: 768px)').matches) {
      panel.current?.scrollIntoView({ block: 'nearest' });
    }
  }, []);
  return (
    <div ref={panel} className="mb-1 rounded-xl border bg-card p-3">
      <div className="mb-3">{costBar}</div>
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
        <span>
          <SidePrice entry={from?.entry} field="input" empty={t('model.noPrice')} />
        </span>
        <span>
          <PriceCell
            from={from?.entry?.prices?.input}
            to={to.entry?.prices?.input}
            toSummary={to.entry?.costSummary}
          />
        </span>

        {showCached && (
          <>
            <span className="text-xs text-muted-foreground">{t('model.cached')}</span>
            <span>
              <SidePrice entry={from?.entry} field="cached" empty={t('model.noPrice')} />
            </span>
            <span>
              <PriceCell
                from={from?.entry?.prices?.cached}
                to={to.entry?.prices?.cached}
                toSummary={to.entry?.costSummary}
              />
            </span>
          </>
        )}

        <span className="text-xs text-muted-foreground">{t('model.table.output')}</span>
        <span>
          <SidePrice entry={from?.entry} field="output" empty={t('model.noPrice')} />
        </span>
        <span>
          <PriceCell
            from={from?.entry?.prices?.output}
            to={to.entry?.prices?.output}
            toSummary={to.entry?.costSummary}
          />
        </span>

        <span className="text-xs text-muted-foreground">{t('model.table.context')}</span>
        <span>{from?.entry?.maxContext ? fmtTokens(from.entry.maxContext) : '—'}</span>
        <span>{to.entry?.maxContext ? fmtTokens(to.entry.maxContext) : '—'}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          className="h-auto min-h-9 min-w-0 flex-1 whitespace-normal break-words"
          onClick={onConfirm}
        >
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
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="w-[40%] py-1 font-normal">{t('model.table.model')}</th>
          <th className="py-1 text-right font-normal">{t('model.table.input')}</th>
          <th className="py-1 text-right font-normal">{t('model.table.output')}</th>
          <th className="py-1 text-right font-normal">{t('model.table.context')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr
            key={o.value}
            className={`border-t tabular-nums md:h-10 ${o.value === current ? 'bg-accent/50' : ''}`}
            onClick={() => onPick(o.value)}
          >
            <td className="break-words py-2 pr-2 font-medium">{o.name}</td>
            <td className="py-2 text-right">
              <SidePrice entry={o.entry} field="input" empty="—" />
            </td>
            <td className="py-2 text-right">
              <SidePrice entry={o.entry} field="output" empty="—" />
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
