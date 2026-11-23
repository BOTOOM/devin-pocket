import type {
  ElicitationContentValue,
  ElicitationRequest,
  ElicitationSchema,
} from '@shared/protocol';
import { MessageCircleQuestion } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { useT } from '@/i18n';
import { send } from '@/lib/ws';

type Prop = NonNullable<ElicitationSchema['properties']>[string];

interface Option {
  value: string;
  label: string;
  description?: string | null;
}

/** Single-select options for a string prop (titled oneOf wins over bare enum). */
function singleOptions(p: Prop): Option[] | null {
  if (p.type !== 'string') return null;
  const s = p as {
    enum?: string[] | null;
    oneOf?: { const: string; title: string; description?: string | null }[] | null;
  };
  if (s.oneOf?.length) {
    return s.oneOf.map((o) => ({ value: o.const, label: o.title, description: o.description }));
  }
  if (s.enum?.length) return s.enum.map((v) => ({ value: v, label: v }));
  return null;
}

/** Multi-select options for an array prop (titled anyOf wins over bare enum). */
function multiOptions(p: Prop): Option[] | null {
  if (p.type !== 'array') return null;
  const items = (
    p as {
      items?: {
        enum?: string[];
        anyOf?: { const: string; title: string; description?: string | null }[];
      };
    }
  ).items;
  if (items?.anyOf?.length) {
    return items.anyOf.map((o) => ({ value: o.const, label: o.title, description: o.description }));
  }
  if (items?.enum?.length) return items.enum.map((v) => ({ value: v, label: v }));
  return null;
}

function defaultFor(p: Prop): ElicitationContentValue | undefined {
  const d = (p as { default?: ElicitationContentValue | null }).default;
  return d ?? undefined;
}

export function ElicitationSheet({
  request,
  sessionId,
}: {
  request: ElicitationRequest;
  sessionId: string;
}) {
  const t = useT();
  const schema = request.schema;
  const entries = useMemo(() => Object.entries(schema.properties ?? {}), [schema]);
  const required = useMemo(() => new Set(schema.required ?? []), [schema]);
  const [values, setValues] = useState<Record<string, ElicitationContentValue>>(() => {
    const init: Record<string, ElicitationContentValue> = {};
    for (const [k, p] of entries) {
      const d = defaultFor(p);
      if (d !== undefined) init[k] = d;
      else if (p.type === 'boolean') init[k] = false;
      else if (p.type === 'array') init[k] = [];
    }
    return init;
  });

  useEffect(() => {
    navigator.vibrate?.(10);
  }, []);

  const respond = (response: {
    action: 'accept' | 'decline' | 'cancel';
    content?: Record<string, ElicitationContentValue>;
  }) =>
    send({
      type: 'elicitation.respond',
      sessionId,
      requestId: request.requestId,
      response,
    }).catch(() => {});

  const missing = [...required].filter((k) => {
    const v = values[k];
    return v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  });

  const set = (k: string, v: ElicitationContentValue) => setValues((s) => ({ ...s, [k]: v }));

  return (
    <Sheet open onOpenChange={() => {}}>
      <SheetContent
        side="bottom"
        className="safe-x safe-bottom max-h-[85dvh] overflow-y-auto px-4"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MessageCircleQuestion className="size-5 text-primary" />
            {schema.title || t('elic.title')}
          </SheetTitle>
          <SheetDescription className="text-left">
            {request.message || schema.description || ''}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 pb-2">
          {entries.map(([key, p]) => (
            <Field
              key={key}
              name={key}
              prop={p}
              required={required.has(key)}
              requiredLabel={t('elic.required')}
              optionalLabel={t('elic.optional')}
              value={values[key]}
              onChange={(v) => set(key, v)}
            />
          ))}

          <div className="flex flex-col gap-2 pt-1">
            {missing.length > 0 && (
              <p className="text-xs text-muted-foreground">{t('elic.missing')}</p>
            )}
            <Button
              className="min-h-12 w-full"
              disabled={missing.length > 0}
              onClick={() => respond({ action: 'accept', content: values })}
            >
              {t('elic.submit')}
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="min-h-11 flex-1"
                onClick={() => respond({ action: 'decline' })}
              >
                {t('elic.decline')}
              </Button>
              <Button
                variant="ghost"
                className="min-h-11 flex-1"
                onClick={() => respond({ action: 'cancel' })}
              >
                {t('elic.cancel')}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  name,
  prop,
  required,
  requiredLabel,
  optionalLabel,
  value,
  onChange,
}: {
  name: string;
  prop: Prop;
  required: boolean;
  requiredLabel: string;
  optionalLabel: string;
  value: ElicitationContentValue | undefined;
  onChange: (v: ElicitationContentValue) => void;
}) {
  const single = singleOptions(prop);
  const multi = multiOptions(prop);
  const title = (prop as { title?: string | null }).title ?? name;
  const desc = (prop as { description?: string | null }).description;
  const tag = (
    <span className="text-xs font-normal text-muted-foreground">
      {required ? requiredLabel : optionalLabel}
    </span>
  );

  if (prop.type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`elic-${name}`} className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          {desc && <span className="block text-xs text-muted-foreground">{desc}</span>}
        </Label>
        <Switch id={`elic-${name}`} checked={value === true} onCheckedChange={(v) => onChange(v)} />
      </div>
    );
  }

  if (prop.type === 'number' || prop.type === 'integer') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`elic-${name}`}>
          {title} {tag}
        </Label>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
        <Input
          id={`elic-${name}`}
          type="number"
          inputMode={prop.type === 'integer' ? 'numeric' : 'decimal'}
          step={prop.type === 'integer' ? 1 : 'any'}
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(e) => {
            if (e.target.value === '') {
              onChange('');
              return;
            }
            const n =
              prop.type === 'integer'
                ? Number.parseInt(e.target.value, 10)
                : Number(e.target.value);
            if (!Number.isNaN(n)) onChange(n);
          }}
        />
      </div>
    );
  }

  if (single) {
    return (
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">
          {title} {tag}
        </legend>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
        <div className="flex flex-col gap-2">
          {single.map((o) => (
            <Button
              key={o.value}
              type="button"
              variant={value === o.value ? 'default' : 'outline'}
              className="h-auto min-h-11 w-full flex-col items-start gap-0 py-2 text-left"
              onClick={() => onChange(o.value)}
            >
              <span className="font-medium">{o.label}</span>
              {o.description && <span className="text-xs font-normal">{o.description}</span>}
            </Button>
          ))}
        </div>
      </fieldset>
    );
  }

  if (multi) {
    const sel = Array.isArray(value) ? value : [];
    const min = (prop as { minItems?: number | null }).minItems ?? undefined;
    const max = (prop as { maxItems?: number | null }).maxItems ?? undefined;
    return (
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">
          {title} {tag}
        </legend>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
        <div className="flex flex-col gap-2">
          {multi.map((o) => {
            const active = sel.includes(o.value);
            return (
              <Button
                key={o.value}
                type="button"
                variant={active ? 'secondary' : 'outline'}
                className="h-auto min-h-11 w-full flex-col items-start gap-0 py-2 text-left"
                onClick={() => {
                  if (active) onChange(sel.filter((v) => v !== o.value));
                  else if (max === undefined || sel.length < max) onChange([...sel, o.value]);
                }}
              >
                <span className="font-medium">
                  {active ? '✓ ' : ''}
                  {o.label}
                </span>
                {o.description && <span className="text-xs font-normal">{o.description}</span>}
              </Button>
            );
          })}
        </div>
        {min !== undefined && sel.length < min && (
          <p className="text-xs text-muted-foreground">≥{min}</p>
        )}
      </fieldset>
    );
  }

  // plain string (or unknown prop) — single-line input
  const fmt = (prop as { format?: string | null }).format;
  const type = fmt === 'email' ? 'email' : fmt === 'uri' ? 'url' : fmt === 'date' ? 'date' : 'text';
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`elic-${name}`}>
        {title} {tag}
      </Label>
      {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      <Input
        id={`elic-${name}`}
        type={type}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
