import { describe, expect, it } from 'vitest';

import {
  buildExecutionIntent,
  buildExecutionPosition,
  buildIntentState,
  buildPolicy,
  buildPositionState,
  buildRiskPosition,
} from '../test-helpers/builders.js';
import {
  BacktestInputError,
  BacktestStateError,
  createBacktestEvent,
  createBacktestPortfolioState,
  type BacktestEventType,
  type BacktestPortfolioState,
} from './index.js';

function initialState(): BacktestPortfolioState {
  return createBacktestPortfolioState({
    backtestId: 'BT-1',
    runCreatedAt: '2026-08-14T08:00:00Z',
    riskPolicyUseMode: 'HISTORICAL_RESEARCH',
    riskPolicyUseAt: '2026-08-14T08:00:00Z',
    policy: buildPolicy(),
  });
}

function event(
  type: BacktestEventType,
  semanticId: string,
  availableAt = '2026-08-14T09:00:00Z',
  subject: Readonly<{
    instrumentId: string | null;
    contractId: string | null;
  }> = {
    instrumentId: type === 'PORTFOLIO_SNAPSHOT' ? null : 'FDXS',
    contractId: type === 'PORTFOLIO_SNAPSHOT' ? null : 'FDXS-202609',
  },
) {
  return createBacktestEvent({
    semanticId,
    type,
    availableAt,
    instrumentId: subject.instrumentId,
    contractId: subject.contractId,
    version: 'V1',
    payload: {},
  });
}

function ledgerEntry(
  eventId: string,
  cashChange: string,
  account: 'CAPITAL' | 'COSTS' | 'FX_TRANSLATION' | 'PNL_CLEARING',
  entryId = `ledger:${eventId}`,
) {
  const inverse = cashChange.startsWith('-')
    ? cashChange.slice(1)
    : `-${cashChange}`;
  return {
    entryId,
    eventId,
    occurredAt: '2026-08-14T09:00:00Z',
    description: 'Test accounting',
    fxSnapshotVersion: account === 'FX_TRANSLATION' ? 'FX-1' : null,
    postings: [
      { account: 'CASH', amount: cashChange },
      { account, amount: inverse },
    ],
  };
}

async function reduce(
  state: BacktestPortfolioState,
  transition: Readonly<Record<string, unknown>>,
): Promise<BacktestPortfolioState> {
  const { reduceBacktestPortfolio } = await import('./reducer.js');
  return reduceBacktestPortfolio(state, transition as never);
}

async function stateWithIntent(): Promise<BacktestPortfolioState> {
  return reduce(initialState(), {
    type: 'REGISTER_INTENT',
    event: event('SIGNAL_DECISION', 'signal-1', '2026-08-14T08:05:00Z'),
    intent: buildIntentState(),
  });
}

async function stateWithPosition(): Promise<BacktestPortfolioState> {
  const registered = await stateWithIntent();
  return reduce(registered, {
    type: 'OPEN_POSITION',
    event: event('OPEN_ENTRY', 'open-1'),
    intentId: 'INTENT-1',
    position: buildPositionState(),
    cashChange: '-2',
    ledgerEntry: ledgerEntry('open-1', '-2', 'COSTS'),
  });
}

describe('reduceBacktestPortfolio lifecycle', () => {
  it('registers and cancels an intent without moving cash', async () => {
    const registered = await stateWithIntent();

    expect(registered.activeEntryIntents).toHaveLength(1);
    expect(registered).toMatchObject({
      cash: '1000',
      reservedMargin: '100',
      reservedGrossExposure: '200',
      openRisk: '5',
      availableFunds: '900',
      processedEventCount: 1,
    });

    const cancelled = await reduce(registered, {
      type: 'CANCEL_INTENT',
      event: event('OPEN_ENTRY', 'cancel-1', '2026-08-14T08:06:00Z'),
      intentId: 'INTENT-1',
    });
    expect(cancelled.activeEntryIntents).toEqual([]);
    expect(cancelled).toMatchObject({
      cash: '1000',
      reservedMargin: '0',
      reservedGrossExposure: '0',
      openRisk: '0',
      availableFunds: '1000',
      processedEventCount: 2,
    });
  });

  it('opens a position atomically, removes its intent, and posts cost', async () => {
    const opened = await stateWithPosition();

    expect(opened.activeEntryIntents).toEqual([]);
    expect(
      opened.positions.map(
        ({ executionPosition }) => executionPosition.positionId,
      ),
    ).toEqual(['POSITION-1']);
    expect(opened).toMatchObject({
      cash: '998',
      realizedEquity: '998',
      usedMargin: '100',
      reservedMargin: '0',
      availableFunds: '898',
      grossExposure: '200',
      openRisk: '5',
      sizingEquity: '998',
      processedEventCount: 2,
    });
    expect(opened.ledger).toHaveLength(2);
  });

  it('revalues without cash movement and applies asymmetric sizing', async () => {
    const opened = await stateWithPosition();
    const gain = await reduce(opened, {
      type: 'REVALUE_POSITION',
      event: event(
        'CLOSED_BAR_POSITION',
        'revalue-gain',
        '2026-08-14T10:00:00Z',
      ),
      position: buildPositionState({ unrealizedPnl: '50' }),
    });
    const loss = await reduce(gain, {
      type: 'REVALUE_POSITION',
      event: event(
        'CLOSED_BAR_POSITION',
        'revalue-loss',
        '2026-08-14T11:00:00Z',
      ),
      position: buildPositionState({ unrealizedPnl: '-50' }),
    });

    expect(gain).toMatchObject({
      cash: '998',
      realizedEquity: '998',
      unrealizedPnl: '50',
      sizingEquity: '998',
      availableFunds: '948',
    });
    expect(loss).toMatchObject({
      cash: '998',
      realizedEquity: '998',
      unrealizedPnl: '-50',
      sizingEquity: '948',
      availableFunds: '848',
    });
    expect(loss.ledger).toHaveLength(2);
  });

  it.each([
    ['DAILY_SETTLEMENT', 'settlement-1'],
    ['ROLL', 'roll-accounting'],
    ['OPEN_EXIT', 'exit-accounting'],
    ['CLOSED_BAR_POSITION', 'bar-accounting'],
  ] as const)(
    'applies accounting on %s and updates a remaining position',
    async (type, semanticId) => {
      const opened = await stateWithPosition();
      const next = await reduce(opened, {
        type: 'APPLY_ACCOUNTING',
        event: event(type, semanticId, '2026-08-14T10:00:00Z'),
        cashChange: '10',
        updatedPosition: buildPositionState({ unrealizedPnl: '0' }),
        ledgerEntry: {
          ...ledgerEntry(semanticId, '10', 'PNL_CLEARING'),
          occurredAt: '2026-08-14T10:00:00Z',
        },
      });

      expect(next).toMatchObject({
        cash: '1008',
        realizedEquity: '1008',
        sizingEquity: '1000',
      });
      expect(next.positions).toHaveLength(1);
      expect(next.ledger).toHaveLength(3);
    },
  );

  it.each(['CLOSED_BAR_POSITION', 'OPEN_EXIT', 'ROLL'] as const)(
    'closes a position and posts its result on %s',
    async (type) => {
      const opened = await stateWithPosition();
      const semanticId = `close-${type}`;
      const closed = await reduce(opened, {
        type: 'CLOSE_POSITION',
        event: event(type, semanticId, '2026-08-14T10:00:00Z'),
        positionId: 'POSITION-1',
        cashChange: '10',
        ledgerEntry: {
          ...ledgerEntry(semanticId, '10', 'PNL_CLEARING'),
          occurredAt: '2026-08-14T10:00:00Z',
        },
      });

      expect(closed.positions).toEqual([]);
      expect(closed).toMatchObject({
        cash: '1008',
        usedMargin: '0',
        grossExposure: '0',
        openRisk: '0',
        availableFunds: '1008',
      });
    },
  );

  it('blocks only new entries and later restores entry capacity', async () => {
    const opened = await stateWithPosition();
    const blocked = await reduce(opened, {
      type: 'SET_ENTRY_CAPACITY',
      event: event('DATA_AVAILABLE', 'capacity-off', '2026-08-14T10:00:00Z'),
      available: false,
    });
    expect(blocked.operatingStatus).toBe('NO_NEW_ENTRIES');

    const revalued = await reduce(blocked, {
      type: 'REVALUE_POSITION',
      event: event(
        'CLOSED_BAR_POSITION',
        'blocked-revalue',
        '2026-08-14T11:00:00Z',
      ),
      position: buildPositionState({ unrealizedPnl: '-10' }),
    });
    const restored = await reduce(revalued, {
      type: 'SET_ENTRY_CAPACITY',
      event: event('DATA_AVAILABLE', 'capacity-on', '2026-08-14T12:00:00Z'),
      available: true,
    });

    expect(revalued.operatingStatus).toBe('NO_NEW_ENTRIES');
    expect(restored.operatingStatus).toBe('RUNNING');
  });

  it('sorts and removes active contracts without touching accounting', async () => {
    const first = await reduce(initialState(), {
      type: 'SET_ACTIVE_CONTRACT',
      event: event('DATA_AVAILABLE', 'contract-z', undefined, {
        instrumentId: 'Z_PRODUCT',
        contractId: 'Z-202609',
      }),
      instrumentId: 'Z_PRODUCT',
      contractId: 'Z-202609',
    });
    const second = await reduce(first, {
      type: 'SET_ACTIVE_CONTRACT',
      event: event('ROLL', 'contract-a', '2026-08-14T10:00:00Z', {
        instrumentId: 'A_PRODUCT',
        contractId: 'A-202609',
      }),
      instrumentId: 'A_PRODUCT',
      contractId: 'A-202609',
    });
    const removed = await reduce(second, {
      type: 'SET_ACTIVE_CONTRACT',
      event: event('ROLL', 'contract-z-remove', '2026-08-14T11:00:00Z', {
        instrumentId: 'Z_PRODUCT',
        contractId: 'Z-202609',
      }),
      instrumentId: 'Z_PRODUCT',
      contractId: null,
    });

    expect(Object.keys(second.activeContractByInstrument)).toEqual([
      'A_PRODUCT',
      'Z_PRODUCT',
    ]);
    expect(removed.activeContractByInstrument).toEqual({
      A_PRODUCT: 'A-202609',
    });
    expect(removed.cash).toBe('1000');
  });

  it('records immutable chronological portfolio snapshots once', async () => {
    const first = await reduce(initialState(), {
      type: 'RECORD_PORTFOLIO_SNAPSHOT',
      event: event(
        'PORTFOLIO_SNAPSHOT',
        'snapshot-event-1',
        '2026-08-14T10:00:00+02:00',
      ),
      snapshotId: 'SNAPSHOT-1',
    });
    const second = await reduce(first, {
      type: 'RECORD_PORTFOLIO_SNAPSHOT',
      event: event(
        'PORTFOLIO_SNAPSHOT',
        'snapshot-event-2',
        '2026-08-14T09:00:00Z',
      ),
      snapshotId: 'SNAPSHOT-2',
    });

    await expect(
      reduce(first, {
        type: 'RECORD_PORTFOLIO_SNAPSHOT',
        event: event(
          'PORTFOLIO_SNAPSHOT',
          'snapshot-event-1',
          '2026-08-14T08:00:00Z',
        ),
        snapshotId: 'SNAPSHOT-DIFFERENT-ID',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });

    expect(first.dailySnapshots).toHaveLength(1);
    expect(second.dailySnapshots).toHaveLength(2);
    expect(second.dailySnapshots[0]).toEqual(first.dailySnapshots[0]);
    expect(second.dailySnapshots[0]).toMatchObject({
      snapshotId: 'SNAPSHOT-1',
      eventId: 'snapshot-event-1',
      recordedAt: '2026-08-14T08:00:00Z',
      cash: '1000',
      positionCount: 0,
      activeIntentCount: 0,
    });
    expect(Object.isFrozen(second.dailySnapshots[0])).toBe(true);
  });
});

describe('reduceBacktestPortfolio invariants', () => {
  it('rejects clock regression', async () => {
    const registered = await stateWithIntent();
    await expect(
      reduce(registered, {
        type: 'CANCEL_INTENT',
        event: event('OPEN_ENTRY', 'past', '2026-08-14T08:04:00Z'),
        intentId: 'INTENT-1',
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ORDER_VIOLATION' });
  });

  it('orders fractional instants causally instead of comparing instant text', async () => {
    const first = await reduce(initialState(), {
      type: 'SET_ENTRY_CAPACITY',
      event: event('DATA_AVAILABLE', 'fraction-first', '2026-08-14T09:00:00Z'),
      available: false,
    });

    await expect(
      reduce(first, {
        type: 'SET_ENTRY_CAPACITY',
        event: event(
          'DATA_AVAILABLE',
          'fraction-second',
          '2026-08-14T09:00:00.1Z',
        ),
        available: true,
      }),
    ).resolves.toMatchObject({
      operatingStatus: 'RUNNING',
      processedEventCount: 2,
    });
  });

  it('rejects unknown or duplicate lifecycle identities', async () => {
    const registered = await stateWithIntent();
    await expect(
      reduce(registered, {
        type: 'REGISTER_INTENT',
        event: event('SIGNAL_DECISION', 'signal-2'),
        intent: buildIntentState(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });

    await expect(
      reduce(initialState(), {
        type: 'CANCEL_INTENT',
        event: event('OPEN_ENTRY', 'missing-intent'),
        intentId: 'MISSING',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
    await expect(
      reduce(initialState(), {
        type: 'REVALUE_POSITION',
        event: event('CLOSED_BAR_POSITION', 'missing-position'),
        position: buildPositionState(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
  });

  it('rejects same-instrument pyramiding or hedge', async () => {
    const opened = await stateWithPosition();
    const secondExecution = buildExecutionIntent({
      intentId: 'INTENT-2',
      riskDecisionId: 'RISK-2',
      direction: 'SHORT',
      stopPrice: '101',
    });
    await expect(
      reduce(opened, {
        type: 'REGISTER_INTENT',
        event: event('SIGNAL_DECISION', 'signal-2', '2026-08-14T10:00:00Z'),
        intent: buildIntentState({ executionIntent: secondExecution }),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
  });

  it('rejects inconsistent execution and risk identities', async () => {
    const executionPosition = buildExecutionPosition();
    const riskPosition = buildRiskPosition(executionPosition, {
      contractId: 'FDXS-202612',
    });
    const registered = await stateWithIntent();

    await expect(
      reduce(registered, {
        type: 'OPEN_POSITION',
        event: event('OPEN_ENTRY', 'open-inconsistent'),
        intentId: 'INTENT-1',
        position: buildPositionState({ executionPosition, riskPosition }),
        cashChange: '-2',
        ledgerEntry: ledgerEntry('open-inconsistent', '-2', 'COSTS'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
  });

  it('allows revaluation to change only unrealized P&L', async () => {
    const opened = await stateWithPosition();
    const current = opened.positions[0];
    if (current === undefined) throw new Error('Missing opened position.');

    await expect(
      reduce(opened, {
        type: 'REVALUE_POSITION',
        event: event(
          'CLOSED_BAR_POSITION',
          'forged-revalue',
          '2026-08-14T10:00:00Z',
        ),
        position: {
          ...current,
          executionPosition: {
            ...current.executionPosition,
            economicEntryPrice: '101',
            accountingBasisPrice: '101',
          },
          unrealizedPnl: '1',
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
  });

  it('requires the opened position policy and posted cost to match the run', async () => {
    const registered = await stateWithIntent();
    const valid = buildPositionState();

    await expect(
      reduce(registered, {
        type: 'OPEN_POSITION',
        event: event('OPEN_ENTRY', 'wrong-position-policy'),
        intentId: 'INTENT-1',
        position: {
          ...valid,
          executionPosition: {
            ...valid.executionPosition,
            riskPolicyVersion: 'OTHER_POLICY',
          },
        },
        cashChange: '-2',
        ledgerEntry: ledgerEntry('wrong-position-policy', '-2', 'COSTS'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });

    await expect(
      reduce(registered, {
        type: 'OPEN_POSITION',
        event: event('OPEN_ENTRY', 'wrong-entry-cost'),
        intentId: 'INTENT-1',
        position: valid,
        cashChange: '-1',
        ledgerEntry: ledgerEntry('wrong-entry-cost', '-1', 'COSTS'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });

    for (const account of ['PNL_CLEARING', 'FX_TRANSLATION'] as const) {
      const semanticId = `wrong-entry-account-${account.toLowerCase()}`;
      await expect(
        reduce(registered, {
          type: 'OPEN_POSITION',
          event: event('OPEN_ENTRY', semanticId),
          intentId: 'INTENT-1',
          position: valid,
          cashChange: '-2',
          ledgerEntry: ledgerEntry(semanticId, '-2', account),
        }),
      ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
    }
  });

  it('requires every opened-position provenance field to match its intent', async () => {
    const registered = await stateWithIntent();
    const valid = buildPositionState();
    const cases: readonly unknown[] = [
      {
        ...valid,
        executionPosition: {
          ...valid.executionPosition,
          riskDecisionId: 'OTHER-RISK',
        },
      },
      {
        ...valid,
        executionPosition: {
          ...valid.executionPosition,
          strategyVersion: 'OTHER-STRATEGY',
        },
      },
      {
        ...valid,
        executionPosition: {
          ...valid.executionPosition,
          datasetVersion: 'OTHER-DATASET',
        },
      },
      {
        ...valid,
        executionPosition: {
          ...valid.executionPosition,
          protectiveStopPrice: '98.5',
        },
      },
      {
        ...valid,
        executionPosition: {
          ...valid.executionPosition,
          quantity: '2',
        },
        riskPosition: { ...valid.riskPosition, quantity: '2' },
      },
    ];

    for (const [index, position] of cases.entries()) {
      const semanticId = `forged-open-provenance-${String(index)}`;
      await expect(
        reduce(registered, {
          type: 'OPEN_POSITION',
          event: event('OPEN_ENTRY', semanticId),
          intentId: 'INTENT-1',
          position,
          cashChange: '-2',
          ledgerEntry: ledgerEntry(semanticId, '-2', 'COSTS'),
        }),
      ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
    }
  });

  it.each([
    {
      name: 'event mismatch',
      cashChange: '-2',
      entry: ledgerEntry('different-event', '-2', 'COSTS'),
    },
    {
      name: 'cash mismatch',
      cashChange: '-2',
      entry: ledgerEntry('open-invalid', '-3', 'COSTS'),
    },
    {
      name: 'capital after initialization',
      cashChange: '2',
      entry: ledgerEntry('open-invalid', '2', 'CAPITAL'),
    },
    {
      name: 'unexplained deposit',
      cashChange: '2',
      entry: ledgerEntry('open-invalid', '2', 'COSTS'),
    },
  ])(
    'rejects invalid ledger reconciliation: $name',
    async ({ cashChange, entry }) => {
      const registered = await stateWithIntent();
      await expect(
        reduce(registered, {
          type: 'OPEN_POSITION',
          event: event('OPEN_ENTRY', 'open-invalid'),
          intentId: 'INTENT-1',
          position: buildPositionState(),
          cashChange,
          ledgerEntry: entry,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
    },
  );

  it('rejects a duplicate ledger entry ID', async () => {
    const opened = await stateWithPosition();
    await expect(
      reduce(opened, {
        type: 'CLOSE_POSITION',
        event: event('OPEN_EXIT', 'close-duplicate', '2026-08-14T10:00:00Z'),
        positionId: 'POSITION-1',
        cashChange: '1',
        ledgerEntry: {
          ...ledgerEntry('close-duplicate', '1', 'PNL_CLEARING'),
          entryId: 'ledger:open-1',
          occurredAt: '2026-08-14T10:00:00Z',
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
  });

  it('rejects malformed reservations and forged aggregate state', async () => {
    const malformedIntent = {
      ...buildIntentState(),
      reservedMargin: '-1',
    };
    await expect(
      reduce(initialState(), {
        type: 'REGISTER_INTENT',
        event: event('SIGNAL_DECISION', 'malformed-intent'),
        intent: malformedIntent,
      }),
    ).rejects.toBeInstanceOf(BacktestInputError);

    const forged = { ...initialState(), cash: '999' } as BacktestPortfolioState;
    await expect(
      reduce(forged, {
        type: 'SET_ENTRY_CAPACITY',
        event: event('DATA_AVAILABLE', 'forged-state'),
        available: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
  });

  it.each([
    ['REGISTER_INTENT', 'OPEN_ENTRY'],
    ['CANCEL_INTENT', 'SIGNAL_DECISION'],
    ['OPEN_POSITION', 'SIGNAL_DECISION'],
    ['REVALUE_POSITION', 'OPEN_ENTRY'],
    ['APPLY_ACCOUNTING', 'SIGNAL_DECISION'],
    ['CLOSE_POSITION', 'OPEN_ENTRY'],
    ['SET_ACTIVE_CONTRACT', 'SIGNAL_DECISION'],
    ['RECORD_PORTFOLIO_SNAPSHOT', 'DATA_AVAILABLE'],
  ] as const)(
    'rejects incompatible %s event %s',
    async (transitionType, eventType) => {
      const base =
        transitionType === 'CANCEL_INTENT' || transitionType === 'OPEN_POSITION'
          ? await stateWithIntent()
          : transitionType === 'REVALUE_POSITION' ||
              transitionType === 'APPLY_ACCOUNTING' ||
              transitionType === 'CLOSE_POSITION'
            ? await stateWithPosition()
            : initialState();
      const shared = {
        type: transitionType,
        event: event(
          eventType,
          `wrong-${transitionType}`,
          '2026-08-14T12:00:00Z',
        ),
        intent: buildIntentState(),
        intentId: 'INTENT-1',
        position: buildPositionState(),
        updatedPosition: buildPositionState(),
        positionId: 'POSITION-1',
        cashChange: '-1',
        ledgerEntry: {
          ...ledgerEntry(`wrong-${transitionType}`, '-1', 'COSTS'),
          occurredAt: '2026-08-14T12:00:00Z',
        },
        instrumentId: 'FDXS',
        contractId: 'FDXS-202609',
        snapshotId: 'SNAPSHOT-X',
      };

      await expect(reduce(base, shared)).rejects.toBeInstanceOf(
        BacktestInputError,
      );
    },
  );

  it('does not mutate caller state and deeply freezes the result', async () => {
    const source = initialState();
    const mutableIntents = [...source.activeEntryIntents];
    const mutableState = {
      ...source,
      activeEntryIntents: mutableIntents,
    } as BacktestPortfolioState;
    const result = await reduce(mutableState, {
      type: 'REGISTER_INTENT',
      event: event('SIGNAL_DECISION', 'immutability'),
      intent: buildIntentState(),
    });
    mutableIntents.push(buildIntentState());

    expect(source.activeEntryIntents).toEqual([]);
    expect(result.activeEntryIntents).toHaveLength(1);
    expect(
      [
        result,
        result.positions,
        result.activeEntryIntents,
        result.riskGroupExposure,
        result.activeContractByInstrument,
        result.dailySnapshots,
        result.ledger,
      ].every((value) => Object.isFrozen(value)),
    ).toBe(true);
  });

  it('maps malformed transition boundaries to typed input errors', async () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    await expect(reduce(initialState(), proxy as never)).rejects.toBeInstanceOf(
      BacktestInputError,
    );
    await expect(
      reduce(initialState(), {
        type: 'UNKNOWN',
        event: event('DATA_AVAILABLE', 'x'),
      }),
    ).rejects.toBeInstanceOf(BacktestInputError);
  });
});

describe('reduceBacktestPortfolio hostile state and boundary hardening', () => {
  async function probe(
    state: BacktestPortfolioState,
  ): Promise<BacktestPortfolioState> {
    return reduce(state, {
      type: 'SET_ENTRY_CAPACITY',
      event: event('DATA_AVAILABLE', 'probe', '2026-08-14T13:00:00Z'),
      available: true,
    });
  }

  it.each([
    { name: 'blank backtest id', override: { backtestId: '' } },
    { name: 'non-string run time', override: { runCreatedAt: 1 } },
    { name: 'invalid run time', override: { runCreatedAt: 'invalid' } },
    { name: 'wrong use mode', override: { riskPolicyUseMode: 'FORWARD' } },
    {
      name: 'wrong policy-use time',
      override: { riskPolicyUseAt: '2026-08-14T08:00:01Z' },
    },
    { name: 'invalid policy', override: { policy: null } },
    { name: 'wrong policy mirror', override: { riskPolicyVersion: 'OTHER' } },
    {
      name: 'invalid operating status',
      override: { operatingStatus: 'PAUSED' },
    },
    { name: 'invalid processed count', override: { processedEventCount: -1 } },
    { name: 'blank clock key', override: { lastClockKey: '' } },
    { name: 'malformed clock key', override: { lastClockKey: 'malformed' } },
    { name: 'malformed cash', override: { cash: 'not-decimal' } },
    { name: 'negative daily loss', override: { dailyLoss: '-1' } },
    {
      name: 'invalid active contract',
      override: { activeContractByInstrument: { FDXS: '' } },
    },
    {
      name: 'risk-group key mismatch',
      override: {
        riskGroupExposure: {
          EUROPE_EQUITY_INDEX: '0',
          US_EQUITY_INDEX: '0',
          EXTRA: '0',
        },
      },
    },
  ])('rejects forged state: $name', async ({ override }) => {
    const forged = {
      ...initialState(),
      ...override,
    } as unknown as BacktestPortfolioState;
    await expect(probe(forged)).rejects.toBeInstanceOf(BacktestStateError);
  });

  it('rejects malformed, duplicate, regressing, and non-initial ledgers', async () => {
    const opened = await stateWithPosition();
    const initialization = opened.ledger[0];
    const cost = opened.ledger[1];
    if (initialization === undefined || cost === undefined) {
      throw new Error('Missing ledger fixtures.');
    }
    const later = {
      ...ledgerEntry('later', '-1', 'COSTS', 'ledger:later'),
      occurredAt: '2026-08-14T10:00:00Z',
    };
    const cases: readonly unknown[][] = [
      [],
      [{ ...initialization, description: '' }],
      [
        initialization,
        {
          ...ledgerEntry('unbalanced-stored', '1', 'PNL_CLEARING'),
          postings: [
            { account: 'CASH', amount: '1' },
            { account: 'PNL_CLEARING', amount: '-0.9' },
          ],
        },
      ],
      [initialization, cost, cost],
      [initialization, later, cost],
      [{ ...initialization, eventId: 'wrong-initial-event' }],
      [initialization, ledgerEntry('capital-later', '1', 'CAPITAL')],
    ];

    for (const ledger of cases) {
      await expect(
        probe({ ...opened, ledger } as unknown as BacktestPortfolioState),
      ).rejects.toBeInstanceOf(BacktestStateError);
    }
  });

  it('rejects duplicate, regressing, and malformed stored daily snapshots', async () => {
    const once = await reduce(initialState(), {
      type: 'RECORD_PORTFOLIO_SNAPSHOT',
      event: event(
        'PORTFOLIO_SNAPSHOT',
        'stored-snapshot',
        '2026-08-14T09:00:00Z',
      ),
      snapshotId: 'STORED-1',
    });
    const stored = once.dailySnapshots[0];
    if (stored === undefined)
      throw new Error('Missing daily snapshot fixture.');

    for (const dailySnapshots of [
      [stored, stored],
      [
        {
          ...stored,
          snapshotId: 'LATER',
          eventId: 'later-event',
          recordedAt: '2026-08-14T10:00:00Z',
        },
        {
          ...stored,
          snapshotId: 'EARLIER',
          eventId: 'earlier-event',
          recordedAt: '2026-08-14T09:00:00Z',
        },
      ],
      [{ ...stored, positionCount: -1 }],
      [{ ...stored, operatingStatus: 'PAUSED' }],
      [stored, { ...stored, snapshotId: 'OTHER-SNAPSHOT-ID' }],
    ]) {
      await expect(
        probe({ ...once, dailySnapshots } as unknown as BacktestPortfolioState),
      ).rejects.toBeInstanceOf(BacktestStateError);
    }
  });

  it('rejects malformed transition scalars and blocked registration', async () => {
    await expect(
      reduce(initialState(), {
        type: 'SET_ENTRY_CAPACITY',
        event: event('DATA_AVAILABLE', 'bad-boolean'),
        available: 'yes',
      }),
    ).rejects.toBeInstanceOf(BacktestInputError);
    await expect(
      reduce(initialState(), {
        type: 'SET_ACTIVE_CONTRACT',
        event: event('DATA_AVAILABLE', 'bad-instrument'),
        instrumentId: '',
        contractId: 'FDXS-202609',
      }),
    ).rejects.toBeInstanceOf(BacktestInputError);
    const blocked = await reduce(initialState(), {
      type: 'SET_ENTRY_CAPACITY',
      event: event('DATA_AVAILABLE', 'blocked-first'),
      available: false,
    });
    await expect(
      reduce(blocked, {
        type: 'REGISTER_INTENT',
        event: event(
          'SIGNAL_DECISION',
          'blocked-register',
          '2026-08-14T10:00:00Z',
        ),
        intent: buildIntentState(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
  });

  it('rejects unknown risk groups and a position with another policy version', async () => {
    await expect(
      reduce(initialState(), {
        type: 'REGISTER_INTENT',
        event: event('SIGNAL_DECISION', 'unknown-risk-group'),
        intent: buildIntentState({ riskGroup: 'UNKNOWN_GROUP' }),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });

    const opened = await stateWithPosition();
    const current = opened.positions[0];
    if (current === undefined) throw new Error('Missing opened position.');
    const forged = {
      ...opened,
      positions: [
        {
          ...current,
          executionPosition: {
            ...current.executionPosition,
            riskPolicyVersion: 'OTHER_POLICY',
          },
        },
      ],
    } as unknown as BacktestPortfolioState;
    await expect(probe(forged)).rejects.toMatchObject({
      code: 'INVALID_BACKTEST_STATE',
    });
  });

  it('supports accounting without a remaining position and rejects unknown updates', async () => {
    const accounted = await reduce(initialState(), {
      type: 'APPLY_ACCOUNTING',
      event: event('DAILY_SETTLEMENT', 'account-without-position'),
      cashChange: '-1',
      updatedPosition: null,
      ledgerEntry: ledgerEntry('account-without-position', '-1', 'COSTS'),
    });
    expect(accounted.cash).toBe('999');

    for (const account of ['PNL_CLEARING', 'FX_TRANSLATION'] as const) {
      await expect(
        reduce(initialState(), {
          type: 'APPLY_ACCOUNTING',
          event: event(
            'DAILY_SETTLEMENT',
            `unexplained-${account.toLowerCase()}`,
          ),
          cashChange: '1',
          updatedPosition: null,
          ledgerEntry: ledgerEntry(
            `unexplained-${account.toLowerCase()}`,
            '1',
            account,
          ),
        }),
      ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
    }

    await expect(
      reduce(initialState(), {
        type: 'APPLY_ACCOUNTING',
        event: event('DAILY_SETTLEMENT', 'unknown-account-position'),
        cashChange: '-1',
        updatedPosition: buildPositionState(),
        ledgerEntry: ledgerEntry('unknown-account-position', '-1', 'COSTS'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
    await expect(
      reduce(initialState(), {
        type: 'CLOSE_POSITION',
        event: event('OPEN_EXIT', 'unknown-close'),
        positionId: 'MISSING',
        cashChange: '-1',
        ledgerEntry: ledgerEntry('unknown-close', '-1', 'COSTS'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
  });

  it('rejects malformed execution/risk nested values and mismatched intents', async () => {
    const registered = await stateWithIntent();
    const valid = buildPositionState();
    const invalidExecutions = [
      { ...valid.executionPosition, direction: 'SIDEWAYS' },
      { ...valid.executionPosition, timeframe: '4h' },
      { ...valid.executionPosition, executionModelVersion: 'OTHER' },
      { ...valid.executionPosition, openedAt: '2026-08-14T08:00:00Z' },
      { ...valid.executionPosition, protectiveStopPrice: '100' },
      { ...valid.executionPosition, limitations: [] },
    ];
    for (const executionPosition of invalidExecutions) {
      await expect(
        reduce(registered, {
          type: 'OPEN_POSITION',
          event: event('OPEN_ENTRY', `invalid-${executionPosition.direction}`),
          intentId: 'INTENT-1',
          position: { ...valid, executionPosition },
          cashChange: '-2',
          ledgerEntry: ledgerEntry(
            `invalid-${executionPosition.direction}`,
            '-2',
            'COSTS',
          ),
        }),
      ).rejects.toBeInstanceOf(BacktestInputError);
    }

    await expect(
      reduce(initialState(), {
        type: 'REGISTER_INTENT',
        event: event('SIGNAL_DECISION', 'invalid-execution-intent'),
        intent: {
          ...buildIntentState(),
          executionIntent: { ...buildExecutionIntent(), timeframe: '4h' },
        },
      }),
    ).rejects.toBeInstanceOf(BacktestInputError);
    await expect(
      reduce(initialState(), {
        type: 'REGISTER_INTENT',
        event: event('SIGNAL_DECISION', 'invalid-risk-intent'),
        intent: {
          ...buildIntentState(),
          riskIntent: {
            ...buildIntentState().riskIntent,
            direction: 'SIDEWAYS',
          },
        },
      }),
    ).rejects.toBeInstanceOf(BacktestInputError);
    await expect(
      reduce(initialState(), {
        type: 'REGISTER_INTENT',
        event: event('SIGNAL_DECISION', 'mismatch-risk-intent'),
        intent: {
          ...buildIntentState(),
          riskIntent: {
            ...buildIntentState().riskIntent,
            instrumentId: 'MES',
            contractId: 'MES-202609',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });

    await expect(
      reduce(registered, {
        type: 'OPEN_POSITION',
        event: event('OPEN_ENTRY', 'invalid-risk-position'),
        intentId: 'INTENT-1',
        position: {
          ...valid,
          riskPosition: { ...valid.riskPosition, margin: '-1' },
        },
        cashChange: '-2',
        ledgerEntry: ledgerEntry('invalid-risk-position', '-2', 'COSTS'),
      }),
    ).rejects.toBeInstanceOf(BacktestInputError);
  });

  it('rejects a forged global position/intent collision', async () => {
    const opened = await stateWithPosition();
    const forged = {
      ...opened,
      activeEntryIntents: [buildIntentState()],
    } as unknown as BacktestPortfolioState;

    await expect(probe(forged)).rejects.toMatchObject({
      code: 'INVALID_BACKTEST_STATE',
    });
  });

  it('rejects aggregate decimal overflow from individually bounded reservations', async () => {
    const huge = '9'.repeat(256);
    const firstIntent = buildExecutionIntent({
      intentId: 'HUGE-1',
      riskDecisionId: 'HUGE-RISK-1',
      instrumentId: 'HUGE_PRODUCT_1',
      contractId: 'HUGE-1-202609',
    });
    const secondIntent = buildExecutionIntent({
      intentId: 'HUGE-2',
      riskDecisionId: 'HUGE-RISK-2',
      instrumentId: 'HUGE_PRODUCT_2',
      contractId: 'HUGE-2-202609',
    });
    const once = await reduce(initialState(), {
      type: 'REGISTER_INTENT',
      event: event('SIGNAL_DECISION', 'huge-1', '2026-08-14T08:01:00Z', {
        instrumentId: 'HUGE_PRODUCT_1',
        contractId: 'HUGE-1-202609',
      }),
      intent: buildIntentState({
        executionIntent: firstIntent,
        reservedMargin: huge,
      }),
    });

    await expect(
      reduce(once, {
        type: 'REGISTER_INTENT',
        event: event('SIGNAL_DECISION', 'huge-2', '2026-08-14T08:02:00Z', {
          instrumentId: 'HUGE_PRODUCT_2',
          contractId: 'HUGE-2-202609',
        }),
        intent: buildIntentState({
          executionIntent: secondIntent,
          reservedMargin: huge,
        }),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
  });

  it('accepts a settled and a short position while rejecting an invalid short stop', async () => {
    const opened = await stateWithPosition();
    const current = opened.positions[0];
    if (current === undefined) throw new Error('Missing opened position.');
    const settledExecution = {
      ...current.executionPosition,
      lastSettlementEffectiveAt: '2026-08-14T09:30:00Z',
    };
    const settled = await reduce(opened, {
      type: 'APPLY_ACCOUNTING',
      event: event(
        'DAILY_SETTLEMENT',
        'settled-position',
        '2026-08-14T10:00:00Z',
      ),
      cashChange: '1',
      updatedPosition: { ...current, executionPosition: settledExecution },
      ledgerEntry: {
        ...ledgerEntry('settled-position', '1', 'PNL_CLEARING'),
        occurredAt: '2026-08-14T10:00:00Z',
      },
    });
    expect(
      settled.positions[0]?.executionPosition.lastSettlementEffectiveAt,
    ).toBe('2026-08-14T09:30:00Z');

    const shortIntent = buildExecutionIntent({
      direction: 'SHORT',
      stopPrice: '101',
    });
    const shortRegistered = await reduce(initialState(), {
      type: 'REGISTER_INTENT',
      event: event('SIGNAL_DECISION', 'short-signal', '2026-08-14T08:05:00Z'),
      intent: buildIntentState({ executionIntent: shortIntent }),
    });
    const shortExecution = buildExecutionPosition({ intent: shortIntent });
    const shortPosition = buildPositionState({
      executionPosition: shortExecution,
    });
    const shortOpened = await reduce(shortRegistered, {
      type: 'OPEN_POSITION',
      event: event('OPEN_ENTRY', 'short-open'),
      intentId: shortIntent.intentId,
      position: shortPosition,
      cashChange: '-2',
      ledgerEntry: ledgerEntry('short-open', '-2', 'COSTS'),
    });
    expect(shortOpened.positions[0]?.executionPosition.direction).toBe('SHORT');

    await expect(
      reduce(shortRegistered, {
        type: 'OPEN_POSITION',
        event: event('OPEN_ENTRY', 'short-invalid-stop'),
        intentId: shortIntent.intentId,
        position: {
          ...shortPosition,
          executionPosition: {
            ...shortExecution,
            protectiveStopPrice: '99',
          },
        },
        cashChange: '-2',
        ledgerEntry: ledgerEntry('short-invalid-stop', '-2', 'COSTS'),
      }),
    ).rejects.toBeInstanceOf(BacktestInputError);
  });

  it('rejects malformed, unbalanced, and multi-balancing transition entries', async () => {
    const registered = await stateWithIntent();
    const entries = [
      { ...ledgerEntry('bad-ledger', '-2', 'COSTS'), description: '' },
      {
        ...ledgerEntry('bad-ledger', '-2', 'COSTS'),
        postings: [
          { account: 'CASH', amount: '-2' },
          { account: 'COSTS', amount: '1' },
        ],
      },
      {
        ...ledgerEntry('bad-ledger', '-2', 'COSTS'),
        postings: [
          { account: 'CASH', amount: '-2' },
          { account: 'COSTS', amount: '1' },
          { account: 'PNL_CLEARING', amount: '1' },
        ],
      },
    ];
    for (const ledger of entries) {
      await expect(
        reduce(registered, {
          type: 'OPEN_POSITION',
          event: event('OPEN_ENTRY', 'bad-ledger'),
          intentId: 'INTENT-1',
          position: buildPositionState(),
          cashChange: '-2',
          ledgerEntry: ledger,
        }),
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof BacktestInputError ||
          error instanceof BacktestStateError,
      );
    }
  });

  it('rejects missing opens, intent mismatches, duplicate snapshots, and blank contracts', async () => {
    await expect(
      reduce(initialState(), {
        type: 'OPEN_POSITION',
        event: event('OPEN_ENTRY', 'missing-open-intent'),
        intentId: 'MISSING',
        position: buildPositionState(),
        cashChange: '-2',
        ledgerEntry: ledgerEntry('missing-open-intent', '-2', 'COSTS'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });

    const registered = await stateWithIntent();
    const otherExecution = buildExecutionPosition({ intentId: 'OTHER' });
    await expect(
      reduce(registered, {
        type: 'OPEN_POSITION',
        event: event('OPEN_ENTRY', 'mismatched-open-intent'),
        intentId: 'INTENT-1',
        position: buildPositionState({ executionPosition: otherExecution }),
        cashChange: '-2',
        ledgerEntry: ledgerEntry('mismatched-open-intent', '-2', 'COSTS'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });

    const snapshotted = await reduce(initialState(), {
      type: 'RECORD_PORTFOLIO_SNAPSHOT',
      event: event('PORTFOLIO_SNAPSHOT', 'snapshot-once'),
      snapshotId: 'DUPLICATE',
    });
    await expect(
      reduce(snapshotted, {
        type: 'RECORD_PORTFOLIO_SNAPSHOT',
        event: event(
          'PORTFOLIO_SNAPSHOT',
          'snapshot-twice',
          '2026-08-14T10:00:00Z',
        ),
        snapshotId: 'DUPLICATE',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
    await expect(
      reduce(initialState(), {
        type: 'SET_ACTIVE_CONTRACT',
        event: event('DATA_AVAILABLE', 'blank-contract'),
        instrumentId: 'FDXS',
        contractId: '',
      }),
    ).rejects.toBeInstanceOf(BacktestInputError);
  });

  it('sorts multiple intents and positions deterministically', async () => {
    const zIntent = buildExecutionIntent({
      intentId: 'INTENT-Z',
      riskDecisionId: 'RISK-Z',
      instrumentId: 'Z_PRODUCT',
      contractId: 'Z-202609',
    });
    const aIntent = buildExecutionIntent({
      intentId: 'INTENT-A',
      riskDecisionId: 'RISK-A',
      instrumentId: 'A_PRODUCT',
      contractId: 'A-202609',
    });
    let state = await reduce(initialState(), {
      type: 'REGISTER_INTENT',
      event: event('SIGNAL_DECISION', 'signal-z', '2026-08-14T08:01:00Z', {
        instrumentId: 'Z_PRODUCT',
        contractId: 'Z-202609',
      }),
      intent: buildIntentState({ executionIntent: zIntent }),
    });
    state = await reduce(state, {
      type: 'REGISTER_INTENT',
      event: event('SIGNAL_DECISION', 'signal-a', '2026-08-14T08:02:00Z', {
        instrumentId: 'A_PRODUCT',
        contractId: 'A-202609',
      }),
      intent: buildIntentState({ executionIntent: aIntent }),
    });
    expect(
      state.activeEntryIntents.map(
        ({ executionIntent }) => executionIntent.intentId,
      ),
    ).toEqual(['INTENT-A', 'INTENT-Z']);

    const aExecution = buildExecutionPosition({
      positionId: 'POSITION-Z',
      intent: aIntent,
      entryCostAccountCurrency: '1',
    });
    state = await reduce(state, {
      type: 'OPEN_POSITION',
      event: event('OPEN_ENTRY', 'open-a', '2026-08-14T09:00:00Z', {
        instrumentId: 'A_PRODUCT',
        contractId: 'A-202609',
      }),
      intentId: 'INTENT-A',
      position: buildPositionState({ executionPosition: aExecution }),
      cashChange: '-1',
      ledgerEntry: ledgerEntry('open-a', '-1', 'COSTS'),
    });
    const zExecution = buildExecutionPosition({
      positionId: 'POSITION-A',
      intent: zIntent,
      entryCostAccountCurrency: '1',
    });
    state = await reduce(state, {
      type: 'OPEN_POSITION',
      event: event('OPEN_ENTRY', 'open-z', '2026-08-14T09:01:00Z', {
        instrumentId: 'Z_PRODUCT',
        contractId: 'Z-202609',
      }),
      intentId: 'INTENT-Z',
      position: buildPositionState({ executionPosition: zExecution }),
      cashChange: '-1',
      ledgerEntry: {
        ...ledgerEntry('open-z', '-1', 'COSTS'),
        occurredAt: '2026-08-14T09:01:00Z',
      },
    });
    expect(
      state.positions.map(
        ({ executionPosition }) => executionPosition.positionId,
      ),
    ).toEqual(['POSITION-A', 'POSITION-Z']);

    state = await probe(state);
    const updatedZ = buildPositionState({
      executionPosition: zExecution,
      unrealizedPnl: '1',
    });
    state = await reduce(state, {
      type: 'REVALUE_POSITION',
      event: event(
        'CLOSED_BAR_POSITION',
        'multi-revalue',
        '2026-08-14T14:00:00Z',
        { instrumentId: 'Z_PRODUCT', contractId: 'Z-202609' },
      ),
      position: updatedZ,
    });
    state = await reduce(state, {
      type: 'APPLY_ACCOUNTING',
      event: event(
        'DAILY_SETTLEMENT',
        'multi-account',
        '2026-08-14T15:00:00Z',
        { instrumentId: 'Z_PRODUCT', contractId: 'Z-202609' },
      ),
      cashChange: '-1',
      updatedPosition: updatedZ,
      ledgerEntry: {
        ...ledgerEntry('multi-account', '-1', 'COSTS'),
        occurredAt: '2026-08-14T15:00:00Z',
      },
    });
    expect(state.positions).toHaveLength(2);

    const thirdIntent = buildExecutionIntent({
      intentId: 'INTENT-THIRD',
      riskDecisionId: 'RISK-THIRD',
      instrumentId: 'THIRD_PRODUCT',
      contractId: 'THIRD-202609',
    });
    state = await reduce(state, {
      type: 'REGISTER_INTENT',
      event: event('SIGNAL_DECISION', 'third-signal', '2026-08-14T16:00:00Z', {
        instrumentId: 'THIRD_PRODUCT',
        contractId: 'THIRD-202609',
      }),
      intent: buildIntentState({ executionIntent: thirdIntent }),
    });
    const duplicateIdExecution = buildExecutionPosition({
      positionId: 'POSITION-A',
      intent: thirdIntent,
    });
    await expect(
      reduce(state, {
        type: 'OPEN_POSITION',
        event: event('OPEN_ENTRY', 'third-open', '2026-08-14T17:00:00Z', {
          instrumentId: 'THIRD_PRODUCT',
          contractId: 'THIRD-202609',
        }),
        intentId: thirdIntent.intentId,
        position: buildPositionState({
          executionPosition: duplicateIdExecution,
        }),
        cashChange: '-1',
        ledgerEntry: {
          ...ledgerEntry('third-open', '-1', 'COSTS'),
          occurredAt: '2026-08-14T17:00:00Z',
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
  });

  it('rejects lifecycle entities that reference time after their event', async () => {
    const futureIntent = buildExecutionIntent({
      signalCloseTime: '2026-08-14T10:00:00Z',
      signalDecisionAt: '2026-08-14T10:00:00Z',
      expiresAt: '2026-08-14T12:00:00Z',
    });
    await expect(
      reduce(initialState(), {
        type: 'REGISTER_INTENT',
        event: event('SIGNAL_DECISION', 'premature-signal'),
        intent: buildIntentState({ executionIntent: futureIntent }),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });

    const registered = await stateWithIntent();
    const futureExecution = buildExecutionPosition({
      occurredAt: '2026-08-14T10:00:00Z',
    });
    await expect(
      reduce(registered, {
        type: 'OPEN_POSITION',
        event: event('OPEN_ENTRY', 'premature-open'),
        intentId: 'INTENT-1',
        position: buildPositionState({ executionPosition: futureExecution }),
        cashChange: '-2',
        ledgerEntry: ledgerEntry('premature-open', '-2', 'COSTS'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });

    const opened = await stateWithPosition();
    const current = opened.positions[0];
    if (current === undefined) throw new Error('Missing opened position.');
    await expect(
      reduce(opened, {
        type: 'APPLY_ACCOUNTING',
        event: event(
          'DAILY_SETTLEMENT',
          'premature-settlement',
          '2026-08-14T10:00:00Z',
        ),
        cashChange: '1',
        updatedPosition: {
          ...current,
          executionPosition: {
            ...current.executionPosition,
            lastSettlementEffectiveAt: '2026-08-14T11:00:00Z',
          },
        },
        ledgerEntry: {
          ...ledgerEntry('premature-settlement', '1', 'PNL_CLEARING'),
          occurredAt: '2026-08-14T10:00:00Z',
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
  });

  it('preserves immutable position identity and economics during accounting', async () => {
    const opened = await stateWithPosition();
    const current = opened.positions[0];
    if (current === undefined) throw new Error('Missing opened position.');

    const forgedInstrument = {
      ...current,
      executionPosition: {
        ...current.executionPosition,
        instrumentId: 'MES',
        contractId: 'MES-202609',
      },
      riskPosition: {
        ...current.riskPosition,
        instrumentId: 'MES',
        contractId: 'MES-202609',
      },
    };
    await expect(
      reduce(opened, {
        type: 'APPLY_ACCOUNTING',
        event: event(
          'DAILY_SETTLEMENT',
          'forged-accounting-identity',
          '2026-08-14T10:00:00Z',
          { instrumentId: 'MES', contractId: 'MES-202609' },
        ),
        cashChange: '1',
        updatedPosition: forgedInstrument,
        ledgerEntry: {
          ...ledgerEntry('forged-accounting-identity', '1', 'PNL_CLEARING'),
          occurredAt: '2026-08-14T10:00:00Z',
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });

    await expect(
      reduce(opened, {
        type: 'APPLY_ACCOUNTING',
        event: event(
          'DAILY_SETTLEMENT',
          'forged-accounting-entry',
          '2026-08-14T10:00:00Z',
        ),
        cashChange: '1',
        updatedPosition: {
          ...current,
          executionPosition: {
            ...current.executionPosition,
            economicEntryPrice: '101',
          },
        },
        ledgerEntry: {
          ...ledgerEntry('forged-accounting-entry', '1', 'PNL_CLEARING'),
          occurredAt: '2026-08-14T10:00:00Z',
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BACKTEST_STATE' });
  });

  it('rejects invalid stored time provenance and event-count overflow', async () => {
    const initialized = initialState();
    const initialEntry = initialized.ledger[0];
    if (initialEntry === undefined) throw new Error('Missing initial ledger.');
    const forgedLedgerTime = {
      ...initialized,
      ledger: [
        {
          ...initialEntry,
          occurredAt: '2026-08-14T07:59:59Z',
        },
      ],
    } as unknown as BacktestPortfolioState;
    await expect(probe(forgedLedgerTime)).rejects.toMatchObject({
      code: 'INVALID_BACKTEST_STATE',
    });

    const overflow = {
      ...initialized,
      processedEventCount: Number.MAX_SAFE_INTEGER,
      lastClockKey: '2026-08-14T08:00:00Z|00|previous',
    } as unknown as BacktestPortfolioState;
    await expect(probe(overflow)).rejects.toMatchObject({
      code: 'INVALID_BACKTEST_STATE',
    });

    const inconsistentCounter = {
      ...initialized,
      processedEventCount: 1,
      lastClockKey: null,
    } as unknown as BacktestPortfolioState;
    await expect(probe(inconsistentCounter)).rejects.toMatchObject({
      code: 'INVALID_BACKTEST_STATE',
    });
  });

  it('refuses to grow bounded state collections beyond their exact cap', async () => {
    const initialized = initialState();
    const activeContractByInstrument = Object.fromEntries(
      Array.from({ length: 256 }, (_, index) => [
        `PRODUCT-${String(index).padStart(3, '0')}`,
        `CONTRACT-${String(index).padStart(3, '0')}`,
      ]),
    );
    const fullContracts = {
      ...initialized,
      activeContractByInstrument,
      processedEventCount: 1,
      lastClockKey: '2026-08-14T08:01:00Z|00|contracts-ready',
    } as unknown as BacktestPortfolioState;
    await expect(
      reduce(fullContracts, {
        type: 'SET_ACTIVE_CONTRACT',
        event: event(
          'DATA_AVAILABLE',
          'contract-overflow',
          '2026-08-14T09:00:00Z',
          { instrumentId: 'PRODUCT-OVER', contractId: 'CONTRACT-OVER' },
        ),
        instrumentId: 'PRODUCT-OVER',
        contractId: 'CONTRACT-OVER',
      }),
    ).rejects.toMatchObject({ code: 'BACKTEST_LIMIT_EXCEEDED' });

    const once = await reduce(initialized, {
      type: 'RECORD_PORTFOLIO_SNAPSHOT',
      event: event(
        'PORTFOLIO_SNAPSHOT',
        'snapshot-template',
        '2026-08-14T08:01:00Z',
      ),
      snapshotId: 'SNAPSHOT-TEMPLATE',
    });
    const template = once.dailySnapshots[0];
    if (template === undefined) throw new Error('Missing snapshot template.');
    const dailySnapshots = Array.from({ length: 10_000 }, (_, index) => ({
      ...template,
      snapshotId: `SNAPSHOT-${String(index).padStart(5, '0')}`,
      eventId: `snapshot-event-${String(index).padStart(5, '0')}`,
    }));
    const fullSnapshots = {
      ...once,
      dailySnapshots,
    } as unknown as BacktestPortfolioState;
    await expect(
      reduce(fullSnapshots, {
        type: 'RECORD_PORTFOLIO_SNAPSHOT',
        event: event(
          'PORTFOLIO_SNAPSHOT',
          'snapshot-overflow',
          '2026-08-14T09:00:00Z',
        ),
        snapshotId: 'SNAPSHOT-OVERFLOW',
      }),
    ).rejects.toMatchObject({ code: 'BACKTEST_LIMIT_EXCEEDED' });
  });
});
