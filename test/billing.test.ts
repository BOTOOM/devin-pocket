import { describe, expect, it } from 'vitest';
import { parseBillingInfo } from '../src/server/acp/billing.js';

describe('parseBillingInfo', () => {
  it('extracts PlanStatus fields from a nested snake_case payload', () => {
    const info = parseBillingInfo({
      billingInformation: {
        plan_info: {
          plan_name: 'Max',
          account_display_name: 'EdwarDiazDev',
          daily_quota_remaining_percent: 82,
          weekly_quota_remaining_percent: '47',
          daily_quota_reset_at_unix: 1791676800,
          weekly_quota_reset_at_unix: 1792022400,
          acu_consumed: 12.4,
          acu_limit: 100,
          available_prompt_credits: 250,
          used_prompt_credits: 50,
          overage_balance_micros: 1500000,
        },
      },
    });
    expect(info).not.toBeNull();
    expect(info?.planName).toBe('Max');
    expect(info?.accountName).toBe('EdwarDiazDev');
    expect(info?.dailyQuotaPct).toBe(82);
    expect(info?.weeklyQuotaPct).toBe(47);
    expect(info?.dailyResetAt).toBe(1791676800);
    expect(info?.acuConsumed).toBe(12.4);
    expect(info?.acuLimit).toBe(100);
    expect(info?.overageMicros).toBe(1500000);
    expect(info?.credits).toEqual([{ kind: 'prompt', available: 250, used: 50 }]);
    expect(info?.updatedAt).toBeGreaterThan(0);
  });

  it('accepts camelCase and flat shapes', () => {
    const info = parseBillingInfo({
      planName: 'Core',
      weeklyQuotaRemainingPercent: 10,
      usedFlexCredits: '3',
    });
    expect(info?.planName).toBe('Core');
    expect(info?.weeklyQuotaPct).toBe(10);
    expect(info?.credits).toEqual([{ kind: 'flex', available: undefined, used: 3 }]);
  });

  it('returns an info with just updatedAt for unknown shapes, null for non-objects', () => {
    const info = parseBillingInfo({ something: 'unrelated' });
    expect(info?.updatedAt).toBeGreaterThan(0);
    expect(info?.planName).toBeUndefined();
    expect(parseBillingInfo(null)).toBeNull();
    expect(parseBillingInfo('str')).toBeNull();
  });
});
