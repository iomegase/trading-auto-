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

  it('maps hostile schedule records and fields to typed errors', () => {
    for (const value of [null, [], new Date(0)]) {
      expectExecutionError(
        () =>
          createExecutionSchedule(value as unknown as ExecutionScheduleInput),
        'INVALID_EXECUTION_SCHEDULE',
        'input',
      );
    }
    const descriptorTrap = new Proxy(validSchedule, {
      getOwnPropertyDescriptor: () => {
        throw new Error('descriptor trap');
      },
    });
    expectExecutionError(
      () => createExecutionSchedule(descriptorTrap),
      'INVALID_EXECUTION_SCHEDULE',
      'version',
    );

    for (const descriptor of [
      { enumerable: false, value: validSchedule.version },
      { enumerable: true, set: () => undefined },
      {
        enumerable: true,
        get: () => {
          throw new Error('getter trap');
        },
      },
    ]) {
      const input = { ...validSchedule } as Record<string, unknown>;
      Object.defineProperty(input, 'version', descriptor);
      expectExecutionError(
        () =>
          createExecutionSchedule(input as unknown as ExecutionScheduleInput),
        'INVALID_EXECUTION_SCHEDULE',
        'version',
      );
    }
  });

  it('rejects malformed instants and hostile interval arrays', () => {
    for (const observedAt of [1 as unknown as string, 'invalid']) {
      expectExecutionError(
        () => createExecutionSchedule({ ...validSchedule, observedAt }),
        'INVALID_EXECUTION_SCHEDULE',
        'observedAt',
      );
    }
    expectExecutionError(
      () =>
        createExecutionSchedule({
          ...validSchedule,
          tradableIntervals: [
            { start: validSchedule.validFrom, end: validSchedule.validFrom },
          ],
        }),
      'INVALID_EXECUTION_SCHEDULE',
      'tradableIntervals',
    );
    expectExecutionError(
      () =>
        createExecutionSchedule({
          ...validSchedule,
          tradableIntervals:
            {} as unknown as ExecutionScheduleInput['tradableIntervals'],
        }),
      'INVALID_EXECUTION_SCHEDULE',
      'tradableIntervals',
    );

    const invalidLengths = [
      new Proxy([], {
        get: (_target, property) => (property === 'length' ? -1 : undefined),
      }),
      new Proxy([], {
        get: (_target, property) => {
          if (property === 'length') throw new Error('length trap');
          return undefined;
        },
      }),
    ];
    for (const tradableIntervals of invalidLengths) {
      expectExecutionError(
        () => createExecutionSchedule({ ...validSchedule, tradableIntervals }),
        'INVALID_EXECUTION_SCHEDULE',
        'tradableIntervals',
      );
    }

    const descriptorTrap = new Proxy([firstTradableInterval], {
      getOwnPropertyDescriptor: () => {
        throw new Error('descriptor trap');
      },
    });
    expectExecutionError(
      () =>
        createExecutionSchedule({
          ...validSchedule,
          tradableIntervals: descriptorTrap,
        }),
      'INVALID_EXECUTION_SCHEDULE',
      'tradableIntervals',
    );

    for (const descriptor of [
      { enumerable: true, set: () => undefined },
      {
        enumerable: true,
        get: () => {
          throw new Error('element getter');
        },
      },
    ]) {
      const intervals: unknown[] = [];
      Object.defineProperty(intervals, '0', descriptor);
      Object.defineProperty(intervals, 'length', { value: 1 });
      expectExecutionError(
        () =>
          createExecutionSchedule({
            ...validSchedule,
            tradableIntervals:
              intervals as ExecutionScheduleInput['tradableIntervals'],
          }),
        'INVALID_EXECUTION_SCHEDULE',
        'tradableIntervals',
      );
    }
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

  it('rejects duplicate eligible opens instead of depending on array order', () => {
    expectExecutionError(
      () =>
        selectNextTradableH1Open({
          signalCloseTime: '2026-01-02T08:00:00Z',
          decisionAt: '2026-01-02T09:00:00Z',
          contract: syntheticFdxsContract,
          schedule: schedule(),
          openEvents: [
            openEvent('2026-01-02T09:00:00Z', { price: '15000' }),
            openEvent('2026-01-02T09:00:00Z', { price: '15000.5' }),
          ],
        }),
      'INVALID_DATA',
      'openEvents',
    );
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
            {
              ...openEvent('2026-01-02T09:00:00Z'),
              contractId: 'FDXS',
            },
          ],
        }),
      'INVALID_DATA',
      'contractId',
    );
  });

  it('rejects a forged continuous contract even without market events', () => {
    const continuousContract = {
      ...syntheticFdxsContract,
      contractId: syntheticFdxsContract.productCode,
    };

    expectExecutionError(
      () =>
        selectNextTradableH1Open({
          signalCloseTime: '2026-01-02T08:00:00Z',
          decisionAt: '2026-01-02T09:00:00Z',
          contract: continuousContract,
          schedule: createExecutionSchedule({
            ...validSchedule,
            contractId: continuousContract.contractId,
          }),
          openEvents: [],
        }),
      'INVALID_DATA',
      'contractId',
    );
  });

  it('rejects invalid query chronology and contract windows', () => {
    expectExecutionError(
      () =>
        selectNextTradableH1Open({
          signalCloseTime: '2026-01-02T10:00:00Z',
          decisionAt: '2026-01-02T09:00:00Z',
          contract: syntheticFdxsContract,
          schedule: schedule(),
          openEvents: [],
        }),
      'INVALID_DATA',
      'decisionAt',
    );
    expectExecutionError(
      () =>
        selectNextTradableH1Open({
          signalCloseTime: '2026-01-02T08:00:00Z',
          decisionAt: '2026-01-02T09:00:00Z',
          contract: {
            ...syntheticFdxsContract,
            lastTradeAt: syntheticFdxsContract.firstTradeAt,
          },
          schedule: schedule(),
          openEvents: [],
        }),
      'INVALID_DATA',
      'contract',
    );
  });

  it('rejects malformed observable opens and wrong instruments', () => {
    expectExecutionError(
      () =>
        selectNextTradableH1Open({
          signalCloseTime: '2026-01-02T08:00:00Z',
          decisionAt: '2026-01-02T09:00:00Z',
          contract: syntheticFdxsContract,
          schedule: schedule(),
          openEvents: [
            {
              ...openEvent('2026-01-02T09:00:00Z'),
              price: 'bad',
            } as unknown as ReturnType<typeof openEvent>,
          ],
        }),
      'INVALID_DATA',
      'openEvents',
    );
    expectExecutionError(
      () =>
        selectNextTradableH1Open({
          signalCloseTime: '2026-01-02T08:00:00Z',
          decisionAt: '2026-01-02T09:00:00Z',
          contract: syntheticFdxsContract,
          schedule: schedule(),
          openEvents: [
            openEvent('2026-01-02T09:00:00Z', { instrumentId: 'OTHER' }),
          ],
        }),
      'INVALID_DATA',
      'instrumentId',
    );
  });
});
