import { describe, expect, it } from 'vitest';
import {
  asDecimalString,
  asInstantString,
  createFuturesContract,
  type FuturesContract,
} from '@trading-auto/domain';
import {
  buildAccount,
  buildContract,
  buildOrderRiskInput,
  buildPolicy,
  buildPortfolio,
  buildProduct,
} from '../../risk/test-helpers/builders.js';
import { Decimal } from 'decimal.js';

import {
  createEntryIntent,
  createH1OpenEvent,
  createOpenPosition,
  createRollSchedule,
  executeContractRollover,
  executeEntryAtNextOpen,
  ExecutionInputError,
  type EntryDirection,
  type OpenPosition,
  type RollScheduleEntryInput,
  type RollScheduleInput,
} from './index.js';

const product = buildProduct({ tickSize: '0.5', tickValue: '0.5' });
const oldContract = buildContract(product);
const nextContract = createFuturesContract(
  {
    contractId: 'FDXS-202606',
    productCode: product.productCode,
    firstTradeAt: '2025-12-15T00:00:00Z',
    lastTradeAt: '2026-06-18T21:00:00Z',
    expiryAt: '2026-06-19T12:00:00Z',
    settlementType: 'CASH',
  },
  product,
);
const laterContract = createFuturesContract(
  {
    contractId: 'FDXS-202609',
    productCode: product.productCode,
    firstTradeAt: '2025-12-20T00:00:00Z',
    lastTradeAt: '2026-09-17T21:00:00Z',
    expiryAt: '2026-09-18T12:00:00Z',
    settlementType: 'CASH',
  },
  product,
);

const rollAt = '2026-01-02T12:30:00Z';
const firstRoll: RollScheduleEntryInput = {
  fromContractId: oldContract.contractId,
  toContractId: nextContract.contractId,
  rollAt,
};
const validSchedule: RollScheduleInput = {
  version: 'FDXS_ROLL_SCHEDULE_V1',
  source: 'SYNTHETIC_RESEARCH',
  observedAt: '2026-01-02T08:00:00Z',
  entries: [firstRoll],
};

function expectError(
  action: () => unknown,
  code:
    'INVALID_EXECUTION_INPUT' | 'INVALID_EXECUTION_SCHEDULE' | 'INVALID_DATA',
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

function contracts(): readonly FuturesContract[] {
  return [oldContract, nextContract, laterContract];
}

function oldPosition(direction: EntryDirection = 'LONG'): OpenPosition {
  const intent = createEntryIntent({
    intentId: `ROLL-OLD-ENTRY-${direction}`,
    instrumentId: product.productCode,
    contractId: oldContract.contractId,
    strategyVersion: 'ICHIMOKU_V1',
    datasetVersion: 'DATASET_V1',
    timeframe: '1h',
    direction,
    signalCloseTime: '2026-01-02T09:00:00Z',
    signalDecisionAt: '2026-01-02T09:00:00Z',
    expiresAt: '2026-01-02T13:00:00Z',
    stopPrice: direction === 'LONG' ? '99' : '101',
    requestedQuantity: '2',
    riskDecisionId: `ROLL-OLD-RISK-${direction}`,
    riskDecisionStatus: 'APPROVE',
  });
  const open = createH1OpenEvent({
    instrumentId: product.productCode,
    contractId: oldContract.contractId,
    openTime: '2026-01-02T12:00:00Z',
    availableAt: '2026-01-02T12:00:00Z',
    price: '100',
  });
  const risk = buildOrderRiskInput({
    direction,
    product,
    contract: oldContract,
    strategyVersion: intent.strategyVersion,
    datasetVersion: intent.datasetVersion,
    signalExpiresAt: intent.expiresAt,
    policy: buildPolicy({ maxContractsPerPosition: '4' }),
    portfolio: buildPortfolio(),
  });
  const fill = executeEntryAtNextOpen({
    intent,
    open,
    adverseEntrySlippagePriceUnits: '0',
    riskInput: {
      ...risk,
      decisionAt: open.openTime,
      riskPolicyUseAt: open.openTime,
    },
  });
  if (fill.type === 'ENTRY_CANCELLED')
    throw new Error('Expected old position fill.');
  return createOpenPosition({
    positionId: `ROLL-OLD-POSITION-${direction}`,
    intent,
    fill,
    entryCostAccountCurrency: '0',
    tickSize: '0.5',
    executionModelVersion: 'BAR_BASED_H1_V1',
    exitPolicyVersion: 'ICHIMOKU_KIJUN_EXIT_V1',
  });
}

function rolloverInput(
  direction: EntryDirection = 'LONG',
  overrides: Record<string, unknown> = {},
) {
  const position = oldPosition(direction);
  const schedule = createRollSchedule(validSchedule, contracts());
  const roll = schedule.entries[0];
  if (roll === undefined) throw new Error('Expected one roll entry.');
  const reentryOpen = createH1OpenEvent({
    instrumentId: product.productCode,
    contractId: nextContract.contractId,
    openTime: roll.rollAt,
    availableAt: roll.rollAt,
    price: '102',
  });
  const risk = buildOrderRiskInput({
    direction,
    product,
    contract: nextContract,
    entryPrice: asDecimalString(direction === 'LONG' ? '102.5' : '101.5'),
    stopPrice: asDecimalString(direction === 'LONG' ? '101' : '103'),
    requestedQuantity: asDecimalString('2'),
    decisionAt: reentryOpen.openTime,
    riskPolicyUseAt: reentryOpen.openTime,
    signalExpiresAt: asInstantString('2026-01-02T13:00:00Z'),
  });
  const riskInput = {
    ...risk,
    signalExpiresAt: asInstantString('2026-01-02T13:00:00Z'),
    strategyVersion: position.strategyVersion,
    datasetVersion: position.datasetVersion,
    policy: buildPolicy({ maxContractsPerPosition: '4' }),
    portfolio: buildPortfolio(),
  };
  return {
    position,
    roll,
    decisionAt: roll.rollAt,
    exitOpen: createH1OpenEvent({
      instrumentId: product.productCode,
      contractId: oldContract.contractId,
      openTime: roll.rollAt,
      availableAt: roll.rollAt,
      price: '102',
    }),
    adverseExitSlippagePriceUnits: '0.5',
    exitCostsAccountCurrency: '1',
    monetaryValuePerPriceUnitAccountCurrency: '1',
    reentry: {
      positionId: `ROLL-NEW-POSITION-${direction}`,
      intentId: `ROLL-NEW-ENTRY-${direction}`,
      riskDecisionId: `ROLL-NEW-RISK-${direction}`,
      expiresAt: '2026-01-02T13:00:00Z',
      stopPrice: direction === 'LONG' ? '101' : '103',
      requestedQuantity: '2',
      stopPolicyVersion: 'ROLL_STOP_POLICY_V2',
      stopComputedAt: roll.rollAt,
      open: reentryOpen,
      adverseEntrySlippagePriceUnits: '0.5',
      entryCostAccountCurrency: '0',
      riskInput,
    },
    ...overrides,
  };
}

describe('explicit versioned roll schedules', () => {
  it('creates a canonical deeply immutable schedule', () => {
    const schedule = createRollSchedule(
      {
        ...validSchedule,
        observedAt: '2026-01-02T09:00:00+01:00',
        entries: [
          {
            ...firstRoll,
            rollAt: '2026-01-02T13:30:00+01:00',
          },
        ],
      },
      contracts(),
    );
    expect(schedule).toEqual({
      ...validSchedule,
      observedAt: '2026-01-02T08:00:00Z',
      entries: [
        {
          version: validSchedule.version,
          source: validSchedule.source,
          observedAt: '2026-01-02T08:00:00Z',
          fromContractId: oldContract.contractId,
          toContractId: nextContract.contractId,
          rollAt,
        },
      ],
    });
    expect(Object.isFrozen(schedule)).toBe(true);
    expect(Object.isFrozen(schedule.entries)).toBe(true);
    expect(Object.isFrozen(schedule.entries[0])).toBe(true);
  });

  it.each([
    ['version', ''],
    ['source', '  '],
  ] as const)('rejects blank %s', (field, value) => {
    expectError(
      () =>
        createRollSchedule({ ...validSchedule, [field]: value }, contracts()),
      'INVALID_EXECUTION_SCHEDULE',
      field,
    );
  });

  it('rejects same-contract and unknown continuous-contract rolls', () => {
    expectError(
      () =>
        createRollSchedule(
          {
            ...validSchedule,
            entries: [
              {
                fromContractId: oldContract.contractId,
                toContractId: oldContract.contractId,
                rollAt,
              },
            ],
          },
          contracts(),
        ),
      'INVALID_EXECUTION_SCHEDULE',
      'entries',
    );
    expectError(
      () =>
        createRollSchedule(
          {
            ...validSchedule,
            entries: [
              {
                fromContractId: 'FDXS',
                toContractId: nextContract.contractId,
                rollAt,
              },
            ],
          },
          contracts(),
        ),
      'INVALID_EXECUTION_SCHEDULE',
      'contracts',
    );
  });

  it('rejects a continuous contract declared in the roll metadata', () => {
    const continuousContract = {
      ...oldContract,
      contractId: product.productCode,
    };

    expectError(
      () =>
        createRollSchedule(
          {
            ...validSchedule,
            entries: [
              {
                ...firstRoll,
                fromContractId: continuousContract.contractId,
              },
            ],
          },
          [continuousContract, nextContract],
        ),
      'INVALID_EXECUTION_SCHEDULE',
      'contracts',
    );
  });

  it('requires schedule observation before every roll', () => {
    expectError(
      () =>
        createRollSchedule(
          { ...validSchedule, observedAt: '2026-01-02T12:30:00.000000001Z' },
          contracts(),
        ),
      'INVALID_EXECUTION_SCHEDULE',
      'observedAt',
    );
  });

  it('requires both contracts active at the roll instant', () => {
    expectError(
      () =>
        createRollSchedule(
          {
            ...validSchedule,
            entries: [
              {
                ...firstRoll,
                rollAt: nextContract.lastTradeAt,
              },
            ],
          },
          contracts(),
        ),
      'INVALID_EXECUTION_SCHEDULE',
      'rollAt',
    );
  });

  it('rejects broken chains and duplicate roll instants', () => {
    const second = {
      fromContractId: nextContract.contractId,
      toContractId: laterContract.contractId,
      rollAt: '2026-03-10T12:30:00Z',
    };
    expectError(
      () =>
        createRollSchedule(
          {
            ...validSchedule,
            entries: [
              firstRoll,
              { ...second, fromContractId: oldContract.contractId },
            ],
          },
          contracts(),
        ),
      'INVALID_EXECUTION_SCHEDULE',
      'entries',
    );
    expectError(
      () =>
        createRollSchedule(
          {
            ...validSchedule,
            entries: [firstRoll, { ...second, rollAt }],
          },
          contracts(),
        ),
      'INVALID_EXECUTION_SCHEDULE',
      'entries',
    );
  });

  it('bounds and snapshots hostile schedule collections', () => {
    const tooManyEntries = Array.from({ length: 257 }, () => firstRoll);
    expectError(
      () =>
        createRollSchedule(
          { ...validSchedule, entries: tooManyEntries },
          contracts(),
        ),
      'INVALID_EXECUTION_SCHEDULE',
      'entries',
    );

    const sparseEntries = new Array(1) as RollScheduleEntryInput[];
    expectError(
      () =>
        createRollSchedule(
          { ...validSchedule, entries: sparseEntries },
          contracts(),
        ),
      'INVALID_EXECUTION_SCHEDULE',
      'entries',
    );

    const { proxy, revoke } = Proxy.revocable(validSchedule, {});
    revoke();
    expectError(
      () => createRollSchedule(proxy, contracts()),
      'INVALID_EXECUTION_SCHEDULE',
      'input',
    );
  });

  it('rejects duplicate and cross-product contract metadata', () => {
    expectError(
      () => createRollSchedule(validSchedule, [oldContract, oldContract]),
      'INVALID_EXECUTION_SCHEDULE',
      'contracts',
    );
    const anotherProduct = buildProduct({ productCode: 'MES' });
    const crossProduct = createFuturesContract(
      {
        contractId: nextContract.contractId,
        productCode: anotherProduct.productCode,
        firstTradeAt: nextContract.firstTradeAt,
        lastTradeAt: nextContract.lastTradeAt,
        expiryAt: nextContract.expiryAt,
        settlementType: nextContract.settlementType,
      },
      anotherProduct,
    );
    expectError(
      () => createRollSchedule(validSchedule, [oldContract, crossProduct]),
      'INVALID_EXECUTION_SCHEDULE',
      'contracts',
    );
  });

  it('maps malformed schedules, fields, arrays, and contract windows to typed errors', () => {
    for (const value of [null, [], new Date(0)]) {
      expectError(
        () =>
          createRollSchedule(
            value as unknown as RollScheduleInput,
            contracts(),
          ),
        'INVALID_EXECUTION_SCHEDULE',
        'input',
      );
    }
    const descriptorTrap = new Proxy(validSchedule, {
      getOwnPropertyDescriptor: () => {
        throw new Error('descriptor trap');
      },
    });
    expectError(
      () => createRollSchedule(descriptorTrap, contracts()),
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
      expectError(
        () =>
          createRollSchedule(
            input as unknown as RollScheduleInput,
            contracts(),
          ),
        'INVALID_EXECUTION_SCHEDULE',
        'version',
      );
    }
    for (const observedAt of [1 as unknown as string, 'invalid']) {
      expectError(
        () => createRollSchedule({ ...validSchedule, observedAt }, contracts()),
        'INVALID_EXECUTION_SCHEDULE',
        'observedAt',
      );
    }

    expectError(
      () =>
        createRollSchedule(
          validSchedule,
          {} as unknown as readonly FuturesContract[],
        ),
      'INVALID_EXECUTION_SCHEDULE',
      'contracts',
    );
    const contractDescriptorTrap = new Proxy([...contracts()], {
      getOwnPropertyDescriptor: () => {
        throw new Error('descriptor trap');
      },
    });
    expectError(
      () => createRollSchedule(validSchedule, contractDescriptorTrap),
      'INVALID_EXECUTION_SCHEDULE',
      'contracts',
    );
    expectError(
      () =>
        createRollSchedule(validSchedule, [
          { ...oldContract, lastTradeAt: oldContract.firstTradeAt },
          nextContract,
        ]),
      'INVALID_EXECUTION_SCHEDULE',
      'contracts',
    );
  });
});

describe('explicit rollover execution', () => {
  it('closes the old contract and opens a distinct approved new position', () => {
    const input = rolloverInput('LONG');
    const oldBefore = structuredClone(input.position);
    const result = executeContractRollover(input);

    expect(result.type).toBe('ROLLOVER_REENTERED');
    expect(result.limitations).toEqual([
      'NO_INTRABAR_PATH',
      'NO_PARTIAL_FILLS',
      'NO_ORDER_BOOK',
    ]);
    expect(result.exit).toEqual({
      type: 'ROLLOVER_EXIT',
      positionId: input.position.positionId,
      contractId: oldContract.contractId,
      rollScheduleVersion: validSchedule.version,
      rollScheduleSource: validSchedule.source,
      rollScheduleObservedAt: '2026-01-02T08:00:00Z',
      occurredAt: rollAt,
      availableAt: rollAt,
      fillPrice: '101.5',
      quantity: '2',
      grossTradePnlAccountCurrency: '3',
      exitCostsAccountCurrency: '1',
      netTradePnlAccountCurrency: '2',
      accountingCashChangeAccountCurrency: '2',
      limitations: ['NO_INTRABAR_PATH', 'NO_PARTIAL_FILLS', 'NO_ORDER_BOOK'],
    });
    expect(result.reentry).toMatchObject({
      type: 'ENTRY_FILLED',
      fillPrice: '102.5',
      quantity: '2',
    });
    expect(result.position).toMatchObject({
      positionId: 'ROLL-NEW-POSITION-LONG',
      contractId: nextContract.contractId,
      economicEntryPrice: '102.5',
      accountingBasisPrice: '102.5',
      protectiveStopPrice: '101',
      exitPolicyVersion: 'ROLL_STOP_POLICY_V2',
    });
    expect(result.position?.positionId).not.toBe(input.position.positionId);
    expect(input.position).toEqual(oldBefore);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.exit)).toBe(true);
    expect(Object.isFrozen(result.reentry)).toBe(true);
    expect(Object.isFrozen(result.position)).toBe(true);
  });

  it('reduces the new contract independently of the old quantity', () => {
    const input = rolloverInput('LONG');
    const result = executeContractRollover({
      ...input,
      reentry: {
        ...input.reentry,
        riskInput: {
          ...input.reentry.riskInput,
          policy: buildPolicy({ maxContractsPerPosition: '1' }),
        },
      },
    });
    expect(result).toMatchObject({
      type: 'ROLLOVER_REENTERED',
      reentry: { type: 'ENTRY_REDUCED_AND_FILLED', quantity: '1' },
      position: { quantity: '1' },
    });
  });

  it('leaves the portfolio flat with exact reasons when re-entry is rejected', () => {
    const input = rolloverInput('LONG');
    const result = executeContractRollover({
      ...input,
      reentry: {
        ...input.reentry,
        riskInput: {
          ...input.reentry.riskInput,
          account: buildAccount({ killSwitchActive: true }),
        },
      },
    });
    expect(result).toMatchObject({
      type: 'ROLLOVER_EXITED_FLAT',
      reentry: {
        type: 'ENTRY_CANCELLED',
        reasons: ['KILL_SWITCH'],
      },
      position: null,
    });
  });

  it('is symmetric for a SHORT rollover exit', () => {
    expect(executeContractRollover(rolloverInput('SHORT')).exit).toMatchObject({
      fillPrice: '102.5',
      grossTradePnlAccountCurrency: '-5',
      netTradePnlAccountCurrency: '-6',
    });
  });

  it('rejects noncausal, mismatched, and continuous-symbol rollover data', () => {
    const input = rolloverInput();
    expectError(
      () =>
        executeContractRollover({
          ...input,
          decisionAt: '2026-01-02T12:29:59.999999999Z',
        }),
      'INVALID_DATA',
      'roll',
    );
    expectError(
      () =>
        executeContractRollover({
          ...input,
          roll: {
            ...input.roll,
            observedAt: asInstantString('2026-01-02T12:30:00.000000001Z'),
          },
        }),
      'INVALID_DATA',
      'roll',
    );
    expectError(
      () =>
        executeContractRollover({
          ...input,
          exitOpen: createH1OpenEvent({
            ...input.exitOpen,
            contractId: nextContract.contractId,
          }),
        }),
      'INVALID_EXECUTION_INPUT',
      'contractId',
    );
    expectError(
      () =>
        executeContractRollover({
          ...input,
          reentry: {
            ...input.reentry,
            open: createH1OpenEvent({
              ...input.reentry.open,
              contractId: 'FDXS',
            }),
          },
        }),
      'INVALID_EXECUTION_INPUT',
      'contractId',
    );
    expectError(
      () =>
        executeContractRollover({
          ...input,
          reentry: {
            ...input.reentry,
            open: createH1OpenEvent({
              ...input.reentry.open,
              contractId: oldContract.contractId,
            }),
          },
        }),
      'INVALID_EXECUTION_INPUT',
      'contractId',
    );
  });

  it('requires causal versioned stop recomputation and permits equal prices', () => {
    const input = rolloverInput();
    expect(
      executeContractRollover({
        ...input,
        reentry: {
          ...input.reentry,
          stopPrice: input.position.protectiveStopPrice,
        },
      }).type,
    ).toBe('ROLLOVER_REENTERED');

    expectError(
      () =>
        executeContractRollover({
          ...input,
          reentry: {
            ...input.reentry,
            stopPolicyVersion: undefined as unknown as string,
          },
        }),
      'INVALID_EXECUTION_INPUT',
      'stopPolicyVersion',
    );
    expectError(
      () =>
        executeContractRollover({
          ...input,
          reentry: {
            ...input.reentry,
            stopComputedAt: asInstantString('2026-01-02T12:29:59Z'),
          },
        }),
      'INVALID_DATA',
      'stopComputedAt',
    );
  });

  it('rejects continuous positions and off-grid exit execution', () => {
    const input = rolloverInput();
    expectError(
      () =>
        executeContractRollover({
          ...input,
          position: {
            ...input.position,
            contractId: input.position.instrumentId,
          },
          roll: {
            ...input.roll,
            fromContractId: input.position.instrumentId,
          },
        }),
      'INVALID_EXECUTION_INPUT',
      'contractId',
    );
    expectError(
      () =>
        executeContractRollover({
          ...input,
          adverseExitSlippagePriceUnits: '0.1',
        }),
      'INVALID_EXECUTION_INPUT',
      'adverseExitSlippagePriceUnits',
    );
    expectError(
      () =>
        executeContractRollover({
          ...input,
          exitOpen: createH1OpenEvent({ ...input.exitOpen, price: '102.1' }),
        }),
      'INVALID_EXECUTION_INPUT',
      'exitOpen',
    );
  });

  it('rejects unavailable opens and hostile public inputs with typed errors', () => {
    const input = rolloverInput();
    expectError(
      () =>
        executeContractRollover({
          ...input,
          reentry: {
            ...input.reentry,
            open: createH1OpenEvent({
              ...input.reentry.open,
              availableAt: '2026-01-02T12:30:00.000000001Z',
            }),
          },
        }),
      'INVALID_DATA',
      'roll',
    );

    const { proxy, revoke } = Proxy.revocable(input, {});
    revoke();
    expectError(
      () => executeContractRollover(proxy),
      'INVALID_EXECUTION_INPUT',
      'input',
    );
  });

  it('isolates exact rollover arithmetic from ambient Decimal configuration', () => {
    const previous = {
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
      Decimal.set({ maxE: 2, minE: -2, precision: 3 });
      expect(executeContractRollover(rolloverInput()).exit).toMatchObject({
        grossTradePnlAccountCurrency: '3',
        netTradePnlAccountCurrency: '2',
      });
    } finally {
      Decimal.set(previous);
    }
  });

  it('rejects forged position enums and limitations', () => {
    const input = rolloverInput();
    for (const [field, value, expected] of [
      ['direction', 'SIDEWAYS', 'direction'],
      ['timeframe', '4h', 'timeframe'],
      ['executionModelVersion', 'OTHER', 'executionModelVersion'],
      ['limitations', [], 'limitations'],
    ] as const) {
      expectError(
        () =>
          executeContractRollover({
            ...input,
            position: { ...input.position, [field]: value },
          }),
        'INVALID_EXECUTION_INPUT',
        expected,
      );
    }
  });

  it('rejects forged position provenance and stop invariants before roll', () => {
    const input = rolloverInput();
    for (const [field, value, expected] of [
      ['riskPolicyVersion', '', 'riskPolicyVersion'],
      ['protectiveStopPrice', '99.25', 'protectiveStopPrice'],
    ] as const) {
      expectError(
        () =>
          executeContractRollover({
            ...input,
            position: { ...input.position, [field]: value },
          }),
        'INVALID_EXECUTION_INPUT',
        expected,
      );
    }
  });

  it('rejects mismatched roll identifiers and unavailable roll opens', () => {
    const input = rolloverInput();
    expectError(
      () =>
        executeContractRollover({
          ...input,
          roll: { ...input.roll, fromContractId: 'OTHER' },
        }),
      'INVALID_EXECUTION_INPUT',
      'contractId',
    );
    expectError(
      () =>
        executeContractRollover({
          ...input,
          roll: {
            ...input.roll,
            toContractId: input.position.instrumentId,
          },
        }),
      'INVALID_EXECUTION_INPUT',
      'contractId',
    );
    expectError(
      () =>
        executeContractRollover({
          ...input,
          exitOpen: createH1OpenEvent({
            ...input.exitOpen,
            openTime: '2026-01-02T12:30:01Z',
            availableAt: '2026-01-02T12:30:01Z',
          }),
          decisionAt: '2026-01-02T12:30:01Z',
        }),
      'INVALID_DATA',
      'roll',
    );
  });

  it('rejects a nonpositive adverse rollover exit fill', () => {
    const input = rolloverInput();
    expectError(
      () =>
        executeContractRollover({
          ...input,
          exitOpen: createH1OpenEvent({ ...input.exitOpen, price: '0.5' }),
          adverseExitSlippagePriceUnits: '0.5',
        }),
      'INVALID_EXECUTION_INPUT',
      'fillPrice',
    );
  });
});
