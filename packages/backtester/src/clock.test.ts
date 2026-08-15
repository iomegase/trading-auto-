import { describe, expect, it } from 'vitest';

import { BacktestInputError } from './errors.js';
import {
  BACKTEST_EVENT_TYPES,
  createBacktestEvent,
  type BacktestEventInput,
} from './event.js';

function eventInput(
  overrides: Partial<BacktestEventInput> = {},
): BacktestEventInput {
  return {
    semanticId: 'event:default',
    type: 'DATA_AVAILABLE',
    availableAt: '2026-08-14T09:00:00Z',
    instrumentId: null,
    contractId: null,
    version: null,
    payload: {},
    ...overrides,
  };
}

function expectInputError(
  operation: () => unknown,
  code:
    | 'INVALID_BACKTEST_INPUT'
    | 'BACKTEST_LIMIT_EXCEEDED'
    | 'DUPLICATE_EVENT' = 'INVALID_BACKTEST_INPUT',
): void {
  try {
    operation();
    throw new Error('Expected BacktestInputError.');
  } catch (error) {
    expect(error).toBeInstanceOf(BacktestInputError);
    expect(error).toMatchObject({ code });
  }
}

describe('deterministic backtest clock', () => {
  it('orders every same-instant priority pair independent of insertion', async () => {
    const { orderBacktestEvents } = await import('./clock.js');

    for (let left = 0; left < BACKTEST_EVENT_TYPES.length; left += 1) {
      for (
        let right = left + 1;
        right < BACKTEST_EVENT_TYPES.length;
        right += 1
      ) {
        const lower = BACKTEST_EVENT_TYPES[left];
        const higher = BACKTEST_EVENT_TYPES[right];
        if (lower === undefined || higher === undefined) {
          throw new Error('event type fixture is incomplete');
        }
        const result = orderBacktestEvents({
          endAt: '2026-08-14T09:00:00Z',
          events: [
            eventInput({ semanticId: `event:${higher}`, type: higher }),
            eventInput({ semanticId: `event:${lower}`, type: lower }),
          ],
        });

        expect(result.map((event) => event.type)).toEqual([lower, higher]);
      }
    }
  });

  it('orders by instant, then priority, then direct semantic ID comparison', async () => {
    const { orderBacktestEvents } = await import('./clock.js');
    const result = orderBacktestEvents({
      endAt: '2026-08-14T10:00:00Z',
      events: [
        eventInput({
          semanticId: 'event:2',
          type: 'SIGNAL_DECISION',
          availableAt: '2026-08-14T09:00:00Z',
        }),
        eventInput({
          semanticId: 'event:10',
          type: 'SIGNAL_DECISION',
          availableAt: '2026-08-14T10:00:00+01:00',
        }),
        eventInput({
          semanticId: 'event:earlier',
          type: 'SESSION_END',
          availableAt: '2026-08-14T08:59:59Z',
        }),
        eventInput({
          semanticId: 'event:data',
          type: 'DATA_AVAILABLE',
          availableAt: '2026-08-14T09:00:00Z',
        }),
      ],
    });

    expect(result.map((event) => event.semanticId)).toEqual([
      'event:earlier',
      'event:data',
      'event:10',
      'event:2',
    ]);
    expect(
      orderBacktestEvents({
        endAt: '2026-08-14T09:00:00Z',
        events: [
          eventInput({
            semanticId: 'event:10',
            type: 'SIGNAL_DECISION',
          }),
          eventInput({
            semanticId: 'event:2',
            type: 'SIGNAL_DECISION',
          }),
        ],
      }).map((event) => event.semanticId),
    ).toEqual(['event:10', 'event:2']);
  });

  it('normalizes endAt and includes an event exactly at the boundary', async () => {
    const { orderBacktestEvents } = await import('./clock.js');

    expect(
      orderBacktestEvents({
        endAt: '2026-08-14T11:00:00+02:00',
        events: [eventInput()],
      }),
    ).toHaveLength(1);
  });

  it('rejects exact and contradictory duplicate eligible identities', async () => {
    const { orderBacktestEvents } = await import('./clock.js');
    const exact = eventInput({ semanticId: 'duplicate' });
    const contradictory = eventInput({
      semanticId: 'duplicate',
      payload: { changed: true },
    });

    expectInputError(
      () =>
        orderBacktestEvents({
          endAt: '2026-08-14T09:00:00Z',
          events: [exact, { ...exact }],
        }),
      'DUPLICATE_EVENT',
    );
    expectInputError(
      () =>
        orderBacktestEvents({
          endAt: '2026-08-14T09:00:00Z',
          events: [exact, contradictory],
        }),
      'DUPLICATE_EVENT',
    );
  });

  it('ignores future duplicates outside the evaluated interval', async () => {
    const { orderBacktestEvents } = await import('./clock.js');
    const future = eventInput({
      semanticId: 'future',
      availableAt: '2026-08-14T10:00:00Z',
    });

    expect(
      orderBacktestEvents({
        endAt: '2026-08-14T09:00:00Z',
        events: [future, { ...future }],
      }),
    ).toEqual([]);
  });

  it('does not read any future-event field after availableAt', async () => {
    const { orderBacktestEvents } = await import('./clock.js');
    const reads = new Map<string, number>();
    const future = Object.defineProperties(
      {},
      Object.fromEntries(
        Object.entries(
          eventInput({
            availableAt: '2026-08-14T10:00:00Z',
          }) as unknown as Record<string, unknown>,
        ).map(([key, value]) => [
          key,
          {
            configurable: true,
            enumerable: true,
            get() {
              reads.set(key, (reads.get(key) ?? 0) + 1);
              if (key !== 'availableAt') throw new Error(`read ${key}`);
              return value;
            },
          },
        ]),
      ),
    );

    const result = orderBacktestEvents({
      endAt: '2026-08-14T09:00:00Z',
      events: [future as BacktestEventInput],
    });

    expect(result).toEqual([]);
    expect(Object.fromEntries(reads)).toEqual({ availableAt: 1 });
  });

  it('does not enumerate irrelevant keys on an unavailable future event', async () => {
    const { orderBacktestEvents } = await import('./clock.js');
    const future = Object.defineProperty(
      { availableAt: '2026-08-14T10:00:00Z' },
      Symbol('ignored'),
      { enumerable: true, value: 'ignored' },
    ) as Record<PropertyKey, unknown>;
    for (let index = 0; index < 257; index += 1) {
      Object.defineProperty(future, `extra${String(index)}`, {
        enumerable: true,
        get() {
          throw new Error('future extra field must not be read');
        },
      });
    }

    expect(
      orderBacktestEvents({
        endAt: '2026-08-14T09:00:00Z',
        events: [future as unknown as BacktestEventInput],
      }),
    ).toEqual([]);
  });

  it('reads availableAt exactly once for an eligible event', async () => {
    const { orderBacktestEvents } = await import('./clock.js');
    let reads = 0;
    const eligible = Object.defineProperty(eventInput(), 'availableAt', {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        if (reads > 1) throw new Error('availableAt read twice');
        return '2026-08-14T09:00:00Z';
      },
    });

    expect(
      orderBacktestEvents({
        endAt: '2026-08-14T09:00:00Z',
        events: [eligible],
      }),
    ).toHaveLength(1);
    expect(reads).toBe(1);
  });

  it('is invariant when a hostile unavailable future event is appended', async () => {
    const { orderBacktestEvents } = await import('./clock.js');
    const baselineInput = {
      endAt: '2026-08-14T09:00:00Z',
      events: [eventInput({ semanticId: 'baseline' })],
    };
    const future = Object.defineProperties(
      {},
      {
        availableAt: {
          enumerable: true,
          value: '2026-08-14T10:00:00Z',
        },
        payload: {
          enumerable: true,
          get() {
            throw new Error('future payload must not be read');
          },
        },
      },
    );

    const baseline = orderBacktestEvents(baselineInput);
    const withFuture = orderBacktestEvents({
      ...baselineInput,
      events: [...baselineInput.events, future as BacktestEventInput],
    });

    expect(withFuture).toEqual(baseline);
  });

  it('rejects malformed eligible events rather than skipping them', async () => {
    const { orderBacktestEvents } = await import('./clock.js');

    expectInputError(() =>
      orderBacktestEvents({
        endAt: '2026-08-14T09:00:00Z',
        events: [eventInput({ type: 'UNKNOWN' })],
      }),
    );
  });

  it('checks the million-event cap before probing an index', async () => {
    const { orderBacktestEvents } = await import('./clock.js');
    let indexProbes = 0;
    const events = new Proxy(new Array<unknown>(1_000_001), {
      getOwnPropertyDescriptor(target, property) {
        if (property !== 'length') indexProbes += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    expectInputError(
      () =>
        orderBacktestEvents({
          endAt: '2026-08-14T09:00:00Z',
          events: events as readonly BacktestEventInput[],
        }),
      'BACKTEST_LIMIT_EXCEEDED',
    );
    expect(indexProbes).toBe(0);
  });

  it('rejects sparse arrays, malformed endAt, and hostile top-level input', async () => {
    const { orderBacktestEvents } = await import('./clock.js');
    const sparse = new Array<BacktestEventInput>(1);
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    expectInputError(() =>
      orderBacktestEvents({
        endAt: '2026-08-14T09:00:00Z',
        events: sparse,
      }),
    );
    expectInputError(() =>
      orderBacktestEvents({ endAt: 'invalid', events: [] }),
    );
    expectInputError(() =>
      orderBacktestEvents({ endAt: 1, events: [] } as never),
    );
    expectInputError(() => orderBacktestEvents(revoked.proxy as never));
  });

  it('captures top-level accessors once without using a Proxy get trap', async () => {
    const { orderBacktestEvents } = await import('./clock.js');
    let endReads = 0;
    let eventReads = 0;
    let directGets = 0;
    const target = Object.defineProperties(
      {},
      {
        endAt: {
          enumerable: true,
          get() {
            endReads += 1;
            return '2026-08-14T09:00:00Z';
          },
        },
        events: {
          enumerable: true,
          get() {
            eventReads += 1;
            return [eventInput()];
          },
        },
      },
    );
    const input = new Proxy(target, {
      get() {
        directGets += 1;
        return 'trap';
      },
    });

    expect(orderBacktestEvents(input as never)).toHaveLength(1);
    expect({ directGets, endReads, eventReads }).toEqual({
      directGets: 0,
      endReads: 1,
      eventReads: 1,
    });
  });

  it('returns a frozen array and produces stable clock keys', async () => {
    const { clockKeyOf, orderBacktestEvents } = await import('./clock.js');
    const result = orderBacktestEvents({
      endAt: '2026-08-14T09:00:00Z',
      events: [
        eventInput({
          semanticId: 'snapshot',
          type: 'PORTFOLIO_SNAPSHOT',
        }),
      ],
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(clockKeyOf(result[0] ?? createBacktestEvent(eventInput()))).toBe(
      '2026-08-14T09:00:00Z|07|snapshot',
    );
  });
});
