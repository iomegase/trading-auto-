import { describe, expect, expectTypeOf, it } from 'vitest';

import { BacktestInputError, type BacktestPortfolioState } from './index.js';

const baselinePolicy = {
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
  riskGroupMaxExposurePct: {
    EUROPE_EQUITY_INDEX: '100',
    US_EQUITY_INDEX: '100',
  },
  allowCashInjection: false,
  sizingEquityMode: 'REALIZED_PLUS_UNREALIZED_LOSSES',
  capIncreaseMode: 'MANUAL_VERSIONED',
  approvedBy: 'RESEARCH_RISK_OWNER',
  approvedAt: '2026-01-01T00:00:00Z',
  activatedAt: '2026-01-01T00:00:00Z',
} as const;

function portfolioInput(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    backtestId: 'BT-1',
    runCreatedAt: '2026-08-14T10:00:00+02:00',
    riskPolicyUseMode: 'HISTORICAL_RESEARCH',
    riskPolicyUseAt: '2026-08-14T08:00:00Z',
    policy: baselinePolicy,
    ...overrides,
  };
}

function expectInputError(operation: () => unknown): BacktestInputError {
  let received: unknown;
  try {
    operation();
  } catch (error) {
    received = error;
  }
  expect(received).toBeInstanceOf(BacktestInputError);
  expect(received).toMatchObject({ code: 'INVALID_BACKTEST_INPUT' });
  return received as BacktestInputError;
}

describe('createBacktestPortfolioState', () => {
  it('creates the exact immutable EUR baseline', async () => {
    const { createBacktestPortfolioState } = await import('./portfolio.js');

    const state = createBacktestPortfolioState(portfolioInput() as never);

    expect(state).toMatchObject({
      backtestId: 'BT-1',
      runCreatedAt: '2026-08-14T08:00:00Z',
      riskPolicyUseMode: 'HISTORICAL_RESEARCH',
      riskPolicyUseAt: '2026-08-14T08:00:00Z',
      riskPolicyVersion: 'RISK_FUTURES_V1_RESEARCH',
      maxSizingCapital: '1000',
      operatingStatus: 'RUNNING',
      accountCurrency: 'EUR',
      initialCash: '1000',
      cash: '1000',
      realizedEquity: '1000',
      unrealizedPnl: '0',
      sizingEquity: '1000',
      usedMargin: '0',
      reservedMargin: '0',
      availableFunds: '1000',
      grossExposure: '0',
      reservedGrossExposure: '0',
      openRisk: '0',
      dailyLoss: '0',
      drawdownPct: '0',
      processedEventCount: 0,
      lastClockKey: null,
    });
    expect(state.policy).toEqual(baselinePolicy);
    expect(state.positions).toEqual([]);
    expect(state.activeEntryIntents).toEqual([]);
    expect(state.riskGroupExposure).toEqual({
      EUROPE_EQUITY_INDEX: '0',
      US_EQUITY_INDEX: '0',
    });
    expect(state.activeContractByInstrument).toEqual({});
    expect(state.dailySnapshots).toEqual([]);
    expect(state.ledger[0]?.postings).toEqual([
      { account: 'CASH', amount: '1000' },
      { account: 'CAPITAL', amount: '-1000' },
    ]);
    expectTypeOf(state).toEqualTypeOf<BacktestPortfolioState>();
  });

  it('deep-freezes the complete initial state', async () => {
    const { createBacktestPortfolioState } = await import('./portfolio.js');

    const state = createBacktestPortfolioState(portfolioInput() as never);

    expect(
      [
        state,
        state.policy,
        state.policy.riskGroupMaxExposurePct,
        state.positions,
        state.activeEntryIntents,
        state.riskGroupExposure,
        state.activeContractByInstrument,
        state.dailySnapshots,
        state.ledger,
        state.ledger[0],
        state.ledger[0]?.postings,
      ].every((value) => Object.isFrozen(value)),
    ).toBe(true);
  });

  it('keeps a separately approved 1,200 EUR cap fixed while starting sizing at 1,000', async () => {
    const { createBacktestPortfolioState } = await import('./portfolio.js');
    const higherPolicy = {
      ...baselinePolicy,
      version: 'RISK_FUTURES_CAP_1200',
      maxSizingCapital: '1200',
    };

    const state = createBacktestPortfolioState(
      portfolioInput({ policy: higherPolicy }) as never,
    );

    expect(state).toMatchObject({
      riskPolicyVersion: 'RISK_FUTURES_CAP_1200',
      maxSizingCapital: '1200',
      initialCash: '1000',
      sizingEquity: '1000',
    });
    expect(state.policy.maxSizingCapital).toBe('1200');
  });

  it.each([
    ['approvalStatus', 'DRAFT'],
    ['referenceCurrency', 'USD'],
    ['accountCurrency', 'USD'],
    ['initialCapital', '999'],
    ['initialCapital', '1000.0'],
    ['allowCashInjection', true],
  ])('rejects invalid policy invariant %s=%s', async (field, value) => {
    const { createBacktestPortfolioState } = await import('./portfolio.js');

    expectInputError(() =>
      createBacktestPortfolioState(
        portfolioInput({
          policy: { ...baselinePolicy, [field]: value },
        }) as never,
      ),
    );
  });

  it('requires historical research mode', async () => {
    const { createBacktestPortfolioState } = await import('./portfolio.js');

    expectInputError(() =>
      createBacktestPortfolioState(
        portfolioInput({ riskPolicyUseMode: 'FORWARD' }) as never,
      ),
    );
  });

  it('requires policy-use time to equal normalized run creation time', async () => {
    const { createBacktestPortfolioState } = await import('./portfolio.js');

    expect(
      createBacktestPortfolioState(
        portfolioInput({
          riskPolicyUseAt: '2026-08-14T09:00:00+01:00',
        }) as never,
      ).riskPolicyUseAt,
    ).toBe('2026-08-14T08:00:00Z');
    expectInputError(() =>
      createBacktestPortfolioState(
        portfolioInput({ riskPolicyUseAt: '2026-08-14T08:00:01Z' }) as never,
      ),
    );
  });

  it('requires approval, activation, then run creation chronology', async () => {
    const { createBacktestPortfolioState } = await import('./portfolio.js');

    expectInputError(() =>
      createBacktestPortfolioState(
        portfolioInput({
          policy: {
            ...baselinePolicy,
            approvedAt: '2026-01-02T00:00:00Z',
            activatedAt: '2026-01-01T00:00:00Z',
          },
        }) as never,
      ),
    );
    expectInputError(() =>
      createBacktestPortfolioState(
        portfolioInput({
          policy: {
            ...baselinePolicy,
            approvedAt: '2026-08-14T07:59:59Z',
            activatedAt: '2026-08-14T08:00:01Z',
          },
        }) as never,
      ),
    );
  });

  it.each([
    ['backtestId', ''],
    ['backtestId', 1],
    ['runCreatedAt', 'invalid'],
    ['riskPolicyUseAt', 1],
    ['policy', null],
  ])('rejects malformed top-level %s', async (field, value) => {
    const { createBacktestPortfolioState } = await import('./portfolio.js');

    expectInputError(() =>
      createBacktestPortfolioState(portfolioInput({ [field]: value }) as never),
    );
  });

  it('captures top-level, policy, and risk-group values without Proxy get traps', async () => {
    const { createBacktestPortfolioState } = await import('./portfolio.js');
    let topGets = 0;
    let policyGets = 0;
    let groupGets = 0;
    const groups = new Proxy(
      { ...baselinePolicy.riskGroupMaxExposurePct },
      {
        get() {
          groupGets += 1;
          return 'trap';
        },
      },
    );
    const policy = new Proxy(
      { ...baselinePolicy, riskGroupMaxExposurePct: groups },
      {
        get() {
          policyGets += 1;
          return 'trap';
        },
      },
    );
    const input = new Proxy(portfolioInput({ policy }), {
      get() {
        topGets += 1;
        return 'trap';
      },
    });

    expect(createBacktestPortfolioState(input as never).policy.version).toBe(
      baselinePolicy.version,
    );
    expect({ topGets, policyGets, groupGets }).toEqual({
      topGets: 0,
      policyGets: 0,
      groupGets: 0,
    });
  });

  it('detaches all caller-owned policy data', async () => {
    const { createBacktestPortfolioState } = await import('./portfolio.js');
    const riskGroupMaxExposurePct: Record<string, string> = {
      ...baselinePolicy.riskGroupMaxExposurePct,
    };
    const policy = {
      ...baselinePolicy,
      riskGroupMaxExposurePct,
    };

    const state = createBacktestPortfolioState(
      portfolioInput({ policy }) as never,
    );
    riskGroupMaxExposurePct.EUROPE_EQUITY_INDEX = '1';

    expect(state.policy.riskGroupMaxExposurePct.EUROPE_EQUITY_INDEX).toBe(
      '100',
    );
    expect(state.riskGroupExposure.EUROPE_EQUITY_INDEX).toBe('0');
  });

  it('maps hostile and revoked Proxy failures to BacktestInputError', async () => {
    const { createBacktestPortfolioState } = await import('./portfolio.js');
    const hostile = new Proxy(portfolioInput(), {
      ownKeys() {
        throw new Error('hostile');
      },
    });
    const { proxy, revoke } = Proxy.revocable(portfolioInput(), {});
    revoke();

    expectInputError(() => createBacktestPortfolioState(hostile as never));
    expectInputError(() => createBacktestPortfolioState(proxy as never));
  });
});
