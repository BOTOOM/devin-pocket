import { estimateCost } from '@shared/cost';
import type { SessionState } from '@shared/protocol';
import { sumTurnStats } from '@shared/reducer';
import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useT } from '@/i18n';
import { fmtMoney, fmtTokens } from '@/lib/format';
import { useStore } from '@/store';

function usageColor(pct: number): string {
  if (pct < 50) return 'var(--usage-low)';
  if (pct < 75) return 'var(--usage-mid)';
  if (pct < 90) return 'var(--usage-warm)';
  return 'var(--usage-high)';
}

export function UsageBar({ state }: { state: SessionState }) {
  const t = useT();
  const catalog = useStore((s) => s.catalog);
  const [open, setOpen] = useState(false);
  const usage = state.usage;
  if (!usage) return null;
  const pct = usage.size > 0 ? Math.min(100, (usage.used / usage.size) * 100) : 0;
  const totals = sumTurnStats(state.turnStats);
  const cost =
    usage.cost ?? (catalog.status === 'ready' ? estimateCost(state.turnStats, catalog) : undefined);

  return (
    <>
      <button
        type="button"
        className="flex w-full items-center gap-2"
        data-chip="usage"
        onClick={() => setOpen(true)}
        aria-label={t('usage.title')}
      >
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full"
          style={{ background: 'var(--usage-track)' }}
        >
          <div
            className="h-full rounded-full transition-[width]"
            style={{ width: `${pct}%`, background: usageColor(pct) }}
          />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {fmtTokens(usage.used)} / {fmtTokens(usage.size)}
        </span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="safe-bottom max-h-[70dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t('usage.title')}</SheetTitle>
            <SheetDescription className="sr-only">{t('usage.title')}</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-4">
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-muted-foreground">{t('usage.context')}</span>
                <span className="font-medium tabular-nums">{pct.toFixed(0)}%</span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full"
                style={{ background: 'var(--usage-track)' }}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: usageColor(pct) }}
                />
              </div>
            </div>

            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                [t('usage.tokensIn'), totals.input],
                [t('usage.tokensOut'), totals.output],
                [t('usage.tokensCached'), totals.cached],
              ].map(([label, v]) => (
                <div key={label as string} className="rounded-lg border p-2">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-medium tabular-nums">{fmtTokens(v as number)}</dd>
                </div>
              ))}
            </dl>

            <div className="rounded-lg border p-3">
              <div className="text-2xl font-semibold tabular-nums">
                {cost ? fmtMoney(cost.amount, cost.currency) : t('usage.unavailable')}
              </div>
              <div className="text-xs text-muted-foreground">
                {cost ? (usage.cost ? t('usage.costReported') : t('usage.costEstimated')) : ''}
              </div>
            </div>

            {state.turnStats.length > 0 && (
              <div>
                <h4 className="mb-1 text-sm font-medium">{t('usage.perTurn')}</h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 font-normal">{t('usage.model')}</th>
                      <th className="py-1 text-right font-normal">{t('usage.in')}</th>
                      <th className="py-1 text-right font-normal">{t('usage.cached')}</th>
                      <th className="py-1 text-right font-normal">{t('usage.out')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.turnStats.map((s) => (
                      <tr key={s.turnRequestId} className="border-t tabular-nums">
                        <td className="max-w-[40%] truncate py-1.5 pr-2">{s.model ?? '—'}</td>
                        <td className="py-1.5 text-right">{fmtTokens(s.input)}</td>
                        <td className="py-1.5 text-right">{fmtTokens(s.cached)}</td>
                        <td className="py-1.5 text-right">{fmtTokens(s.output)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
