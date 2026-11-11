import type { PermissionRequest } from '@shared/protocol';
import { ShieldAlert } from 'lucide-react';
import { useEffect } from 'react';
import { DiffView } from '@/components/ToolCard';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useT } from '@/i18n';
import { send } from '@/lib/ws';

export function PermissionSheet({
  request,
  sessionId,
}: {
  request: PermissionRequest;
  sessionId: string;
}) {
  const t = useT();

  useEffect(() => {
    navigator.vibrate?.(10);
  }, []);

  const respond = (optionId: string) =>
    send({
      type: 'permission.respond',
      sessionId,
      requestId: request.requestId,
      outcome: { kind: 'selected', optionId },
    }).catch(() => {});

  const diffs = request.content?.filter((c) => c.type === 'diff') ?? [];
  const texts =
    request.content?.filter((c) => c.type === 'content' && c.content?.type === 'text') ?? [];

  return (
    <Sheet open onOpenChange={() => {}}>
      {/* No dismiss while pending — pointer-events blocked via modal sheet */}
      <SheetContent
        side="bottom"
        className="safe-x safe-bottom px-4"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-warning" />
            {t('perm.title')}
          </SheetTitle>
          <SheetDescription className="text-left">{request.title}</SheetDescription>
        </SheetHeader>

        <div className="space-y-2 pb-2">
          {(request.permissionRule || request.permissionReason) && (
            <p className="text-xs text-muted-foreground">
              {request.permissionRule && (
                <>
                  {t('perm.rule')}:{' '}
                  <code className="rounded bg-muted px-1">{request.permissionRule}</code>
                </>
              )}
              {request.permissionRule && request.permissionReason && ' · '}
              {request.permissionReason}
            </p>
          )}
          {request.editableCommand && (
            <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 text-sm">
              $ {request.editableCommand}
            </code>
          )}
          {diffs.map((c) =>
            c.type === 'diff' ? (
              <DiffView key={c.path} path={c.path} oldText={c.oldText ?? ''} newText={c.newText} />
            ) : null,
          )}
          {texts.map((c) =>
            c.type === 'content' && c.content?.type === 'text' ? (
              <pre
                key={c.content.text.slice(0, 64)}
                className="max-h-40 overflow-auto rounded-md bg-muted px-3 py-2 text-xs whitespace-pre-wrap"
              >
                {c.content.text}
              </pre>
            ) : null,
          )}

          <div className="flex flex-col gap-2 pt-1">
            {request.options.map((o) => {
              const kind = o.kind ?? '';
              const allow = kind.startsWith('allow');
              const always = kind === 'allow_always';
              return (
                <Button
                  key={o.optionId}
                  variant={allow && !always ? 'default' : allow ? 'secondary' : 'outline'}
                  className={`h-auto min-h-12 w-full flex-col items-start gap-0 py-2.5 text-left ${
                    !allow ? 'border-destructive text-destructive hover:bg-destructive/10' : ''
                  }`}
                  onClick={() => respond(o.optionId)}
                >
                  <span className="font-medium">{o.name}</span>
                  {always && <span className="text-xs">{t('perm.forSession')}</span>}
                </Button>
              );
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
