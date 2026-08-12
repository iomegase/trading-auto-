import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  assertM2ARiskSafetyAssertions,
  assertRiskPolicyDenormalizationMatches,
  createRiskPolicy,
  RiskInputError,
  type M2ARiskSafetyAssertions,
  type RiskPolicyDenormalizationInput,
  type RiskPolicyVersion,
} from '@trading-auto/risk';

const baseline = {
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

function invalid(run: () => unknown, field?: string): RiskInputError {
  let received: unknown;
  try {
    run();
  } catch (error) {
    received = error;
  }
  expect(received).toBeInstanceOf(RiskInputError);
  expect(received).toMatchObject({ code: 'INVALID_RISK_INPUT' });
  if (field !== undefined) {
    expect((received as RiskInputError).details).toMatchObject({ field });
  }
  return received as RiskInputError;
}

function withInheritedProperties(
  properties: Readonly<Record<string, unknown>>,
  run: () => void,
): void {
  const previous = new Map<string, PropertyDescriptor | undefined>();
  try {
    for (const [key, value] of Object.entries(properties)) {
      previous.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        value,
      });
    }
    run();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(Object.prototype, key);
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

function mirror(): RiskPolicyDenormalizationInput {
  return {
    riskPolicyVersion: baseline.version,
    referenceCurrency: baseline.referenceCurrency,
    accountCurrency: baseline.accountCurrency,
    initialCapital: 1000,
    maxSizingCapital: '1000',
    allowCashInjection: baseline.allowCashInjection,
    sizingEquityMode: baseline.sizingEquityMode,
    capIncreaseMode: baseline.capIncreaseMode,
    riskPerTradePct: 0.5,
    maxOpenRiskPct: 2,
    maxOpenPositions: 4,
    maxContractsPerPosition: 4,
    maxGrossExposurePct: 100,
    maxMarginUsagePct: 100,
    cashReservePct: 0,
    dailyLossLimitPct: 2,
    maxDrawdownPct: 10,
    riskGroupMaxExposurePct: {
      US_EQUITY_INDEX: 100,
      EUROPE_EQUITY_INDEX: '100',
    },
  };
}

describe('createRiskPolicy', () => {
  it('creates the exact approved baseline and exposes APPROVED only', () => {
    const policy = createRiskPolicy(baseline);

    expect(policy).toEqual(baseline);
    expectTypeOf(policy).toEqualTypeOf<RiskPolicyVersion>();
    expectTypeOf(policy.approvalStatus).toEqualTypeOf<'APPROVED'>();
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.riskGroupMaxExposurePct)).toBe(true);
    expect(() => {
      (policy.riskGroupMaxExposurePct as Record<string, string>).NEW = '1';
    }).toThrow(TypeError);
  });

  it('accepts manually versioned lower and higher positive sizing caps', () => {
    expect(
      createRiskPolicy({
        ...baseline,
        version: 'CAP_800',
        maxSizingCapital: '800',
      }).maxSizingCapital,
    ).toBe('800');
    expect(
      createRiskPolicy({
        ...baseline,
        version: 'CAP_1200',
        maxSizingCapital: '1200',
      }).maxSizingCapital,
    ).toBe('1200');
  });

  it.each([null, [], 'policy', 1, true])(
    'rejects non-object inputs: %j',
    (value) => {
      invalid(() => createRiskPolicy(value as never), 'input');
    },
  );

  it('rejects non-plain policy objects and accepts null-prototype records', () => {
    class ForgedPolicy {
      readonly forged = true;
    }
    Object.assign(ForgedPolicy.prototype, baseline);
    invalid(() => createRiskPolicy(new ForgedPolicy() as never), 'input');

    const nullPrototype = Object.assign(
      Object.create(null) as object,
      baseline,
    );
    expect(createRiskPolicy(nullPrototype as never)).toEqual(baseline);
  });

  it('snapshots every top-level property exactly once', () => {
    const reads = new Map<string, number>();
    const input = {} as Record<string, unknown>;
    for (const [key, value] of Object.entries(baseline)) {
      Object.defineProperty(input, key, {
        enumerable: true,
        get() {
          reads.set(key, (reads.get(key) ?? 0) + 1);
          return value;
        },
      });
    }

    expect(createRiskPolicy(input as never)).toEqual(baseline);
    expect([...reads.values()].every((count) => count === 1)).toBe(true);
  });

  it('rejects inherited required policy fields', () => {
    const input = { ...baseline } as Record<string, unknown>;
    Reflect.deleteProperty(input, 'version');
    withInheritedProperties({ version: baseline.version }, () => {
      invalid(() => createRiskPolicy(input as never), 'version');
    });
  });

  it('maps unreadable required ownership checks to RiskInputError', () => {
    const input = new Proxy(
      { ...baseline },
      {
        getOwnPropertyDescriptor() {
          throw new Error('boom');
        },
      },
    );
    invalid(() => createRiskPolicy(input), 'version');
  });

  it('converts throwing getters and hostile proxies to stable input errors', () => {
    const getter = { ...baseline } as Record<string, unknown>;
    Object.defineProperty(getter, 'version', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    invalid(() => createRiskPolicy(getter as never), 'version');

    invalid(
      () =>
        createRiskPolicy(
          new Proxy(
            { ...baseline },
            {
              getPrototypeOf() {
                throw new Error('boom');
              },
            },
          ),
        ),
      'input',
    );
  });

  it.each([
    ['version', '   '],
    ['approvedBy', '\t'],
    ['approvalStatus', 'DRAFT'],
    ['approvalStatus', 'RETIRED'],
    ['referenceCurrency', 'USD'],
    ['accountCurrency', 'USD'],
    ['allowCashInjection', true],
    ['sizingEquityMode', 'REALIZED_ONLY'],
    ['capIncreaseMode', 'AUTOMATIC'],
  ])('rejects unsupported %s values', (field, value) => {
    invalid(() => createRiskPolicy({ ...baseline, [field]: value }), field);
  });

  it.each(['900', '1000.01', '1000.0', 'not-a-decimal'])(
    'rejects non-exact initial capital %s',
    (value) => {
      invalid(
        () => createRiskPolicy({ ...baseline, initialCapital: value }),
        'initialCapital',
      );
    },
  );

  it.each(['0', '-1', '-0'])(
    'rejects nonpositive maxSizingCapital %s',
    (value) => {
      invalid(
        () => createRiskPolicy({ ...baseline, maxSizingCapital: value }),
        'maxSizingCapital',
      );
    },
  );

  it.each([
    ['riskPerTradePct', '-0'],
    ['riskPerTradePct', '-1'],
    ['riskPerTradePct', '100.1'],
    ['maxOpenRiskPct', '1e2'],
    ['maxMarginUsagePct', '101'],
    ['cashReservePct', '-0'],
    ['dailyLossLimitPct', '101'],
    ['maxDrawdownPct', '-1'],
    ['maxGrossExposurePct', '0'],
    ['maxGrossExposurePct', '-0'],
  ])('rejects invalid decimal policy field %s=%s', (field, value) => {
    invalid(() => createRiskPolicy({ ...baseline, [field]: value }), field);
  });

  it('allows an explicit gross exposure percentage above 100', () => {
    expect(
      createRiskPolicy({ ...baseline, maxGrossExposurePct: '250' })
        .maxGrossExposurePct,
    ).toBe('250');
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid maxOpenPositions %s',
    (value) => {
      invalid(
        () => createRiskPolicy({ ...baseline, maxOpenPositions: value }),
        'maxOpenPositions',
      );
    },
  );

  it.each(['0', '-0', '-1', '1.5', '01'])(
    'rejects invalid max contracts %s',
    (value) => {
      invalid(
        () =>
          createRiskPolicy({
            ...baseline,
            maxContractsPerPosition: value,
          }),
        'maxContractsPerPosition',
      );
    },
  );

  it.each([
    ['approvedAt', 1],
    ['approvedAt', '2026-01-01T01:00:00+01:00'],
    ['activatedAt', '2026-01-01T00:00:00.000Z'],
    ['approvedAt', 'not-an-instant'],
  ])('rejects a noncanonical instant in %s', (field, value) => {
    invalid(() => createRiskPolicy({ ...baseline, [field]: value }), field);
  });

  it('rejects activation before approval', () => {
    invalid(
      () =>
        createRiskPolicy({
          ...baseline,
          approvedAt: '2026-01-02T00:00:00Z',
          activatedAt: '2026-01-01T00:00:00Z',
        }),
      'activatedAt',
    );
  });

  it.each([
    {},
    { '': '1' },
    { '  ': '1' },
    { EU: '-0' },
    { EU: '101' },
    { EU: '1', ' EU ': '1' },
  ])('rejects invalid risk-group maps', (riskGroupMaxExposurePct) => {
    invalid(() => createRiskPolicy({ ...baseline, riskGroupMaxExposurePct }));
  });

  it('rejects non-plain, unreadable, and oversized risk-group maps', () => {
    invalid(
      () =>
        createRiskPolicy({
          ...baseline,
          riskGroupMaxExposurePct: new Map(),
        } as never),
      'riskGroupMaxExposurePct',
    );
    invalid(
      () =>
        createRiskPolicy({
          ...baseline,
          riskGroupMaxExposurePct: new Proxy(
            {},
            {
              ownKeys() {
                throw new Error('boom');
              },
            },
          ),
        }),
      'riskGroupMaxExposurePct',
    );
    const oversized = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [
        `GROUP_${String(index)}`,
        '1',
      ]),
    );
    invalid(
      () =>
        createRiskPolicy({
          ...baseline,
          riskGroupMaxExposurePct: oversized,
        }),
      'riskGroupMaxExposurePct',
    );
    const nullPrototype = Object.assign(Object.create(null) as object, {
      EU: '1',
    });
    expect(
      createRiskPolicy({
        ...baseline,
        riskGroupMaxExposurePct: nullPrototype,
      }).riskGroupMaxExposurePct,
    ).toEqual({ EU: '1' });
  });

  it('reads each risk-group value once', () => {
    let reads = 0;
    const groups = {} as Record<string, unknown>;
    Object.defineProperty(groups, 'EU', {
      enumerable: true,
      get() {
        reads += 1;
        return '50';
      },
    });
    expect(
      createRiskPolicy({
        ...baseline,
        riskGroupMaxExposurePct: groups,
      } as never).riskGroupMaxExposurePct,
    ).toEqual({ EU: '50' });
    expect(reads).toBe(1);
  });

  it('preserves reserved risk-group keys as safe own enumerable values', () => {
    const groups: Record<string, unknown> = {};
    for (const [key, value] of [
      ['__proto__', '25'],
      ['constructor', '50'],
      ['toString', '75'],
    ] as const) {
      Object.defineProperty(groups, key, {
        enumerable: true,
        value,
      });
    }

    const policy = createRiskPolicy({
      ...baseline,
      riskGroupMaxExposurePct: groups,
    } as never);

    expect(Object.keys(policy.riskGroupMaxExposurePct)).toEqual([
      '__proto__',
      'constructor',
      'toString',
    ]);
    expect(Object.hasOwn(policy.riskGroupMaxExposurePct, '__proto__')).toBe(
      true,
    );
    expect(policy.riskGroupMaxExposurePct.__proto__).toBe('25');
    expect(policy.riskGroupMaxExposurePct.constructor).toBe('50');
    expect(
      Object.getOwnPropertyDescriptor(
        policy.riskGroupMaxExposurePct,
        'toString',
      )?.value,
    ).toBe('75');
    expect(Object.getPrototypeOf(policy.riskGroupMaxExposurePct)).toBe(
      Object.prototype,
    );
    expect(Object.isFrozen(policy.riskGroupMaxExposurePct)).toBe(true);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    assertRiskPolicyDenormalizationMatches(policy, {
      riskPolicyVersion: policy.version,
      riskGroupMaxExposurePct: groups as never,
    });
  });

  it.each(['1'.repeat(257), `0.${'1'.repeat(129)}`])(
    'rejects decimals beyond the documented arithmetic bound',
    (value) => {
      invalid(
        () => createRiskPolicy({ ...baseline, maxSizingCapital: value }),
        'maxSizingCapital',
      );
    },
  );
});

describe('assertRiskPolicyDenormalizationMatches', () => {
  const mismatchCases: readonly [string, unknown][] = [
    ['riskPolicyVersion', 'OTHER'],
    ['referenceCurrency', 'USD'],
    ['accountCurrency', 'USD'],
    ['initialCapital', 999],
    ['maxSizingCapital', 1200],
    ['allowCashInjection', true],
    ['sizingEquityMode', 'OTHER'],
    ['capIncreaseMode', 'OTHER'],
    ['riskPerTradePct', 0.6],
    ['maxOpenRiskPct', 3],
    ['maxOpenPositions', 5],
    ['maxContractsPerPosition', 5],
    ['maxGrossExposurePct', 101],
    ['maxMarginUsagePct', 99],
    ['cashReservePct', 1],
    ['dailyLossLimitPct', 3],
    ['maxDrawdownPct', 11],
    ['riskGroupMaxExposurePct', { EUROPE_EQUITY_INDEX: 100 }],
    [
      'riskGroupMaxExposurePct',
      { EUROPE_EQUITY_INDEX: 100, US_EQUITY_INDEX: 99 },
    ],
  ];

  it('accepts exact raw JSON mirrors independent of risk-group key order', () => {
    const policy = createRiskPolicy(baseline);
    assertRiskPolicyDenormalizationMatches(policy, mirror());
    assertRiskPolicyDenormalizationMatches(policy, {
      riskPolicyVersion: baseline.version,
    });
  });

  it('requires an own riskPolicyVersion and ignores inherited optional mirrors', () => {
    const policy = createRiskPolicy(baseline);
    withInheritedProperties({ riskPolicyVersion: baseline.version }, () => {
      invalid(() => {
        assertRiskPolicyDenormalizationMatches(policy, {} as never);
      }, 'riskPolicyVersion');
    });
    withInheritedProperties({ maxSizingCapital: '1200' }, () => {
      assertRiskPolicyDenormalizationMatches(policy, {
        riskPolicyVersion: baseline.version,
      });
    });
  });

  it('maps unreadable optional mirror ownership checks to RiskInputError', () => {
    const input = new Proxy(
      { riskPolicyVersion: baseline.version },
      {
        getOwnPropertyDescriptor(target, field) {
          if (field === 'riskPolicyVersion') {
            return Reflect.getOwnPropertyDescriptor(target, field);
          }
          throw new Error('boom');
        },
      },
    );
    invalid(() => {
      assertRiskPolicyDenormalizationMatches(createRiskPolicy(baseline), input);
    }, 'referenceCurrency');
  });

  it.each(mismatchCases)('rejects a mismatch in %s', (field, value) => {
    invalid(() => {
      assertRiskPolicyDenormalizationMatches(createRiskPolicy(baseline), {
        ...mirror(),
        [field]: value,
      });
    }, field);
  });

  it.each([NaN, Infinity, -Infinity, -0, 1e21, Number.MAX_SAFE_INTEGER + 1])(
    'rejects ambiguous numeric mirrors: %s',
    (value) => {
      invalid(() => {
        assertRiskPolicyDenormalizationMatches(createRiskPolicy(baseline), {
          riskPolicyVersion: baseline.version,
          maxSizingCapital: value,
        });
      }, 'maxSizingCapital');
    },
  );

  it('rejects exponent-rendered fractional numbers and unknown complete risk groups', () => {
    invalid(() => {
      assertRiskPolicyDenormalizationMatches(createRiskPolicy(baseline), {
        riskPolicyVersion: baseline.version,
        riskPerTradePct: 1e-7,
      });
    }, 'riskPerTradePct');
    invalid(() => {
      assertRiskPolicyDenormalizationMatches(createRiskPolicy(baseline), {
        riskPolicyVersion: baseline.version,
        riskGroupMaxExposurePct: {
          EUROPE_EQUITY_INDEX: 100,
          UNKNOWN: 100,
        },
      });
    }, 'riskGroupMaxExposurePct');
  });

  it.each([null, [], 'mirror'])(
    'rejects runtime mirror nonobjects',
    (value) => {
      invalid(() => {
        assertRiskPolicyDenormalizationMatches(
          createRiskPolicy(baseline),
          value as never,
        );
      }, 'input');
    },
  );

  it('snapshots mirror getters once and converts throwing getters', () => {
    let reads = 0;
    const exact = {
      get riskPolicyVersion() {
        reads += 1;
        return baseline.version;
      },
    };
    assertRiskPolicyDenormalizationMatches(createRiskPolicy(baseline), exact);
    expect(reads).toBe(1);

    const hostile = {
      get riskPolicyVersion(): string {
        throw new Error('boom');
      },
    };
    invalid(() => {
      assertRiskPolicyDenormalizationMatches(
        createRiskPolicy(baseline),
        hostile,
      );
    }, 'riskPolicyVersion');
  });
});

describe('assertM2ARiskSafetyAssertions', () => {
  const exact = {
    futuresEligibility: 'RESEARCH_ONLY',
    requireExplicitGrossExposureLimit: true,
    includeEstimatedExitCosts: true,
    rejectIfMinQuantityExceedsRiskBudget: true,
  } as const;

  it('returns immutable exact assertions', () => {
    const result = assertM2ARiskSafetyAssertions(exact);
    expect(result).toEqual(exact);
    expectTypeOf(result).toEqualTypeOf<M2ARiskSafetyAssertions>();
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ['futuresEligibility', 'LIVE'],
    ['requireExplicitGrossExposureLimit', false],
    ['includeEstimatedExitCosts', false],
    ['rejectIfMinQuantityExceedsRiskBudget', false],
  ])('rejects independent safety mismatch %s', (field, value) => {
    invalid(
      () => assertM2ARiskSafetyAssertions({ ...exact, [field]: value }),
      field,
    );
  });

  it('reads assertions once and handles casts/accessors safely', () => {
    const reads = new Map<string, number>();
    const input = {} as Record<string, unknown>;
    for (const [key, value] of Object.entries(exact)) {
      Object.defineProperty(input, key, {
        enumerable: true,
        configurable: true,
        get() {
          reads.set(key, (reads.get(key) ?? 0) + 1);
          return value;
        },
      });
    }
    expect(assertM2ARiskSafetyAssertions(input as never)).toEqual(exact);
    expect([...reads.values()].every((count) => count === 1)).toBe(true);

    Object.defineProperty(input, 'futuresEligibility', {
      configurable: true,
      get() {
        throw new Error('boom');
      },
    });
    invalid(
      () => assertM2ARiskSafetyAssertions(input as never),
      'futuresEligibility',
    );
  });

  it('rejects inherited safety assertion fields', () => {
    withInheritedProperties(exact, () => {
      invalid(
        () => assertM2ARiskSafetyAssertions({} as never),
        'futuresEligibility',
      );
    });
  });

  it.each([null, [], 'assertions'])(
    'rejects runtime assertion nonobjects',
    (value) => {
      invalid(() => assertM2ARiskSafetyAssertions(value as never), 'input');
    },
  );
});
