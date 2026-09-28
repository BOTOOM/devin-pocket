import type { Command } from '@shared/protocol';
import {
  Command as Cmd,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useT } from '@/i18n';
import { navigate } from '@/lib/router';
import { send } from '@/lib/ws';

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  commands: Command[];
  onPick: (name: string) => void;
}) {
  const t = useT();
  const groups = new Map<string, Command[]>();
  for (const c of commands) {
    const k = c.category ?? 'other';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)?.push(c);
  }

  const local = [
    { name: 'settings', label: t('cmd.actionSettings'), go: () => navigate('settings') },
    { name: 'diagnostics', label: t('cmd.actionDiagnostics'), go: () => navigate('diagnostics') },
    { name: 'home', label: t('cmd.actionHome'), go: () => navigate('home') },
    {
      name: 'restart',
      label: t('cmd.actionRestart'),
      go: () => send({ type: 'agent.restart' }).catch(() => {}),
    },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="safe-x safe-bottom max-h-[50dvh] px-0 pb-2">
        <SheetHeader className="sr-only">
          <SheetTitle>{t('cmd.title')}</SheetTitle>
          <SheetDescription>{t('cmd.title')}</SheetDescription>
        </SheetHeader>
        <Cmd className="bg-transparent">
          <CommandInput placeholder={t('cmd.search')} />
          <CommandList className="max-h-[38dvh]">
            <CommandEmpty>—</CommandEmpty>
            {[...groups.entries()].map(([cat, list]) => (
              <CommandGroup key={cat} heading={cat}>
                {list.map((c) => (
                  <CommandItem
                    key={c.name}
                    value={`${c.name} ${c.description ?? ''}`}
                    onSelect={() => {
                      onPick(c.name);
                      onOpenChange(false);
                    }}
                  >
                    <span className="font-medium">/{c.name}</span>
                    {c.description && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {c.description}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            <CommandGroup heading={t('cmd.local')}>
              {local.map((a) => (
                <CommandItem
                  key={a.name}
                  onSelect={() => {
                    onOpenChange(false);
                    a.go();
                  }}
                >
                  {a.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Cmd>
      </SheetContent>
    </Sheet>
  );
}
