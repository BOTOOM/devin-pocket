import type { PlanEntry } from '@shared/protocol';
import { Check, ChevronDown, Circle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useT } from '@/i18n';

export function PlanPanel({ plan }: { plan: PlanEntry[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const done = plan.filter((e) => e.status === 'completed').length;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t bg-card">
      <CollapsibleTrigger className="safe-x flex min-h-10 w-full items-center gap-2 px-4 text-sm font-medium">
        {t('plan.title', { done, total: plan.length })}
        <ChevronDown
          className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="safe-x px-4 pb-2">
        {plan.map((e) => (
          <div key={e.content} className="flex items-start gap-2 py-1 text-sm">
            <PlanIcon status={e.status} />
            <span className={e.status === 'completed' ? 'text-muted-foreground line-through' : ''}>
              {e.content}
            </span>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function PlanIcon({ status }: { status: string }) {
  if (status === 'completed') return <Check className="mt-0.5 size-4 shrink-0 text-success" />;
  if (status === 'in_progress')
    return <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-info" />;
  return <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}
