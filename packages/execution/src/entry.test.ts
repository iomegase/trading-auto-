import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  asDecimalString,
  asInstantString,
  type DecimalString,
  type InstantString,
} from '@trading-auto/domain';
import {
  RiskInputError,
  type OrderRiskInput,
  type RiskDecisionReason,
} from '@trading-auto/risk';
import {
  buildContract,
  buildOrderRiskInput,
  buildPolicy,
  buildPortfolio,
  buildProduct,
} from '../../risk/test-helpers/builders.js';

import {
  createEntryIntent,
  createH1OpenEvent,
  executeEntryAtNextOpen,
  ExecutionInputError,
  type EntryIntentInput,
} from './index.js';

const validIntent: EntryIntentInput = {
  intentId: 'ENTRY-1',
  instrumentId: 'FDXS',
  contractId: 'FDXS-202603',
  strategyVersion: 'ICHIMOKU_V1',
  datasetVersion: 'DATASET_V1',
  timeframe: '1h',
  direction: 'LONG',
  signalCloseTime: '2026-01-02T10:00:00+01:00',
  expiresAt: '2026-01-02T13:00:00Z',
  stopPrice: '99',
  requestedQuantity: '2',
  riskDecisionId: 'RISK-AT-SIGNAL-1',
  riskDecisionStatus: 'APPROVE',
};

function expectInputError(action: () => unknown, field: string): void {
  let received: unknown;
  try {
    action();
  } catch (error) {
    received = error;
  }
  expect(received).toBeInstanceOf(ExecutionInputError);
  expect(received).toMatchObject({
    code: 'INVALID_EXECUTION_INPUT',
    details: { field },
  });
}

function inputAtOpen(overrides: Partial<OrderRiskInput> = {}): OrderRiskInput {
  const product = buildProduct({ tickSize: '0.5', tickValue: '0.5' });
  const contract = buildContract(product);
  const base = buildOrderRiskInput({
    product,
    contract,
    policy: buildPolicy({ maxContractsPerPosition: '4' }),
    strategyVersion: validIntent.strategyVersion,
  });
  return {
    ...base,
    decisionAt: asInstantString('2026-01-02T12:00:00Z'),
    riskPolicyUseAt: asInstantString('2026-01-02T12:00:00Z'),
    signalExpiresAt: asInstantString(validIntent.expiresAt),
    portfolio: buildPortfolio(),
    ...overrides,
  };
}

const open = createH1OpenEvent({
  instrumentId: 'FDXS',
  contractId: 'FDXS-202603',
  openTime: '2026-01-02T12:00:00Z',
  availableAt: '2026-01-02T12:00:00Z',
  price: '100',
});

describe('entry intents', () => {
  it('creates an immutable, canonical, dated-contract intent', () => {
    const intent = createEntryIntent(validIntent);

    expect(intent).toEqual({
      ...validIntent,
      signalCloseTime: '2026-01-02T09:00:00Z',
    });
    expect(Object.isFrozen(intent)).toBe(true);
    expectTypeOf(intent.stopPrice).toEqualTypeOf<DecimalString>();
    expectTypeOf(intent.signalCloseTime).toEqualTypeOf<InstantString>();
  });

  it.each([
    ['intentId', ''],
    ['instrumentId', '  '],
    ['contractId', '\t'],
    ['strategyVersion', ''],
    ['datasetVersion', ''],
    ['riskDecisionId', ''],
  ] as const)('rejects blank %s', (field, value) => {
    expectInputError(
      () => createEntryIntent({ ...validIntent, [field]: value }),
      field,
    );
  });

  it.each([
    ['timeframe', '4h'],
    ['direction', 'NONE'],
    ['riskDecisionStatus', 'REJECT'],
    ['requestedQuantity', '0'],
    ['requestedQuantity', '1e2'],
    ['stopPrice', '-1'],
  ] as const)('rejects invalid %s %s', (field, value) => {
    expectInputError(
      () =>
        createEntryIntent({
          ...validIntent,
          [field]: value,
        }),
      field,
    );
  });

  it('requires expiry strictly after signal close', () => {
    expectInputError(
      () =>
        createEntryIntent({
          ...validIntent,
          expiresAt: validIntent.signalCloseTime,
        }),
      'expiresAt',
    );
  });

  it('rejects a risk decision identifier duplicated as the intent identifier', () => {
    expectInputError(
      () =>
        createEntryIntent({
          ...validIntent,
          riskDecisionId: validIntent.intentId,
        }),
      'riskDecisionId',
    );
  });

  it('rejects a continuous symbol in place of a dated contract', () => {
    expectInputError(
      () => createEntryIntent({ ...validIntent, contractId: 'FDXS' }),
      'contractId',
    );
  });

  it('requires every field to be own and reads own accessors once', () => {
    const input = Object.create({ intentId: validIntent.intentId }) as Record<
      string,
      unknown
    >;
    for (const field of Object.keys(validIntent).filter(
      (field) => field !== 'intentId',
    ) as Array<keyof EntryIntentInput>) {
      Object.defineProperty(input, field, {
        enumerable: true,
        value: validIntent[field],
      });
    }
    expectInputError(
      () => createEntryIntent(input as unknown as EntryIntentInput),
      'input',
    );

    const reads: Record<string, number> = {};
    const accessorInput: Record<string, unknown> = {};
    for (const field of Object.keys(validIntent) as Array<
      keyof EntryIntentInput
    >) {
      const value = validIntent[field];
      Object.defineProperty(accessorInput, field, {
        enumerable: true,
        get: () => {
          reads[field] = (reads[field] ?? 0) + 1;
          return reads[field] === 1 ? value : 'CHANGED';
        },
      });
    }
    expect(
      createEntryIntent(accessorInput as unknown as EntryIntentInput).intentId,
    ).toBe(validIntent.intentId);
    expect(reads).toEqual(
      Object.fromEntries(Object.keys(validIntent).map((field) => [field, 1])),
    );
  });

  it('rejects missing, non-enumerable, setter-only, and hostile intent fields', () => {
    const missing = { ...validIntent } as Partial<EntryIntentInput>;
    Reflect.deleteProperty(missing, 'intentId');
    expectInputError(
      () => createEntryIntent(missing as EntryIntentInput),
      'intentId',
    );

    for (const descriptor of [
      { enumerable: false, value: validIntent.intentId },
      { enumerable: true, set: () => undefined },
      {
        enumerable: true,
        get: () => {
          throw new Error('hostile getter');
        },
      },
    ]) {
      const input = { ...validIntent } as Record<string, unknown>;
      Object.defineProperty(input, 'intentId', descriptor);
      expectInputError(
        () => createEntryIntent(input as unknown as EntryIntentInput),
        'intentId',
      );
    }
    const descriptorTrap = new Proxy(validIntent, {
      getOwnPropertyDescriptor: () => {
        throw new Error('descriptor trap');
      },
    });
    expectInputError(() => createEntryIntent(descriptorTrap), 'intentId');
  });

  it('rejects malformed instant types and syntax', () => {
    expectInputError(
      () => createEntryIntent(null as unknown as EntryIntentInput),
      'input',
    );
    expectInputError(
      () =>
        createEntryIntent({
          ...validIntent,
          signalCloseTime: 1 as unknown as string,
        }),
      'signalCloseTime',
    );
    expectInputError(
      () => createEntryIntent({ ...validIntent, signalCloseTime: 'invalid' }),
      'signalCloseTime',
    );
  });
});

describe('entry execution at the next open', () => {
  it('fills an approved LONG at exact adverse adjusted price', () => {
    const result = executeEntryAtNextOpen({
      intent: createEntryIntent(validIntent),
      open,
      adverseEntrySlippagePriceUnits: '0.5',
      riskInput: inputAtOpen(),
    });

    expect(result).toMatchObject({
      type: 'ENTRY_FILLED',
      intentId: validIntent.intentId,
      fillPrice: '100.5',
      quantity: '2',
      occurredAt: open.openTime,
      limitations: ['NO_INTRABAR_PATH', 'NO_PARTIAL_FILLS', 'NO_ORDER_BOOK'],
      riskDecision: { status: 'APPROVE', quantity: '2' },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.riskDecision)).toBe(true);
  });

  it('subtracts the adverse adjustment for a SHORT', () => {
    const intent = createEntryIntent({
      ...validIntent,
      direction: 'SHORT',
      stopPrice: '101',
      requestedQuantity: '1',
    });
    const result = executeEntryAtNextOpen({
      intent,
      open,
      adverseEntrySlippagePriceUnits: '0.5',
      riskInput: inputAtOpen({
        direction: 'SHORT',
        stopPrice: asDecimalString('101'),
      }),
    });
    expect(result).toMatchObject({ type: 'ENTRY_FILLED', fillPrice: '99.5' });
  });

  it('returns reduced-and-filled with the fresh risk quantity', () => {
    const result = executeEntryAtNextOpen({
      intent: createEntryIntent(validIntent),
      open,
      adverseEntrySlippagePriceUnits: '0',
      riskInput: inputAtOpen({
        policy: buildPolicy({ maxContractsPerPosition: '1' }),
      }),
    });
    expect(result).toMatchObject({
      type: 'ENTRY_REDUCED_AND_FILLED',
      quantity: '1',
      riskDecision: {
        status: 'REDUCE_SIZE',
        reasons: ['MAX_CONTRACTS_PER_POSITION'],
      },
    });
  });

  it('cancels when the fresh risk evaluation rejects', () => {
    const result = executeEntryAtNextOpen({
      intent: createEntryIntent(validIntent),
      open,
      adverseEntrySlippagePriceUnits: '0',
      riskInput: inputAtOpen({
        account: { ...inputAtOpen().account, killSwitchActive: true },
      }),
    });
    expect(result).toMatchObject({
      type: 'ENTRY_CANCELLED',
      quantity: '0',
      reasons: ['KILL_SWITCH'],
      riskDecision: { status: 'REJECT' },
    });
  });

  it('cancels an expired signal without invoking malformed risk data', () => {
    const result = executeEntryAtNextOpen({
      intent: createEntryIntent({
        ...validIntent,
        expiresAt: open.openTime,
      }),
      open,
      adverseEntrySlippagePriceUnits: '0',
      riskInput: new Proxy({} as OrderRiskInput, {
        get: () => {
          throw new Error('risk input must not be read after expiry');
        },
      }),
    });
    expect(result).toEqual({
      type: 'ENTRY_CANCELLED',
      intentId: validIntent.intentId,
      occurredAt: open.openTime,
      availableAt: open.availableAt,
      quantity: '0',
      reasons: ['SIGNAL_EXPIRED'],
      riskDecision: null,
      limitations: ['NO_INTRABAR_PATH', 'NO_PARTIAL_FILLS', 'NO_ORDER_BOOK'],
    });
  });

  it.each([
    ['LONG', '100', '100', 'INVALID_STOP_AT_OPEN'],
    ['SHORT', '100', '100', 'INVALID_STOP_AT_OPEN'],
  ] as const)(
    'cancels an invalid %s stop after the opening gap',
    (direction, price, stopPrice, reason) => {
      const result = executeEntryAtNextOpen({
        intent: createEntryIntent({
          ...validIntent,
          direction,
          stopPrice,
        }),
        open: createH1OpenEvent({ ...open, price }),
        adverseEntrySlippagePriceUnits: '0',
        riskInput: new Proxy({} as OrderRiskInput, {
          get: () => {
            throw new Error('risk input must not be read for invalid stop');
          },
        }),
      });
      expect(result).toMatchObject({
        type: 'ENTRY_CANCELLED',
        reasons: [reason],
        riskDecision: null,
      });
    },
  );

  it('overwrites the four price/time/quantity fields before risk evaluation', () => {
    const poisoned = inputAtOpen({
      entryPrice: asDecimalString('999'),
      stopPrice: asDecimalString('998'),
      requestedQuantity: asDecimalString('99'),
      decisionAt: asInstantString('2026-01-02T11:59:59Z'),
      instrumentId: 'FDXS',
      direction: 'LONG',
      datasetVersion: 'DATASET_V1',
      strategyVersion: 'ICHIMOKU_V1',
    });
    const result = executeEntryAtNextOpen({
      intent: createEntryIntent(validIntent),
      open,
      adverseEntrySlippagePriceUnits: '0',
      riskInput: poisoned,
    });

    expect(result.riskDecision?.context).toMatchObject({
      entryPrice: '100',
      stopPrice: '99',
      decisionAt: open.openTime,
    });
    expect(result.quantity).toBe('2');
  });

  it('never reads forward fields replaced by trusted execution data', () => {
    const riskInput = { ...inputAtOpen() } as Record<string, unknown>;
    for (const field of [
      'entryPrice',
      'stopPrice',
      'requestedQuantity',
      'decisionAt',
      'riskPolicyUseAt',
      'backtestId',
      'runCreatedAt',
    ]) {
      Object.defineProperty(riskInput, field, {
        configurable: true,
        enumerable: true,
        get: () => {
          throw new Error(`${field} must be overwritten without observation`);
        },
      });
    }

    expect(
      executeEntryAtNextOpen({
        intent: createEntryIntent(validIntent),
        open,
        adverseEntrySlippagePriceUnits: '0',
        riskInput: riskInput as unknown as OrderRiskInput,
      }),
    ).toMatchObject({ type: 'ENTRY_FILLED', quantity: '2' });
  });

  it('accepts an equivalent offset signal expiry and canonicalizes it', () => {
    const riskInput = {
      ...inputAtOpen(),
      signalExpiresAt: '2026-01-02T14:00:00+01:00',
    } as unknown as OrderRiskInput;
    const result = executeEntryAtNextOpen({
      intent: createEntryIntent(validIntent),
      open,
      adverseEntrySlippagePriceUnits: '0',
      riskInput,
    });
    expect(result.riskDecision?.context.signalExpiresAt).toBe(
      validIntent.expiresAt,
    );
  });

  it('captures every product and contract accessor exactly once', () => {
    const base = inputAtOpen();
    const reads: Record<string, number> = {};
    const product: Record<string, unknown> = {};
    const contract: Record<string, unknown> = {};

    for (const [prefix, source, target] of [
      ['product', base.product, product],
      ['contract', base.contract, contract],
    ] as const) {
      for (const field of Object.keys(source)) {
        const value = source[field as keyof typeof source];
        const key = `${prefix}.${field}`;
        Object.defineProperty(target, field, {
          enumerable: true,
          get: () => {
            reads[key] = (reads[key] ?? 0) + 1;
            return reads[key] === 1 ? value : 'CHANGED';
          },
        });
      }
    }

    expect(
      executeEntryAtNextOpen({
        intent: createEntryIntent(validIntent),
        open,
        adverseEntrySlippagePriceUnits: '0',
        riskInput: {
          ...base,
          product: product as unknown as OrderRiskInput['product'],
          contract: contract as unknown as OrderRiskInput['contract'],
        },
      }),
    ).toMatchObject({ type: 'ENTRY_FILLED' });
    expect(Object.values(reads).every((count) => count === 1)).toBe(true);
  });

  it('does not allow the template to override trusted identity or versions', () => {
    for (const [field, riskValue, openValue] of [
      ['instrumentId', 'OTHER', undefined],
      ['direction', 'SHORT', undefined],
      ['strategyVersion', 'OTHER', undefined],
      ['datasetVersion', 'OTHER', undefined],
      ['contractId', undefined, 'OTHER'],
      ['productCode', undefined, 'OTHER'],
      ['signalExpiresAt', '2026-01-02T12:59:59Z', undefined],
    ] as const) {
      let riskInput = inputAtOpen(
        riskValue === undefined ? {} : { [field]: riskValue },
      );
      if (field === 'contractId') {
        riskInput = {
          ...riskInput,
          contract: { ...riskInput.contract, contractId: openValue },
        };
      }
      if (field === 'productCode') {
        riskInput = {
          ...riskInput,
          product: { ...riskInput.product, productCode: openValue },
        };
      }
      expectInputError(
        () =>
          executeEntryAtNextOpen({
            intent: createEntryIntent(validIntent),
            open,
            adverseEntrySlippagePriceUnits: '0',
            riskInput,
          }),
        field === 'productCode' ? 'instrumentId' : field,
      );
    }
  });

  it('rejects open identity and chronology mismatches before risk', () => {
    for (const [field, value, expected] of [
      ['instrumentId', 'OTHER', 'instrumentId'],
      ['contractId', 'OTHER', 'contractId'],
      ['openTime', validIntent.signalCloseTime, 'openTime'],
    ] as const) {
      expectInputError(
        () =>
          executeEntryAtNextOpen({
            intent: createEntryIntent(validIntent),
            open: createH1OpenEvent({ ...open, [field]: value }),
            adverseEntrySlippagePriceUnits: '0',
            riskInput: inputAtOpen(),
          }),
        expected,
      );
    }
  });

  it('captures historical optional risk fields', () => {
    const runCreatedAt = asInstantString('2026-01-03T12:00:00Z');
    expect(
      executeEntryAtNextOpen({
        intent: createEntryIntent(validIntent),
        open,
        adverseEntrySlippagePriceUnits: '0',
        riskInput: inputAtOpen({
          riskPolicyUseMode: 'HISTORICAL_RESEARCH',
          riskPolicyUseAt: runCreatedAt,
          backtestId: 'BACKTEST_ENTRY',
          runCreatedAt,
        }),
      }),
    ).toMatchObject({ type: 'ENTRY_FILLED' });
  });

  it('preserves a typed risk rejection when historical backtestId is absent', () => {
    const runCreatedAt = asInstantString('2026-01-03T12:00:00Z');
    expect(() =>
      executeEntryAtNextOpen({
        intent: createEntryIntent(validIntent),
        open,
        adverseEntrySlippagePriceUnits: '0',
        riskInput: inputAtOpen({
          riskPolicyUseMode: 'HISTORICAL_RESEARCH',
          riskPolicyUseAt: runCreatedAt,
          runCreatedAt,
        }),
      }),
    ).toThrow(RiskInputError);
  });

  it('rejects a nonpositive adjusted SHORT fill before risk', () => {
    expectInputError(
      () =>
        executeEntryAtNextOpen({
          intent: createEntryIntent({
            ...validIntent,
            direction: 'SHORT',
            stopPrice: '101',
          }),
          open,
          adverseEntrySlippagePriceUnits: '100',
          riskInput: inputAtOpen({ direction: 'SHORT' }),
        }),
      'fillPrice',
    );
  });

  it.each([
    ['adverseEntrySlippagePriceUnits', '-0.5'],
    ['adverseEntrySlippagePriceUnits', '1e2'],
    ['adverseEntrySlippagePriceUnits', '0.25'],
  ] as const)('rejects invalid or non-tick-aligned %s', (field, value) => {
    expectInputError(
      () =>
        executeEntryAtNextOpen({
          intent: createEntryIntent(validIntent),
          open,
          adverseEntrySlippagePriceUnits: value,
          riskInput: inputAtOpen(),
        }),
      field,
    );
  });

  it('rejects an adjusted fill that exceeds the decimal boundary before risk', () => {
    expectInputError(
      () =>
        executeEntryAtNextOpen({
          intent: createEntryIntent(validIntent),
          open: createH1OpenEvent({
            ...open,
            price: '9'.repeat(256),
          }),
          adverseEntrySlippagePriceUnits: '1',
          riskInput: new Proxy({} as OrderRiskInput, {
            get: () => {
              throw new Error('risk input must not be read after overflow');
            },
          }),
        }),
      'fillPrice',
    );
  });

  it('preserves the ordered risk reasons on cancellation', () => {
    const result = executeEntryAtNextOpen({
      intent: createEntryIntent(validIntent),
      open,
      adverseEntrySlippagePriceUnits: '0',
      riskInput: inputAtOpen({
        account: {
          ...inputAtOpen().account,
          killSwitchActive: true,
          dailyLoss: asDecimalString('100'),
          drawdownPct: asDecimalString('10'),
        },
      }),
    });
    expect(result.reasons).toEqual<RiskDecisionReason[]>([
      'KILL_SWITCH',
      'DAILY_LOSS_LIMIT',
      'DRAWDOWN_LIMIT',
    ]);
  });
});
