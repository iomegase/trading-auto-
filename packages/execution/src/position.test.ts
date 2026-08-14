import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  asDecimalString,
  asInstantString,
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
import { buildExecutionSchedule } from '../test-helpers/builders.js';

import {
  createEntryIntent,
  createH1ClosedBarEvent,
  createH1OpenEvent,
  createOpenPosition,
  executeEntryAtNextOpen,
  executeTrendExitAtNextOpen,
  ExecutionInputError,
  processPositionH1Bar,
  type EntryDirection,
  type EntryExecutionResult,
  type FilledEntryExecution,
  type EntryIntent,
  type OpenPosition,
  type OpenPositionInput,
} from './index.js';

type FilledEntry = Extract<
  EntryExecutionResult,
  { readonly type: 'ENTRY_FILLED' | 'ENTRY_REDUCED_AND_FILLED' }
>;

const EXECUTION_MODEL_VERSION = 'BAR_BASED_H1_V1' as const;
const EXIT_POLICY_VERSION = 'ICHIMOKU_KIJUN_EXIT_V1';
const trendProduct = buildProduct({ tickSize: '0.5', tickValue: '0.5' });
const trendContract = buildContract(trendProduct);
const trendSchedule = buildExecutionSchedule(trendContract);

function buildFilledEntry(
  direction: EntryDirection = 'LONG',
): Readonly<{ intent: EntryIntent; fill: FilledEntry }> {
  const isLong = direction === 'LONG';
  const intent = createEntryIntent({
    intentId: `ENTRY-${direction}`,
    instrumentId: 'FDXS',
    contractId: 'FDXS-202603',
    strategyVersion: 'ICHIMOKU_V1',
    datasetVersion: 'DATASET_V1',
    timeframe: '1h',
    direction,
    signalCloseTime: '2026-01-02T09:00:00Z',
    signalDecisionAt: '2026-01-02T09:00:00Z',
    expiresAt: '2026-01-02T13:00:00Z',
    stopPrice: isLong ? '99' : '101',
    requestedQuantity: '2',
    riskDecisionId: `RISK-${direction}`,
    riskDecisionStatus: 'APPROVE',
  });
  const product = buildProduct({ tickSize: '0.5', tickValue: '0.5' });
  const contract = buildContract(product);
  const baseRisk = buildOrderRiskInput({
    instrumentId: 'FDXS',
    direction,
    strategyVersion: intent.strategyVersion,
    datasetVersion: intent.datasetVersion,
    stopPrice: asDecimalString(intent.stopPrice),
    signalExpiresAt: asInstantString(intent.expiresAt),
    product,
    contract,
    policy: buildPolicy({ maxContractsPerPosition: '4' }),
    portfolio: buildPortfolio(),
  });
  const open = createH1OpenEvent({
    instrumentId: intent.instrumentId,
    contractId: intent.contractId,
    openTime: '2026-01-02T12:00:00Z',
    availableAt: '2026-01-02T12:00:00Z',
    price: '100',
  });
  const fill = executeEntryAtNextOpen({
    intent,
    open,
    adverseEntrySlippagePriceUnits: '0.5',
    riskInput: {
      ...baseRisk,
      decisionAt: open.openTime,
      riskPolicyUseAt: open.openTime,
    },
  });
  if (fill.type === 'ENTRY_CANCELLED') {
    throw new Error('Expected the position fixture to be filled.');
  }
  return Object.freeze({ intent, fill });
}

function positionInput(
  direction: EntryDirection = 'LONG',
  overrides: Partial<OpenPositionInput> = {},
): OpenPositionInput {
  const { intent, fill } = buildFilledEntry(direction);
  return {
    positionId: `POSITION-${direction}`,
    intent,
    fill,
    entryCostAccountCurrency: '1.25',
    tickSize: '0.5',
    executionModelVersion: EXECUTION_MODEL_VERSION,
    exitPolicyVersion: EXIT_POLICY_VERSION,
    ...overrides,
  };
}

function position(direction: EntryDirection = 'LONG'): OpenPosition {
  return createOpenPosition(positionInput(direction));
}

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

function bar(
  values: Partial<{
    openTime: string;
    closeTime: string;
    availableAt: string;
    open: string;
    high: string;
    low: string;
    close: string;
  }> = {},
) {
  return createH1ClosedBarEvent({
    instrumentId: 'FDXS',
    contractId: 'FDXS-202603',
    openTime: '2026-01-02T12:00:00Z',
    closeTime: '2026-01-02T13:00:00Z',
    availableAt: '2026-01-02T13:00:00Z',
    open: '100',
    high: '102',
    low: '99.5',
    close: '101',
    ...values,
  });
}

function openEvent(price = '100', openTime = '2026-01-02T12:00:00Z') {
  return createH1OpenEvent({
    instrumentId: 'FDXS',
    contractId: 'FDXS-202603',
    openTime,
    availableAt: openTime,
    price,
  });
}

function kijun(price = '100', computedAt = '2026-01-02T13:00:00Z') {
  return { price, computedAt };
}

function trendFixture(direction: EntryDirection = 'LONG') {
  const current = position(direction);
  const intent = processPositionH1Bar({
    position: current,
    openEvent: openEvent('100'),
    bar: bar(
      direction === 'LONG'
        ? { open: '100', high: '102', low: '99.5', close: '100' }
        : { open: '100', high: '100.5', low: '98', close: '100' },
    ),
    currentKijun: kijun(direction === 'LONG' ? '101' : '99'),
    decisionAt: '2026-01-02T13:00:00Z',
    adverseExitSlippagePriceUnits: '0.5',
  });
  if (intent.type !== 'TREND_EXIT_INTENT') {
    throw new Error('Expected a trend-exit intent fixture.');
  }
  return { current, intent };
}

function trendExecutionEvidence(
  openEvents: readonly ReturnType<typeof openEvent>[],
) {
  return {
    contract: trendContract,
    schedule: trendSchedule,
    openEvents,
  } as const;
}

describe('open futures positions', () => {
  it('derives a complete immutable position from intent, fill, and risk context', () => {
    const input = positionInput();
    const created = createOpenPosition(input);

    expect(created).toEqual({
      positionId: 'POSITION-LONG',
      intentId: input.intent.intentId,
      riskDecisionId: input.intent.riskDecisionId,
      instrumentId: input.intent.instrumentId,
      contractId: input.intent.contractId,
      strategyVersion: input.intent.strategyVersion,
      datasetVersion: input.intent.datasetVersion,
      riskPolicyVersion: input.fill.riskDecision.context.riskPolicyVersion,
      timeframe: '1h',
      direction: 'LONG',
      quantity: input.fill.quantity,
      economicEntryPrice: input.fill.fillPrice,
      accountingBasisPrice: input.fill.fillPrice,
      protectiveStopPrice: input.intent.stopPrice,
      entryCostAccountCurrency: '1.25',
      tickSize: '0.5',
      signalCloseTime: input.intent.signalCloseTime,
      signalDecisionAt: input.intent.signalDecisionAt,
      openedAt: input.fill.occurredAt,
      lastSettlementEffectiveAt: null,
      executionModelVersion: EXECUTION_MODEL_VERSION,
      exitPolicyVersion: EXIT_POLICY_VERSION,
      limitations: ['NO_INTRABAR_PATH', 'NO_PARTIAL_FILLS', 'NO_ORDER_BOOK'],
    });
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.limitations)).toBe(true);
    expectTypeOf(created.quantity).toEqualTypeOf<DecimalString>();
    expectTypeOf(created.openedAt).toEqualTypeOf<InstantString>();
  });

  it('rejects a cancelled entry result', () => {
    const input = positionInput();
    expectInputError(
      () =>
        createOpenPosition({
          ...input,
          fill: {
            type: 'ENTRY_CANCELLED',
            intentId: input.intent.intentId,
            occurredAt: input.fill.occurredAt,
            quantity: asDecimalString('0'),
            reasons: ['SIGNAL_EXPIRED'],
            riskDecision: null,
          } as unknown as FilledEntryExecution,
        }),
      'fill',
    );
  });

  it('requires the filled entry to carry the execution limitations', () => {
    const input = positionInput();
    expectInputError(
      () =>
        createOpenPosition({
          ...input,
          fill: { ...input.fill, limitations: [] },
        }),
      'limitations',
    );
  });

  it.each([
    ['positionId', ''],
    ['entryCostAccountCurrency', '-1'],
    ['tickSize', '0'],
    ['executionModelVersion', 'OTHER'],
    ['exitPolicyVersion', ''],
  ] as const)('rejects invalid %s', (field, value) => {
    expectInputError(
      () =>
        createOpenPosition({
          ...positionInput(),
          [field]: value,
        }),
      field,
    );
  });

  it.each([
    ['intentId', 'OTHER', 'intentId'],
    ['quantity', asDecimalString('1'), 'quantity'],
    ['fillPrice', asDecimalString('100'), 'entryPrice'],
    ['occurredAt', asInstantString('2026-01-02T12:00:01Z'), 'occurredAt'],
  ] as const)(
    'rejects a fill with mismatched %s',
    (field, value, expectedField) => {
      const input = positionInput();
      expectInputError(
        () =>
          createOpenPosition({
            ...input,
            fill: { ...input.fill, [field]: value },
          }),
        expectedField,
      );
    },
  );

  it.each([
    ['strategyVersion', 'OTHER'],
    ['datasetVersion', 'OTHER'],
    ['contractId', 'OTHER'],
    ['productCode', 'OTHER'],
    ['entryPrice', asDecimalString('100')],
    ['stopPrice', asDecimalString('98.5')],
  ] as const)('rejects mismatched risk context %s', (field, value) => {
    const input = positionInput();
    expectInputError(
      () =>
        createOpenPosition({
          ...input,
          fill: {
            ...input.fill,
            riskDecision: {
              ...input.fill.riskDecision,
              context: {
                ...input.fill.riskDecision.context,
                [field]: value,
              },
            },
          },
        }),
      field,
    );
  });

  it.each([
    ['99.25', '100.5', 'protectiveStopPrice'],
    ['99', '100.25', 'economicEntryPrice'],
    ['101', '100.5', 'protectiveStopPrice'],
  ] as const)(
    'rejects stop %s and fill %s when the executable price grid is invalid',
    (stopPrice, fillPrice, field) => {
      const input = positionInput();
      expectInputError(
        () =>
          createOpenPosition({
            ...input,
            intent: {
              ...input.intent,
              stopPrice: asDecimalString(stopPrice),
            },
            fill: {
              ...input.fill,
              fillPrice: asDecimalString(fillPrice),
              riskDecision: {
                ...input.fill.riskDecision,
                context: {
                  ...input.fill.riskDecision.context,
                  entryPrice: asDecimalString(fillPrice),
                  stopPrice: asDecimalString(stopPrice),
                },
              },
            },
          }),
        field,
      );
    },
  );

  it('reads the filled-entry discriminator exactly once', () => {
    const input = positionInput();
    let reads = 0;
    const fill = { ...input.fill } as Record<string, unknown>;
    Object.defineProperty(fill, 'type', {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? input.fill.type : 'ENTRY_CANCELLED';
      },
    });

    expect(
      createOpenPosition({
        ...input,
        fill: fill as unknown as FilledEntryExecution,
      }).positionId,
    ).toBe('POSITION-LONG');
    expect(reads).toBe(1);
  });

  it('maps hostile position-construction records to typed errors', () => {
    for (const value of [null, [], new Date(0)]) {
      expectInputError(
        () => createOpenPosition(value as unknown as OpenPositionInput),
        'input',
      );
    }
    const descriptorTrap = new Proxy(positionInput(), {
      getOwnPropertyDescriptor: () => {
        throw new Error('descriptor trap');
      },
    });
    expectInputError(() => createOpenPosition(descriptorTrap), 'positionId');

    for (const descriptor of [
      { enumerable: false, value: 'POSITION-LONG' },
      { enumerable: true, set: () => undefined },
      {
        enumerable: true,
        get: () => {
          throw new Error('getter trap');
        },
      },
    ]) {
      const input = { ...positionInput() } as Record<string, unknown>;
      Object.defineProperty(input, 'positionId', descriptor);
      expectInputError(
        () => createOpenPosition(input as unknown as OpenPositionInput),
        'positionId',
      );
    }
  });

  it('rejects invalid fresh risk status, availability, and policy version', () => {
    const input = positionInput();
    expectInputError(
      () =>
        createOpenPosition({
          ...input,
          fill: {
            ...input.fill,
            riskDecision: { ...input.fill.riskDecision, status: 'REJECT' },
          },
        }),
      'riskDecision',
    );
    expectInputError(
      () =>
        createOpenPosition({
          ...input,
          fill: {
            ...input.fill,
            availableAt: asInstantString('2026-01-02T12:00:01Z'),
          },
        }),
      'availableAt',
    );
    expectInputError(
      () =>
        createOpenPosition({
          ...input,
          fill: {
            ...input.fill,
            riskDecision: {
              ...input.fill.riskDecision,
              context: {
                ...input.fill.riskDecision.context,
                riskPolicyVersion: '',
              },
            },
          },
        }),
      'riskPolicyVersion',
    );
    expectInputError(
      () =>
        createOpenPosition({
          ...input,
          fill: {
            ...input.fill,
            occurredAt: input.intent.signalCloseTime,
          },
        }),
      'occurredAt',
    );
    expectInputError(
      () =>
        createOpenPosition({
          ...input,
          intent: {
            ...input.intent,
            signalDecisionAt: asInstantString('2026-01-02T12:00:01Z'),
          },
        }),
      'occurredAt',
    );
  });

  it('maps malformed fill and risk-context values to typed errors', () => {
    const input = positionInput();
    for (const [part, field, value, expected] of [
      ['fill', 'quantity', 'bad', 'quantity'],
      ['fill', 'fillPrice', 'bad', 'fillPrice'],
      ['riskDecision', 'quantity', 'bad', 'quantity'],
      ['context', 'entryPrice', 'bad', 'entryPrice'],
      ['context', 'stopPrice', 'bad', 'stopPrice'],
      ['context', 'decisionAt', 'not-an-instant', 'decisionAt'],
    ] as const) {
      const fill =
        part === 'fill'
          ? { ...input.fill, [field]: value }
          : {
              ...input.fill,
              riskDecision:
                part === 'riskDecision'
                  ? { ...input.fill.riskDecision, [field]: value }
                  : {
                      ...input.fill.riskDecision,
                      context: {
                        ...input.fill.riskDecision.context,
                        [field]: value,
                      },
                    },
            };
      expectInputError(
        () =>
          createOpenPosition({
            ...input,
            fill: fill as unknown as FilledEntryExecution,
          }),
        expected,
      );
    }
  });
});

describe('fixed protective stops and close-known trend exits', () => {
  it('does not read top-level closed-bar or Kijun properties after a gap', () => {
    const input: Record<string, unknown> = {
      position: position('LONG'),
      openEvent: openEvent('98'),
      decisionAt: '2026-01-02T12:00:00Z',
      adverseExitSlippagePriceUnits: '0.5',
    };
    for (const field of ['bar', 'currentKijun']) {
      Object.defineProperty(input, field, {
        enumerable: true,
        get: () => {
          throw new Error(`${field} must not be observed after a gap stop.`);
        },
      });
    }

    expect(
      processPositionH1Bar(
        input as unknown as Parameters<typeof processPositionH1Bar>[0],
      ),
    ).toMatchObject({ type: 'STOP_GAP_EXIT', fillPrice: '97.5' });
  });

  it('fills a LONG opening gap at the adverse available open', () => {
    const result = processPositionH1Bar({
      position: position('LONG'),
      openEvent: openEvent('98'),
      bar: new Proxy({} as ReturnType<typeof bar>, {
        get: () => {
          throw new Error('The closed bar must not be read after a gap stop.');
        },
      }),
      currentKijun: new Proxy({} as { price: string; computedAt: string }, {
        get: () => {
          throw new Error('Kijun must not be read after a gap stop.');
        },
      }),
      decisionAt: '2026-01-02T12:00:00Z',
      adverseExitSlippagePriceUnits: '0.5',
    });

    expect(result).toEqual({
      type: 'STOP_GAP_EXIT',
      positionId: 'POSITION-LONG',
      occurredAt: '2026-01-02T12:00:00Z',
      availableAt: '2026-01-02T12:00:00Z',
      fillPrice: '97.5',
      quantity: '2',
      protectiveStopPrice: '99',
      limitations: ['NO_INTRABAR_PATH', 'NO_PARTIAL_FILLS', 'NO_ORDER_BOOK'],
    });
  });

  it('fills a SHORT opening gap symmetrically', () => {
    expect(
      processPositionH1Bar({
        position: position('SHORT'),
        openEvent: openEvent('102'),
        bar: bar({ open: '102', high: '103', low: '99', close: '100' }),
        currentKijun: null,
        decisionAt: '2026-01-02T13:00:00Z',
        adverseExitSlippagePriceUnits: '0.5',
      }),
    ).toMatchObject({ type: 'STOP_GAP_EXIT', fillPrice: '102.5' });
  });

  it.each([
    ['LONG', { open: '100', high: '102', low: '98.5', close: '101' }, '98.5'],
    ['SHORT', { open: '100', high: '101.5', low: '98', close: '99' }, '101.5'],
  ] as const)(
    'fills a %s intrabar stop at the adverse stop adjustment',
    (direction, values, fillPrice) => {
      expect(
        processPositionH1Bar({
          position: position(direction),
          openEvent: openEvent(values.open),
          bar: bar(values),
          currentKijun: null,
          decisionAt: '2026-01-02T13:00:00Z',
          adverseExitSlippagePriceUnits: '0.5',
        }),
      ).toMatchObject({
        type: 'PROTECTIVE_STOP_EXIT',
        occurredAt: '2026-01-02T13:00:00Z',
        fillPrice,
      });
    },
  );

  it('applies STOP_FIRST when a LONG stop and trend exit coexist', () => {
    expect(
      processPositionH1Bar({
        position: position('LONG'),
        openEvent: openEvent('100'),
        bar: bar({ open: '100', high: '101', low: '98.5', close: '100' }),
        currentKijun: kijun('101'),
        decisionAt: '2026-01-02T13:00:00Z',
        adverseExitSlippagePriceUnits: '0.5',
      }),
    ).toMatchObject({ type: 'PROTECTIVE_STOP_EXIT', fillPrice: '98.5' });
  });

  it.each([
    ['LONG', { open: '100', high: '102', low: '99.5', close: '100' }, '101'],
    ['SHORT', { open: '100', high: '100.5', low: '98', close: '100' }, '99'],
  ] as const)(
    'creates a %s trend-exit intent from the causal closed-bar Kijun',
    (direction, values, kijunPrice) => {
      const result = processPositionH1Bar({
        position: position(direction),
        openEvent: openEvent(values.open),
        bar: bar(values),
        currentKijun: kijun(kijunPrice),
        decisionAt: '2026-01-02T13:00:00Z',
        adverseExitSlippagePriceUnits: '0.5',
      });
      expect(result).toEqual({
        type: 'TREND_EXIT_INTENT',
        positionId: `POSITION-${direction}`,
        occurredAt: '2026-01-02T13:00:00Z',
        availableAt: '2026-01-02T13:00:00Z',
        referencePrice: '100',
        kijunPrice,
        quantity: '2',
        fillModel: 'NEXT_TRADABLE_PRICE',
        exitPolicyVersion: EXIT_POLICY_VERSION,
        limitations: ['NO_INTRABAR_PATH', 'NO_PARTIAL_FILLS', 'NO_ORDER_BOOK'],
      });
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  it.each(['LONG', 'SHORT'] as const)(
    'keeps a %s position open when close equals current Kijun',
    (direction) => {
      const current = position(direction);
      const before = structuredClone(current);
      const result = processPositionH1Bar({
        position: current,
        openEvent: openEvent('100'),
        bar: bar({ open: '100', high: '100.5', low: '99.5', close: '100' }),
        currentKijun: kijun('100'),
        decisionAt: '2026-01-02T13:00:00Z',
        adverseExitSlippagePriceUnits: '0.5',
      });
      expect(result).toEqual({
        type: 'POSITION_REMAINS_OPEN',
        positionId: `POSITION-${direction}`,
        evaluatedAt: '2026-01-02T13:00:00Z',
        availableAt: '2026-01-02T13:00:00Z',
        limitations: ['NO_INTRABAR_PATH', 'NO_PARTIAL_FILLS', 'NO_ORDER_BOOK'],
      });
      expect(current).toEqual(before);
      expect(current.protectiveStopPrice).toBe(
        direction === 'LONG' ? '99' : '101',
      );
    },
  );

  it('fills a close-known LONG trend exit only at a later H1 open', () => {
    const { current, intent } = trendFixture('LONG');
    const nextOpen = openEvent('98', '2026-01-02T14:00:00Z');

    expect(
      executeTrendExitAtNextOpen({
        position: current,
        intent,
        open: nextOpen,
        decisionAt: '2026-01-02T14:00:00Z',
        adverseExitSlippagePriceUnits: '0.5',
        ...trendExecutionEvidence([nextOpen]),
      }),
    ).toEqual({
      type: 'TREND_EXIT_FILLED',
      positionId: current.positionId,
      instrumentId: current.instrumentId,
      contractId: current.contractId,
      direction: 'LONG',
      intentOccurredAt: '2026-01-02T13:00:00Z',
      intentAvailableAt: '2026-01-02T13:00:00Z',
      occurredAt: '2026-01-02T14:00:00Z',
      availableAt: '2026-01-02T14:00:00Z',
      referencePrice: '100',
      kijunPrice: '101',
      fillPrice: '97.5',
      quantity: '2',
      exitPolicyVersion: EXIT_POLICY_VERSION,
      limitations: ['NO_INTRABAR_PATH', 'NO_PARTIAL_FILLS', 'NO_ORDER_BOOK'],
    });
  });

  it('fills a SHORT trend exit with symmetric adverse slippage', () => {
    const { current, intent } = trendFixture('SHORT');
    const nextOpen = openEvent('102', '2026-01-02T14:00:00Z');
    expect(
      executeTrendExitAtNextOpen({
        position: current,
        intent,
        open: nextOpen,
        decisionAt: '2026-01-02T14:00:00Z',
        adverseExitSlippagePriceUnits: '0.5',
        ...trendExecutionEvidence([nextOpen]),
      }),
    ).toMatchObject({
      type: 'TREND_EXIT_FILLED',
      direction: 'SHORT',
      fillPrice: '102.5',
    });
  });

  it('selects the first tradable open after a delayed trend intent is available', () => {
    const { current, intent } = trendFixture('LONG');
    const delayedIntent = {
      ...intent,
      availableAt: asInstantString('2026-01-02T13:30:00Z'),
    };
    const nextOpen = openEvent('98', '2026-01-02T14:00:00Z');

    expect(
      executeTrendExitAtNextOpen({
        position: current,
        intent: delayedIntent,
        open: nextOpen,
        decisionAt: nextOpen.availableAt,
        adverseExitSlippagePriceUnits: '0.5',
        ...trendExecutionEvidence([nextOpen]),
      }).occurredAt,
    ).toBe(nextOpen.openTime);
  });

  it('rejects forged trend intents before filling them', () => {
    const { current, intent } = trendFixture();
    const nextOpen = openEvent('98', '2026-01-02T14:00:00Z');
    const base = {
      position: current,
      intent,
      open: nextOpen,
      decisionAt: '2026-01-02T14:00:00Z',
      adverseExitSlippagePriceUnits: '0.5',
      ...trendExecutionEvidence([nextOpen]),
    } as const;
    for (const [field, value, expected] of [
      ['type', 'POSITION_REMAINS_OPEN', 'intent'],
      ['positionId', 'OTHER', 'positionId'],
      ['quantity', '1', 'quantity'],
      ['referencePrice', 'bad', 'referencePrice'],
      ['referencePrice', '100.25', 'referencePrice'],
      ['kijunPrice', 'bad', 'kijunPrice'],
      ['occurredAt', 'bad', 'occurredAt'],
      ['availableAt', '2026-01-02T12:59:59Z', 'availableAt'],
      ['fillModel', 'SAME_CLOSE', 'fillModel'],
      ['exitPolicyVersion', 'OTHER', 'exitPolicyVersion'],
      ['limitations', [], 'limitations'],
    ] as const) {
      expectInputError(
        () =>
          executeTrendExitAtNextOpen({
            ...base,
            intent: { ...intent, [field]: value },
          }),
        expected,
      );
    }
  });

  it.each([
    [
      'LONG',
      {
        referencePrice: asDecimalString('101'),
        kijunPrice: asDecimalString('100'),
      },
      'referencePrice',
    ],
    [
      'SHORT',
      {
        referencePrice: asDecimalString('99'),
        kijunPrice: asDecimalString('100'),
      },
      'referencePrice',
    ],
    [
      'LONG',
      {
        occurredAt: asInstantString('2026-01-02T11:00:00Z'),
        availableAt: asInstantString('2026-01-02T11:00:00Z'),
      },
      'occurredAt',
    ],
  ] as const)(
    'rejects a %s trend intent that cannot originate from the open position',
    (direction, overrides, field) => {
      const { current, intent } = trendFixture(direction);
      const nextOpen = openEvent('100', '2026-01-02T14:00:00Z');
      expectInputError(
        () =>
          executeTrendExitAtNextOpen({
            position: current,
            intent: { ...intent, ...overrides },
            open: nextOpen,
            decisionAt: '2026-01-02T14:00:00Z',
            adverseExitSlippagePriceUnits: '0.5',
            ...trendExecutionEvidence([nextOpen]),
          }),
        field,
      );
    },
  );

  it('rejects noncausal, mismatched, and off-grid trend-exit opens', () => {
    const { current, intent } = trendFixture();
    const nextOpen = openEvent('98', '2026-01-02T14:00:00Z');
    const base = {
      position: current,
      intent,
      open: nextOpen,
      decisionAt: '2026-01-02T14:00:00Z',
      adverseExitSlippagePriceUnits: '0.5',
      ...trendExecutionEvidence([nextOpen]),
    } as const;

    for (const [field, value, expected] of [
      ['instrumentId', 'OTHER', 'instrumentId'],
      ['contractId', 'OTHER-202603', 'contractId'],
      ['price', '98.25', 'open.price'],
    ] as const) {
      expectInputError(
        () =>
          executeTrendExitAtNextOpen({
            ...base,
            open: createH1OpenEvent({ ...base.open, [field]: value }),
          }),
        expected,
      );
    }
    expectInputError(
      () =>
        executeTrendExitAtNextOpen({
          ...base,
          open: openEvent('98', intent.occurredAt),
          decisionAt: intent.availableAt,
        }),
      'openTime',
    );
    expectInputError(
      () =>
        executeTrendExitAtNextOpen({
          ...base,
          intent: {
            ...intent,
            availableAt: asInstantString('2026-01-02T13:30:00Z'),
          },
          open: openEvent('98', '2026-01-02T13:15:00Z'),
        }),
      'openTime',
    );
    expectInputError(
      () =>
        executeTrendExitAtNextOpen({
          ...base,
          open: createH1OpenEvent({
            ...base.open,
            availableAt: '2026-01-02T14:00:01Z',
          }),
        }),
      'decisionAt',
    );
    expectInputError(
      () =>
        executeTrendExitAtNextOpen({
          ...base,
          adverseExitSlippagePriceUnits: '0.25',
        }),
      'adverseExitSlippagePriceUnits',
    );
    expectInputError(
      () =>
        executeTrendExitAtNextOpen({
          ...base,
          open: openEvent('0.5', '2026-01-02T14:00:00Z'),
        }),
      'fillPrice',
    );
  });

  it('rejects a later open when an earlier tradable H1 open exists', () => {
    const { current, intent } = trendFixture();
    const earliest = openEvent('98', '2026-01-02T14:00:00Z');
    const later = openEvent('97', '2026-01-02T15:00:00Z');

    expectInputError(
      () =>
        executeTrendExitAtNextOpen({
          position: current,
          intent,
          open: later,
          decisionAt: later.availableAt,
          adverseExitSlippagePriceUnits: '0.5',
          ...trendExecutionEvidence([earliest, later]),
        }),
      'openTime',
    );
  });

  it('maps a revoked trend-exit input to a typed error', () => {
    const revoked = Proxy.revocable(
      {} as Parameters<typeof executeTrendExitAtNextOpen>[0],
      {},
    );
    revoked.revoke();
    expectInputError(() => executeTrendExitAtNextOpen(revoked.proxy), 'input');
  });

  it('requires a causal current Kijun only after the stop checks', () => {
    expectInputError(
      () =>
        processPositionH1Bar({
          position: position('LONG'),
          openEvent: openEvent(),
          bar: bar(),
          currentKijun: kijun('100', '2026-01-02T12:59:59Z'),
          decisionAt: '2026-01-02T13:00:00Z',
          adverseExitSlippagePriceUnits: '0.5',
        }),
      'currentKijun.computedAt',
    );
    expectInputError(
      () =>
        processPositionH1Bar({
          position: position('LONG'),
          openEvent: openEvent(),
          bar: bar(),
          currentKijun: kijun('100', '2026-01-02T13:00:00.000000001Z'),
          decisionAt: '2026-01-02T13:00:00Z',
          adverseExitSlippagePriceUnits: '0.5',
        }),
      'currentKijun.computedAt',
    );
    expectInputError(
      () =>
        processPositionH1Bar({
          position: position('LONG'),
          openEvent: openEvent(),
          bar: bar(),
          currentKijun: null,
          decisionAt: '2026-01-02T13:00:00Z',
          adverseExitSlippagePriceUnits: '0.5',
        }),
      'currentKijun',
    );
  });

  it('rejects mismatched data, pre-position bars, and non-tick adjustments', () => {
    expectInputError(
      () =>
        processPositionH1Bar({
          position: position(),
          openEvent: openEvent(),
          bar: createH1ClosedBarEvent({
            ...bar(),
            contractId: 'OTHER',
          }),
          currentKijun: kijun(),
          decisionAt: '2026-01-02T13:00:00Z',
          adverseExitSlippagePriceUnits: '0.5',
        }),
      'contractId',
    );
    expectInputError(
      () =>
        processPositionH1Bar({
          position: position(),
          openEvent: openEvent('100', '2026-01-02T10:00:00Z'),
          bar: bar({
            openTime: '2026-01-02T10:00:00Z',
            closeTime: '2026-01-02T11:00:00Z',
            availableAt: '2026-01-02T11:00:00Z',
          }),
          currentKijun: kijun('100', '2026-01-02T11:00:00Z'),
          decisionAt: '2026-01-02T11:00:00Z',
          adverseExitSlippagePriceUnits: '0.5',
        }),
      'bar.openTime',
    );
    expectInputError(
      () =>
        processPositionH1Bar({
          position: position(),
          openEvent: openEvent(),
          bar: bar(),
          currentKijun: kijun(),
          decisionAt: '2026-01-02T13:00:00Z',
          adverseExitSlippagePriceUnits: '0.25',
        }),
      'adverseExitSlippagePriceUnits',
    );
  });

  it('maps a revoked limitations array to a stable execution error', () => {
    const current = position();
    const revoked = Proxy.revocable([...current.limitations], {});
    revoked.revoke();
    expectInputError(
      () =>
        processPositionH1Bar({
          position: {
            ...current,
            limitations: revoked.proxy,
          },
          openEvent: openEvent(),
          bar: bar(),
          currentKijun: kijun(),
          decisionAt: '2026-01-02T13:00:00Z',
          adverseExitSlippagePriceUnits: '0.5',
        }),
      'limitations',
    );
  });

  it('rejects forged position enums and hostile limitation arrays', () => {
    const current = position();
    const base = {
      position: current,
      openEvent: openEvent(),
      bar: bar(),
      currentKijun: kijun(),
      decisionAt: '2026-01-02T13:00:00Z',
      adverseExitSlippagePriceUnits: '0.5',
    } as const;
    for (const [field, value, expected] of [
      ['executionModelVersion', 'OTHER', 'executionModelVersion'],
      ['timeframe', '4h', 'timeframe'],
      ['direction', 'SIDEWAYS', 'direction'],
    ] as const) {
      expectInputError(
        () =>
          processPositionH1Bar({
            ...base,
            position: { ...current, [field]: value },
          }),
        expected,
      );
    }

    const hostileLimitations: Array<readonly unknown[]> = [
      [],
      ['WRONG', ...current.limitations.slice(1)],
      new Array(3),
    ];
    const descriptorTrap = new Proxy([...current.limitations], {
      getOwnPropertyDescriptor: () => {
        throw new Error('descriptor trap');
      },
    });
    hostileLimitations.push(descriptorTrap);
    const setterOnly: unknown[] = [...current.limitations];
    Object.defineProperty(setterOnly, '0', {
      enumerable: true,
      set: () => undefined,
    });
    hostileLimitations.push(setterOnly);
    const getterTrap: unknown[] = [...current.limitations];
    Object.defineProperty(getterTrap, '0', {
      enumerable: true,
      get: () => {
        throw new Error('getter trap');
      },
    });
    hostileLimitations.push(getterTrap);

    for (const limitations of hostileLimitations) {
      expectInputError(
        () =>
          processPositionH1Bar({
            ...base,
            position: { ...current, limitations } as OpenPosition,
          }),
        'limitations',
      );
    }
    expectInputError(
      () =>
        processPositionH1Bar({
          ...base,
          position: { ...current, openedAt: 'invalid' as InstantString },
        }),
      'openedAt',
    );
    expectInputError(
      () =>
        processPositionH1Bar({
          ...base,
          position: {
            ...current,
            openedAt: 1 as unknown as InstantString,
          },
        }),
      'openedAt',
    );
    expectInputError(
      () =>
        processPositionH1Bar({
          ...base,
          position: {
            ...current,
            limitations: {} as unknown as OpenPosition['limitations'],
          },
        }),
      'limitations',
    );
  });

  it('rejects forged position provenance, chronology, and price invariants', () => {
    const current = position();
    const base = {
      position: current,
      openEvent: openEvent('98'),
      bar: bar(),
      currentKijun: null,
      decisionAt: '2026-01-02T12:00:00Z',
      adverseExitSlippagePriceUnits: '0.5',
    } as const;
    for (const [field, value, expected] of [
      ['positionId', ' ', 'positionId'],
      ['intentId', '', 'intentId'],
      ['riskDecisionId', '\t', 'riskDecisionId'],
      ['strategyVersion', '', 'strategyVersion'],
      ['datasetVersion', '', 'datasetVersion'],
      ['riskPolicyVersion', '', 'riskPolicyVersion'],
      ['exitPolicyVersion', '', 'exitPolicyVersion'],
      ['instrumentId', current.contractId, 'contractId'],
      ['economicEntryPrice', '100.25', 'economicEntryPrice'],
      ['accountingBasisPrice', '100.25', 'accountingBasisPrice'],
      ['protectiveStopPrice', '99.25', 'protectiveStopPrice'],
      ['protectiveStopPrice', '101', 'protectiveStopPrice'],
      ['signalDecisionAt', 'invalid', 'signalDecisionAt'],
      ['signalDecisionAt', '2026-01-02T08:59:59Z', 'signalDecisionAt'],
      ['signalDecisionAt', '2026-01-02T12:00:01Z', 'openedAt'],
      ['openedAt', current.signalCloseTime, 'openedAt'],
      [
        'lastSettlementEffectiveAt',
        current.openedAt,
        'lastSettlementEffectiveAt',
      ],
    ] as const) {
      expectInputError(
        () =>
          processPositionH1Bar({
            ...base,
            position: { ...current, [field]: value },
          }),
        expected,
      );
    }
  });

  it('rejects open and closed-bar identity, timing, and availability mismatches', () => {
    const current = position();
    const base = {
      position: current,
      openEvent: openEvent(),
      bar: bar(),
      currentKijun: kijun(),
      decisionAt: '2026-01-02T13:00:00Z',
      adverseExitSlippagePriceUnits: '0.5',
    } as const;
    for (const [part, field, value, expected] of [
      ['openEvent', 'instrumentId', 'OTHER', 'instrumentId'],
      ['openEvent', 'contractId', 'OTHER', 'contractId'],
      [
        'openEvent',
        'availableAt',
        '2026-01-02T13:00:00.000000001Z',
        'decisionAt',
      ],
      ['bar', 'instrumentId', 'OTHER', 'instrumentId'],
      ['bar', 'contractId', 'OTHER', 'contractId'],
      ['bar', 'openTime', '2026-01-02T12:00:01Z', 'bar.openTime'],
      ['bar', 'open', '100.5', 'bar.openTime'],
      ['bar', 'availableAt', '2026-01-02T13:00:00.000000001Z', 'decisionAt'],
    ] as const) {
      const next = { ...base };
      if (part === 'openEvent') {
        next.openEvent = createH1OpenEvent({
          ...base.openEvent,
          [field]: value,
        });
      } else {
        next.bar = createH1ClosedBarEvent({
          ...base.bar,
          ...(field === 'openTime'
            ? {
                openTime: value,
                closeTime: '2026-01-02T13:00:01Z',
                availableAt: '2026-01-02T13:00:01Z',
              }
            : { [field]: value }),
        });
      }
      expectInputError(() => processPositionH1Bar(next), expected);
    }
  });

  it('rejects off-grid open and closed-bar prices before execution', () => {
    expectInputError(
      () =>
        processPositionH1Bar({
          position: position(),
          openEvent: openEvent('98.25'),
          bar: bar(),
          currentKijun: null,
          decisionAt: '2026-01-02T12:00:00Z',
          adverseExitSlippagePriceUnits: '0.5',
        }),
      'openEvent.price',
    );

    for (const [field, value] of [
      ['high', '102.25'],
      ['low', '99.25'],
      ['close', '101.25'],
    ] as const) {
      expectInputError(
        () =>
          processPositionH1Bar({
            position: position(),
            openEvent: openEvent(),
            bar: bar({ [field]: value }),
            currentKijun: kijun(),
            decisionAt: '2026-01-02T13:00:00Z',
            adverseExitSlippagePriceUnits: '0.5',
          }),
        `bar.${field}`,
      );
    }
  });

  it('rejects a nonpositive adverse gap fill', () => {
    expectInputError(
      () =>
        processPositionH1Bar({
          position: position('LONG'),
          openEvent: openEvent('0.5'),
          bar: bar({ open: '0.5', high: '1', low: '0.5', close: '1' }),
          currentKijun: null,
          decisionAt: '2026-01-02T13:00:00Z',
          adverseExitSlippagePriceUnits: '0.5',
        }),
      'fillPrice',
    );
  });

  it('is unchanged when unrelated future bars exist outside the single-bar boundary', () => {
    const current = position('LONG');
    const atT = bar({ open: '100', high: '102', low: '98.5', close: '101' });
    const baseline = processPositionH1Bar({
      position: current,
      openEvent: openEvent(),
      bar: atT,
      currentKijun: null,
      decisionAt: '2026-01-02T13:00:00Z',
      adverseExitSlippagePriceUnits: '0.5',
    });
    const dataset = [
      atT,
      bar({
        openTime: '2026-01-02T13:00:00Z',
        closeTime: '2026-01-02T14:00:00Z',
        availableAt: '2026-01-02T14:00:00Z',
        open: '1000',
        high: '1001',
        low: '999',
        close: '1000',
      }),
    ];
    const first = dataset.at(0);
    if (first === undefined) throw new Error('Expected a causal bar prefix.');
    expect(
      processPositionH1Bar({
        position: current,
        openEvent: openEvent(),
        bar: first,
        currentKijun: null,
        decisionAt: '2026-01-02T13:00:00Z',
        adverseExitSlippagePriceUnits: '0.5',
      }),
    ).toEqual(baseline);
  });
});
