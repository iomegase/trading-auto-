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
  createBacktestPortfolioState,
  orderBacktestEvents,
  type BacktestEvent,
  type BacktestEventInput,
  type BacktestPortfolioState,
} from './index.js';
import {
  reduceBacktestPortfolio,
  type BacktestPortfolioTransition,
} from './reducer.js';

const PUBLIC_RUNTIME_EXPORTS = Object.freeze([
  'BACKTEST_EVENT_PRIORITY',
  'BACKTEST_EVENT_TYPES',
  'BacktestInputError',
  'BacktestStateError',
  'appendLedgerEntry',
  'createBacktestEvent',
  'createBacktestPortfolioState',
  'createInitialLedger',
  'createLedgerEntry',
  'orderBacktestEvents',
]);

function input(
  semanticId: string,
  type: BacktestEventInput['type'],
  availableAt: string,
  instrumentId: string | null,
  contractId: string | null,
): BacktestEventInput {
  return {
    semanticId,
    type,
    availableAt,
    instrumentId,
    contractId,
    version: 'CORE-INTEGRATION-V1',
    payload: {},
  };
}

function ledgerEntry(
  eventId: string,
  occurredAt: string,
  cashChange: string,
  account: 'COSTS' | 'PNL_CLEARING',
) {
  const inverse = cashChange.startsWith('-')
    ? cashChange.slice(1)
    : `-${cashChange}`;
  return {
    entryId: `ledger:${eventId}`,
    eventId,
    occurredAt,
    description: `Accounting for ${eventId}`,
    fxSnapshotVersion: null,
    postings: [
      { account: 'CASH', amount: cashChange },
      { account, amount: inverse },
    ],
  };
}

function initialState(): BacktestPortfolioState {
  return createBacktestPortfolioState({
    backtestId: 'BT-CORE-INTEGRATION',
    runCreatedAt: '2026-08-14T08:00:00Z',
    riskPolicyUseMode: 'HISTORICAL_RESEARCH',
    riskPolicyUseAt: '2026-08-14T08:00:00Z',
    policy: buildPolicy(),
  });
}

function assertLedgerReconciles(state: BacktestPortfolioState): void {
  const cash = state.ledger
    .flatMap(({ postings }) => postings)
    .filter(({ account }) => account === 'CASH')
    .reduce((sum, { amount }) => sum + BigInt(amount), 0n);
  expect(state.cash).toBe(cash.toString());
  expect(state.realizedEquity).toBe(state.cash);
}

const firstIntent = buildExecutionIntent();
const firstPosition = buildPositionState();
const secondIntent = buildExecutionIntent({
  intentId: 'INTENT-MES',
  instrumentId: 'MES',
  contractId: 'MES-202609',
  riskDecisionId: 'RISK-MES',
});
const secondExecutionPosition = buildExecutionPosition({
  positionId: 'POSITION-MES',
  intent: secondIntent,
  occurredAt: '2026-08-14T10:00:00Z',
});
const secondPosition = buildPositionState({
  executionPosition: secondExecutionPosition,
  riskPosition: buildRiskPosition(secondExecutionPosition, {
    riskGroup: 'US_EQUITY_INDEX',
  }),
});

const SOURCE_EVENTS = Object.freeze([
  input(
    'signal-fdxs',
    'SIGNAL_DECISION',
    '2026-08-14T08:05:00Z',
    'FDXS',
    'FDXS-202609',
  ),
  input(
    'open-fdxs',
    'OPEN_ENTRY',
    '2026-08-14T09:00:00Z',
    'FDXS',
    'FDXS-202609',
  ),
  input(
    'signal-mes',
    'SIGNAL_DECISION',
    '2026-08-14T09:30:00Z',
    'MES',
    'MES-202609',
  ),
  input('open-mes', 'OPEN_ENTRY', '2026-08-14T10:00:00Z', 'MES', 'MES-202609'),
  input(
    'settlement-after-stop',
    'DAILY_SETTLEMENT',
    '2026-08-14T10:00:00Z',
    'FDXS',
    'FDXS-202609',
  ),
  input(
    'stop-fdxs',
    'CLOSED_BAR_POSITION',
    '2026-08-14T10:00:00Z',
    'FDXS',
    'FDXS-202609',
  ),
  input(
    'snapshot-after-open',
    'PORTFOLIO_SNAPSHOT',
    '2026-08-14T10:00:00Z',
    null,
    null,
  ),
]);

function transitionFor(
  event: BacktestEvent,
  state: BacktestPortfolioState,
): BacktestPortfolioTransition {
  switch (event.semanticId) {
    case 'signal-fdxs':
      return {
        type: 'REGISTER_INTENT',
        event,
        intent: buildIntentState({ executionIntent: firstIntent }),
      };
    case 'open-fdxs':
      return {
        type: 'OPEN_POSITION',
        event,
        intentId: firstIntent.intentId,
        position: firstPosition,
        cashChange: '-2',
        ledgerEntry: ledgerEntry(
          event.semanticId,
          event.availableAt,
          '-2',
          'COSTS',
        ),
      };
    case 'signal-mes':
      return {
        type: 'REGISTER_INTENT',
        event,
        intent: buildIntentState({
          executionIntent: secondIntent,
          riskGroup: 'US_EQUITY_INDEX',
        }),
      };
    case 'stop-fdxs':
      return {
        type: 'CLOSE_POSITION',
        event,
        positionId: firstPosition.executionPosition.positionId,
        cashChange: '10',
        ledgerEntry: ledgerEntry(
          event.semanticId,
          event.availableAt,
          '10',
          'PNL_CLEARING',
        ),
      };
    case 'settlement-after-stop':
      expect(
        state.positions.some(
          ({ executionPosition }) =>
            executionPosition.positionId ===
            firstPosition.executionPosition.positionId,
        ),
      ).toBe(false);
      return { type: 'SET_ENTRY_CAPACITY', event, available: true };
    case 'open-mes':
      expect(
        state.positions.some(
          ({ executionPosition }) =>
            executionPosition.positionId ===
            firstPosition.executionPosition.positionId,
        ),
      ).toBe(false);
      return {
        type: 'OPEN_POSITION',
        event,
        intentId: secondIntent.intentId,
        position: secondPosition,
        cashChange: '-2',
        ledgerEntry: ledgerEntry(
          event.semanticId,
          event.availableAt,
          '-2',
          'COSTS',
        ),
      };
    case 'snapshot-after-open':
      return {
        type: 'RECORD_PORTFOLIO_SNAPSHOT',
        event,
        snapshotId: 'SNAPSHOT-1',
      };
    default:
      throw new Error(`No transition for ${event.semanticId}`);
  }
}

function run(events: readonly BacktestEventInput[]): BacktestPortfolioState {
  const ordered = orderBacktestEvents({
    endAt: '2026-08-14T10:00:00Z',
    events,
  });
  expect(
    ordered
      .filter(({ availableAt }) => availableAt === '2026-08-14T10:00:00Z')
      .map(({ type }) => type),
  ).toEqual([
    'CLOSED_BAR_POSITION',
    'DAILY_SETTLEMENT',
    'OPEN_ENTRY',
    'PORTFOLIO_SNAPSHOT',
  ]);

  let state = initialState();
  assertLedgerReconciles(state);
  for (const event of ordered) {
    state = reduceBacktestPortfolio(state, transitionFor(event, state));
    assertLedgerReconciles(state);
  }
  return state;
}

function sourceEventAt(index: number): BacktestEventInput {
  const event = SOURCE_EVENTS[index];
  if (event === undefined) throw new Error('Incomplete source event fixture.');
  return event;
}

describe('backtester core integration', () => {
  it('locks the exact public runtime surface', async () => {
    expect(
      Object.keys(await import('@trading-auto/backtester')).sort(),
    ).toEqual(PUBLIC_RUNTIME_EXPORTS);
  });

  it('reduces every input permutation to the same causal exact state', () => {
    const baseline = run(SOURCE_EVENTS);
    const reversed = run([...SOURCE_EVENTS].reverse());
    const permuted = run([
      sourceEventAt(3),
      sourceEventAt(0),
      sourceEventAt(6),
      sourceEventAt(4),
      sourceEventAt(1),
      sourceEventAt(5),
      sourceEventAt(2),
    ]);

    expect(reversed).toEqual(baseline);
    expect(permuted).toEqual(baseline);
    expect(baseline).toMatchObject({
      initialCash: '1000',
      cash: '1006',
      realizedEquity: '1006',
      processedEventCount: 7,
    });
    expect(
      baseline.positions.map(
        ({ executionPosition }) => executionPosition.positionId,
      ),
    ).toEqual(['POSITION-MES']);
    expect(baseline.dailySnapshots).toHaveLength(1);
  });

  it('is unchanged when a future hostile payload is appended', () => {
    let payloadReads = 0;
    const future = Object.defineProperties(
      {},
      {
        availableAt: {
          enumerable: true,
          value: '2026-08-14T11:00:00Z',
        },
        payload: {
          enumerable: true,
          get() {
            payloadReads += 1;
            throw new Error('future payload must not be read');
          },
        },
      },
    ) as unknown as BacktestEventInput;

    expect(run([...SOURCE_EVENTS, future])).toEqual(run(SOURCE_EVENTS));
    expect(payloadReads).toBe(0);
  });

  it('rejects an event whose subject differs from its transition entity', () => {
    const mismatched = orderBacktestEvents({
      endAt: '2026-08-14T08:05:00Z',
      events: [
        input(
          'mismatched-subject',
          'SIGNAL_DECISION',
          '2026-08-14T08:05:00Z',
          'MES',
          'MES-202609',
        ),
      ],
    })[0];
    if (mismatched === undefined) throw new Error('Missing event fixture.');

    expect(() =>
      reduceBacktestPortfolio(initialState(), {
        type: 'REGISTER_INTENT',
        event: mismatched,
        intent: buildIntentState({ executionIntent: firstIntent }),
      }),
    ).toThrow(BacktestStateError);

    const wrongActiveContractEvent = orderBacktestEvents({
      endAt: '2026-08-14T08:05:00Z',
      events: [
        input(
          'mismatched-contract-subject',
          'DATA_AVAILABLE',
          '2026-08-14T08:05:00Z',
          'MES',
          'MES-202609',
        ),
      ],
    })[0];
    if (wrongActiveContractEvent === undefined) {
      throw new Error('Missing active-contract event fixture.');
    }
    expect(() =>
      reduceBacktestPortfolio(initialState(), {
        type: 'SET_ACTIVE_CONTRACT',
        event: wrongActiveContractEvent,
        instrumentId: 'FDXS',
        contractId: 'FDXS-202609',
      }),
    ).toThrow(BacktestStateError);
  });

  it('contains hostile and oversized error details deterministically', () => {
    const unreadableLength = new Proxy([], {
      getOwnPropertyDescriptor(target, property) {
        if (property === 'length') throw new Error('unreadable length');
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const unreadableIndex = new Proxy([1], {
      getOwnPropertyDescriptor(target, property) {
        if (property === '0') throw new Error('unreadable index');
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const accessorArray = Object.defineProperty([undefined], '0', {
      enumerable: true,
      get() {
        throw new Error('must not be invoked');
      },
    });
    const unreadableObject = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('unreadable object');
        },
      },
    );
    let descriptorReads = 0;
    const disappearingDescriptor = new Proxy(
      { field: 1 },
      {
        getOwnPropertyDescriptor(target, property) {
          if (property === 'field') {
            descriptorReads += 1;
            if (descriptorReads > 1) throw new Error('descriptor changed');
          }
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      },
    );
    let deep: Record<string, unknown> = {};
    for (let depth = 0; depth < 17; depth += 1) deep = { next: deep };
    const manyNodes = Array.from({ length: 1_025 }, () => ({}));

    const detailsOf = (value: unknown) =>
      new BacktestInputError('INVALID_BACKTEST_INPUT', 'hostile details', {
        value,
      }).details;

    expect(detailsOf(accessorArray)).toEqual({
      value: ['[unreadable]'],
    });
    expect(detailsOf(disappearingDescriptor)).toEqual({
      value: { field: '[unreadable]' },
    });
    expect(detailsOf(new Array<unknown>(10_001))).toEqual({
      value: '[truncated]',
    });
    const sparseDetails = detailsOf(new Array<unknown>(1));
    const sparseValue = sparseDetails?.value;
    expect(Array.isArray(sparseValue)).toBe(true);
    if (!Array.isArray(sparseValue)) throw new Error('Expected sparse array.');
    expect(sparseValue).toHaveLength(1);
    expect(0 in sparseValue).toBe(false);
    expect(detailsOf(unreadableIndex)).toEqual({
      value: ['[unreadable]'],
    });
    expect(detailsOf(unreadableLength)).toEqual({ value: '[unreadable]' });
    expect(detailsOf(unreadableObject)).toEqual({ value: '[unreadable]' });
    expect(JSON.stringify(detailsOf(deep))).toContain('[truncated]');
    expect(JSON.stringify(detailsOf(manyNodes))).toContain('[truncated]');
    expect(descriptorReads).toBe(2);
  });
});
