import {
  asCurrencyCode,
  asDecimalString,
  createFuturesProduct,
  type FuturesProductInput,
} from '@trading-auto/domain';
import { Decimal } from 'decimal.js';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  calculateCandidateEconomics,
  calculateFee,
  createCostModelSnapshot,
  createFxSnapshot,
  createMarginSnapshot,
  resolveFxRate,
  RiskInputError,
  type CandidateEconomics,
  type CostModelSnapshotInput,
  type FeeSchedule,
  type FeeScheduleInput,
  type FxSnapshotInput,
  type MarginSnapshotInput,
} from './index.js';

const VerificationDecimal = Decimal.clone({
  precision: 512,
  maxE: 9e15,
  minE: -9e15,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});
const MAX_PUBLIC_FRACTION_DIGITS = 128;

function fractionDigits(value: string): number {
  const point = value.indexOf('.');
  return point === -1 ? 0 : value.length - point - 1;
}

function roundedUpAtPublicScale(
  value: InstanceType<typeof VerificationDecimal>,
): string {
  return value
    .toDecimalPlaces(MAX_PUBLIC_FRACTION_DIGITS, Decimal.ROUND_UP)
    .toFixed();
}

const metadata = {
  version: 'v1',
  source: 'test-provider',
  observedAt: '2026-01-02T08:00:00Z',
  validFrom: '2026-01-02T07:00:00Z',
  validUntil: '2026-01-03T07:00:00Z',
} as const;

const zeroFees: FeeScheduleInput = {
  minimum: '0',
  tiers: [{ upToQuantity: null, feePerContract: '0' }],
};

const syntheticFdxsProductInput: FuturesProductInput = {
  productCode: 'FDXS',
  exchange: 'EUREX',
  underlyingId: 'DAX',
  quoteCurrency: 'EUR',
  pnlCurrency: 'EUR',
  tickSize: '0.5',
  tickValue: '0.5',
  monetaryValuePerPriceUnit: '1',
  quantityStep: '1',
  minQuantity: '1',
  riskGroup: 'EU_EQUITY_INDEX',
};

const syntheticMesProductInput: FuturesProductInput = {
  productCode: 'MES',
  exchange: 'CME',
  underlyingId: 'SP500',
  quoteCurrency: 'USD',
  pnlCurrency: 'USD',
  tickSize: '0.25',
  tickValue: '1.25',
  monetaryValuePerPriceUnit: '5',
  quantityStep: '1',
  minQuantity: '1',
  riskGroup: 'US_EQUITY_INDEX',
};

const syntheticFdxsProduct = createFuturesProduct(syntheticFdxsProductInput);
const syntheticMesProduct = createFuturesProduct(syntheticMesProductInput);

function marginInput(
  overrides: Partial<MarginSnapshotInput> = {},
): MarginSnapshotInput {
  return {
    ...metadata,
    contractId: 'FDXSH26',
    currency: 'EUR',
    initialMarginPerContract: '10',
    maintenanceMarginPerContract: '8',
    ...overrides,
  };
}

function costInput(
  overrides: Partial<CostModelSnapshotInput> = {},
): CostModelSnapshotInput {
  return {
    ...metadata,
    contractId: 'FDXSH26',
    currency: 'EUR',
    entryFees: zeroFees,
    exitFees: zeroFees,
    spreadPriceUnitsRoundTrip: '0',
    adverseEntrySlippagePriceUnits: '0',
    adverseExitSlippagePriceUnits: '0',
    ...overrides,
  };
}

function fxInput(overrides: Partial<FxSnapshotInput> = {}): FxSnapshotInput {
  return {
    ...metadata,
    baseCurrency: 'USD',
    quoteCurrency: 'EUR',
    rate: '0.8',
    ...overrides,
  };
}

function baseCandidateInput() {
  return {
    direction: 'LONG' as const,
    entryPrice: asDecimalString('100'),
    stopPrice: asDecimalString('98'),
    quantity: asDecimalString('2'),
    product: syntheticFdxsProduct,
    accountCurrency: asCurrencyCode('EUR'),
    fx: null,
    margin: createMarginSnapshot(marginInput()),
    costs: createCostModelSnapshot(costInput()),
  };
}

function expectRiskInputError(
  action: () => unknown,
  code?: string,
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
    ...(code === undefined ? {} : { code }),
  });
  return received as RiskInputError;
}

describe('resolveFxRate', () => {
  it('requires null for identity EUR without reading a supplied FX snapshot', () => {
    let reads = 0;
    const unreadable = new Proxy(
      {},
      {
        get: () => {
          reads += 1;
          throw new Error('must not read identity FX');
        },
      },
    );

    expectRiskInputError(
      () =>
        resolveFxRate(
          asCurrencyCode('EUR'),
          asCurrencyCode('EUR'),
          unreadable as never,
        ),
      'INVALID_RISK_INPUT',
    );
    expect(reads).toBe(0);
    expect(
      resolveFxRate(asCurrencyCode('EUR'), asCurrencyCode('EUR'), null),
    ).toBe('1');
  });

  it('resolves a direct USD/EUR rate canonically', () => {
    const fx = createFxSnapshot(fxInput({ rate: '0.8000' }));

    expect(
      resolveFxRate(asCurrencyCode('USD'), asCurrencyCode('EUR'), fx),
    ).toBe('0.8');
  });

  it('resolves an inverse EUR/USD rate exactly when representable', () => {
    const fx = createFxSnapshot(fxInput({ rate: '0.8' }));

    expect(
      resolveFxRate(asCurrencyCode('EUR'), asCurrencyCode('USD'), fx),
    ).toBe('1.25');
  });

  it('rejects missing, unrelated, and malformed relevant FX snapshots stably', () => {
    expectRiskInputError(
      () => resolveFxRate(asCurrencyCode('USD'), asCurrencyCode('EUR'), null),
      'MISMATCHED_CURRENCY',
    );

    expectRiskInputError(
      () =>
        resolveFxRate(
          asCurrencyCode('GBP'),
          asCurrencyCode('EUR'),
          createFxSnapshot(fxInput()),
        ),
      'MISMATCHED_CURRENCY',
    );

    expectRiskInputError(
      () =>
        resolveFxRate(asCurrencyCode('USD'), asCurrencyCode('EUR'), {
          ...createFxSnapshot(fxInput()),
          rate: '-0',
        } as never),
      'INVALID_RISK_INPUT',
    );
  });

  it('rounds a non-terminating inverse upward at the bounded public scale', () => {
    const fx = createFxSnapshot(fxInput({ rate: '1.17' }));
    const inverse = resolveFxRate(
      asCurrencyCode('EUR'),
      asCurrencyCode('USD'),
      fx,
    );
    const repeated = resolveFxRate(
      asCurrencyCode('EUR'),
      asCurrencyCode('USD'),
      fx,
    );
    const returned = new VerificationDecimal(inverse);
    const source = new VerificationDecimal('1.17');
    const exact = new VerificationDecimal('1').div(source);
    const lastPlaceUnit = new VerificationDecimal(
      `0.${'0'.repeat(MAX_PUBLIC_FRACTION_DIGITS - 1)}1`,
    );

    expect(inverse).toMatch(/^(0|[1-9]\d*)(\.\d+)?$/);
    expect(repeated).toBe(inverse);
    expect(fractionDigits(inverse)).toBeLessThanOrEqual(
      MAX_PUBLIC_FRACTION_DIGITS,
    );
    expect(returned.times(source).gte(1)).toBe(true);
    expect(returned.gte(exact)).toBe(true);
    expect(returned.minus(exact).lt(lastPlaceUnit)).toBe(true);
  });

  it('validates forged currencies at runtime', () => {
    expectRiskInputError(
      () =>
        resolveFxRate(
          'usd' as never,
          asCurrencyCode('EUR'),
          createFxSnapshot(fxInput()),
        ),
      'INVALID_RISK_INPUT',
    );
  });
});

describe('calculateFee', () => {
  const tieredSchedule = createCostModelSnapshot(
    costInput({
      entryFees: {
        minimum: '0',
        tiers: [
          { upToQuantity: '2', feePerContract: '1' },
          { upToQuantity: '5', feePerContract: '0.8' },
          { upToQuantity: null, feePerContract: '0.5' },
        ],
      },
    }),
  ).entryFees;

  it('charges ordered tiers marginally across boundaries', () => {
    expect(calculateFee(asDecimalString('1'), tieredSchedule)).toBe('1');
    expect(calculateFee(asDecimalString('2'), tieredSchedule)).toBe('2');
    expect(calculateFee(asDecimalString('5'), tieredSchedule)).toBe('4.4');
    expect(calculateFee(asDecimalString('7'), tieredSchedule)).toBe('5.4');
  });

  it('applies the per-side minimum after marginal charges', () => {
    const schedule = createCostModelSnapshot(
      costInput({
        entryFees: {
          minimum: '1.25',
          tiers: [{ upToQuantity: null, feePerContract: '0.1' }],
        },
      }),
    ).entryFees;

    expect(calculateFee(asDecimalString('1'), schedule)).toBe('1.25');
    expect(calculateFee(asDecimalString('20'), schedule)).toBe('2');
  });

  it.each(['0', '-0', '-1', '1.5', '1e0'])(
    'rejects non-positive or non-integer quantity %s',
    (quantity) => {
      expectRiskInputError(
        () => calculateFee(quantity as never, tieredSchedule),
        'INVALID_RISK_INPUT',
      );
    },
  );

  it('revalidates forged fee schedules and bounds tier iteration', () => {
    const invalidSchedules: unknown[] = [
      null,
      {},
      { minimum: '-0', tiers: [{ upToQuantity: null, feePerContract: '1' }] },
      { minimum: '0', tiers: [] },
      {
        minimum: '0',
        tiers: [
          { upToQuantity: '2', feePerContract: '1' },
          { upToQuantity: '2', feePerContract: '1' },
          { upToQuantity: null, feePerContract: '1' },
        ],
      },
    ];

    for (const schedule of invalidSchedules) {
      expectRiskInputError(
        () =>
          calculateFee(asDecimalString('1'), schedule as Readonly<FeeSchedule>),
        'INVALID_RISK_INPUT',
      );
    }

    const oversizedTiers = Array.from({ length: 257 }, () => ({
      upToQuantity: null,
      feePerContract: asDecimalString('0'),
    }));
    expectRiskInputError(
      () =>
        calculateFee(asDecimalString('1'), {
          minimum: asDecimalString('0'),
          tiers: oversizedTiers,
        }),
      'INVALID_RISK_INPUT',
    );

    const sparseTiers = new Array<FeeSchedule['tiers'][number]>(1);
    const ownPropertyFailure = new Proxy(
      [{ upToQuantity: null, feePerContract: asDecimalString('0') }],
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('hostile own-property trap');
        },
      },
    );
    const revokedTiers = Proxy.revocable([], {});
    revokedTiers.revoke();

    for (const tiers of [
      {},
      sparseTiers,
      ownPropertyFailure,
      revokedTiers.proxy,
    ]) {
      expectRiskInputError(
        () =>
          calculateFee(asDecimalString('1'), {
            minimum: asDecimalString('0'),
            tiers: tiers as FeeSchedule['tiers'],
          }),
        'INVALID_RISK_INPUT',
      );
    }
  });

  it('converts proxy failures into stable risk errors', () => {
    const unreadableSchedule = new Proxy(
      {},
      {
        get: () => {
          throw new Error('hostile getter');
        },
      },
    );

    expectRiskInputError(
      () =>
        calculateFee(
          asDecimalString('1'),
          unreadableSchedule as Readonly<FeeSchedule>,
        ),
      'INVALID_RISK_INPUT',
    );
  });

  it('rejects inherited fee schedule fields under Object.prototype pollution', () => {
    const previousMinimum = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'minimum',
    );
    const previousTiers = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'tiers',
    );

    try {
      Object.defineProperty(Object.prototype, 'minimum', {
        configurable: true,
        value: '0',
      });
      Object.defineProperty(Object.prototype, 'tiers', {
        configurable: true,
        value: [{ upToQuantity: null, feePerContract: '7' }],
      });

      expectRiskInputError(
        () => calculateFee(asDecimalString('2'), {} as Readonly<FeeSchedule>),
        'INVALID_RISK_INPUT',
      );
    } finally {
      if (previousMinimum === undefined) {
        Reflect.deleteProperty(Object.prototype, 'minimum');
      } else {
        Object.defineProperty(Object.prototype, 'minimum', previousMinimum);
      }
      if (previousTiers === undefined) {
        Reflect.deleteProperty(Object.prototype, 'tiers');
      } else {
        Object.defineProperty(Object.prototype, 'tiers', previousTiers);
      }
    }
  });

  it('rejects an inherited required fee tier field', () => {
    const inheritedTier = Object.assign(
      Object.create({ feePerContract: '7' }) as Record<string, unknown>,
      { upToQuantity: null },
    );

    expectRiskInputError(
      () =>
        calculateFee(asDecimalString('2'), {
          minimum: asDecimalString('0'),
          tiers: [inheritedTier as never],
        }),
      'INVALID_RISK_INPUT',
    );
  });

  it('uses the captured own schedule descriptors without prototype fallback', () => {
    const target = Object.assign(
      Object.create({
        minimum: '0',
        tiers: [{ upToQuantity: null, feePerContract: '7' }],
      }) as Record<string, unknown>,
      {
        minimum: '0',
        tiers: [{ upToQuantity: null, feePerContract: '1' }],
      },
    );
    const deletingDescriptorProxy = new Proxy(target, {
      getOwnPropertyDescriptor: (proxiedTarget, property) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(
          proxiedTarget,
          property,
        );
        Reflect.deleteProperty(proxiedTarget, property);
        return descriptor;
      },
    });

    expect(
      calculateFee(asDecimalString('2'), deletingDescriptorProxy as never),
    ).toBe('2');
  });
});

describe('calculateCandidateEconomics', () => {
  it('calculates a synthetic FDXS contract exactly', () => {
    const result = calculateCandidateEconomics(baseCandidateInput());

    expectTypeOf(result).toEqualTypeOf<CandidateEconomics>();
    expect(result).toEqual({
      quantity: '2',
      directionalLossAccount: '4',
      estimatedCostsAccount: '0',
      worstCaseBudgetedLossAccount: '4',
      initialMarginAccount: '20',
      maintenanceMarginAccount: '16',
      grossExposureAccount: '200',
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('calculates a synthetic MES contract through direct USD/EUR FX', () => {
    const result = calculateCandidateEconomics({
      direction: 'LONG',
      entryPrice: asDecimalString('100'),
      stopPrice: asDecimalString('99'),
      quantity: asDecimalString('1'),
      product: syntheticMesProduct,
      accountCurrency: asCurrencyCode('EUR'),
      fx: createFxSnapshot(fxInput()),
      margin: createMarginSnapshot(
        marginInput({
          contractId: 'MESH26',
          currency: 'USD',
          initialMarginPerContract: '20',
          maintenanceMarginPerContract: '15',
        }),
      ),
      costs: createCostModelSnapshot(
        costInput({ contractId: 'MESH26', currency: 'USD' }),
      ),
    });

    expect(result).toMatchObject({
      directionalLossAccount: '4',
      initialMarginAccount: '16',
      maintenanceMarginAccount: '12',
      grossExposureAccount: '400',
    });
  });

  it('calculates a complete MES contract conservatively through recurring inverse FX', () => {
    const inverseFx = createFxSnapshot(
      fxInput({
        baseCurrency: 'EUR',
        quoteCurrency: 'USD',
        rate: '1.17',
      }),
    );
    const result = calculateCandidateEconomics({
      direction: 'LONG',
      entryPrice: asDecimalString('100'),
      stopPrice: asDecimalString('99'),
      quantity: asDecimalString('1'),
      product: syntheticMesProduct,
      accountCurrency: asCurrencyCode('EUR'),
      fx: inverseFx,
      margin: createMarginSnapshot(
        marginInput({
          contractId: 'MESH26',
          currency: 'USD',
          initialMarginPerContract: '20',
          maintenanceMarginPerContract: '15',
        }),
      ),
      costs: createCostModelSnapshot(
        costInput({
          contractId: 'MESH26',
          currency: 'USD',
          spreadPriceUnitsRoundTrip: '0.25',
        }),
      ),
    });
    const inverse = new VerificationDecimal(
      resolveFxRate(asCurrencyCode('USD'), asCurrencyCode('EUR'), inverseFx),
    );

    expect(result).toMatchObject({
      directionalLossAccount: roundedUpAtPublicScale(inverse.times('5')),
      estimatedCostsAccount: roundedUpAtPublicScale(inverse.times('1.25')),
      initialMarginAccount: roundedUpAtPublicScale(inverse.times('20')),
      maintenanceMarginAccount: roundedUpAtPublicScale(inverse.times('15')),
      grossExposureAccount: roundedUpAtPublicScale(inverse.times('500')),
    });
    for (const value of [
      result.quantity,
      result.directionalLossAccount,
      result.estimatedCostsAccount,
      result.worstCaseBudgetedLossAccount,
      result.initialMarginAccount,
      result.maintenanceMarginAccount,
      result.grossExposureAccount,
    ]) {
      expect(fractionDigits(value)).toBeLessThanOrEqual(
        MAX_PUBLIC_FRACTION_DIGITS,
      );
    }
    expect(
      new VerificationDecimal(result.directionalLossAccount).gte(
        new VerificationDecimal('5').div('1.17'),
      ),
    ).toBe(true);
  });

  it('rejects every non-null FX input for identity economics without reading it', () => {
    expectRiskInputError(
      () =>
        calculateCandidateEconomics({
          ...baseCandidateInput(),
          fx: createFxSnapshot(fxInput()),
        }),
      'INVALID_RISK_INPUT',
    );

    let reads = 0;
    const unreadable = new Proxy(
      {},
      {
        get: () => {
          reads += 1;
          throw new Error('identity economics must not read FX');
        },
      },
    );
    expectRiskInputError(
      () =>
        calculateCandidateEconomics({
          ...baseCandidateInput(),
          fx: unreadable as never,
        }),
      'INVALID_RISK_INPUT',
    );
    expect(reads).toBe(0);
  });

  it('adds marginal fees, per-side minima, spread, and both adverse slippages', () => {
    const result = calculateCandidateEconomics({
      ...baseCandidateInput(),
      entryPrice: asDecimalString('100'),
      stopPrice: asDecimalString('99'),
      quantity: asDecimalString('4'),
      product: createFuturesProduct({
        ...syntheticFdxsProductInput,
        tickSize: '0.25',
        tickValue: '0.5',
        monetaryValuePerPriceUnit: '2',
      }),
      margin: createMarginSnapshot(
        marginInput({
          initialMarginPerContract: '20',
          maintenanceMarginPerContract: '15',
        }),
      ),
      costs: createCostModelSnapshot(
        costInput({
          entryFees: {
            minimum: '2.5',
            tiers: [
              { upToQuantity: '2', feePerContract: '1' },
              { upToQuantity: null, feePerContract: '0.5' },
            ],
          },
          exitFees: {
            minimum: '2',
            tiers: [{ upToQuantity: null, feePerContract: '0.25' }],
          },
          spreadPriceUnitsRoundTrip: '0.5',
          adverseEntrySlippagePriceUnits: '0.25',
          adverseExitSlippagePriceUnits: '0.25',
        }),
      ),
    });

    expect(result).toEqual({
      quantity: '4',
      directionalLossAccount: '8',
      estimatedCostsAccount: '13',
      worstCaseBudgetedLossAccount: '21',
      initialMarginAccount: '80',
      maintenanceMarginAccount: '60',
      grossExposureAccount: '800',
    });
  });

  it('converts round-trip fees when the shared P&L currency differs from the account', () => {
    const result = calculateCandidateEconomics({
      direction: 'LONG',
      entryPrice: asDecimalString('100'),
      stopPrice: asDecimalString('99'),
      quantity: asDecimalString('1'),
      product: syntheticMesProduct,
      accountCurrency: asCurrencyCode('EUR'),
      fx: createFxSnapshot(fxInput()),
      margin: createMarginSnapshot(
        marginInput({
          contractId: 'MESH26',
          currency: 'USD',
          initialMarginPerContract: '20',
          maintenanceMarginPerContract: '15',
        }),
      ),
      costs: createCostModelSnapshot(
        costInput({
          contractId: 'MESH26',
          currency: 'USD',
          entryFees: {
            minimum: '1',
            tiers: [{ upToQuantity: null, feePerContract: '0' }],
          },
          exitFees: {
            minimum: '2',
            tiers: [{ upToQuantity: null, feePerContract: '0' }],
          },
        }),
      ),
    });

    expect(result.estimatedCostsAccount).toBe('2.4');
    expect(result.worstCaseBudgetedLossAccount).toBe('6.4');
  });

  it('supports SHORT only with a stop strictly above the entry', () => {
    const result = calculateCandidateEconomics({
      ...baseCandidateInput(),
      direction: 'SHORT',
      entryPrice: asDecimalString('100'),
      stopPrice: asDecimalString('101'),
      quantity: asDecimalString('1'),
    });

    expect(result.directionalLossAccount).toBe('1');
  });

  it.each([
    ['LONG', '100', '100'],
    ['LONG', '100', '101'],
    ['SHORT', '100', '100'],
    ['SHORT', '100', '99'],
  ] as const)(
    'rejects invalid %s stop direction from %s to %s',
    (direction, entryPrice, stopPrice) => {
      expectRiskInputError(
        () =>
          calculateCandidateEconomics({
            ...baseCandidateInput(),
            direction,
            entryPrice: asDecimalString(entryPrice),
            stopPrice: asDecimalString(stopPrice),
          }),
        'INVALID_RISK_INPUT',
      );
    },
  );

  it.each([
    ['entry', '100.1', '98'],
    ['stop', '100', '98.1'],
  ] as const)(
    'rejects %s prices not exactly aligned to the product tick',
    (_field, entryPrice, stopPrice) => {
      expectRiskInputError(
        () =>
          calculateCandidateEconomics({
            ...baseCandidateInput(),
            entryPrice: asDecimalString(entryPrice),
            stopPrice: asDecimalString(stopPrice),
          }),
        'INVALID_RISK_INPUT',
      );
    },
  );

  it.each([
    ['entryPrice', '0'],
    ['entryPrice', '-0'],
    ['entryPrice', '-1'],
    ['entryPrice', '1e2'],
    ['stopPrice', '0'],
    ['quantity', '0'],
    ['quantity', '-0'],
    ['quantity', '1.5'],
    ['entryPrice', 1],
  ] as const)('rejects forged %s value %s', (field, value) => {
    expectRiskInputError(
      () =>
        calculateCandidateEconomics({
          ...baseCandidateInput(),
          [field]: value,
        }),
      'INVALID_RISK_INPUT',
    );
  });

  it('accepts bounded trailing-zero decimals and emits canonical results', () => {
    const result = calculateCandidateEconomics({
      ...baseCandidateInput(),
      entryPrice: asDecimalString('100.00'),
      stopPrice: asDecimalString('98.00'),
      quantity: asDecimalString('2.0'),
    });

    expect(result.quantity).toBe('2');
    expect(result.directionalLossAccount).toBe('4');
  });

  it('requires an available conversion for every non-account currency', () => {
    expectRiskInputError(
      () =>
        calculateCandidateEconomics({
          ...baseCandidateInput(),
          product: syntheticMesProduct,
          quantity: asDecimalString('1'),
          margin: createMarginSnapshot(
            marginInput({ currency: 'USD', contractId: 'MESH26' }),
          ),
          costs: createCostModelSnapshot(
            costInput({ currency: 'USD', contractId: 'MESH26' }),
          ),
        }),
      'MISMATCHED_CURRENCY',
    );

    expectRiskInputError(
      () =>
        calculateCandidateEconomics({
          ...baseCandidateInput(),
          costs: createCostModelSnapshot(costInput({ currency: 'GBP' })),
          fx: createFxSnapshot(fxInput()),
        }),
      'MISMATCHED_CURRENCY',
    );
  });

  it.each([
    [
      'margin',
      createMarginSnapshot(marginInput({ currency: 'USD' })),
      createCostModelSnapshot(costInput()),
    ],
    [
      'costs',
      createMarginSnapshot(marginInput()),
      createCostModelSnapshot(costInput({ currency: 'USD' })),
    ],
  ] as const)(
    'rejects %s currency when it differs from product P&L currency',
    (_field, margin, costs) => {
      expectRiskInputError(
        () =>
          calculateCandidateEconomics({
            ...baseCandidateInput(),
            fx: createFxSnapshot(fxInput()),
            margin,
            costs,
          }),
        'MISMATCHED_CURRENCY',
      );
    },
  );

  it('requires margin and cost snapshots for the same contract', () => {
    expectRiskInputError(
      () =>
        calculateCandidateEconomics({
          ...baseCandidateInput(),
          costs: createCostModelSnapshot(
            costInput({ contractId: 'OTHER-CONTRACT' }),
          ),
        }),
      'MISMATCHED_CONTRACT',
    );
  });

  it('is isolated from ambient Decimal configuration contamination', () => {
    const recurringInverse = resolveFxRate(
      asCurrencyCode('EUR'),
      asCurrencyCode('USD'),
      createFxSnapshot(fxInput({ rate: '1.17' })),
    );
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
      Decimal.set({ precision: 2, toExpNeg: -2, toExpPos: 2 });
      expect(calculateCandidateEconomics(baseCandidateInput())).toMatchObject({
        directionalLossAccount: '4',
        grossExposureAccount: '200',
      });
      expect(
        resolveFxRate(
          asCurrencyCode('EUR'),
          asCurrencyCode('USD'),
          createFxSnapshot(fxInput()),
        ),
      ).toBe('1.25');
      expect(
        resolveFxRate(
          asCurrencyCode('EUR'),
          asCurrencyCode('USD'),
          createFxSnapshot(fxInput({ rate: '1.17' })),
        ),
      ).toBe(recurringInverse);
    } finally {
      Decimal.set(previous);
    }
  });

  it('rejects outputs beyond supported non-exponential decimal bounds', () => {
    const huge = '9'.repeat(200);
    const hugeProduct = createFuturesProduct({
      ...syntheticFdxsProductInput,
      tickSize: '1',
      tickValue: huge,
      monetaryValuePerPriceUnit: huge,
    });

    expectRiskInputError(
      () =>
        calculateCandidateEconomics({
          ...baseCandidateInput(),
          entryPrice: asDecimalString(huge),
          stopPrice: asDecimalString('1'),
          quantity: asDecimalString('2'),
          product: hugeProduct,
        }),
      'INVALID_RISK_INPUT',
    );
  });

  it('rejects public decimal inputs beyond supported bounds before arithmetic', () => {
    expectRiskInputError(
      () =>
        calculateCandidateEconomics({
          ...baseCandidateInput(),
          quantity: '1'.repeat(257) as never,
        }),
      'INVALID_RISK_INPUT',
    );
  });

  it('revalidates top-level and nested runtime casts without leaking native errors', () => {
    const invalidInputs: unknown[] = [
      null,
      [],
      {},
      { ...baseCandidateInput(), direction: 'UP' },
      { ...baseCandidateInput(), fx: {} },
      {
        ...baseCandidateInput(),
        product: { ...syntheticFdxsProduct, tickSize: '0' },
      },
      {
        ...baseCandidateInput(),
        margin: {
          ...baseCandidateInput().margin,
          initialMarginPerContract: '-1',
        },
      },
      {
        ...baseCandidateInput(),
        costs: { ...baseCandidateInput().costs, entryFees: null },
      },
    ];

    for (const input of invalidInputs) {
      expectRiskInputError(
        () => calculateCandidateEconomics(input as never),
        'INVALID_RISK_INPUT',
      );
    }

    const unreadable = new Proxy(
      {},
      {
        get: () => {
          throw new Error('hostile candidate');
        },
      },
    );
    expectRiskInputError(
      () => calculateCandidateEconomics(unreadable as never),
      'INVALID_RISK_INPUT',
    );
  });

  it('rejects inherited required fields at candidate, product, and snapshot boundaries', () => {
    const candidateOwnFields = {
      ...baseCandidateInput(),
    } as Record<string, unknown>;
    Reflect.deleteProperty(candidateOwnFields, 'direction');
    const inheritedCandidate = Object.assign(
      Object.create({ direction: 'LONG' }) as Record<string, unknown>,
      candidateOwnFields,
    );
    expectRiskInputError(
      () => calculateCandidateEconomics(inheritedCandidate as never),
      'INVALID_RISK_INPUT',
    );

    const candidateWithInheritedFx = {
      ...baseCandidateInput(),
    } as Record<string, unknown>;
    Reflect.deleteProperty(candidateWithInheritedFx, 'fx');
    expectRiskInputError(
      () =>
        calculateCandidateEconomics(
          Object.assign(
            Object.create({ fx: null }) as Record<string, unknown>,
            candidateWithInheritedFx,
          ) as never,
        ),
      'INVALID_RISK_INPUT',
    );

    const productOwnFields = {
      ...syntheticFdxsProduct,
    } as Record<string, unknown>;
    Reflect.deleteProperty(productOwnFields, 'tickSize');
    const inheritedProduct = Object.assign(
      Object.create({ tickSize: syntheticFdxsProduct.tickSize }) as Record<
        string,
        unknown
      >,
      productOwnFields,
    );
    expectRiskInputError(
      () =>
        calculateCandidateEconomics({
          ...baseCandidateInput(),
          product: inheritedProduct as never,
        }),
      'INVALID_RISK_INPUT',
    );
    expectRiskInputError(
      () =>
        calculateCandidateEconomics({
          ...baseCandidateInput(),
          product: {
            ...syntheticFdxsProduct,
            tickSize: '1'.repeat(257),
          } as never,
        }),
      'INVALID_RISK_INPUT',
    );

    const fxOwnFields = {
      ...createFxSnapshot(fxInput()),
    } as Record<string, unknown>;
    Reflect.deleteProperty(fxOwnFields, 'rate');
    const inheritedFx = Object.assign(
      Object.create({ rate: '0.8' }) as Record<string, unknown>,
      fxOwnFields,
    );
    expectRiskInputError(
      () =>
        resolveFxRate(
          asCurrencyCode('USD'),
          asCurrencyCode('EUR'),
          inheritedFx as never,
        ),
      'INVALID_RISK_INPUT',
    );
  });

  it('converts own-property descriptor traps into typed risk errors', () => {
    const descriptorFailure = new Proxy(baseCandidateInput(), {
      getOwnPropertyDescriptor: () => {
        throw new Error('hostile descriptor trap');
      },
    });

    expectRiskInputError(
      () => calculateCandidateEconomics(descriptorFailure),
      'INVALID_RISK_INPUT',
    );
  });

  it('uses the captured own candidate descriptor without prototype fallback', () => {
    const target = Object.assign(
      Object.create({ direction: 'SHORT' }) as Record<string, unknown>,
      baseCandidateInput(),
    );
    const deletingDescriptorProxy = new Proxy(target, {
      getOwnPropertyDescriptor: (proxiedTarget, property) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(
          proxiedTarget,
          property,
        );
        if (property === 'direction') {
          Reflect.deleteProperty(proxiedTarget, property);
        }
        return descriptor;
      },
    });

    expect(
      calculateCandidateEconomics(deletingDescriptorProxy as never),
    ).toMatchObject({
      directionalLossAccount: '4',
    });
  });

  it('reads each required own getter exactly once', () => {
    let directionReads = 0;
    const input = { ...baseCandidateInput() };
    Object.defineProperty(input, 'direction', {
      configurable: true,
      enumerable: true,
      get: () => {
        directionReads += 1;
        return 'LONG' as const;
      },
    });

    expect(calculateCandidateEconomics(input)).toMatchObject({
      directionalLossAccount: '4',
    });
    expect(directionReads).toBe(1);

    const throwingInput = { ...baseCandidateInput() };
    Object.defineProperty(throwingInput, 'direction', {
      configurable: true,
      enumerable: true,
      get: () => {
        directionReads += 1;
        throw new Error('hostile own getter');
      },
    });
    expectRiskInputError(
      () => calculateCandidateEconomics(throwingInput),
      'INVALID_RISK_INPUT',
    );
    expect(directionReads).toBe(2);

    const setterOnlyInput = { ...baseCandidateInput() };
    Object.defineProperty(setterOnlyInput, 'direction', {
      configurable: true,
      enumerable: true,
      set: () => undefined,
    });
    expectRiskInputError(
      () => calculateCandidateEconomics(setterOnlyInput),
      'INVALID_RISK_INPUT',
    );
  });

  it('snapshots top-level and nested getters once and never mutates inputs', () => {
    const reads = new Map<string, number>();
    const once = <T extends object>(label: string, value: T): T =>
      new Proxy(value, {
        getOwnPropertyDescriptor: (target, property) => {
          if (typeof property === 'string') {
            const key = `${label}.${property}`;
            const count = (reads.get(key) ?? 0) + 1;
            reads.set(key, count);
            if (count > 1) {
              throw new Error(`read twice: ${key}`);
            }
          }
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      });

    const original = baseCandidateInput();
    const input = once('input', {
      ...original,
      product: once('product', original.product),
      margin: once('margin', original.margin),
      costs: once('costs', original.costs),
    });

    expect(calculateCandidateEconomics(input)).toMatchObject({
      directionalLossAccount: '4',
      grossExposureAccount: '200',
    });
    expect(reads.size).toBeGreaterThan(0);
    expect(original).toEqual(baseCandidateInput());
  });
});
