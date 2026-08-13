import { describe, expect, expectTypeOf, it } from 'vitest';
import type { InstantString } from '@trading-auto/domain';
import { syntheticFdxsContract } from '@trading-auto/test-helpers';

import {
  createExecutionSchedule,
  createH1OpenEvent,
  ExecutionInputError,
  selectNextTradableH1Open,
  type ExecutionScheduleInput,
  type H1OpenEventInput,
} from './index.js';

const firstTradableInterval = {
  start: '2026-01-02T09:00:00+01:00',
  end: '2026-01-02T13:00:00+01:00',
};

const validSchedule: ExecutionScheduleInput = {
  version: 'EUREX_FDXS_2026-01-02_V1',
  source: 'SYNTHETIC_EUREX',
  observedAt: '2026-01-02T08:59:00+01:00',
  validFrom: '2026-01-02T09:00:00+01:00',
  validUntil: '2026-01-02T18:00:00+01:00',
  contractId: syntheticFdxsContract.contractId,
  tradableIntervals: [
    firstTradableInterval,
    {
      start: '2026-01-02T14:00:00+01:00',
      end: '2026-01-02T18:00:00+01:00',
    },
  ],
  maintenanceBreaks: [
    {
      start: '2026-01-02T11:00:00+01:00',
      end: '2026-01-02T11:30:00+01:00',
    },
  ],
};

function openEvent(
  openTime: string,
  overrides: Partial<H1OpenEventInput> = {},
) {
  return createH1OpenEvent({
    instrumentId: 'FDXS',
    contractId: syntheticFdxsContract.contractId,
    openTime,
    availableAt: openTime,
    price: '15000',
    ...overrides,
  });
}

function expectExecutionError(
  action: () => unknown,
  code: 'INVALID_EXECUTION_SCHEDULE' | 'INVALID_DATA',
  field: string,
): void {
  let received: unknown;
  try {
    action();
  } catch (error) {
    received = error;
  }

  expect(received).toBeInstanceOf(ExecutionInputError);
  expect(received).toMatchObject({ code, details: { field } });
}

describe('versioned execution schedules', () => {
  it('canonicalizes and deeply freezes schedule intervals', () => {
    const schedule = createExecutionSchedule(validSchedule);

    expect(schedule).toEqual({
      ...validSchedule,
      observedAt: '2026-01-02T07:59:00Z',
      validFrom: '2026-01-02T08:00:00Z',
      validUntil: '2026-01-02T17:00:00Z',
      tradableIntervals: [
        { start: '2026-01-02T08:00:00Z', end: '2026-01-02T12:00:00Z' },
        { start: '2026-01-02T13:00:00Z', end: '2026-01-02T17:00:00Z' },
      ],
      maintenanceBreaks: [
        { start: '2026-01-02T10:00:00Z', end: '2026-01-02T10:30:00Z' },
      ],
    });
    expect(Object.isFrozen(schedule)).toBe(true);
    expect(Object.isFrozen(schedule.tradableIntervals)).toBe(true);
    expect(Object.isFrozen(schedule.tradableIntervals[0])).toBe(true);
    expectTypeOf(schedule.observedAt).toEqualTypeOf<InstantString>();
  });

  it.each([
    ['version', '  '],
    ['source', ''],
    ['contractId', '\t'],
  ] as const)('requires a nonblank %s', (field, value) => {
    expectExecutionError(
      () => createExecutionSchedule({ ...validSchedule, [field]: value }),
      'INVALID_EXECUTION_SCHEDULE',
      field,
    );
  });

  it('requires a positive validity window', () => {
    expectExecutionError(
      () =>
        createExecutionSchedule({
          ...validSchedule,
          validUntil: validSchedule.validFrom,
        }),
      'INVALID_EXECUTION_SCHEDULE',
      'validUntil',
    );
  });

  it('rejects overlapping tradable intervals', () => {
    expectExecutionError(
      () =>
        createExecutionSchedule({
          ...validSchedule,
          tradableIntervals: [
            firstTradableInterval,
            {
              start: '2026-01-02T12:59:59+01:00',
              end: '2026-01-02T15:00:00+01:00',
            },
          ],
        }),
      'INVALID_EXECUTION_SCHEDULE',
      'tradableIntervals',
    );
  });

  it('rejects sparse and oversized interval arrays before traversing them', () => {
    const sparse = new Array(2) as Array<{ start: string; end: string }>;
    sparse[1] = firstTradableInterval;
    expectExecutionError(
      () =>
        createExecutionSchedule({
          ...validSchedule,
          tradableIntervals: sparse,
        }),
      'INVALID_EXECUTION_SCHEDULE',
      'tradableIntervals',
    );

    const oversized = new Array(10_001).fill(
      firstTradableInterval,
    ) as ExecutionScheduleInput['tradableIntervals'];
    expectExecutionError(
      () =>
        createExecutionSchedule({
          ...validSchedule,
          tradableIntervals: oversized,
        }),
      'INVALID_EXECUTION_SCHEDULE',
      'tradableIntervals',
    );
  });

  it('snapshots top-level and nested accessors exactly once', () => {
    const topReads: Record<string, number> = {};
    const intervalReads: Record<string, number> = {};
    const input: Record<string, unknown> = {};

    for (const field of Object.keys(validSchedule) as Array<
      keyof ExecutionScheduleInput
    >) {
      if (field === 'tradableIntervals') continue;
      const value = validSchedule[field];
      Object.defineProperty(input, field, {
        enumerable: true,
        get: () => {
          topReads[field] = (topReads[field] ?? 0) + 1;
          return topReads[field] === 1 ? value : 'CHANGED';
        },
      });
    }

    const interval: Record<string, unknown> = {};
    for (const field of ['start', 'end'] as const) {
      const value = firstTradableInterval[field];
      Object.defineProperty(interval, field, {
        enumerable: true,
        get: () => {
          intervalReads[field] = (intervalReads[field] ?? 0) + 1;
          return intervalReads[field] === 1 ? value : 'CHANGED';
        },
      });
    }
    Object.defineProperty(input, 'tradableIntervals', {
      enumerable: true,
      value: [interval],
    });

    expect(
      createExecutionSchedule(input as unknown as ExecutionScheduleInput)
        .tradableIntervals,
    ).toEqual([{ start: '2026-01-02T08:00:00Z', end: '2026-01-02T12:00:00Z' }]);
    expect(topReads).toEqual(
      Object.fromEntries(
        Object.keys(validSchedule)
          .filter((field) => field !== 'tradableIntervals')
          .map((field) => [field, 1]),
      ),
    );
    expect(intervalReads).toEqual({ start: 1, end: 1 });
  });
});

describe('causal next-tradable-open selection', () => {
  const schedule = () => createExecutionSchedule(validSchedule);

  it('selects the earliest observable open after maintenance and a session gap', () => {
    const selected = selectNextTradableH1Open({
      signalCloseTime: '2026-01-02T09:00:00Z',
      decisionAt: '2026-01-02T13:00:00Z',
      contract: syntheticFdxsContract,
      schedule: schedule(),
      openEvents: [
        openEvent('2026-01-02T09:00:00Z'),
        openEvent('2026-01-02T10:00:00Z'),
        openEvent('2026-01-02T12:00:00Z'),
        openEvent('2026-01-02T13:00:00Z'),
      ],
    });

    expect(selected?.openTime).toBe('2026-01-02T13:00:00Z');
  });

  it('uses half-open session and contract boundaries', () => {
    const sessionEnd = selectNextTradableH1Open({
      signalCloseTime: '2026-01-02T11:00:00Z',
      decisionAt: '2026-01-02T13:00:00Z',
      contract: syntheticFdxsContract,
      schedule: schedule(),
      openEvents: [
        openEvent('2026-01-02T12:00:00Z'),
        openEvent('2026-01-02T13:00:00Z'),
      ],
    });
    expect(sessionEnd?.openTime).toBe('2026-01-02T13:00:00Z');

    const atLastTrade = openEvent(syntheticFdxsContract.lastTradeAt);
    expect(
      selectNextTradableH1Open({
        signalCloseTime: '2026-03-20T10:00:00Z',
        decisionAt: syntheticFdxsContract.lastTradeAt,
        contract: syntheticFdxsContract,
        schedule: createExecutionSchedule({
          ...validSchedule,
          validFrom: '2026-03-20T10:00:00Z',
          validUntil: '2026-03-20T13:00:00Z',
          observedAt: '2026-03-20T09:00:00Z',
          tradableIntervals: [
            { start: '2026-03-20T10:00:00Z', end: '2026-03-20T13:00:00Z' },
          ],
          maintenanceBreaks: [],
        }),
        openEvents: [atLastTrade],
      }),
    ).toBeNull();
  });

  it('ignores an open not yet observable at decisionAt', () => {
    expect(
      selectNextTradableH1Open({
        signalCloseTime: '2026-01-02T08:00:00Z',
        decisionAt: '2026-01-02T10:00:00Z',
        contract: syntheticFdxsContract,
        schedule: schedule(),
        openEvents: [
          openEvent('2026-01-02T09:00:00Z', {
            availableAt: '2026-01-02T10:00:00.000000001Z',
          }),
        ],
      }),
    ).toBeNull();
  });

  it('rejects a future-observed or wrong-contract schedule', () => {
    expectExecutionError(
      () =>
        selectNextTradableH1Open({
          signalCloseTime: '2026-01-02T08:00:00Z',
          decisionAt: '2026-01-02T09:00:00Z',
          contract: syntheticFdxsContract,
          schedule: createExecutionSchedule({
            ...validSchedule,
            observedAt: '2026-01-02T09:00:00.000000001Z',
          }),
          openEvents: [],
        }),
      'INVALID_EXECUTION_SCHEDULE',
      'observedAt',
    );

    expectExecutionError(
      () =>
        selectNextTradableH1Open({
          signalCloseTime: '2026-01-02T08:00:00Z',
          decisionAt: '2026-01-02T09:00:00Z',
          contract: syntheticFdxsContract,
          schedule: createExecutionSchedule({
            ...validSchedule,
            contractId: 'OTHER',
          }),
          openEvents: [],
        }),
      'INVALID_EXECUTION_SCHEDULE',
      'contractId',
    );
  });

  it('throws INVALID_DATA when the requested interval lacks schedule coverage', () => {
    expectExecutionError(
      () =>
        selectNextTradableH1Open({
          signalCloseTime: '2026-01-02T07:59:59Z',
          decisionAt: '2026-01-02T13:00:00Z',
          contract: syntheticFdxsContract,
          schedule: schedule(),
          openEvents: [],
        }),
      'INVALID_DATA',
      'scheduleCoverage',
    );
  });

  it('never reads future OHLC fields from an open event boundary', () => {
    const input = { ...openEvent('2026-01-02T09:00:00Z') } as Record<
      string,
      unknown
    >;
    for (const field of ['high', 'low', 'close']) {
      Object.defineProperty(input, field, {
        enumerable: true,
        get: () => {
          throw new Error(`${field} must not be observed at open`);
        },
      });
    }

    expect(
      selectNextTradableH1Open({
        signalCloseTime: '2026-01-02T08:00:00Z',
        decisionAt: '2026-01-02T09:00:00Z',
        contract: syntheticFdxsContract,
        schedule: schedule(),
        openEvents: [input as unknown as ReturnType<typeof openEvent>],
      })?.openTime,
    ).toBe('2026-01-02T09:00:00Z');
  });

  it('rejects a continuous-symbol or different-contract event', () => {
    expectExecutionError(
      () =>
        selectNextTradableH1Open({
          signalCloseTime: '2026-01-02T08:00:00Z',
          decisionAt: '2026-01-02T09:00:00Z',
          contract: syntheticFdxsContract,
          schedule: schedule(),
          openEvents: [
            openEvent('2026-01-02T09:00:00Z', { contractId: 'FDXS' }),
          ],
        }),
      'INVALID_DATA',
      'contractId',
    );
  });
});
