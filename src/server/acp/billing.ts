import type { BillingInfo } from '../../shared/protocol.js';

const CREDIT_KINDS = ['prompt', 'flow', 'flex'] as const;

/** depth-first scalar scan — first value wins for duplicate keys */
function collect(v: unknown, out: Map<string, unknown>, depth: number): void {
  if (depth > 8) return;
  if (Array.isArray(v)) {
    for (const item of v) collect(item, out, depth + 1);
    return;
  }
  if (typeof v !== 'object' || v === null) return;
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'number' || typeof val === 'string') {
      if (!out.has(k)) out.set(k, val);
    } else {
      collect(val, out, depth + 1);
    }
  }
}

/**
 * `_cognition.ai/billingInformation` params → BillingInfo.
 * The payload is an undocumented mirror of the seat-management user/plan
 * status, so we scan for PlanStatus field names (snake_case or camelCase)
 * anywhere in the params tree rather than pinning a shape.
 */
export function parseBillingInfo(params: unknown): BillingInfo | null {
  if (typeof params !== 'object' || params === null) return null;
  const flat = new Map<string, unknown>();
  collect(params, flat, 0);

  const num = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = flat.get(k);
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };
  const str = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = flat.get(k);
      if (typeof v === 'string' && v) return v;
    }
    return undefined;
  };

  const info: BillingInfo = {
    updatedAt: Date.now(),
    source: 'push',
    planName: str('plan_name', 'planName'),
    accountName: str('account_display_name', 'accountDisplayName'),
    dailyQuotaPct: num('daily_quota_remaining_percent', 'dailyQuotaRemainingPercent'),
    weeklyQuotaPct: num('weekly_quota_remaining_percent', 'weeklyQuotaRemainingPercent'),
    dailyResetAt: num('daily_quota_reset_at_unix', 'dailyQuotaResetAtUnix'),
    weeklyResetAt: num('weekly_quota_reset_at_unix', 'weeklyQuotaResetAtUnix'),
    acuConsumed: num('acu_consumed', 'acuConsumed'),
    acuLimit: num('acu_limit', 'acuLimit'),
    overageMicros: num('overage_balance_micros', 'overageBalanceMicros'),
  };
  const credits = CREDIT_KINDS.flatMap((kind) => {
    const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
    const available = num(`available_${kind}_credits`, `available${cap}Credits`);
    const used = num(`used_${kind}_credits`, `used${cap}Credits`);
    return available === undefined && used === undefined ? [] : [{ kind, available, used }];
  });
  if (credits.length > 0) info.credits = credits;
  return info;
}
