import { type PricedModel, relativeModelCosts } from '@shared/model-cost';
import type { CatalogState } from '@shared/protocol';
import { useT } from '@/i18n';

export function RelativeCostBar({
  models,
  current,
  candidate,
  catalog,
}: {
  models: readonly PricedModel[];
  current?: string;
  candidate?: string;
  catalog: CatalogState;
}) {
  const t = useT();
  const { points, comparable } = relativeModelCosts(models);
  const pair = candidate !== undefined && candidate !== current;
  const labels = [
    { value: current, role: 'current', label: t('model.current') },
    ...(pair ? [{ value: candidate, role: 'new', label: t('model.new') }] : []),
  ].map((item) => {
    const model = models.find((m) => m.value === item.value);
    const point = points.find((p) => p.value === item.value);
    const status = !point
      ? t('model.positionUnavailable')
      : !comparable
        ? t('model.costNoScale')
        : `${Math.round((point.position ?? 0) * 100)}%`;
    return { ...item, text: `${item.label}: ${model?.name ?? '—'} · ${status}` };
  });
  const cached = catalog.status === 'ready' && catalog.fromCache;
  const stale = cached && (catalog.debug?.cacheAgeMs ?? 0) >= 24 * 3600 * 1000;
  return (
    <figure
      className="min-w-0 space-y-2 rounded-lg border bg-background p-3"
      data-testid="relative-cost"
    >
      <figcaption className="text-xs text-muted-foreground">
        {t('model.relativeCost')}
        {cached && (
          <span className="ml-1">· {t(stale ? 'model.stalePrices' : 'model.cachedPrices')}</span>
        )}
      </figcaption>
      {labels.map((item) => (
        <p key={item.role} className="flex items-start gap-2 break-words text-xs font-medium">
          <span
            aria-hidden="true"
            className={`mt-0.5 size-2 shrink-0 border border-foreground ${item.role === 'current' ? 'rounded-full bg-foreground' : 'rotate-45 bg-background'}`}
          />
          <span>{item.text}</span>
        </p>
      ))}
      {comparable && (
        <div
          role="img"
          aria-label={`${t('model.relativeCost')}. ${labels.map((item) => item.text).join('. ')}`}
          className="px-2 py-3"
        >
          <div className="relative h-2 rounded-full border border-muted-foreground bg-[linear-gradient(90deg,#83ba73_0%,#e8a257_50%,#a87bd5_100%)]">
            {points.map((p) => {
              const marker =
                p.value === current ? 'current' : pair && p.value === candidate ? 'new' : undefined;
              return (
                <span
                  key={p.value}
                  title={p.name}
                  data-model={p.value}
                  data-marker={marker}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 ${marker === 'current' ? 'z-10 size-3 rounded-full border-2 border-background bg-foreground ring-1 ring-foreground' : marker === 'new' ? 'z-10 size-3 rotate-45 border-2 border-foreground bg-background ring-1 ring-background' : 'size-1.5 rounded-full bg-foreground opacity-40'}`}
                  style={{
                    left: `${(p.position ?? 0) * 100}%`,
                    top: marker && pair ? (marker === 'current' ? '-4px' : '12px') : '50%',
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </figure>
  );
}
