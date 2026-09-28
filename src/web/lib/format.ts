import { getLang } from '@/i18n';

export function relTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const es = getLang() === 'es';
  const mins = Math.round(diff / 60000);
  if (mins < 1) return es ? 'ahora' : 'now';
  if (mins < 60) return es ? `hace ${mins} min` : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return es ? `hace ${hrs} h` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return es ? `hace ${days} d` : `${days}d ago`;
  return new Date(d).toLocaleDateString(es ? 'es' : 'en', { month: 'short', day: 'numeric' });
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function fmtMoney(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat(getLang() === 'es' ? 'es' : 'en', {
    style: 'currency',
    currency,
    minimumFractionDigits: amount < 1 ? 3 : 2,
  }).format(amount);
}

export function baseName(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}

export function dayGroup(iso?: string): 'today' | 'yesterday' | 'older' {
  if (!iso) return 'older';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, now)) return 'today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return 'yesterday';
  return 'older';
}
