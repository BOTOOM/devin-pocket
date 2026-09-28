import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { setTheme, useTheme } from '@/lib/theme';

export function ThemeToggle() {
  const t = useT();
  const { resolved } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t(`settings.theme.${next}`)}
      onClick={() => setTheme(next)}
    >
      {resolved === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </Button>
  );
}
