import { Temporal } from '@js-temporal/polyfill';
import { type DecimalString } from '@trading-auto/domain';
import { Decimal } from 'decimal.js';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createCostModelSnapshot,
  createEligibilitySnapshot,
  createFxSnapshot,
  createMarginSnapshot,
  RiskInputError,
  selectRiskSnapshotBundle,
  type CostModelSnapshotInput,
  type EligibilitySnapshotInput,
  type FeeScheduleInput,
  type FxSnapshotInput,
  type MarginSnapshotInput,
  type RiskSnapshotSelectionQueryInput,
  type RiskSnapshotSeriesInput,
} from './index.js';

const metadata = {
  version: 'v1',
  source: 'test-provider',
  observedAt: '2026-01-02T09:00:00+01:00',
  validFrom: '2026-01-02T08:30:00+01:00',
  validUntil: '2026-01-03T08:30:00+01:00',
} as const;

const validFxInput: FxSnapshotInput = {
  ...metadata,
  baseCurrency: 'USD',
  quoteCurrency: 'EUR',
  rate: '0.92',
};

const validMarginInput: MarginSnapshotInput = {
  ...metadata,
  contractId: 'MESH26',
  currency: 'USD',
  initialMarginPerContract: '2200',
  maintenanceMarginPerContract: '2000',
};

const validEligibilityInput: EligibilitySnapshotInput = {
  ...metadata,
  contractId: 'MESH26',
  researchOnly: false,
  eligible: true,
  reason: null,
};

const zeroFees: FeeScheduleInput = {
  minimum: '0',
  tiers: [{ upToQuantity: null, feePerContract: '0' }],
};

const validCostInput: CostModelSnapshotInput = {
  ...metadata,
  contractId: 'MESH26',
  currency: 'USD',
  entryFees: {
    minimum: '1.25',
    tiers: [
      { upToQuantity: '10', feePerContract: '0.65' },
      { upToQuantity: null, feePerContract: '0.45' },
    ],
  },
  exitFees: zeroFees,
  spreadPriceUnitsRoundTrip: '0.25',
  adverseEntrySlippagePriceUnits: '0.25',
  adverseExitSlippagePriceUnits: '0.5',
};

const query: RiskSnapshotSelectionQueryInput = {
  decisionAt: '2026-01-02T09:00:00Z',
  contractId: 'MESH26',
  pnlCurrency: 'USD',
  accountCurrency: 'EUR',
};

function expectRiskInputError(
  action: () => unknown,
  code: string,
  details?: Readonly<Record<string, unknown>>,
): RiskInputError {
  let received: unknown;

  try {
    action();
  } catch (error) {
    received = error;
  }

  expect(received).toBeInstanceOf(RiskInputError);
  expect(received).toMatchObject({
    name: 'RiskInputError',
    code,
    ...(details === undefined ? {} : { details }),
  });

  return received as RiskInputError;
}

function at<T extends { readonly observedAt: string }>(
  input: T,
  observedAt: string,
): T {
  return { ...input, observedAt };
}

function routingOnlyRecord(
  readable: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return new Proxy(
    { ...readable },
    {
      get: (target, property): unknown => {
        if (typeof property === 'string' && Object.hasOwn(target, property)) {
          return target[property];
        }

        throw new Error(`Unexpected read of ${String(property)}`);
      },
    },
  );
}

describe('RiskInputError', () => {
  it('has a stable prototype, name, code, and frozen copied details', () => {
    const sourceDetails = { field: 'rate', value: 'bad' };
    const error = new RiskInputError(
      'INVALID_SNAPSHOT',
      'Invalid snapshot.',
      sourceDetails,
    );

    sourceDetails.value = 'changed';

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RiskInputError);
    expect(error).toMatchObject({
      name: 'RiskInputError',
      code: 'INVALID_SNAPSHOT',
      details: { field: 'rate', value: 'bad' },
    });
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it('keeps details absent when the caller supplies none', () => {
    const error = new RiskInputError(
      'INVALID_RISK_INPUT',
      'Invalid risk input.',
    );

    expect(error.details).toBeUndefined();
  });

  it('defensively clones and deeply freezes nested detail objects and arrays', () => {
    const sourceDetails = {
      field: 'entryFees',
      nested: {
        values: [{ label: 'before' }, 'stable'],
      },
    };
    const error = new RiskInputError(
      'INVALID_SNAPSHOT',
      'Invalid snapshot.',
      sourceDetails,
    );

    sourceDetails.nested.values[0] = { label: 'changed at source' };
    sourceDetails.nested.values.push('source append');

    expect(error.details).toEqual({
      field: 'entryFees',
      nested: {
        values: [{ label: 'before' }, 'stable'],
      },
    });
    const nested = error.details?.nested as {
      readonly values: readonly [{ readonly label: string }, string];
    };
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.values)).toBe(true);
    expect(Object.isFrozen(nested.values[0])).toBe(true);
    expect(() => {
      (nested.values[0] as { label: string }).label = 'returned mutation';
    }).toThrow(TypeError);
    expect(nested.values[0].label).toBe('before');
  });

  it('clones and freezes cyclic plain detail structures without recursion leaks', () => {
    const sourceDetails: Record<string, unknown> = { field: 'cycle' };
    sourceDetails.self = sourceDetails;

    const error = new RiskInputError(
      'INVALID_RISK_INPUT',
      'Invalid risk input.',
      sourceDetails,
    );

    expect(error.details?.self).toBe(error.details);
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it('replaces unsupported detail values with stable frozen representations', () => {
    const sourceDetails = {
      field: 'unsupported',
      date: new Date('2026-01-01T00:00:00Z'),
      callback: () => 'caller code',
      token: Symbol('secret'),
    };

    const error = new RiskInputError(
      'INVALID_RISK_INPUT',
      'Invalid risk input.',
      sourceDetails,
    );

    expect(error.details).toEqual({
      field: 'unsupported',
      date: '[unsupported]',
      callback: '[unsupported]',
      token: '[unsupported]',
    });
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it('truncates oversized nested detail arrays before probing their indices', () => {
    let indexProbes = 0;
    const oversized = new Proxy([], {
      get: (target, property, receiver): unknown =>
        property === 'length' ? 1025 : Reflect.get(target, property, receiver),
      getOwnPropertyDescriptor: (target, property) => {
        indexProbes += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    const error = new RiskInputError(
      'INVALID_RISK_INPUT',
      'Invalid risk input.',
      { oversized },
    );

    expect(error.details).toEqual({ oversized: '[truncated]' });
    expect(indexProbes).toBe(0);
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it('safely represents hostile descriptors, proxies, and array accessors', () => {
    let descriptorReads = 0;
    const descriptorRace = new Proxy(
      { value: 'caller-owned' },
      {
        getOwnPropertyDescriptor: (target, property) => {
          descriptorReads += 1;
          if (descriptorReads > 1) {
            throw new Error('descriptor changed during capture');
          }
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      },
    );
    const unreadableObject = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error('prototype unavailable');
        },
      },
    );
    const unreadableLength = new Proxy([], {
      get: (_target, property): unknown => {
        if (property === 'length') {
          throw new Error('length unavailable');
        }
        return undefined;
      },
    });
    const unreadableIndex = new Proxy(['caller-owned'], {
      getOwnPropertyDescriptor: () => {
        throw new Error('index descriptor unavailable');
      },
    });
    const accessorArray = new Array<unknown>(1);
    Object.defineProperty(accessorArray, 0, {
      enumerable: true,
      get: () => {
        throw new Error('accessor must not run');
      },
    });
    const accessorObject: Record<string, unknown> = {};
    Object.defineProperty(accessorObject, 'secret', {
      enumerable: true,
      get: () => {
        throw new Error('accessor must not run');
      },
    });
    const sparseArray = new Array<unknown>(1);
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    const error = new RiskInputError(
      'INVALID_RISK_INPUT',
      'Invalid risk input.',
      {
        descriptorRace,
        unreadableObject,
        unreadableLength,
        unreadableIndex,
        accessorArray,
        accessorObject,
        sparseArray,
        revoked: revoked.proxy,
      },
    );

    expect(error.details).toMatchObject({
      descriptorRace: { value: '[unreadable]' },
      unreadableObject: '[unreadable]',
      unreadableLength: '[unreadable]',
      unreadableIndex: ['[unreadable]'],
      accessorArray: ['[unreadable]'],
      accessorObject: { secret: '[unreadable]' },
      revoked: '[unreadable]',
    });
    const clonedSparse = error.details?.sparseArray as readonly unknown[];
    expect(clonedSparse).toHaveLength(1);
    expect(0 in clonedSparse).toBe(false);
  });

  it('bounds deeply nested and wide detail objects and wraps unsupported roots', () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let depth = 0; depth < 20; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    const wide = Object.fromEntries(
      Array.from({ length: 1025 }, (_value, index) => [String(index), index]),
    );

    const bounded = new RiskInputError(
      'INVALID_RISK_INPUT',
      'Invalid risk input.',
      { deep, wide },
    );
    expect(JSON.stringify(bounded.details)).toContain('[truncated]');
    expect(bounded.details?.wide).toBe('[truncated]');

    const unsupportedRoot = new RiskInputError(
      'INVALID_RISK_INPUT',
      'Invalid risk input.',
      new Date('2026-01-01T00:00:00Z') as unknown as Readonly<
        Record<string, unknown>
      >,
    );
    expect(unsupportedRoot.details).toEqual({ value: '[unsupported]' });
    expect(Object.isFrozen(unsupportedRoot.details)).toBe(true);
  });
});

describe('snapshot factories', () => {
  it('canonicalizes offset instants while preserving canonical decimal text', () => {
    const fx = createFxSnapshot(validFxInput);
    const margin = createMarginSnapshot(validMarginInput);
    const eligibility = createEligibilitySnapshot(validEligibilityInput);
    const costs = createCostModelSnapshot(validCostInput);

    for (const snapshot of [fx, margin, eligibility, costs]) {
      expect(snapshot).toMatchObject({
        observedAt: '2026-01-02T08:00:00Z',
        validFrom: '2026-01-02T07:30:00Z',
        validUntil: '2026-01-03T07:30:00Z',
      });
    }
    expect(fx.rate).toBe('0.92');
    expect(margin.initialMarginPerContract).toBe('2200');
    expect(costs.entryFees.tiers[0]?.feePerContract).toBe('0.65');
    expectTypeOf(fx.rate).toEqualTypeOf<DecimalString>();
  });

  it.each([
    ['FX', createFxSnapshot, validFxInput],
    ['margin', createMarginSnapshot, validMarginInput],
    ['eligibility', createEligibilitySnapshot, validEligibilityInput],
    ['cost', createCostModelSnapshot, validCostInput],
  ] as const)(
    'rejects invalid metadata for a %s snapshot',
    (_name, factory, input) => {
      for (const field of ['version', 'source'] as const) {
        expectRiskInputError(
          () => factory({ ...input, [field]: ' \t\n ' } as never),
          'INVALID_SNAPSHOT',
          { field, value: ' \t\n ' },
        );
      }

      expectRiskInputError(
        () => factory({ ...input, observedAt: 'not-an-instant' } as never),
        'INVALID_SNAPSHOT',
        { field: 'observedAt', value: 'not-an-instant' },
      );
      expectRiskInputError(
        () => factory({ ...input, source: 42 } as never),
        'INVALID_SNAPSHOT',
        { field: 'source', value: 42 },
      );
      expectRiskInputError(
        () =>
          factory({
            ...input,
            validFrom: '2026-01-03T00:00:00Z',
            validUntil: '2026-01-03T00:00:00Z',
          } as never),
        'INVALID_SNAPSHOT',
      );
    },
  );

  it('requires validFrom before validUntil but leaves observedAt independent', () => {
    const variants = [
      '2026-01-01T00:00:00Z',
      '2026-01-02T08:00:00Z',
      '2026-01-04T00:00:00Z',
    ];

    for (const observedAt of variants) {
      expect(createFxSnapshot({ ...validFxInput, observedAt }).observedAt).toBe(
        observedAt,
      );
    }

    expectRiskInputError(
      () =>
        createFxSnapshot({
          ...validFxInput,
          validFrom: '2026-01-03T00:00:01Z',
          validUntil: '2026-01-03T00:00:00Z',
        }),
      'INVALID_SNAPSHOT',
    );
  });

  it.each([null, [], 0, 'snapshot', true, undefined])(
    'rejects runtime non-object snapshot input: %s',
    (input) => {
      expectRiskInputError(
        () => createFxSnapshot(input as unknown as FxSnapshotInput),
        'INVALID_SNAPSHOT',
        { field: 'input' },
      );
    },
  );

  it('validates positive FX rates and distinct canonical currencies', () => {
    for (const rate of ['0', '-0', '-1', '1e0', '01']) {
      expectRiskInputError(
        () => createFxSnapshot({ ...validFxInput, rate }),
        'INVALID_SNAPSHOT',
        { field: 'rate', value: rate },
      );
    }
    expectRiskInputError(
      () => createFxSnapshot({ ...validFxInput, baseCurrency: 'usd' }),
      'INVALID_SNAPSHOT',
      { field: 'baseCurrency', value: 'usd' },
    );
    expectRiskInputError(
      () => createFxSnapshot({ ...validFxInput, quoteCurrency: 'USD' }),
      'INVALID_SNAPSHOT',
      { baseCurrency: 'USD', quoteCurrency: 'USD' },
    );
  });

  it('validates positive coherent margin amounts and a nonblank contract', () => {
    expectRiskInputError(
      () => createMarginSnapshot({ ...validMarginInput, contractId: '  ' }),
      'INVALID_SNAPSHOT',
      { field: 'contractId', value: '  ' },
    );
    for (const field of [
      'initialMarginPerContract',
      'maintenanceMarginPerContract',
    ] as const) {
      expectRiskInputError(
        () => createMarginSnapshot({ ...validMarginInput, [field]: '0' }),
        'INVALID_SNAPSHOT',
        { field, value: '0' },
      );
    }
    expectRiskInputError(
      () =>
        createMarginSnapshot({
          ...validMarginInput,
          initialMarginPerContract: '1999.99',
        }),
      'INVALID_SNAPSHOT',
    );
  });

  it('validates eligibility booleans and reason coherence', () => {
    expectRiskInputError(
      () =>
        createEligibilitySnapshot({
          ...validEligibilityInput,
          researchOnly: 'false' as unknown as boolean,
        }),
      'INVALID_SNAPSHOT',
      { field: 'researchOnly', value: 'false' },
    );
    expectRiskInputError(
      () =>
        createEligibilitySnapshot({
          ...validEligibilityInput,
          eligible: 'true' as unknown as boolean,
        }),
      'INVALID_SNAPSHOT',
      { field: 'eligible', value: 'true' },
    );
    expectRiskInputError(
      () =>
        createEligibilitySnapshot({
          ...validEligibilityInput,
          reason: 'not needed',
        }),
      'INVALID_SNAPSHOT',
      { field: 'reason', value: 'not needed' },
    );
    expectRiskInputError(
      () =>
        createEligibilitySnapshot({
          ...validEligibilityInput,
          eligible: false,
          reason: ' \t ',
        }),
      'INVALID_SNAPSHOT',
      { field: 'reason', value: ' \t ' },
    );
    expect(
      createEligibilitySnapshot({
        ...validEligibilityInput,
        eligible: false,
        reason: 'Broker restriction',
      }).reason,
    ).toBe('Broker restriction');
  });

  it('allows an explicitly complete zero-cost model', () => {
    const costs = createCostModelSnapshot({
      ...validCostInput,
      entryFees: zeroFees,
      exitFees: zeroFees,
      spreadPriceUnitsRoundTrip: '0',
      adverseEntrySlippagePriceUnits: '0',
      adverseExitSlippagePriceUnits: '0',
    });

    expect(costs).toMatchObject({
      entryFees: zeroFees,
      exitFees: zeroFees,
      spreadPriceUnitsRoundTrip: '0',
      adverseEntrySlippagePriceUnits: '0',
      adverseExitSlippagePriceUnits: '0',
    });
  });

  it.each([
    ['entry minimum', { entryFees: { ...zeroFees, minimum: '-1' } }],
    [
      'entry fee',
      {
        entryFees: {
          minimum: '0',
          tiers: [{ upToQuantity: null, feePerContract: '-0.01' }],
        },
      },
    ],
    ['spread', { spreadPriceUnitsRoundTrip: '-0.01' }],
    ['entry slippage', { adverseEntrySlippagePriceUnits: '-0' }],
    ['exit slippage', { adverseExitSlippagePriceUnits: '1e0' }],
  ] as const)(
    'rejects invalid nonnegative cost input: %s',
    (_name, override) => {
      expectRiskInputError(
        () => createCostModelSnapshot({ ...validCostInput, ...override }),
        'INVALID_SNAPSHOT',
      );
    },
  );

  it('requires dense, nonempty, strictly increasing, positive, final-open fee tiers', () => {
    const invalidTierLists: readonly FeeScheduleInput['tiers'][] = [
      [],
      [
        { upToQuantity: '10', feePerContract: '1' },
        { upToQuantity: '10', feePerContract: '1' },
        { upToQuantity: null, feePerContract: '1' },
      ],
      [
        { upToQuantity: '11', feePerContract: '1' },
        { upToQuantity: '10', feePerContract: '1' },
        { upToQuantity: null, feePerContract: '1' },
      ],
      [{ upToQuantity: '0', feePerContract: '1' }],
      [{ upToQuantity: '-1', feePerContract: '1' }],
      [{ upToQuantity: '1e1', feePerContract: '1' }],
      [
        { upToQuantity: null, feePerContract: '1' },
        { upToQuantity: null, feePerContract: '1' },
      ],
      [{ upToQuantity: '10', feePerContract: '1' }],
    ];

    for (const tiers of invalidTierLists) {
      expectRiskInputError(
        () =>
          createCostModelSnapshot({
            ...validCostInput,
            entryFees: { minimum: '0', tiers },
          }),
        'INVALID_SNAPSHOT',
      );
    }

    const sparse = new Array<FeeScheduleInput['tiers'][number]>(2);
    sparse[1] = { upToQuantity: null, feePerContract: '0' };
    expectRiskInputError(
      () =>
        createCostModelSnapshot({
          ...validCostInput,
          entryFees: { minimum: '0', tiers: sparse },
        }),
      'INVALID_SNAPSHOT',
    );
  });

  it('bounds fee tiers before probing or copying oversized arrays', () => {
    let indexProbes = 0;
    const oversizedTiers = new Proxy(new Array(257), {
      getOwnPropertyDescriptor: (target, property) => {
        if (property !== 'length') indexProbes += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    expectRiskInputError(
      () =>
        createCostModelSnapshot({
          ...validCostInput,
          entryFees: {
            minimum: '0',
            tiers: oversizedTiers,
          },
        }),
      'INVALID_SNAPSHOT',
      { field: 'entryFees.tiers', length: 257, limit: 256 },
    );
    expect(indexProbes).toBe(0);
  });

  it('accepts and freezes a fee schedule at the 256-tier limit', () => {
    const tiers = Array.from({ length: 256 }, (_value, index) => ({
      upToQuantity: index === 255 ? null : String(index + 1),
      feePerContract: '0',
    }));

    const costs = createCostModelSnapshot({
      ...validCostInput,
      entryFees: { minimum: '0', tiers },
    });

    expect(costs.entryFees.tiers).toHaveLength(256);
    expect(Object.isFrozen(costs.entryFees.tiers)).toBe(true);
    expect(Object.isFrozen(costs.entryFees.tiers[255])).toBe(true);
  });

  it.each([null, [], 0, 'schedule', true, undefined])(
    'rejects runtime non-object fee schedules: %s',
    (entryFees) => {
      expectRiskInputError(
        () =>
          createCostModelSnapshot({
            ...validCostInput,
            entryFees: entryFees as unknown as FeeScheduleInput,
          }),
        'INVALID_SNAPSHOT',
      );
    },
  );

  it.each([null, [], 0, 'tier', true, undefined])(
    'rejects runtime non-object fee tiers: %s',
    (tier) => {
      expectRiskInputError(
        () =>
          createCostModelSnapshot({
            ...validCostInput,
            entryFees: {
              minimum: '0',
              tiers: [tier as unknown as FeeScheduleInput['tiers'][number]],
            },
          }),
        'INVALID_SNAPSHOT',
      );
    },
  );

  it('deep-freezes snapshots, schedules, tier arrays, and tiers without mutating inputs', () => {
    const input = structuredClone(validCostInput);
    const before = structuredClone(input);
    const costs = createCostModelSnapshot(input);

    expect(input).toEqual(before);
    expect(Object.isFrozen(costs)).toBe(true);
    expect(Object.isFrozen(costs.entryFees)).toBe(true);
    expect(Object.isFrozen(costs.entryFees.tiers)).toBe(true);
    expect(Object.isFrozen(costs.entryFees.tiers[0])).toBe(true);
    expect(() => {
      (costs.entryFees.tiers as Array<unknown>).push({});
    }).toThrow(TypeError);
  });

  it('constructs top-level snapshots from exactly one read of each property', () => {
    const reads: Record<string, number> = {};
    const input: Record<string, unknown> = {};

    for (const field of Object.keys(validFxInput) as Array<
      keyof FxSnapshotInput
    >) {
      const value = validFxInput[field];
      Object.defineProperty(input, field, {
        enumerable: true,
        get: () => {
          reads[field] = (reads[field] ?? 0) + 1;
          return reads[field] === 1 ? value : 'CHANGED';
        },
      });
    }

    expect(createFxSnapshot(input as unknown as FxSnapshotInput)).toEqual({
      ...validFxInput,
      observedAt: '2026-01-02T08:00:00Z',
      validFrom: '2026-01-02T07:30:00Z',
      validUntil: '2026-01-03T07:30:00Z',
    });
    expect(reads).toEqual(
      Object.fromEntries(Object.keys(validFxInput).map((field) => [field, 1])),
    );
  });

  it('constructs nested costs from one read and never exposes TOCTOU values', () => {
    const tierReads: Record<string, number> = {};
    const tier: Record<string, unknown> = {};
    const expectedTier = {
      upToQuantity: null,
      feePerContract: '0.25',
    } as const;

    for (const field of Object.keys(expectedTier) as Array<
      keyof typeof expectedTier
    >) {
      Object.defineProperty(tier, field, {
        enumerable: true,
        get: () => {
          tierReads[field] = (tierReads[field] ?? 0) + 1;
          return tierReads[field] === 1 ? expectedTier[field] : '-999';
        },
      });
    }

    const costs = createCostModelSnapshot({
      ...validCostInput,
      entryFees: {
        minimum: '0',
        tiers: [tier as unknown as FeeScheduleInput['tiers'][number]],
      },
    });

    expect(costs.entryFees.tiers).toEqual([expectedTier]);
    expect(tierReads).toEqual({ upToQuantity: 1, feePerContract: 1 });
  });

  it('converts throwing top-level and nested descriptor reads into RiskInputError', () => {
    const throwingInput = new Proxy(validFxInput, {
      getOwnPropertyDescriptor: () => {
        throw new Error('unexpected access');
      },
    });
    expectRiskInputError(
      () => createFxSnapshot(throwingInput),
      'INVALID_SNAPSHOT',
      { field: 'version' },
    );

    const throwingTier = new Proxy(
      { upToQuantity: null, feePerContract: '0' },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('unexpected access');
        },
      },
    );
    expectRiskInputError(
      () =>
        createCostModelSnapshot({
          ...validCostInput,
          entryFees: { minimum: '0', tiers: [throwingTier] },
        }),
      'INVALID_SNAPSHOT',
      { field: 'entryFees.tiers[0].upToQuantity' },
    );
  });

  it('is independent of ambient Decimal configuration', () => {
    const originalConfig = {
      precision: Decimal.precision,
      rounding: Decimal.rounding,
      toExpNeg: Decimal.toExpNeg,
      toExpPos: Decimal.toExpPos,
      minE: Decimal.minE,
      maxE: Decimal.maxE,
      modulo: Decimal.modulo,
      crypto: Decimal.crypto,
    };

    try {
      Decimal.set({ maxE: 2, precision: 1 });

      expect(createFxSnapshot({ ...validFxInput, rate: '1000' }).rate).toBe(
        '1000',
      );
      expect(
        createMarginSnapshot({
          ...validMarginInput,
          initialMarginPerContract: '1000.01',
          maintenanceMarginPerContract: '1000',
        }),
      ).toMatchObject({
        initialMarginPerContract: '1000.01',
        maintenanceMarginPerContract: '1000',
      });
    } finally {
      Decimal.set(originalConfig);
    }
  });

  it('rejects snapshot decimals beyond the bounded risk input contract', () => {
    const oversizedRate = '1'.repeat(257);

    expectRiskInputError(
      () => createFxSnapshot({ ...validFxInput, rate: oversizedRate }),
      'INVALID_SNAPSHOT',
      { field: 'rate', value: oversizedRate },
    );
  });

  it('captures own data descriptors instead of a divergent proxy get trap', () => {
    const input = new Proxy(validFxInput, {
      get: (target, property, receiver): unknown =>
        property === 'rate' ? '2' : Reflect.get(target, property, receiver),
    });

    expect(createFxSnapshot(input).rate).toBe('0.92');
  });
});

describe('selectRiskSnapshotBundle', () => {
  it('snapshots the canonical query before any series property is read', () => {
    let decisionAt = query.decisionAt;
    const queryReads: Record<string, number> = {};
    const accessorQuery: Record<string, unknown> = {};
    for (const field of Object.keys(query) as Array<
      keyof RiskSnapshotSelectionQueryInput
    >) {
      Object.defineProperty(accessorQuery, field, {
        enumerable: true,
        get: () => {
          queryReads[field] = (queryReads[field] ?? 0) + 1;
          return field === 'decisionAt' ? decisionAt : query[field];
        },
      });
    }

    const series = {
      get fx() {
        decisionAt = '2026-01-02T11:00:00Z';
        return [
          at(validFxInput, '2026-01-02T08:00:00Z'),
          at(validFxInput, '2026-01-02T10:00:00Z'),
        ];
      },
      margin: [],
      eligibility: [],
      costs: [],
    };

    expect(
      selectRiskSnapshotBundle(
        series,
        accessorQuery as unknown as RiskSnapshotSelectionQueryInput,
      ).fx?.observedAt,
    ).toBe('2026-01-02T08:00:00Z');
    expect(queryReads).toEqual({
      decisionAt: 1,
      contractId: 1,
      pnlCurrency: 1,
      accountCurrency: 1,
    });
  });

  it('ignores a future FX record without reading its invalid rate', () => {
    const futureFx = at(validFxInput, '2026-01-02T10:00:00Z');
    Object.defineProperty(futureFx, 'rate', {
      enumerable: true,
      get: () => {
        throw new Error('future rate must not be read');
      },
    });

    expect(
      selectRiskSnapshotBundle(
        {
          fx: [at(validFxInput, '2026-01-02T08:00:00Z'), futureFx],
          margin: [],
          eligibility: [],
          costs: [],
        },
        query,
      ).fx?.observedAt,
    ).toBe('2026-01-02T08:00:00Z');
  });

  it.each([
    ['margin', validMarginInput],
    ['eligibility', validEligibilityInput],
    ['costs', validCostInput],
  ] as const)(
    'ignores a future %s record after reading only observedAt',
    (field, base) => {
      const future = routingOnlyRecord({
        observedAt: '2026-01-02T10:00:00Z',
      });
      const series = {
        fx: [],
        margin: [],
        eligibility: [],
        costs: [],
        [field]: [at(base, '2026-01-02T08:00:00Z'), future],
      } as unknown as RiskSnapshotSeriesInput;

      expect(selectRiskSnapshotBundle(series, query)[field]?.observedAt).toBe(
        '2026-01-02T08:00:00Z',
      );
    },
  );

  it.each([
    [
      'fx',
      validFxInput,
      {
        observedAt: '2026-01-02T08:30:00Z',
        baseCurrency: 'GBP',
        quoteCurrency: 'CHF',
      },
    ],
    [
      'margin',
      validMarginInput,
      { observedAt: '2026-01-02T08:30:00Z', contractId: 'ESM26' },
    ],
    [
      'eligibility',
      validEligibilityInput,
      { observedAt: '2026-01-02T08:30:00Z', contractId: 'ESM26' },
    ],
    [
      'costs',
      validCostInput,
      { observedAt: '2026-01-02T08:30:00Z', contractId: 'ESM26' },
    ],
  ] as const)(
    'ignores malformed non-routing fields for an observable unrelated %s record',
    (field, base, readableRouting) => {
      const unrelated = routingOnlyRecord(readableRouting);
      const series = {
        fx: [],
        margin: [],
        eligibility: [],
        costs: [],
        [field]: [at(base, '2026-01-02T08:00:00Z'), unrelated],
      } as unknown as RiskSnapshotSeriesInput;

      expect(selectRiskSnapshotBundle(series, query)[field]?.observedAt).toBe(
        '2026-01-02T08:00:00Z',
      );
    },
  );

  it('still fully validates an observable relevant record', () => {
    expectRiskInputError(
      () =>
        selectRiskSnapshotBundle(
          {
            fx: [
              {
                ...validFxInput,
                observedAt: '2026-01-02T08:30:00Z',
                rate: 'invalid',
              },
            ],
            margin: [],
            eligibility: [],
            costs: [],
          },
          query,
        ),
      'INVALID_SNAPSHOT',
      { field: 'rate', value: 'invalid' },
    );

    expectRiskInputError(
      () =>
        selectRiskSnapshotBundle(
          {
            fx: [
              {
                ...validFxInput,
                baseCurrency: 'USD',
                quoteCurrency: 'USD',
              },
            ],
            margin: [],
            eligibility: [],
            costs: [],
          },
          query,
        ),
      'INVALID_SNAPSHOT',
      { baseCurrency: 'USD', quoteCurrency: 'USD' },
    );
  });

  it('selects the latest causally observable MES snapshots by actual instant', () => {
    const fxAt0800 = at(validFxInput, '2026-01-02T09:00:00+01:00');
    const fxAt1000 = at(validFxInput, '2026-01-02T11:00:00+01:00');
    const marginAt0800 = at(validMarginInput, '2026-01-02T08:00:00Z');
    const marginAt1000 = at(validMarginInput, '2026-01-02T10:00:00Z');
    const eligibilityAt0800 = at(validEligibilityInput, '2026-01-02T08:00:00Z');
    const eligibilityAt1000 = at(validEligibilityInput, '2026-01-02T10:00:00Z');
    const costsAt0800 = at(validCostInput, '2026-01-02T08:00:00Z');
    const costsAt1000 = at(validCostInput, '2026-01-02T10:00:00Z');

    const selected = selectRiskSnapshotBundle(
      {
        fx: [fxAt1000, fxAt0800],
        margin: [marginAt1000, marginAt0800],
        eligibility: [eligibilityAt1000, eligibilityAt0800],
        costs: [costsAt1000, costsAt0800],
      },
      query,
    );

    expect(selected.fx?.observedAt).toBe('2026-01-02T08:00:00Z');
    expect(selected.margin?.observedAt).toBe('2026-01-02T08:00:00Z');
    expect(selected.eligibility?.observedAt).toBe('2026-01-02T08:00:00Z');
    expect(selected.costs?.observedAt).toBe('2026-01-02T08:00:00Z');
    expect(Object.isFrozen(selected)).toBe(true);
  });

  it('orders equivalent-offset instants temporally, not lexically or by array order', () => {
    const selected = selectRiskSnapshotBundle(
      {
        fx: [
          at(validFxInput, '2026-01-02T10:45:00+02:00'),
          at(validFxInput, '2026-01-02T09:00:00Z'),
          at(validFxInput, '2026-01-02T08:30:00Z'),
        ],
        margin: [],
        eligibility: [],
        costs: [],
      },
      query,
    );

    expect(selected.fx?.observedAt).toBe('2026-01-02T09:00:00Z');
  });

  it('matches direct and inverse FX pairs without changing the supplied rate', () => {
    const direct = selectRiskSnapshotBundle(
      { fx: [validFxInput], margin: [], eligibility: [], costs: [] },
      query,
    );
    const inverseInput = {
      ...validFxInput,
      version: 'inverse',
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      rate: '1.0869565',
    };
    const inverse = selectRiskSnapshotBundle(
      { fx: [inverseInput], margin: [], eligibility: [], costs: [] },
      query,
    );

    expect(direct.fx?.rate).toBe('0.92');
    expect(inverse.fx).toMatchObject({
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      rate: '1.0869565',
    });
  });

  it('returns null FX for identity conversion without reading FX record fields', () => {
    const brokenFx = new Proxy(
      {},
      {
        get: () => {
          throw new Error('identity FX record must not be read');
        },
      },
    );

    expect(
      selectRiskSnapshotBundle(
        {
          fx: [brokenFx as unknown as FxSnapshotInput],
          margin: [],
          eligibility: [],
          costs: [],
        },
        { ...query, accountCurrency: 'USD' },
      ).fx,
    ).toBeNull();
  });

  it('matches contract snapshots and requires pnl currency for margin and costs', () => {
    const selected = selectRiskSnapshotBundle(
      {
        fx: [],
        margin: [validMarginInput],
        eligibility: [validEligibilityInput],
        costs: [validCostInput],
      },
      query,
    );

    expect(selected.margin?.contractId).toBe('MESH26');
    expect(selected.eligibility?.contractId).toBe('MESH26');
    expect(selected.costs?.currency).toBe('USD');

    expectRiskInputError(
      () =>
        selectRiskSnapshotBundle(
          {
            fx: [],
            margin: [{ ...validMarginInput, currency: 'GBP' }],
            eligibility: [],
            costs: [],
          },
          query,
        ),
      'MISMATCHED_CURRENCY',
      { field: 'margin.currency', expected: 'USD', value: 'GBP' },
    );
    expectRiskInputError(
      () =>
        selectRiskSnapshotBundle(
          {
            fx: [],
            margin: [],
            eligibility: [],
            costs: [{ ...validCostInput, currency: 'EUR' }],
          },
          query,
        ),
      'MISMATCHED_CURRENCY',
      { field: 'costs.currency', expected: 'USD', value: 'EUR' },
    );
  });

  it('ignores records for another contract while matching the requested one', () => {
    const selected = selectRiskSnapshotBundle(
      {
        fx: [],
        margin: [
          { ...validMarginInput, contractId: 'ESM26' },
          validMarginInput,
        ],
        eligibility: [
          { ...validEligibilityInput, contractId: 'ESM26' },
          validEligibilityInput,
        ],
        costs: [{ ...validCostInput, contractId: 'ESM26' }, validCostInput],
      },
      query,
    );

    expect(selected.margin?.contractId).toBe('MESH26');
    expect(selected.eligibility?.contractId).toBe('MESH26');
    expect(selected.costs?.contractId).toBe('MESH26');
  });

  it('retains the latest observed snapshot even when its validity has expired', () => {
    const staleMargin = {
      ...validMarginInput,
      version: 'stale-latest',
      observedAt: '2026-01-02T08:30:00Z',
      validFrom: '2026-01-01T00:00:00Z',
      validUntil: '2026-01-02T08:00:00Z',
    };

    expect(
      selectRiskSnapshotBundle(
        {
          fx: [],
          margin: [validMarginInput, staleMargin],
          eligibility: [],
          costs: [],
        },
        query,
      ).margin?.version,
    ).toBe('stale-latest');
  });

  it('returns null for every category with no observable matching record', () => {
    const futureAt = '2026-01-02T09:00:00.000000001Z';
    const selected = selectRiskSnapshotBundle(
      {
        fx: [at(validFxInput, futureAt)],
        margin: [at(validMarginInput, futureAt)],
        eligibility: [at(validEligibilityInput, futureAt)],
        costs: [at(validCostInput, futureAt)],
      },
      query,
    );

    expect(selected).toEqual({
      fx: null,
      margin: null,
      eligibility: null,
      costs: null,
    });

    const unrelated = selectRiskSnapshotBundle(
      {
        fx: [
          {
            ...validFxInput,
            baseCurrency: 'GBP',
            quoteCurrency: 'CHF',
          },
        ],
        margin: [{ ...validMarginInput, contractId: 'ESM26' }],
        eligibility: [{ ...validEligibilityInput, contractId: 'ESM26' }],
        costs: [{ ...validCostInput, contractId: 'ESM26' }],
      },
      query,
    );
    expect(unrelated).toEqual({
      fx: null,
      margin: null,
      eligibility: null,
      costs: null,
    });
  });

  it.each(['fx', 'margin', 'eligibility', 'costs'] as const)(
    'rejects equal-observedAt duplicate relevant %s snapshots',
    (field) => {
      const series: RiskSnapshotSeriesInput = {
        fx: [],
        margin: [],
        eligibility: [],
        costs: [],
      };
      const input = {
        fx: validFxInput,
        margin: validMarginInput,
        eligibility: validEligibilityInput,
        costs: validCostInput,
      }[field];
      (series[field] as Array<typeof input>).push(input, {
        ...input,
        version: 'duplicate',
      });

      expectRiskInputError(
        () => selectRiskSnapshotBundle(series, query),
        'INVALID_SNAPSHOT',
        { field, observedAt: '2026-01-02T08:00:00Z' },
      );
    },
  );

  it('rejects an older duplicate even when a newer snapshot is already selected', () => {
    expectRiskInputError(
      () =>
        selectRiskSnapshotBundle(
          {
            fx: [
              at(validFxInput, '2026-01-02T09:00:00Z'),
              at(validFxInput, '2026-01-02T08:00:00Z'),
              at(
                { ...validFxInput, version: 'older-duplicate' },
                '2026-01-02T08:00:00Z',
              ),
            ],
            margin: [],
            eligibility: [],
            costs: [],
          },
          query,
        ),
      'INVALID_SNAPSHOT',
      { field: 'fx', observedAt: '2026-01-02T08:00:00Z' },
    );
  });

  it('is invariant when valid future snapshots are appended', () => {
    const baseSeries: RiskSnapshotSeriesInput = {
      fx: [validFxInput],
      margin: [validMarginInput],
      eligibility: [validEligibilityInput],
      costs: [validCostInput],
    };
    const before = selectRiskSnapshotBundle(baseSeries, query);
    const futureAt = '2026-01-02T10:00:00Z';
    const after = selectRiskSnapshotBundle(
      {
        fx: [...baseSeries.fx, at(validFxInput, futureAt)],
        margin: [...baseSeries.margin, at(validMarginInput, futureAt)],
        eligibility: [
          ...baseSeries.eligibility,
          at(validEligibilityInput, futureAt),
        ],
        costs: [...baseSeries.costs, at(validCostInput, futureAt)],
      },
      query,
    );

    expect(after).toEqual(before);
  });

  it('does not mutate supplied arrays or records', () => {
    const series: RiskSnapshotSeriesInput = {
      fx: [validFxInput],
      margin: [validMarginInput],
      eligibility: [validEligibilityInput],
      costs: [validCostInput],
    };
    const before = structuredClone(series);

    selectRiskSnapshotBundle(series, query);

    expect(series).toEqual(before);
  });

  it('rejects sparse snapshot arrays and runtime non-array series fields', () => {
    const sparse = new Array(2) as FxSnapshotInput[];
    sparse[1] = validFxInput;

    expectRiskInputError(
      () =>
        selectRiskSnapshotBundle(
          { fx: sparse, margin: [], eligibility: [], costs: [] },
          query,
        ),
      'INVALID_RISK_INPUT',
      { field: 'fx' },
    );
    expectRiskInputError(
      () =>
        selectRiskSnapshotBundle(
          {
            fx: null as unknown as readonly FxSnapshotInput[],
            margin: [],
            eligibility: [],
            costs: [],
          },
          query,
        ),
      'INVALID_RISK_INPUT',
      { field: 'fx' },
    );
  });

  it('converts hostile array proxy traps into stable input errors', () => {
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    expectRiskInputError(
      () =>
        selectRiskSnapshotBundle(
          {
            fx: revoked.proxy,
            margin: [],
            eligibility: [],
            costs: [],
          },
          query,
        ),
      'INVALID_RISK_INPUT',
      { field: 'fx' },
    );

    const throwingOwnCheck = new Proxy([validFxInput], {
      getOwnPropertyDescriptor: (target, property) => {
        if (property !== 'length') {
          throw new Error('unexpected own-index check');
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    expectRiskInputError(
      () =>
        selectRiskSnapshotBundle(
          { fx: throwingOwnCheck, margin: [], eligibility: [], costs: [] },
          query,
        ),
      'INVALID_RISK_INPUT',
      { field: 'fx' },
    );
  });

  it('bounds snapshot series before probing an oversized array', () => {
    let indexProbes = 0;
    const oversized = new Proxy(new Array(10_001), {
      getOwnPropertyDescriptor: (target, property) => {
        if (property !== 'length') indexProbes += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    expectRiskInputError(
      () =>
        selectRiskSnapshotBundle(
          {
            fx: oversized,
            margin: [],
            eligibility: [],
            costs: [],
          },
          query,
        ),
      'INVALID_RISK_INPUT',
      { field: 'fx', length: 10_001, limit: 10_000 },
    );
    expect(indexProbes).toBe(0);
  });

  it('accepts a causally irrelevant snapshot series at the 10,000-item limit', () => {
    const future = routingOnlyRecord({
      observedAt: '2026-01-02T10:00:00Z',
    }) as unknown as FxSnapshotInput;
    const fx = Array.from({ length: 10_000 }, () => future);

    expect(
      selectRiskSnapshotBundle(
        { fx, margin: [], eligibility: [], costs: [] },
        query,
      ).fx,
    ).toBeNull();
  });

  it.each([null, [], 0, 'series', true, undefined])(
    'rejects runtime non-object selector series: %s',
    (series) => {
      expectRiskInputError(
        () =>
          selectRiskSnapshotBundle(
            series as unknown as RiskSnapshotSeriesInput,
            query,
          ),
        'INVALID_RISK_INPUT',
        { field: 'series' },
      );
    },
  );

  it.each([null, [], 0, 'query', true, undefined])(
    'rejects runtime non-object selector query: %s',
    (selectionQuery) => {
      expectRiskInputError(
        () =>
          selectRiskSnapshotBundle(
            { fx: [], margin: [], eligibility: [], costs: [] },
            selectionQuery as unknown as RiskSnapshotSelectionQueryInput,
          ),
        'INVALID_RISK_INPUT',
        { field: 'query' },
      );
    },
  );

  it('snapshots series and query properties once and converts thrown accessors', () => {
    const seriesReads: Record<string, number> = {};
    const sourceSeries: RiskSnapshotSeriesInput = {
      fx: [validFxInput],
      margin: [],
      eligibility: [],
      costs: [],
    };
    const series: Record<string, unknown> = {};
    for (const field of Object.keys(sourceSeries) as Array<
      keyof RiskSnapshotSeriesInput
    >) {
      Object.defineProperty(series, field, {
        enumerable: true,
        get: () => {
          seriesReads[field] = (seriesReads[field] ?? 0) + 1;
          return seriesReads[field] === 1 ? sourceSeries[field] : null;
        },
      });
    }

    expect(
      selectRiskSnapshotBundle(
        series as unknown as RiskSnapshotSeriesInput,
        query,
      ).fx?.rate,
    ).toBe('0.92');
    expect(seriesReads).toEqual({ fx: 1, margin: 1, eligibility: 1, costs: 1 });

    const queryReads: Record<string, number> = {};
    const accessorQuery: Record<string, unknown> = {};
    for (const field of Object.keys(query) as Array<
      keyof RiskSnapshotSelectionQueryInput
    >) {
      Object.defineProperty(accessorQuery, field, {
        enumerable: true,
        get: () => {
          queryReads[field] = (queryReads[field] ?? 0) + 1;
          return queryReads[field] === 1 ? query[field] : 'CHANGED';
        },
      });
    }
    expect(
      selectRiskSnapshotBundle(
        sourceSeries,
        accessorQuery as unknown as RiskSnapshotSelectionQueryInput,
      ).fx?.rate,
    ).toBe('0.92');
    expect(queryReads).toEqual({
      decisionAt: 1,
      contractId: 1,
      pnlCurrency: 1,
      accountCurrency: 1,
    });

    const throwingQuery = new Proxy(query, {
      getOwnPropertyDescriptor: () => {
        throw new Error('unexpected access');
      },
    });
    expectRiskInputError(
      () =>
        selectRiskSnapshotBundle(
          { fx: [], margin: [], eligibility: [], costs: [] },
          throwingQuery,
        ),
      'INVALID_RISK_INPUT',
      { field: 'decisionAt' },
    );
  });

  it('uses nanosecond Temporal comparison at the inclusive decision boundary', () => {
    const boundaryQuery = {
      ...query,
      decisionAt: '2026-01-02T09:00:00.000000001Z',
    };
    const selected = selectRiskSnapshotBundle(
      {
        fx: [
          at(validFxInput, '2026-01-02T09:00:00.000000001Z'),
          at(validFxInput, '2026-01-02T09:00:00.000000002Z'),
        ],
        margin: [],
        eligibility: [],
        costs: [],
      },
      boundaryQuery,
    );

    expect(
      Temporal.Instant.compare(
        selected.fx?.observedAt ?? '',
        boundaryQuery.decisionAt,
      ),
    ).toBe(0);
  });
});
