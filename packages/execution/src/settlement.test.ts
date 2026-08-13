import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  asCurrencyCode,
  asDecimalString,
  type CurrencyCode,
  type DecimalString,
  type InstantString,
} from '@trading-auto/domain';
import {
  buildContract,
  buildOrderRiskInput,
  buildPolicy,
  buildPortfolio,
  buildProduct,
} from '../../risk/test-helpers/builders.js';

import {
  applyDailySettlement,
  createDailySettlement,
  createEntryIntent,
  createH1OpenEvent,
  createOpenPosition,
  executeEntryAtNextOpen,
  ExecutionInputError,
  selectDailySettlement,
  type DailySettlementInput,
  type EntryDirection,
  type OpenPosition,
} from './index.js';

const constraints = {
  contractId: 'FDXS-202603',
  currency: 'EUR',
  tickSize: '0.5',
} as const;

const validSettlement: DailySettlementInput = {
  version: 'EUREX_SETTLEMENT_2026-01-02_V1',
  source: 'SYNTHETIC_EUREX',
  observedAt: '2026-01-02T18:05:00+01:00',
  effectiveAt: '2026-01-02T18:00:00+01:00',
  contractId: constraints.contractId,
  currency: constraints.currency,
  price: '101.5',
};

function expectError(
  action: () => unknown,
  code: 'INVALID_EXECUTION_INPUT' | 'INVALID_DATA',
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

function buildPosition(direction: EntryDirection = 'LONG'): OpenPosition {
  const intent = createEntryIntent({
    intentId: `SETTLEMENT-ENTRY-${direction}`,
    instrumentId: 'FDXS',
    contractId: constraints.contractId,
    strategyVersion: 'ICHIMOKU_V1',
    datasetVersion: 'DATASET_V1',
    timeframe: '1h',
    direction,
    signalCloseTime: '2026-01-02T09:00:00Z',
    expiresAt: '2026-01-02T13:00:00Z',
    stopPrice: direction === 'LONG' ? '99' : '101',
    requestedQuantity: '2',
    riskDecisionId: `SETTLEMENT-RISK-${direction}`,
    riskDecisionStatus: 'APPROVE',
  });
  const product = buildProduct({ tickSize: '0.5', tickValue: '0.5' });
  const contract = buildContract(product);
  const baseRisk = buildOrderRiskInput({
    direction,
    strategyVersion: intent.strategyVersion,
    datasetVersion: intent.datasetVersion,
    signalExpiresAt: intent.expiresAt,
    product,
    contract,
    policy: buildPolicy({ maxContractsPerPosition: '4' }),
    portfolio: buildPortfolio(),
  });
  const open = createH1OpenEvent({
    instrumentId: 'FDXS',
    contractId: constraints.contractId,
    openTime: '2026-01-02T12:00:00Z',
    availableAt: '2026-01-02T12:00:00Z',
    price: '100',
  });
  const fill = executeEntryAtNextOpen({
    intent,
    open,
    adverseEntrySlippagePriceUnits: '0',
    riskInput: {
      ...baseRisk,
      decisionAt: open.openTime,
      riskPolicyUseAt: open.openTime,
    },
  });
  if (fill.type === 'ENTRY_CANCELLED')
    throw new Error('Expected filled fixture.');
  return createOpenPosition({
    positionId: `SETTLEMENT-POSITION-${direction}`,
    intent,
    fill,
    entryCostAccountCurrency: '0',
    tickSize: constraints.tickSize,
    executionModelVersion: 'BAR_BASED_H1_V1',
    exitPolicyVersion: 'ICHIMOKU_KIJUN_EXIT_V1',
  });
}

describe('daily settlement artifacts', () => {
  it('creates a canonical deeply immutable settlement', () => {
    const settlement = createDailySettlement(validSettlement, constraints);
    expect(settlement).toEqual({
      ...validSettlement,
      observedAt: '2026-01-02T17:05:00Z',
      effectiveAt: '2026-01-02T17:00:00Z',
    });
    expect(Object.isFrozen(settlement)).toBe(true);
    expectTypeOf(settlement.price).toEqualTypeOf<DecimalString>();
    expectTypeOf(settlement.currency).toEqualTypeOf<CurrencyCode>();
    expectTypeOf(settlement.effectiveAt).toEqualTypeOf<InstantString>();
  });

  it.each([
    ['version', ''],
    ['source', '  '],
    ['contractId', '\t'],
  ] as const)('rejects blank %s', (field, value) => {
    expectError(
      () =>
        createDailySettlement(
          { ...validSettlement, [field]: value },
          constraints,
        ),
      'INVALID_EXECUTION_INPUT',
      field,
    );
  });

  it.each([
    ['contractId', 'OTHER'],
    ['currency', 'USD'],
    ['price', '101.25'],
    ['price', '1e2'],
  ] as const)('rejects mismatched or invalid %s', (field, value) => {
    expectError(
      () =>
        createDailySettlement(
          { ...validSettlement, [field]: value },
          constraints,
        ),
      'INVALID_EXECUTION_INPUT',
      field,
    );
  });

  it('requires publication no earlier than the effective instant', () => {
    expectError(
      () =>
        createDailySettlement(
          {
            ...validSettlement,
            observedAt: '2026-01-02T16:59:59.999999999Z',
          },
          constraints,
        ),
      'INVALID_EXECUTION_INPUT',
      'observedAt',
    );
  });

  it('reads every artifact and constraint accessor exactly once', () => {
    const reads: Record<string, number> = {};
    function accessorObject(source: object, prefix: string) {
      const result: Record<string, unknown> = {};
      for (const field of Object.keys(source)) {
        const value = (source as Record<string, unknown>)[field];
        const key = `${prefix}.${field}`;
        Object.defineProperty(result, field, {
          enumerable: true,
          get: () => {
            reads[key] = (reads[key] ?? 0) + 1;
            return reads[key] === 1 ? value : 'CHANGED';
          },
        });
      }
      return result;
    }

    expect(
      createDailySettlement(
        accessorObject(
          validSettlement,
          'settlement',
        ) as unknown as DailySettlementInput,
        accessorObject(constraints, 'constraints') as typeof constraints,
      ).price,
    ).toBe('101.5');
    expect(Object.values(reads).every((count) => count === 1)).toBe(true);
  });

  it('maps hostile records, accessors, currencies, and instants to typed errors', () => {
    for (const value of [null, [], new Date(0)]) {
      expectError(
        () =>
          createDailySettlement(
            value as unknown as DailySettlementInput,
            constraints,
          ),
        'INVALID_EXECUTION_INPUT',
        'input',
      );
    }
    for (const [field, value] of [
      ['observedAt', 1],
      ['observedAt', 'invalid'],
      ['currency', 1],
      ['currency', 'EURO'],
    ] as const) {
      expectError(
        () =>
          createDailySettlement(
            { ...validSettlement, [field]: value },
            constraints,
          ),
        'INVALID_EXECUTION_INPUT',
        field,
      );
    }

    const descriptorTrap = new Proxy(validSettlement, {
      getOwnPropertyDescriptor: () => {
        throw new Error('descriptor trap');
      },
    });
    expectError(
      () => createDailySettlement(descriptorTrap, constraints),
      'INVALID_EXECUTION_INPUT',
      'version',
    );
    for (const descriptor of [
      { enumerable: false, value: validSettlement.version },
      { enumerable: true, set: () => undefined },
      {
        enumerable: true,
        get: () => {
          throw new Error('getter trap');
        },
      },
    ]) {
      const input = { ...validSettlement } as Record<string, unknown>;
      Object.defineProperty(input, 'version', descriptor);
      expectError(
        () =>
          createDailySettlement(
            input as unknown as DailySettlementInput,
            constraints,
          ),
        'INVALID_EXECUTION_INPUT',
        'version',
      );
    }
  });
});

describe('causal settlement selection', () => {
  it('selects the unique exact settlement observable at decisionAt', () => {
    const selected = selectDailySettlement({
      settlements: [
        createDailySettlement(validSettlement, constraints),
        createDailySettlement(
          {
            ...validSettlement,
            version: 'NEXT',
            effectiveAt: '2026-01-03T17:00:00Z',
            observedAt: '2026-01-03T17:05:00Z',
            price: '102',
          },
          constraints,
        ),
      ],
      requiredEffectiveAt: '2026-01-02T17:00:00Z',
      decisionAt: '2026-01-02T17:05:00Z',
      constraints,
    });
    expect(selected.version).toBe(validSettlement.version);
  });

  it('rejects missing, duplicated, or future-observed required settlements', () => {
    expectError(
      () =>
        selectDailySettlement({
          settlements: [],
          requiredEffectiveAt: '2026-01-02T17:00:00Z',
          decisionAt: '2026-01-02T17:05:00Z',
          constraints,
        }),
      'INVALID_DATA',
      'settlement',
    );
    const exact = createDailySettlement(validSettlement, constraints);
    expectError(
      () =>
        selectDailySettlement({
          settlements: [exact, exact],
          requiredEffectiveAt: exact.effectiveAt,
          decisionAt: exact.observedAt,
          constraints,
        }),
      'INVALID_DATA',
      'settlement',
    );
    expectError(
      () =>
        selectDailySettlement({
          settlements: [exact],
          requiredEffectiveAt: exact.effectiveAt,
          decisionAt: '2026-01-02T17:04:59.999999999Z',
          constraints,
        }),
      'INVALID_DATA',
      'settlement',
    );
  });

  it('does not inspect unrelated future economic fields or an H1 fallback', () => {
    const exact = createDailySettlement(validSettlement, constraints);
    const future: Record<string, unknown> = {
      effectiveAt: '2026-01-03T17:00:00Z',
    };
    for (const field of ['version', 'source', 'observedAt', 'price']) {
      Object.defineProperty(future, field, {
        enumerable: true,
        get: () => {
          throw new Error(`${field} is unavailable in the future`);
        },
      });
    }
    const input: Record<string, unknown> = {
      settlements: [exact, future],
      requiredEffectiveAt: exact.effectiveAt,
      decisionAt: exact.observedAt,
      constraints,
    };
    Object.defineProperty(input, 'h1CloseFallback', {
      enumerable: true,
      get: () => {
        throw new Error('An H1 close must never replace settlement.');
      },
    });

    expect(
      selectDailySettlement(
        input as unknown as Parameters<typeof selectDailySettlement>[0],
      ).version,
    ).toBe(exact.version);
  });

  it('reads every field of the selected settlement exactly once', () => {
    const reads: Record<string, number> = {};
    const candidate: Record<string, unknown> = {};
    for (const field of Object.keys(validSettlement) as Array<
      keyof DailySettlementInput
    >) {
      const value = validSettlement[field];
      Object.defineProperty(candidate, field, {
        enumerable: true,
        get: () => {
          reads[field] = (reads[field] ?? 0) + 1;
          return reads[field] === 1 ? value : 'CHANGED';
        },
      });
    }

    expect(
      selectDailySettlement({
        settlements: [
          candidate as unknown as ReturnType<typeof createDailySettlement>,
        ],
        requiredEffectiveAt: '2026-01-02T17:00:00Z',
        decisionAt: '2026-01-02T17:05:00Z',
        constraints,
      }).price,
    ).toBe('101.5');
    expect(reads).toEqual(
      Object.fromEntries(
        Object.keys(validSettlement).map((field) => [field, 1]),
      ),
    );
  });

  it('bounds and validates hostile settlement series before selection', () => {
    const base = {
      requiredEffectiveAt: '2026-01-02T17:00:00Z',
      decisionAt: '2026-01-02T17:05:00Z',
      constraints,
    } as const;
    expectError(
      () =>
        selectDailySettlement({
          ...base,
          settlements: {} as unknown as readonly ReturnType<
            typeof createDailySettlement
          >[],
        }),
      'INVALID_DATA',
      'settlements',
    );
    expectError(
      () =>
        selectDailySettlement({
          ...base,
          settlements: new Array(10_001),
        }),
      'INVALID_DATA',
      'settlements',
    );
    expectError(
      () =>
        selectDailySettlement({
          ...base,
          settlements: new Array(1),
        }),
      'INVALID_DATA',
      'settlements',
    );

    const descriptorTrap = new Proxy(
      [createDailySettlement(validSettlement, constraints)],
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('descriptor trap');
        },
      },
    );
    expectError(
      () => selectDailySettlement({ ...base, settlements: descriptorTrap }),
      'INVALID_DATA',
      'settlements',
    );

    for (const [descriptor, expectedField] of [
      [{ enumerable: true, set: () => undefined }, 'settlement'],
      [
        {
          enumerable: true,
          get: () => {
            throw new Error('element getter');
          },
        },
        'settlements',
      ],
    ] as const) {
      const settlements: unknown[] = [];
      Object.defineProperty(settlements, '0', descriptor);
      Object.defineProperty(settlements, 'length', { value: 1 });
      expectError(
        () =>
          selectDailySettlement({
            ...base,
            settlements: settlements as readonly ReturnType<
              typeof createDailySettlement
            >[],
          }),
        'INVALID_DATA',
        expectedField,
      );
    }
  });

  it('maps malformed matching settlements and absent constraints to INVALID_DATA', () => {
    const exact = createDailySettlement(validSettlement, constraints);
    expectError(
      () =>
        selectDailySettlement({
          settlements: [{ ...exact, price: 'bad' } as typeof exact],
          requiredEffectiveAt: exact.effectiveAt,
          decisionAt: exact.observedAt,
          constraints,
        }),
      'INVALID_DATA',
      'settlement',
    );
    expectError(
      () =>
        selectDailySettlement({
          settlements: [exact],
          requiredEffectiveAt: exact.effectiveAt,
          decisionAt: exact.observedAt,
          constraints: undefined as unknown as typeof constraints,
        }),
      'INVALID_DATA',
      'settlement',
    );
  });
});

describe('variation margin', () => {
  it.each([
    ['LONG', '101.5', '15'],
    ['SHORT', '98.5', '15'],
    ['LONG', '98.5', '-15'],
    ['SHORT', '101.5', '-15'],
  ] as const)(
    'applies exact %s variation margin at settlement %s',
    (direction, price, expectedVariation) => {
      const current = buildPosition(direction);
      const before = structuredClone(current);
      const settlement = createDailySettlement(
        { ...validSettlement, price },
        constraints,
      );
      const result = applyDailySettlement({
        position: current,
        settlement,
        decisionAt: settlement.observedAt,
        currency: constraints.currency,
        monetaryValuePerPriceUnit: '5',
        cash: '1000',
        realizedEquity: '1000',
      });

      expect(result).toMatchObject({
        type: 'DAILY_SETTLEMENT_APPLIED',
        positionId: current.positionId,
        contractId: constraints.contractId,
        effectiveAt: settlement.effectiveAt,
        availableAt: settlement.observedAt,
        currency: 'EUR',
        previousAccountingBasisPrice: '100',
        settlementPrice: price,
        variationMargin: expectedVariation,
        cashBefore: '1000',
        cashAfter: expectedVariation.startsWith('-') ? '985' : '1015',
        realizedEquityBefore: '1000',
        realizedEquityAfter: expectedVariation.startsWith('-') ? '985' : '1015',
      });
      expect(result.position.accountingBasisPrice).toBe(price);
      expect(result.position.economicEntryPrice).toBe('100');
      expect(current).toEqual(before);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.position)).toBe(true);
    },
  );

  it('uses the reset accounting basis on the next settlement', () => {
    const current = buildPosition('LONG');
    const first = createDailySettlement(validSettlement, constraints);
    const applied = applyDailySettlement({
      position: current,
      settlement: first,
      decisionAt: first.observedAt,
      currency: 'EUR',
      monetaryValuePerPriceUnit: '5',
      cash: '1000',
      realizedEquity: '1000',
    });
    const second = createDailySettlement(
      {
        ...validSettlement,
        version: 'NEXT',
        effectiveAt: '2026-01-03T17:00:00Z',
        observedAt: '2026-01-03T17:05:00Z',
        price: '102',
      },
      constraints,
    );
    expect(
      applyDailySettlement({
        position: applied.position,
        settlement: second,
        decisionAt: second.observedAt,
        currency: 'EUR',
        monetaryValuePerPriceUnit: '5',
        cash: applied.cashAfter,
        realizedEquity: applied.realizedEquityAfter,
      }).variationMargin,
    ).toBe('5');
  });

  it.each([
    ['contractId', 'OTHER'],
    ['currency', 'USD'],
  ] as const)('rejects mismatched %s', (field, value) => {
    const current = buildPosition();
    const settlement = createDailySettlement(validSettlement, constraints);
    expectError(
      () =>
        applyDailySettlement({
          position:
            field === 'contractId'
              ? { ...current, contractId: value }
              : current,
          settlement,
          decisionAt: settlement.observedAt,
          currency: field === 'currency' ? value : constraints.currency,
          monetaryValuePerPriceUnit: '5',
          cash: '1000',
          realizedEquity: '1000',
        }),
      'INVALID_EXECUTION_INPUT',
      field,
    );
  });

  it('rejects application before observation and at or before position open', () => {
    const current = buildPosition();
    const settlement = createDailySettlement(validSettlement, constraints);
    expectError(
      () =>
        applyDailySettlement({
          position: current,
          settlement,
          decisionAt: settlement.effectiveAt,
          currency: 'EUR',
          monetaryValuePerPriceUnit: '5',
          cash: '1000',
          realizedEquity: '1000',
        }),
      'INVALID_DATA',
      'settlement',
    );
    const beforeOpen = createDailySettlement(
      {
        ...validSettlement,
        effectiveAt: current.openedAt,
        observedAt: current.openedAt,
        price: '100',
      },
      constraints,
    );
    expectError(
      () =>
        applyDailySettlement({
          position: current,
          settlement: beforeOpen,
          decisionAt: beforeOpen.observedAt,
          currency: 'EUR',
          monetaryValuePerPriceUnit: '5',
          cash: '1000',
          realizedEquity: '1000',
        }),
      'INVALID_EXECUTION_INPUT',
      'effectiveAt',
    );
  });

  it('supports canonical negative balances but rejects malformed numbers', () => {
    const current = buildPosition();
    const settlement = createDailySettlement(
      { ...validSettlement, price: '1' },
      constraints,
    );
    expect(
      applyDailySettlement({
        position: current,
        settlement,
        decisionAt: settlement.observedAt,
        currency: 'EUR',
        monetaryValuePerPriceUnit: '5',
        cash: '-10',
        realizedEquity: '-10',
      }).cashAfter,
    ).toBe('-1000');
    expectError(
      () =>
        applyDailySettlement({
          position: current,
          settlement,
          decisionAt: settlement.observedAt,
          currency: 'EUR',
          monetaryValuePerPriceUnit: '1e2',
          cash: '-10',
          realizedEquity: '-10',
        }),
      'INVALID_EXECUTION_INPUT',
      'monetaryValuePerPriceUnit',
    );
  });

  it('keeps canonical public types in the event', () => {
    const current = buildPosition();
    const settlement = createDailySettlement(validSettlement, constraints);
    const result = applyDailySettlement({
      position: current,
      settlement,
      decisionAt: settlement.observedAt,
      currency: asCurrencyCode('EUR'),
      monetaryValuePerPriceUnit: asDecimalString('5'),
      cash: asDecimalString('1000'),
      realizedEquity: asDecimalString('1000'),
    });
    expectTypeOf(result.variationMargin).toEqualTypeOf<DecimalString>();
    expectTypeOf(result.currency).toEqualTypeOf<CurrencyCode>();
    expectTypeOf(result.availableAt).toEqualTypeOf<InstantString>();
  });

  it('rejects forged position enums and limitations at the boundary', () => {
    const current = buildPosition();
    const settlement = createDailySettlement(validSettlement, constraints);
    for (const [field, value, expectedField] of [
      ['direction', 'SIDEWAYS', 'direction'],
      ['timeframe', '4h', 'timeframe'],
      ['executionModelVersion', 'OTHER', 'executionModelVersion'],
      ['limitations', [], 'position.limitations'],
    ] as const) {
      expectError(
        () =>
          applyDailySettlement({
            position: { ...current, [field]: value },
            settlement,
            decisionAt: settlement.observedAt,
            currency: 'EUR',
            monetaryValuePerPriceUnit: '5',
            cash: '1000',
            realizedEquity: '1000',
          }),
        'INVALID_EXECUTION_INPUT',
        expectedField,
      );
    }

    const revoked = Proxy.revocable([...current.limitations], {});
    revoked.revoke();
    const hostileLimitations: Array<OpenPosition['limitations']> = [
      [
        'WRONG',
        ...current.limitations.slice(1),
      ] as unknown as OpenPosition['limitations'],
      revoked.proxy,
      {} as unknown as OpenPosition['limitations'],
    ];
    for (const limitations of hostileLimitations) {
      expectError(
        () =>
          applyDailySettlement({
            position: { ...current, limitations },
            settlement,
            decisionAt: settlement.observedAt,
            currency: 'EUR',
            monetaryValuePerPriceUnit: '5',
            cash: '1000',
            realizedEquity: '1000',
          }),
        'INVALID_EXECUTION_INPUT',
        'position.limitations',
      );
    }
  });

  it('rejects canonical negative zero balances', () => {
    const current = buildPosition();
    const settlement = createDailySettlement(validSettlement, constraints);
    expectError(
      () =>
        applyDailySettlement({
          position: current,
          settlement,
          decisionAt: settlement.observedAt,
          currency: 'EUR',
          monetaryValuePerPriceUnit: '5',
          cash: '-0',
          realizedEquity: '1000',
        }),
      'INVALID_EXECUTION_INPUT',
      'cash',
    );
  });
});
