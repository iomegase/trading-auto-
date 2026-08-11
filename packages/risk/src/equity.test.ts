import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  calculateSizingEquity,
  createRiskAccountState,
  createRiskPolicy,
  RiskInputError,
} from '@trading-auto/risk';

const policyInput = {
  version: 'RISK_FUTURES_V1_RESEARCH',
  approvalStatus: 'APPROVED',
  referenceCurrency: 'EUR',
  accountCurrency: 'EUR',
  initialCapital: '1000',
  maxSizingCapital: '1000',
  riskPerTradePct: '0.5',
  maxOpenRiskPct: '2',
  maxOpenPositions: 4,
  maxContractsPerPosition: '4',
  maxGrossExposurePct: '100',
  maxMarginUsagePct: '100',
  cashReservePct: '0',
  dailyLossLimitPct: '2',
  maxDrawdownPct: '10',
  riskGroupMaxExposurePct: { EU: '100', US: '100' },
  allowCashInjection: false,
  sizingEquityMode: 'REALIZED_PLUS_UNREALIZED_LOSSES',
  capIncreaseMode: 'MANUAL_VERSIONED',
  approvedBy: 'RESEARCH_RISK_OWNER',
  approvedAt: '2026-01-01T00:00:00Z',
  activatedAt: '2026-01-01T00:00:00Z',
} as const;

function account(realizedEquity: string, unrealizedPnl: string) {
  const usedMargin = '0';
  const availableFunds = String(BigInt(realizedEquity) + BigInt(unrealizedPnl));
  return createRiskAccountState({
    accountCurrency: 'EUR',
    realizedEquity,
    unrealizedPnl,
    availableFunds,
    usedMargin,
    grossExposure: '0',
    openRisk: '0',
    dailyLoss: '0',
    drawdownPct: '0',
    killSwitchActive: false,
  });
}

describe('calculateSizingEquity', () => {
  it('ignores unrealized gains, includes losses, clamps, and caps exactly', () => {
    const policy = createRiskPolicy(policyInput);
    expect(calculateSizingEquity(account('1000', '200'), policy)).toBe('1000');
    expect(calculateSizingEquity(account('1000', '-200'), policy)).toBe('800');
    expect(calculateSizingEquity(account('1300', '0'), policy)).toBe('1000');
    expect(calculateSizingEquity(account('100', '-200'), policy)).toBe('0');
    expect(calculateSizingEquity(account('-100', '0'), policy)).toBe('0');
    expect(
      calculateSizingEquity(
        account('1300', '0'),
        createRiskPolicy({
          ...policyInput,
          version: 'CAP_1200',
          maxSizingCapital: '1200',
        }),
      ),
    ).toBe('1200');
    expect(
      calculateSizingEquity(
        account('1000', '0'),
        createRiskPolicy({
          ...policyInput,
          version: 'CAP_800',
          maxSizingCapital: '800',
        }),
      ),
    ).toBe('800');
  });

  it('preserves exact arithmetic beyond 20 digits without exponent notation', () => {
    const realized = '123456789012345678901234567890.123456789';
    const loss = '-0.123456789';
    const exactAccount = createRiskAccountState({
      accountCurrency: 'EUR',
      realizedEquity: realized,
      unrealizedPnl: loss,
      availableFunds: '123456789012345678901234567890',
      usedMargin: '0',
      grossExposure: '0',
      openRisk: '0',
      dailyLoss: '0',
      drawdownPct: '0',
      killSwitchActive: false,
    });
    const policy = createRiskPolicy({
      ...policyInput,
      version: 'HUGE_CAP',
      maxSizingCapital: '999999999999999999999999999999',
    });
    expect(calculateSizingEquity(exactAccount, policy)).toBe(
      '123456789012345678901234567890',
    );
  });

  it('is isolated from ambient Decimal configuration and does not mutate inputs', () => {
    const previous = {
      precision: Decimal.precision,
      toExpNeg: Decimal.toExpNeg,
      toExpPos: Decimal.toExpPos,
    };
    const exactAccount = account('1000', '-200');
    const policy = createRiskPolicy(policyInput);
    try {
      Decimal.set({ precision: 2, toExpNeg: 0, toExpPos: 0 });
      expect(calculateSizingEquity(exactAccount, policy)).toBe('800');
    } finally {
      Decimal.set(previous);
    }
    expect(exactAccount).toEqual(account('1000', '-200'));
    expect(policy).toEqual(createRiskPolicy(policyInput));
  });

  it('rejects forged runtime account and policy inputs', () => {
    const accountValue = account('1000', '0');
    const policy = createRiskPolicy(policyInput);
    expect(() =>
      calculateSizingEquity(
        { ...accountValue, realizedEquity: 'bad' } as never,
        policy,
      ),
    ).toThrow(RiskInputError);
    expect(() =>
      calculateSizingEquity(accountValue, {
        ...policy,
        maxSizingCapital: '-1',
      } as never),
    ).toThrow(RiskInputError);
  });
});
