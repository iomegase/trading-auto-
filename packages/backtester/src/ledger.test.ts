import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { BacktestInputError, BacktestStateError } from './errors.js';

function ledgerEntryInput(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    entryId: 'cost:fill-1',
    eventId: 'fill-1',
    occurredAt: '2026-08-14T09:00:00Z',
    description: 'Round-trip execution cost',
    fxSnapshotVersion: null,
    postings: [
      { account: 'CASH', amount: '-2.40' },
      { account: 'COSTS', amount: '2.40' },
    ],
    ...overrides,
  };
}

function createStoredEntry(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return ledgerEntryInput({
    entryId: 'stored-entry',
    eventId: 'stored-event',
    ...overrides,
  });
}

function expectInputError(
  operation: () => unknown,
  code:
    | 'INVALID_BACKTEST_INPUT'
    | 'BACKTEST_LIMIT_EXCEEDED' = 'INVALID_BACKTEST_INPUT',
): void {
  try {
    operation();
    throw new Error('Expected BacktestInputError.');
  } catch (error) {
    expect(error).toBeInstanceOf(BacktestInputError);
    expect(error).toMatchObject({ code });
  }
}

function expectStateError(
  operation: () => unknown,
  code:
    'INVALID_BACKTEST_STATE' | 'EVENT_ORDER_VIOLATION' | 'UNBALANCED_LEDGER',
): void {
  try {
    operation();
    throw new Error('Expected BacktestStateError.');
  } catch (error) {
    expect(error).toBeInstanceOf(BacktestStateError);
    expect(error).toMatchObject({ code });
  }
}

describe('ledger entries', () => {
  it('creates the exact 1,000 EUR initialization ledger', async () => {
    const { createInitialLedger } = await import('./ledger.js');

    const ledger = createInitialLedger({
      backtestId: 'BT-1',
      runCreatedAt: '2026-08-14T10:00:00+02:00',
    });

    expect(ledger).toEqual([
      {
        entryId: 'initialization:BT-1',
        eventId: 'run:BT-1:initialization',
        occurredAt: '2026-08-14T08:00:00Z',
        description: 'Initial capital',
        fxSnapshotVersion: null,
        postings: [
          { account: 'CASH', amount: '1000' },
          { account: 'CAPITAL', amount: '-1000' },
        ],
      },
    ]);
    expect(Object.isFrozen(ledger)).toBe(true);
    expect(Object.isFrozen(ledger[0])).toBe(true);
    expect(Object.isFrozen(ledger[0]?.postings)).toBe(true);
  });

  it('creates an exact deeply frozen cost entry', async () => {
    const { createLedgerEntry } = await import('./ledger.js');
    const input = ledgerEntryInput();

    const entry = createLedgerEntry(input as never);

    expect(entry).toEqual(ledgerEntryInput());
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.postings)).toBe(true);
    expect(entry.postings.every(Object.isFrozen)).toBe(true);
  });

  it.each([
    {
      description: 'Domestic profit',
      fxSnapshotVersion: null,
      postings: [
        { account: 'CASH', amount: '12.5' },
        { account: 'PNL_CLEARING', amount: '-12.5' },
      ],
    },
    {
      description: 'Domestic loss',
      fxSnapshotVersion: null,
      postings: [
        { account: 'CASH', amount: '-12.5' },
        { account: 'PNL_CLEARING', amount: '12.5' },
      ],
    },
    {
      description: 'Foreign profit translated to EUR',
      fxSnapshotVersion: 'FX_EURUSD_1',
      postings: [
        { account: 'CASH', amount: '10' },
        { account: 'FX_TRANSLATION', amount: '-10' },
      ],
    },
    {
      description: 'Foreign loss translated to EUR',
      fxSnapshotVersion: 'FX_EURUSD_1',
      postings: [
        { account: 'CASH', amount: '-10' },
        { account: 'FX_TRANSLATION', amount: '10' },
      ],
    },
  ])('accepts $description', async (overrides) => {
    const { createLedgerEntry } = await import('./ledger.js');

    expect(
      createLedgerEntry(ledgerEntryInput(overrides) as never),
    ).toMatchObject(overrides);
  });

  it('balances values exactly without binary floating-point rounding', async () => {
    const { createLedgerEntry } = await import('./ledger.js');

    expect(
      createLedgerEntry(
        ledgerEntryInput({
          postings: [
            { account: 'CASH', amount: '0.1' },
            { account: 'COSTS', amount: '0.2' },
            { account: 'PNL_CLEARING', amount: '-0.3' },
          ],
        }) as never,
      ).postings,
    ).toHaveLength(3);
    expectStateError(
      () =>
        createLedgerEntry(
          ledgerEntryInput({
            postings: [
              { account: 'CASH', amount: '0.1' },
              { account: 'COSTS', amount: '0.2' },
              {
                account: 'PNL_CLEARING',
                amount: '-0.3000000000000000001',
              },
            ],
          }) as never,
        ),
      'UNBALANCED_LEDGER',
    );
  });

  it('requires two through 32 dense postings before probing items', async () => {
    const { createLedgerEntry } = await import('./ledger.js');
    let indexProbes = 0;
    const oversized = new Proxy(new Array<unknown>(33), {
      getOwnPropertyDescriptor(target, property) {
        if (property !== 'length') indexProbes += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    expectInputError(() =>
      createLedgerEntry(ledgerEntryInput({ postings: [] }) as never),
    );
    expectInputError(() =>
      createLedgerEntry(
        ledgerEntryInput({
          postings: [{ account: 'CASH', amount: '1' }],
        }) as never,
      ),
    );
    expectInputError(
      () =>
        createLedgerEntry(ledgerEntryInput({ postings: oversized }) as never),
      'BACKTEST_LIMIT_EXCEEDED',
    );
    expect(indexProbes).toBe(0);
  });

  it.each([
    {
      postings: [
        { account: 'CASH', amount: '-1' },
        { account: 'CASH', amount: '1' },
      ],
    },
    {
      postings: [
        { account: 'UNKNOWN', amount: '-1' },
        { account: 'COSTS', amount: '1' },
      ],
    },
    {
      postings: [
        { account: 'CASH', amount: '0' },
        { account: 'COSTS', amount: '0' },
      ],
    },
    {
      postings: [
        { account: 'CASH', amount: '1' },
        { account: 'COSTS', amount: '1' },
      ],
    },
  ])('rejects invalid posting set %#', async ({ postings }) => {
    const { createLedgerEntry } = await import('./ledger.js');

    expectInputError(() =>
      createLedgerEntry(ledgerEntryInput({ postings }) as never),
    );
  });

  it('requires an FX version when FX_TRANSLATION is posted', async () => {
    const { createLedgerEntry } = await import('./ledger.js');

    expectInputError(() =>
      createLedgerEntry(
        ledgerEntryInput({
          fxSnapshotVersion: null,
          postings: [
            { account: 'CASH', amount: '1' },
            { account: 'FX_TRANSLATION', amount: '-1' },
          ],
        }) as never,
      ),
    );
  });

  it('rejects an FX version when no FX_TRANSLATION posting exists', async () => {
    const { createLedgerEntry } = await import('./ledger.js');

    expectInputError(() =>
      createLedgerEntry(
        ledgerEntryInput({ fxSnapshotVersion: 'UNUSED_FX' }) as never,
      ),
    );
  });

  it.each([
    ['entryId', ''],
    ['eventId', '   '],
    ['description', 1],
    ['fxSnapshotVersion', ''],
    ['occurredAt', 'invalid'],
    ['occurredAt', 1],
  ])('rejects malformed %s value %#', async (field, value) => {
    const { createLedgerEntry } = await import('./ledger.js');

    expectInputError(() =>
      createLedgerEntry(ledgerEntryInput({ [field]: value }) as never),
    );
  });

  it('captures entry and posting accessors once without Proxy get traps', async () => {
    const { createLedgerEntry } = await import('./ledger.js');
    let entryGets = 0;
    let postingGets = 0;
    const postingTarget = { account: 'CASH', amount: '-1' };
    const posting = new Proxy(postingTarget, {
      get() {
        postingGets += 1;
        return 'trap';
      },
    });
    const raw = ledgerEntryInput({
      postings: [posting, { account: 'COSTS', amount: '1' }],
    });
    const entry = new Proxy(raw, {
      get() {
        entryGets += 1;
        return 'trap';
      },
    });

    expect(createLedgerEntry(entry as never).postings[0]).toEqual(
      postingTarget,
    );
    expect({ entryGets, postingGets }).toEqual({
      entryGets: 0,
      postingGets: 0,
    });
  });

  it.each(['__proto__', 'constructor'])(
    'rejects reserved account key %s',
    async (account) => {
      const { createLedgerEntry } = await import('./ledger.js');

      expectInputError(() =>
        createLedgerEntry(
          ledgerEntryInput({
            postings: [
              { account, amount: '-1' },
              { account: 'COSTS', amount: '1' },
            ],
          }) as never,
        ),
      );
    },
  );

  it('maps hostile and revoked Proxy failures to typed input errors', async () => {
    const { createLedgerEntry } = await import('./ledger.js');
    const hostile = new Proxy(ledgerEntryInput(), {
      ownKeys() {
        throw new Error('hostile');
      },
    });
    const { proxy, revoke } = Proxy.revocable(ledgerEntryInput(), {});
    revoke();

    expectInputError(() => createLedgerEntry(hostile as never));
    expectInputError(() => createLedgerEntry(proxy as never));
  });

  it('detaches caller-owned postings', async () => {
    const { createLedgerEntry } = await import('./ledger.js');
    const postings = [
      { account: 'CASH', amount: '-1' },
      { account: 'COSTS', amount: '1' },
    ];

    const entry = createLedgerEntry(ledgerEntryInput({ postings }) as never);
    const firstPosting = postings[0];
    if (firstPosting === undefined) throw new Error('Missing test posting.');
    firstPosting.amount = '-2';

    expect(entry.postings[0]?.amount).toBe('-1');
  });

  it('is isolated from mutable global Decimal configuration', async () => {
    const previous = {
      precision: Decimal.precision,
      rounding: Decimal.rounding,
      toExpNeg: Decimal.toExpNeg,
      toExpPos: Decimal.toExpPos,
      maxE: Decimal.maxE,
      minE: Decimal.minE,
      modulo: Decimal.modulo,
      crypto: Decimal.crypto,
    };

    try {
      Decimal.set({ maxE: 2, minE: -2, precision: 1 });
      const { createLedgerEntry } = await import('./ledger.js');

      expect(
        createLedgerEntry(ledgerEntryInput() as never).postings,
      ).toHaveLength(2);
    } finally {
      Decimal.set(previous);
    }
  });
});

describe('append-only ledger', () => {
  it('appends chronologically without mutating the previous ledger', async () => {
    const { appendLedgerEntry, createInitialLedger } =
      await import('./ledger.js');
    const initial = createInitialLedger({
      backtestId: 'BT-1',
      runCreatedAt: '2026-08-14T08:00:00Z',
    });

    const appended = appendLedgerEntry(
      initial,
      ledgerEntryInput({ occurredAt: '2026-08-14T08:00:00Z' }) as never,
    );

    expect(initial).toHaveLength(1);
    expect(appended).toHaveLength(2);
    expect(appended[0]).toEqual(initial[0]);
    expect(Object.isFrozen(appended)).toBe(true);
  });

  it('rejects duplicate entry IDs and chronology regression', async () => {
    const { appendLedgerEntry, createInitialLedger } =
      await import('./ledger.js');
    const initial = createInitialLedger({
      backtestId: 'BT-1',
      runCreatedAt: '2026-08-14T08:00:00Z',
    });

    expectStateError(
      () =>
        appendLedgerEntry(
          initial,
          ledgerEntryInput({
            entryId: 'initialization:BT-1',
            occurredAt: '2026-08-14T09:00:00Z',
          }) as never,
        ),
      'INVALID_BACKTEST_STATE',
    );
    expectStateError(
      () =>
        appendLedgerEntry(
          initial,
          ledgerEntryInput({ occurredAt: '2026-08-14T07:59:59Z' }) as never,
        ),
      'EVENT_ORDER_VIOLATION',
    );
  });

  it('rejects duplicate IDs and chronology regression already stored in the ledger', async () => {
    const { appendLedgerEntry } = await import('./ledger.js');
    const first = createStoredEntry({
      entryId: 'stored-1',
      occurredAt: '2026-08-14T09:00:00Z',
    });

    expectStateError(
      () =>
        appendLedgerEntry(
          [first, createStoredEntry({ entryId: 'stored-1' })] as never,
          ledgerEntryInput({ entryId: 'next' }) as never,
        ),
      'INVALID_BACKTEST_STATE',
    );
    expectStateError(
      () =>
        appendLedgerEntry(
          [
            first,
            createStoredEntry({
              entryId: 'stored-2',
              occurredAt: '2026-08-14T08:59:59Z',
            }),
          ] as never,
          ledgerEntryInput({ entryId: 'next' }) as never,
        ),
      'EVENT_ORDER_VIOLATION',
    );
  });

  it('checks the million-entry limit before probing an index', async () => {
    const { appendLedgerEntry } = await import('./ledger.js');
    let indexProbes = 0;
    const ledger = new Proxy(new Array<unknown>(1_000_001), {
      getOwnPropertyDescriptor(target, property) {
        if (property !== 'length') indexProbes += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    expectInputError(
      () => appendLedgerEntry(ledger as never, ledgerEntryInput() as never),
      'BACKTEST_LIMIT_EXCEEDED',
    );
    expect(indexProbes).toBe(0);
  });

  it('rejects sparse and forged existing ledgers', async () => {
    const { appendLedgerEntry } = await import('./ledger.js');
    const sparse = new Array<unknown>(1);
    const forged = [
      {
        ...ledgerEntryInput(),
        postings: [
          { account: 'CASH', amount: '1' },
          { account: 'COSTS', amount: '1' },
        ],
      },
    ];

    expectInputError(() =>
      appendLedgerEntry(sparse as never, ledgerEntryInput() as never),
    );
    expectStateError(
      () => appendLedgerEntry(forged as never, ledgerEntryInput() as never),
      'UNBALANCED_LEDGER',
    );
  });
});
