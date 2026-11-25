import type { SessionConfigOption, SessionState } from '@shared/protocol';
import { pickModelOptions } from '@shared/reducer';
import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { ModelSheet } from '@/components/ModelSheet';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useT } from '@/i18n';
import { send } from '@/lib/ws';

const MODE_DESC: Record<string, string> = {
  code: 'Code — ejecuta comandos y edita archivos / runs commands and edits files',
  smart: 'Smart — equilibrio entre autonomía y preguntas / balances autonomy and questions',
  ask: 'Ask — solo responde, sin cambios / answers only, no changes',
  plan: 'Plan — propone un plan antes de actuar / proposes a plan first',
  bypass: 'Bypass — sin permisos, úsalo con cuidado / no permission prompts, use carefully',
};

/** Compact mode/model/reasoning chips + their sheets; rendered inside the composer row. */
export function SessionChips({ state, sessionId }: { state?: SessionState; sessionId: string }) {
  const t = useT();
  const [sheet, setSheet] = useState<'mode' | 'model' | 'reason' | null>(null);
  if (!state) return null;
  const { model, reasoning, speed } = pickModelOptions(state);
  const modelValue = currentValue(model);
  const modelName = model && selectOptions(model).find((o) => o.value === modelValue)?.name;
  const reasonValue = currentValue(reasoning);
  const speedValue = currentValue(speed);
  const modeName =
    state.modes.find((m) => m.id === state.currentMode)?.name ?? state.currentMode ?? '';

  return (
    <>
      {state.modes.length > 0 && (
        <Chip
          chip="mode"
          label={`${t('mode.title')}: ${modeName}`}
          onClick={() => setSheet('mode')}
          active={state.currentMode === 'bypass'}
        >
          {modeName || t('mode.title')}
        </Chip>
      )}
      {model && (
        <Chip
          chip="model"
          label={`${t('model.title')}: ${modelName ?? modelValue ?? ''}${speedValue === 'fast' ? ' · Fast' : ''}`}
          onClick={() => setSheet('model')}
        >
          {modelName ?? modelValue ?? t('model.title')}
          {speedValue === 'fast' && <span className="shrink-0 text-warning"> ⚡</span>}
        </Chip>
      )}
      {reasoning && reasonValue && (
        <Chip
          chip="reasoning"
          label={`${t('reasoning.title')}: ${reasonValue}`}
          onClick={() => setSheet('reason')}
        >
          {reasonValue}
        </Chip>
      )}

      <Sheet open={sheet === 'mode'} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent side="bottom" className="safe-bottom">
          <SheetHeader>
            <SheetTitle>{t('mode.title')}</SheetTitle>
            <SheetDescription className="sr-only">{t('mode.title')}</SheetDescription>
          </SheetHeader>
          <ToggleGroup
            type="single"
            className="flex-col items-stretch gap-1 md:w-full"
            value={state.currentMode}
            onValueChange={async (v) => {
              if (!v) return;
              await send({ type: 'mode.set', sessionId, modeId: v }).catch(() => {});
              setSheet(null);
            }}
          >
            {state.modes.map((m) => {
              const warn = /bypass/i.test(m.id);
              return (
                <ToggleGroupItem
                  key={m.id}
                  value={m.id}
                  className={`h-auto flex-col items-start gap-0.5 rounded-lg border px-3 py-3 text-left data-[state=on]:bg-accent ${warn ? 'border-warning/60' : ''}`}
                >
                  <span
                    className={`flex w-full items-center justify-between font-medium ${warn ? 'text-warning' : ''}`}
                  >
                    {m.name}
                    {state.currentMode === m.id && <Check className="size-4" />}
                  </span>
                  <span className="w-full min-w-0 whitespace-normal break-words text-left text-xs text-muted-foreground">
                    {m.description ?? MODE_DESC[m.id.toLowerCase()] ?? ''}
                  </span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </SheetContent>
      </Sheet>

      {model && (
        <ModelSheet
          open={sheet === 'model'}
          onOpenChange={(o) => !o && setSheet(null)}
          option={model}
          sessionId={sessionId}
        />
      )}

      {reasoning && (
        <Sheet open={sheet === 'reason'} onOpenChange={(o) => !o && setSheet(null)}>
          <SheetContent side="bottom" className="safe-bottom">
            <SheetHeader>
              <SheetTitle>{t('reasoning.title')}</SheetTitle>
              <SheetDescription className="sr-only">{t('reasoning.title')}</SheetDescription>
            </SheetHeader>
            <div className="space-y-1">
              {selectOptions(reasoning).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left hover:bg-accent"
                  onClick={async () => {
                    await send({
                      type: 'config.set',
                      sessionId,
                      configId: reasoning.id,
                      value: o.value,
                    }).catch(() => {});
                    setSheet(null);
                  }}
                >
                  <span className="min-w-0 flex-1 whitespace-normal break-words">{o.name}</span>
                  {o.value === reasonValue && <Check className="size-4 shrink-0" />}
                </button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

function Chip({
  children,
  onClick,
  active,
  chip,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  chip?: string;
  label: string;
}) {
  return (
    <button
      type="button"
      data-chip={chip}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-8 min-w-0 max-w-28 shrink-0 items-center justify-center gap-1 rounded-full border px-2 text-xs font-medium md:max-w-44 ${
        active ? 'border-warning/60 bg-warning/15 text-warning' : 'bg-card'
      }`}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronDown className="size-3 shrink-0 opacity-60" />
    </button>
  );
}

/** Select-type config option value (SDK union also allows boolean options). */
export function currentValue(opt?: SessionConfigOption): string | undefined {
  if (opt?.type !== 'select') return undefined;
  const v = (opt as { currentValue?: unknown }).currentValue;
  return typeof v === 'string' ? v : undefined;
}

export interface FlatOption {
  value: string;
  name: string;
  description?: string;
  group?: string;
  /** _meta["cognition.ai/supportsImages"] on the option (CLI ≥3000.11.92) */
  supportsImages?: boolean;
}

export function selectOptions(opt: SessionConfigOption): FlatOption[] {
  const raw = (opt.type === 'select' ? opt.options : []) as unknown[];
  const out: FlatOption[] = [];
  const images = (m: unknown): boolean | undefined => {
    const v = (m as Record<string, unknown> | undefined)?.['cognition.ai/supportsImages'];
    return typeof v === 'boolean' ? v : undefined;
  };
  for (const o of raw) {
    const item = o as {
      value?: string;
      name?: string;
      description?: string;
      _meta?: unknown;
      options?: { value: string; name: string; description?: string; _meta?: unknown }[];
    };
    if (Array.isArray(item.options)) {
      for (const sub of item.options)
        out.push({
          value: sub.value,
          name: sub.name,
          description: sub.description,
          group: item.name,
          supportsImages: images(sub._meta),
        });
    } else if (item.value !== undefined) {
      out.push({
        value: item.value,
        name: item.name ?? item.value,
        description: item.description,
        supportsImages: images(item._meta),
      });
    }
  }
  return out;
}
