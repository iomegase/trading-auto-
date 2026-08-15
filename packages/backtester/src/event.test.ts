import { describe, expect, it } from 'vitest';

import { BacktestInputError } from './errors.js';

const EXPECTED_TYPES = [
  'DATA_AVAILABLE',
  'CLOSED_BAR_POSITION',
  'DAILY_SETTLEMENT',
  'ROLL',
  'OPEN_EXIT',
  'OPEN_ENTRY',
  'SIGNAL_DECISION',
  'PORTFOLIO_SNAPSHOT',
  'SESSION_END',
] as const;

function eventInput(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    semanticId: 'FDXS-202609:bar:2026-08-14T09:00:00Z',
    type: 'CLOSED_BAR_POSITION',
    availableAt: '2026-08-14T09:00:00+00:00',
    instrumentId: 'FDXS',
    contractId: 'FDXS-202609',
    version: 'DATASET_1',
    payload: { close: '24500' },
    ...overrides,
  };
}

function expectInputError(operation: () => unknown): void {
  try {
    operation();
    throw new Error('Expected BacktestInputError.');
  } catch (error) {
    expect(error).toBeInstanceOf(BacktestInputError);
    expect(error).toMatchObject({ code: 'INVALID_BACKTEST_INPUT' });
  }
}

describe('backtest event contract', () => {
  it('publishes the nine frozen event types and exact priorities', async () => {
    const { BACKTEST_EVENT_PRIORITY, BACKTEST_EVENT_TYPES } =
      await import('./event.js');

    expect(BACKTEST_EVENT_TYPES).toEqual(EXPECTED_TYPES);
    expect(BACKTEST_EVENT_PRIORITY).toEqual({
      DATA_AVAILABLE: 0,
      CLOSED_BAR_POSITION: 1,
      DAILY_SETTLEMENT: 2,
      ROLL: 3,
      OPEN_EXIT: 4,
      OPEN_ENTRY: 5,
      SIGNAL_DECISION: 6,
      PORTFOLIO_SNAPSHOT: 7,
      SESSION_END: 8,
    });
    expect(Object.isFrozen(BACKTEST_EVENT_TYPES)).toBe(true);
    expect(Object.isFrozen(BACKTEST_EVENT_PRIORITY)).toBe(true);
  });

  it('creates a canonical deeply frozen event', async () => {
    const { createBacktestEvent } = await import('./event.js');
    const input = eventInput();

    const event = createBacktestEvent(input as never);

    expect(event).toEqual({
      semanticId: 'FDXS-202609:bar:2026-08-14T09:00:00Z',
      type: 'CLOSED_BAR_POSITION',
      priority: 1,
      availableAt: '2026-08-14T09:00:00Z',
      instrumentId: 'FDXS',
      contractId: 'FDXS-202609',
      version: 'DATASET_1',
      payload: { close: '24500' },
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
  });

  it.each(EXPECTED_TYPES)(
    'derives the priority for %s rather than trusting input',
    async (type) => {
      const { BACKTEST_EVENT_PRIORITY, createBacktestEvent } =
        await import('./event.js');

      const event = createBacktestEvent(
        eventInput({ priority: 99, type }) as never,
      );

      expect(event.priority).toBe(BACKTEST_EVENT_PRIORITY[type]);
    },
  );

  it('does not read an irrelevant caller-supplied priority field', async () => {
    const { createBacktestEvent } = await import('./event.js');
    let reads = 0;
    const input = Object.defineProperty(eventInput(), 'priority', {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error('must not be read');
      },
    });

    expect(createBacktestEvent(input as never).priority).toBe(1);
    expect(reads).toBe(0);
  });

  it('requires explicit nullable provenance fields', async () => {
    const { createBacktestEvent } = await import('./event.js');

    expect(
      createBacktestEvent(
        eventInput({
          instrumentId: null,
          contractId: null,
          version: null,
        }) as never,
      ),
    ).toMatchObject({
      instrumentId: null,
      contractId: null,
      version: null,
    });

    for (const field of ['instrumentId', 'contractId', 'version']) {
      const input = Object.fromEntries(
        Object.entries(eventInput()).filter(([key]) => key !== field),
      );
      expectInputError(() => createBacktestEvent(input as never));
    }
  });

  it.each([
    ['semanticId', ''],
    ['semanticId', '   '],
    ['semanticId', 'event with space'],
    ['semanticId', 'event:é'],
    ['semanticId', 'event:😀'],
    ['semanticId', 1],
    ['instrumentId', ''],
    ['instrumentId', ' FDXS'],
    ['instrumentId', 'FDXS '],
    ['contractId', '   '],
    ['contractId', ' FDXS-202609'],
    ['contractId', 'FDXS-202609 '],
    ['version', 1],
    ['version', ' DATASET_1'],
    ['version', 'DATASET_1 '],
  ])('rejects invalid %s value %#', async (field, value) => {
    const { createBacktestEvent } = await import('./event.js');

    expectInputError(() =>
      createBacktestEvent(eventInput({ [field]: value }) as never),
    );
  });

  it.each(['UNKNOWN', '', null, 1])(
    'rejects unsupported event type %#',
    async (type) => {
      const { createBacktestEvent } = await import('./event.js');

      expectInputError(() =>
        createBacktestEvent(eventInput({ type }) as never),
      );
    },
  );

  it.each(['not-an-instant', '', 1, null])(
    'maps invalid availableAt %# to a typed input error',
    async (availableAt) => {
      const { createBacktestEvent } = await import('./event.js');

      expectInputError(() =>
        createBacktestEvent(eventInput({ availableAt }) as never),
      );
    },
  );

  it('captures every top-level accessor once without a Proxy get trap', async () => {
    const { createBacktestEvent } = await import('./event.js');
    const raw = eventInput();
    const reads = new Map<string, number>();
    const target = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [
        key,
        {
          configurable: true,
          enumerable: true,
          get() {
            reads.set(key, (reads.get(key) ?? 0) + 1);
            return value;
          },
        },
      ]),
    );
    const accessors = Object.defineProperties({}, target);
    let directGets = 0;
    const input = new Proxy(accessors, {
      get() {
        directGets += 1;
        return 'trap';
      },
    });

    const event = createBacktestEvent(input as never);

    expect(event.type).toBe('CLOSED_BAR_POSITION');
    expect(Object.fromEntries(reads)).toEqual(
      Object.fromEntries(Object.keys(raw).map((key) => [key, 1])),
    );
    expect(directGets).toBe(0);
  });

  it('detaches its payload and preserves reserved keys safely', async () => {
    const { createBacktestEvent } = await import('./event.js');
    const payload = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(payload, '__proto__', {
      enumerable: true,
      value: { value: 'before' },
    });

    const event = createBacktestEvent(eventInput({ payload }) as never);
    (payload.__proto__ as { value: string }).value = 'after';

    expect(event.payload.__proto__).toEqual({ value: 'before' });
    expect(Object.getPrototypeOf(event.payload)).toBeNull();
    expect(({} as { value?: string }).value).toBeUndefined();
  });

  it.each([
    null,
    [],
    { value: undefined },
    { value: Number.NaN },
    { value: 1n },
  ])('rejects malformed payload %#', async (payload) => {
    const { createBacktestEvent } = await import('./event.js');

    expectInputError(() =>
      createBacktestEvent(eventInput({ payload }) as never),
    );
  });

  it('rejects missing, inherited, non-enumerable, and hostile top-level fields', async () => {
    const { createBacktestEvent } = await import('./event.js');
    const missing = eventInput();
    delete missing.semanticId;
    const inherited = Object.create(eventInput()) as Record<string, unknown>;
    const hidden = eventInput();
    Object.defineProperty(hidden, 'semanticId', {
      enumerable: false,
      value: hidden.semanticId,
    });
    const throwing = eventInput();
    Object.defineProperty(throwing, 'semanticId', {
      enumerable: true,
      get() {
        throw new Error('hostile');
      },
    });
    const revoked = Proxy.revocable(eventInput(), {});
    revoked.revoke();

    for (const input of [missing, inherited, hidden, throwing, revoked.proxy]) {
      expectInputError(() => createBacktestEvent(input as never));
    }
  });

  it('rejects symbol keys at the event boundary', async () => {
    const { createBacktestEvent } = await import('./event.js');
    const input = eventInput();
    Object.defineProperty(input, Symbol('hidden'), {
      enumerable: true,
      value: 'unsupported',
    });

    expectInputError(() => createBacktestEvent(input as never));
  });
});
