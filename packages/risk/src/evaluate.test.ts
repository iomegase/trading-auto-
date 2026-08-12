import { Decimal } from 'decimal.js';
import type { FuturesContract, FuturesProduct } from '@trading-auto/domain';
import {
  syntheticFdxsContract,
  syntheticFdxsProduct,
  syntheticMesContract,
  syntheticMesProduct,
} from '@trading-auto/test-helpers';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createCostModelSnapshot,
  createEligibilitySnapshot,
  createFxSnapshot,
  createMarginSnapshot,
  evaluateOrderRisk,
  RiskInputError,
  type OrderRiskInput,
  type RiskDecision,
  type RiskDecisionContext,
  type RiskDecisionReason,
  type RiskPolicyUseMode,
} from './index.js';
import {
  DECISION_AT,
  RUN_CREATED_AT,
  baseAccountInput,
  baseContractInput,
  basePolicyInput,
  baseSafetyAssertionsInput,
  buildAccount,
  buildContract,
  buildCostsInput,
  buildEligibilityInput,
  buildFxInput,
  buildMarginInput,
  buildMesInput,
  buildOrderRiskInput,
  buildPolicy,
  buildPortfolio,
  buildProduct,
  buildSafetyAssertions,
  buildSnapshots,
  type OrderRiskInputOverrides,
} from '../test-helpers/builders.js';

const M2A_DECISION_AT = '2026-03-10T09:00:00Z';

function syntheticSnapshots(
  product: Readonly<FuturesProduct>,
  contract: Readonly<FuturesContract>,
  fxDirection: 'DIRECT' | 'INVERSE' = 'DIRECT',
) {
  const metadata = {
    source: 'SYNTHETIC_TEST_ONLY',
    observedAt: '2026-03-10T08:00:00Z',
    validFrom: '2026-03-10T08:00:00Z',
    validUntil: '2026-03-10T10:00:00Z',
  } as const;
  const zeroFees = {
    minimum: '0',
    tiers: [{ upToQuantity: null, feePerContract: '0' }],
  } as const;

  return Object.freeze({
    fx:
      product.pnlCurrency === 'EUR'
        ? null
        : createFxSnapshot({
            ...metadata,
            version: 'FX_SYNTHETIC_EQUIVALENT',
            baseCurrency: fxDirection === 'DIRECT' ? 'USD' : 'EUR',
            quoteCurrency: fxDirection === 'DIRECT' ? 'EUR' : 'USD',
            rate: fxDirection === 'DIRECT' ? '0.8' : '1.25',
          }),
    margin: createMarginSnapshot({
      ...metadata,
      version: `MARGIN_${contract.contractId}`,
      contractId: contract.contractId,
      currency: product.pnlCurrency,
      initialMarginPerContract: '10',
      maintenanceMarginPerContract: '8',
    }),
    eligibility: createEligibilitySnapshot({
      ...metadata,
      version: `ELIGIBILITY_${contract.contractId}`,
      contractId: contract.contractId,
      researchOnly: true,
      eligible: true,
      reason: null,
    }),
    costs: createCostModelSnapshot({
      ...metadata,
      version: `COSTS_${contract.contractId}`,
      contractId: contract.contractId,
      currency: product.pnlCurrency,
      entryFees: zeroFees,
      exitFees: zeroFees,
      spreadPriceUnitsRoundTrip: '0',
      adverseEntrySlippagePriceUnits: '0',
      adverseExitSlippagePriceUnits: '0',
    }),
  });
}

function syntheticPolicy(
  product: Readonly<FuturesProduct>,
  overrides: Parameters<typeof buildPolicy>[0] = {},
) {
  return buildPolicy({
    version: 'RISK_M2A_SYNTHETIC',
    maxContractsPerPosition: '10',
    riskGroupMaxExposurePct: { [product.riskGroup]: '100' },
    ...overrides,
  });
}

function syntheticOrderRiskInput(
  product: Readonly<FuturesProduct>,
  contract: Readonly<FuturesContract>,
  overrides: OrderRiskInputOverrides = {},
): OrderRiskInput {
  return buildOrderRiskInput({
    instrumentId: product.productCode,
    entryPrice: '100',
    stopPrice: product.tickSize === '0.5' ? '99.5' : '99.75',
    decisionAt: M2A_DECISION_AT,
    riskPolicyUseAt: M2A_DECISION_AT,
    signalExpiresAt: '2026-03-10T10:00:00Z',
    product,
    contract,
    snapshots: syntheticSnapshots(product, contract),
    policy: syntheticPolicy(product),
    ...overrides,
  });
}

const reasonOrder = [
  'KILL_SWITCH',
  'SIGNAL_EXPIRED',
  'POSITION_ALREADY_ACTIVE',
  'ENTRY_INTENT_ALREADY_ACTIVE',
  'MAX_POSITIONS',
  'MAX_CONTRACTS_PER_POSITION',
  'DAILY_LOSS_LIMIT',
  'DRAWDOWN_LIMIT',
  'NO_SIZING_EQUITY',
  'MISSING_FX',
  'STALE_FX',
  'MISSING_MARGIN',
  'STALE_MARGIN',
  'MISSING_ELIGIBILITY',
  'STALE_ELIGIBILITY',
  'INELIGIBLE_CONTRACT',
  'RISK_BUDGET',
  'OPEN_RISK',
  'MARGIN',
  'GROSS_EXPOSURE',
  'RISK_GROUP_EXPOSURE',
  'AVAILABLE_FUNDS',
  'MIN_QUANTITY',
] as const satisfies readonly RiskDecisionReason[];

function expectRiskInputError(
  action: () => unknown,
  code: string = 'INVALID_RISK_INPUT',
): RiskInputError {
  let received: unknown;
  try {
    action();
  } catch (error) {
    received = error;
  }
  expect(received).toBeInstanceOf(RiskInputError);
  expect(received).toMatchObject({ code });
  return received as RiskInputError;
}

function policyForFour(overrides = {}) {
  return buildPolicy({ maxContractsPerPosition: '4', ...overrides });
}

function otherPositions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    positionId: `POSITION_${String(index)}`,
    instrumentId: `OTHER_${String(index)}`,
    contractId: `OTHER_CONTRACT_${String(index)}`,
    direction: 'LONG' as const,
    quantity: '1',
    remainingOpenRisk: '0',
    margin: '0',
    grossExposure: '0',
    riskGroup: 'OTHER_GROUP',
  }));
}

function firstOtherPosition() {
  const position = otherPositions(1)[0];
  if (position === undefined) throw new Error('Expected one position fixture.');
  return position;
}

function divergentProperty<T extends object>(
  target: T,
  property: PropertyKey,
  descriptorValue: unknown,
  getValue: unknown,
): T {
  return new Proxy(target, {
    get(input, key, receiver) {
      return key === property ? getValue : Reflect.get(input, key, receiver);
    },
    getOwnPropertyDescriptor(input, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
      if (key !== property || descriptor === undefined) return descriptor;
      return { ...descriptor, value: descriptorValue };
    },
  });
}

function activePositionRaw(instrumentId = 'FDXS') {
  return {
    positionId: 'POSITION_ACTIVE',
    instrumentId,
    contractId: baseContractInput.contractId,
    direction: 'LONG',
    quantity: '1',
    remainingOpenRisk: '0',
    margin: '0',
    grossExposure: '0',
    riskGroup: 'EU_EQUITY_INDEX',
  };
}

function inputForReason(reason: RiskDecisionReason): OrderRiskInput {
  switch (reason) {
    case 'KILL_SWITCH':
      return buildOrderRiskInput({
        account: buildAccount({ killSwitchActive: true }),
      });
    case 'SIGNAL_EXPIRED':
      return buildOrderRiskInput({ signalExpiresAt: DECISION_AT });
    case 'POSITION_ALREADY_ACTIVE':
      return buildOrderRiskInput({
        portfolio: buildPortfolio({
          positions: [
            {
              ...firstOtherPosition(),
              instrumentId: 'FDXS',
              contractId: baseContractInput.contractId,
            },
          ],
        }),
      });
    case 'ENTRY_INTENT_ALREADY_ACTIVE':
      return buildOrderRiskInput({
        portfolio: buildPortfolio({
          activeEntryIntents: [
            {
              intentId: 'INTENT_1',
              instrumentId: 'FDXS',
              contractId: baseContractInput.contractId,
              direction: 'LONG',
            },
          ],
        }),
      });
    case 'MAX_POSITIONS':
      return buildOrderRiskInput({
        portfolio: buildPortfolio({ positions: otherPositions(4) }),
      });
    case 'MAX_CONTRACTS_PER_POSITION':
      return buildOrderRiskInput({ requestedQuantity: '2' });
    case 'DAILY_LOSS_LIMIT':
      return buildOrderRiskInput({
        account: buildAccount({ dailyLoss: '100' }),
      });
    case 'DRAWDOWN_LIMIT':
      return buildOrderRiskInput({
        account: buildAccount({ drawdownPct: '10' }),
      });
    case 'NO_SIZING_EQUITY':
      return buildOrderRiskInput({
        account: buildAccount({ realizedEquity: '0', availableFunds: '0' }),
      });
    case 'MISSING_FX': {
      const mes = buildMesInput();
      return { ...mes, snapshots: { ...mes.snapshots, fx: null } };
    }
    case 'STALE_FX': {
      const mes = buildMesInput();
      return {
        ...mes,
        snapshots: {
          ...mes.snapshots,
          fx: createFxSnapshot(buildFxInput({ validUntil: DECISION_AT })),
        },
      };
    }
    case 'MISSING_MARGIN':
      return buildOrderRiskInput({
        snapshots: buildSnapshots({ margin: null }),
      });
    case 'STALE_MARGIN':
      return buildOrderRiskInput({
        snapshots: buildSnapshots({
          margin: createMarginSnapshot(
            buildMarginInput({ validUntil: DECISION_AT }),
          ),
        }),
      });
    case 'MISSING_ELIGIBILITY':
      return buildOrderRiskInput({
        snapshots: buildSnapshots({ eligibility: null }),
      });
    case 'STALE_ELIGIBILITY':
      return buildOrderRiskInput({
        snapshots: buildSnapshots({
          eligibility: createEligibilitySnapshot(
            buildEligibilityInput({ validUntil: DECISION_AT }),
          ),
        }),
      });
    case 'INELIGIBLE_CONTRACT':
      return buildOrderRiskInput({
        snapshots: buildSnapshots({
          eligibility: createEligibilitySnapshot(
            buildEligibilityInput({
              eligible: false,
              reason: 'SYNTHETIC_INELIGIBLE',
            }),
          ),
        }),
      });
    case 'RISK_BUDGET':
      return buildOrderRiskInput({
        policy: buildPolicy({ riskPerTradePct: '0' }),
      });
    case 'OPEN_RISK':
      return buildOrderRiskInput({
        policy: buildPolicy({ maxOpenRiskPct: '0' }),
      });
    case 'MARGIN':
      return buildOrderRiskInput({
        policy: buildPolicy({ maxMarginUsagePct: '0' }),
      });
    case 'GROSS_EXPOSURE':
      return buildOrderRiskInput({
        policy: buildPolicy({ maxGrossExposurePct: '0.01' }),
      });
    case 'RISK_GROUP_EXPOSURE':
      return buildOrderRiskInput({
        policy: buildPolicy({
          riskGroupMaxExposurePct: { EU_EQUITY_INDEX: '0' },
        }),
      });
    case 'AVAILABLE_FUNDS':
      return buildOrderRiskInput({
        policy: buildPolicy({ cashReservePct: '100' }),
      });
    case 'MIN_QUANTITY': {
      const product = buildProduct({ minQuantity: '2' });
      return buildOrderRiskInput({
        product,
        contract: buildContract(product),
        requestedQuantity: '1',
        policy: policyForFour(),
      });
    }
  }
}

describe('evaluateOrderRisk result contracts', () => {
  it('approves the maximum admissible quantity when no quantity is requested', () => {
    const decision = evaluateOrderRisk(buildOrderRiskInput());
    expect(decision).toMatchObject({
      status: 'APPROVE',
      quantity: '1',
      reasons: [],
    });
    expectTypeOf(decision).toEqualTypeOf<RiskDecision>();
  });

  it('approves an explicit exactly admissible quantity', () => {
    expect(
      evaluateOrderRisk(buildOrderRiskInput({ requestedQuantity: '1' })),
    ).toMatchObject({ status: 'APPROVE', quantity: '1', reasons: [] });
  });

  it('reduces a requested four contracts to the greatest admissible one', () => {
    const decision = evaluateOrderRisk(
      buildOrderRiskInput({
        requestedQuantity: '4',
        policy: policyForFour({ riskPerTradePct: '0.15' }),
      }),
    );
    expect(decision).toMatchObject({
      status: 'REDUCE_SIZE',
      requestedQuantity: '4',
      quantity: '1',
      reasons: ['RISK_BUDGET'],
    });
    if (decision.status !== 'REDUCE_SIZE') {
      throw new Error('Expected a REDUCE_SIZE decision.');
    }
    expect(decision.reasons.length).toBeGreaterThan(0);
    expect(Number(decision.quantity)).toBeLessThan(
      Number(decision.requestedQuantity),
    );
  });

  it('rejects without rounding up when the minimum is not feasible', () => {
    expect(
      evaluateOrderRisk(
        buildOrderRiskInput({ policy: buildPolicy({ riskPerTradePct: '0' }) }),
      ),
    ).toMatchObject({
      status: 'REJECT',
      quantity: '0',
      reasons: ['RISK_BUDGET'],
      economics: { quantity: '1' },
    });
  });

  it('reduces a request above the cap and reports the cap reason', () => {
    expect(
      evaluateOrderRisk(
        buildOrderRiskInput({
          requestedQuantity: '5',
          policy: policyForFour(),
        }),
      ),
    ).toMatchObject({
      status: 'REDUCE_SIZE',
      requestedQuantity: '5',
      quantity: '4',
      reasons: ['MAX_CONTRACTS_PER_POSITION'],
    });
  });

  it('merges cap and explicit requested-quantity failures when a lower capped quantity is feasible', () => {
    expect(
      evaluateOrderRisk(
        buildOrderRiskInput({
          requestedQuantity: '5',
          policy: policyForFour({ riskPerTradePct: '0.15' }),
        }),
      ),
    ).toMatchObject({
      status: 'REDUCE_SIZE',
      requestedQuantity: '5',
      quantity: '1',
      reasons: ['MAX_CONTRACTS_PER_POSITION', 'RISK_BUDGET'],
    });
  });

  it('deep-freezes the result, reasons, context, and economics', () => {
    const decision = evaluateOrderRisk(buildOrderRiskInput());
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.reasons)).toBe(true);
    expect(Object.isFrozen(decision.context)).toBe(true);
    expect(Object.isFrozen(decision.economics)).toBe(true);
    expect(() => {
      (decision.context as { datasetVersion: string }).datasetVersion =
        'MUTATED';
    }).toThrow(TypeError);
  });

  it('records the exact immutable decision context and nullable identity FX version', () => {
    const decision = evaluateOrderRisk(buildOrderRiskInput());
    expect(decision.context).toEqual({
      decisionAt: DECISION_AT,
      riskPolicyUseMode: 'FORWARD',
      riskPolicyUseAt: DECISION_AT,
      backtestId: null,
      runCreatedAt: null,
      signalExpiresAt: '2026-01-02T13:00:00Z',
      entryPrice: '100',
      stopPrice: '99',
      datasetVersion: 'DATASET_V1',
      strategyVersion: 'STRATEGY_V1',
      riskPolicyVersion: 'RISK_FUTURES_V1_RESEARCH',
      fxVersion: null,
      marginVersion: 'MARGIN_V1',
      costModelVersion: 'COSTS_V1',
      eligibilityVersion: 'ELIGIBILITY_V1',
      productCode: 'FDXS',
      contractId: 'FDXS-202603',
    });
    expectTypeOf(decision.context).toEqualTypeOf<
      Readonly<RiskDecisionContext>
    >();
    expectTypeOf<'FORWARD'>().toExtend<RiskPolicyUseMode>();
  });
});

describe('stable business reason coverage and ordering', () => {
  it.each(reasonOrder)('emits %s in a business decision', (reason) => {
    expect(evaluateOrderRisk(inputForReason(reason)).reasons).toContain(reason);
  });

  it('orders and deduplicates concurrent reasons by the stable precedence', () => {
    const decision = evaluateOrderRisk(
      buildOrderRiskInput({
        requestedQuantity: '5',
        signalExpiresAt: DECISION_AT,
        account: buildAccount({
          dailyLoss: '100',
          drawdownPct: '10',
          killSwitchActive: true,
        }),
        policy: buildPolicy({
          maxContractsPerPosition: '4',
          riskPerTradePct: '0',
          maxOpenRiskPct: '0',
        }),
      }),
    );
    expect(decision.status).toBe('REJECT');
    expect(decision.reasons).toEqual([
      'KILL_SWITCH',
      'SIGNAL_EXPIRED',
      'MAX_CONTRACTS_PER_POSITION',
      'DAILY_LOSS_LIMIT',
      'DRAWDOWN_LIMIT',
      'RISK_BUDGET',
      'OPEN_RISK',
    ]);
    expect(new Set(decision.reasons).size).toBe(decision.reasons.length);
  });

  it('does not report loss-limit breaches when observed losses are zero', () => {
    const decision = evaluateOrderRisk(
      buildOrderRiskInput({
        account: buildAccount({ dailyLoss: '0', drawdownPct: '0' }),
        policy: buildPolicy({
          dailyLossLimitPct: '0',
          maxDrawdownPct: '0',
        }),
      }),
    );

    expect(decision.reasons).not.toContain('DAILY_LOSS_LIMIT');
    expect(decision.reasons).not.toContain('DRAWDOWN_LIMIT');
  });

  it('reports minimum economics and constraints for a blocking static guard', () => {
    const decision = evaluateOrderRisk(
      buildOrderRiskInput({
        requestedQuantity: '2',
        account: buildAccount({ killSwitchActive: true }),
        policy: policyForFour({ riskPerTradePct: '0.15' }),
      }),
    );
    expect(decision).toMatchObject({
      status: 'REJECT',
      reasons: ['KILL_SWITCH'],
      economics: { quantity: '1' },
    });
  });

  it('does not traverse a 10000-candidate grid after a blocking static guard', () => {
    const monetaryValue = '9'.repeat(252);
    const equity = '9'.repeat(256);
    const product = buildProduct({
      tickSize: '1',
      tickValue: monetaryValue,
      monetaryValuePerPriceUnit: monetaryValue,
    });
    const decision = evaluateOrderRisk(
      buildOrderRiskInput({
        entryPrice: '2',
        stopPrice: '1',
        product,
        contract: buildContract(product),
        account: buildAccount({
          realizedEquity: equity,
          availableFunds: equity,
          killSwitchActive: true,
        }),
        policy: buildPolicy({
          maxSizingCapital: equity,
          maxContractsPerPosition: '10000',
          riskPerTradePct: '100',
        }),
      }),
    );
    expect(decision).toMatchObject({
      status: 'REJECT',
      reasons: ['KILL_SWITCH'],
      economics: { quantity: '1' },
    });
  });

  it('uses null economics before economics are observable', () => {
    const decision = evaluateOrderRisk(inputForReason('MISSING_MARGIN'));
    expect(decision).toMatchObject({ status: 'REJECT', economics: null });
  });
});

describe('policy-use chronology', () => {
  it('accepts equality approvedAt = activatedAt = useAt in FORWARD mode', () => {
    const policy = buildPolicy({
      approvedAt: DECISION_AT,
      activatedAt: DECISION_AT,
    });
    expect(evaluateOrderRisk(buildOrderRiskInput({ policy })).status).toBe(
      'APPROVE',
    );
  });

  it('rejects a FORWARD use time different from decisionAt', () => {
    expectRiskInputError(() =>
      evaluateOrderRisk(
        buildOrderRiskInput({ riskPolicyUseAt: '2026-01-02T11:59:59Z' }),
      ),
    );
  });

  it.each([
    { backtestId: 'BT_1' },
    { runCreatedAt: RUN_CREATED_AT },
    { backtestId: 'BT_1', runCreatedAt: RUN_CREATED_AT },
  ])('rejects historical linkage in FORWARD mode: %j', (linkage) => {
    expectRiskInputError(() => evaluateOrderRisk(buildOrderRiskInput(linkage)));
  });

  it('accepts HISTORICAL_RESEARCH with a later run creation policy-use time', () => {
    const decision = evaluateOrderRisk(
      buildOrderRiskInput({
        riskPolicyUseMode: 'HISTORICAL_RESEARCH',
        riskPolicyUseAt: RUN_CREATED_AT,
        backtestId: 'BACKTEST_1',
        runCreatedAt: RUN_CREATED_AT,
        policy: buildPolicy({
          approvedAt: '2026-01-03T10:00:00Z',
          activatedAt: '2026-01-03T11:00:00Z',
        }),
      }),
    );
    expect(decision.context).toMatchObject({
      riskPolicyUseMode: 'HISTORICAL_RESEARCH',
      riskPolicyUseAt: RUN_CREATED_AT,
      backtestId: 'BACKTEST_1',
      runCreatedAt: RUN_CREATED_AT,
    });
  });

  it.each([
    { backtestId: undefined, runCreatedAt: RUN_CREATED_AT },
    { backtestId: '  ', runCreatedAt: RUN_CREATED_AT },
    { backtestId: 'BT_1', runCreatedAt: undefined },
    { backtestId: 'BT_1', runCreatedAt: '2026-01-03T12:00:00+00:00' },
  ])('rejects invalid historical linkage: %j', (linkage) => {
    expectRiskInputError(() =>
      evaluateOrderRisk(
        buildOrderRiskInput({
          riskPolicyUseMode: 'HISTORICAL_RESEARCH',
          riskPolicyUseAt: RUN_CREATED_AT,
          ...linkage,
        } as never),
      ),
    );
  });

  it('requires historical riskPolicyUseAt to equal runCreatedAt', () => {
    expectRiskInputError(() =>
      evaluateOrderRisk(
        buildOrderRiskInput({
          riskPolicyUseMode: 'HISTORICAL_RESEARCH',
          riskPolicyUseAt: '2026-01-03T11:00:00Z',
          backtestId: 'BT_1',
          runCreatedAt: RUN_CREATED_AT,
        }),
      ),
    );
  });

  it('requires each historical linkage field when it is truly absent', () => {
    expectRiskInputError(() =>
      evaluateOrderRisk(
        buildOrderRiskInput({
          riskPolicyUseMode: 'HISTORICAL_RESEARCH',
          riskPolicyUseAt: RUN_CREATED_AT,
          runCreatedAt: RUN_CREATED_AT,
        }),
      ),
    );
    expectRiskInputError(() =>
      evaluateOrderRisk(
        buildOrderRiskInput({
          riskPolicyUseMode: 'HISTORICAL_RESEARCH',
          riskPolicyUseAt: RUN_CREATED_AT,
          backtestId: 'BT_1',
        }),
      ),
    );
  });

  it.each(['FORWARD', 'HISTORICAL_RESEARCH'] as const)(
    'rejects a policy activated after use time in %s mode',
    (mode) => {
      const historical = mode === 'HISTORICAL_RESEARCH';
      expectRiskInputError(() =>
        evaluateOrderRisk(
          buildOrderRiskInput({
            riskPolicyUseMode: mode,
            riskPolicyUseAt: historical ? RUN_CREATED_AT : DECISION_AT,
            ...(historical
              ? { backtestId: 'BT_1', runCreatedAt: RUN_CREATED_AT }
              : {}),
            policy: buildPolicy({
              approvedAt: '2026-01-04T10:00:00Z',
              activatedAt: '2026-01-04T11:00:00Z',
            }),
          }),
        ),
      );
    },
  );

  it('validates fixed safety assertions independently at the boundary', () => {
    expectRiskInputError(() =>
      evaluateOrderRisk(
        buildOrderRiskInput({
          safetyAssertions: {
            ...buildSafetyAssertions(),
            includeEstimatedExitCosts: false,
          } as never,
        }),
      ),
    );
  });
});

describe('operational snapshot boundary', () => {
  it.each([
    ['fx', 'STALE_FX'],
    ['margin', 'STALE_MARGIN'],
    ['eligibility', 'STALE_ELIGIBILITY'],
  ] as const)('treats validUntil equality as stale for %s', (kind, reason) => {
    const mes = kind === 'fx' ? buildMesInput() : buildOrderRiskInput();
    const stale =
      kind === 'fx'
        ? createFxSnapshot(buildFxInput({ validUntil: DECISION_AT }))
        : kind === 'margin'
          ? createMarginSnapshot(buildMarginInput({ validUntil: DECISION_AT }))
          : createEligibilitySnapshot(
              buildEligibilityInput({ validUntil: DECISION_AT }),
            );
    expect(
      evaluateOrderRisk({
        ...mes,
        snapshots: { ...mes.snapshots, [kind]: stale },
      }).reasons,
    ).toContain(reason);
  });

  it('accepts observedAt and validFrom equality with decisionAt', () => {
    const snapshots = buildSnapshots({
      margin: createMarginSnapshot(
        buildMarginInput({ observedAt: DECISION_AT, validFrom: DECISION_AT }),
      ),
      eligibility: createEligibilitySnapshot(
        buildEligibilityInput({
          observedAt: DECISION_AT,
          validFrom: DECISION_AT,
        }),
      ),
      costs: createCostModelSnapshot(
        buildCostsInput({ observedAt: DECISION_AT, validFrom: DECISION_AT }),
      ),
    });
    expect(evaluateOrderRisk(buildOrderRiskInput({ snapshots })).status).toBe(
      'APPROVE',
    );
  });

  it.each([true, false])(
    'treats eligible=true as eligible independently of researchOnly=%s',
    (researchOnly) => {
      const decision = evaluateOrderRisk(
        buildOrderRiskInput({
          snapshots: buildSnapshots({
            eligibility: createEligibilitySnapshot(
              buildEligibilityInput({
                researchOnly,
                eligible: true,
                reason: null,
              }),
            ),
          }),
        }),
      );
      expect(decision.status).toBe('APPROVE');
      expect(decision.reasons).not.toContain('INELIGIBLE_CONTRACT');
    },
  );

  it.each(['missing', 'stale'] as const)(
    '%s costs throw STALE_COST_MODEL',
    (state) => {
      const costs =
        state === 'missing'
          ? null
          : createCostModelSnapshot(
              buildCostsInput({ validUntil: DECISION_AT }),
            );
      expectRiskInputError(
        () =>
          evaluateOrderRisk(
            buildOrderRiskInput({ snapshots: buildSnapshots({ costs }) }),
          ),
        'STALE_COST_MODEL',
      );
    },
  );

  it('rejects every future-observed snapshot before business evaluation', () => {
    const future = '2026-01-02T12:00:01Z';
    const inputs = [
      buildMesInput({
        snapshots: {
          ...buildMesInput().snapshots,
          fx: createFxSnapshot(buildFxInput({ observedAt: future })),
        },
      }),
      buildOrderRiskInput({
        snapshots: buildSnapshots({
          margin: createMarginSnapshot(
            buildMarginInput({ observedAt: future }),
          ),
        }),
      }),
      buildOrderRiskInput({
        snapshots: buildSnapshots({
          eligibility: createEligibilitySnapshot(
            buildEligibilityInput({ observedAt: future }),
          ),
        }),
      }),
      buildOrderRiskInput({
        snapshots: buildSnapshots({
          costs: createCostModelSnapshot(
            buildCostsInput({ observedAt: future }),
          ),
        }),
      }),
    ];
    for (const input of inputs) {
      expectRiskInputError(
        () => evaluateOrderRisk(input),
        'LOOKAHEAD_SNAPSHOT',
      );
    }
  });

  it('rejects wrong snapshot contracts and currencies as typed input errors', () => {
    expectRiskInputError(
      () =>
        evaluateOrderRisk(
          buildOrderRiskInput({
            snapshots: buildSnapshots({
              margin: createMarginSnapshot(
                buildMarginInput({ contractId: 'WRONG' }),
              ),
            }),
          }),
        ),
      'MISMATCHED_CONTRACT',
    );
    expectRiskInputError(
      () =>
        evaluateOrderRisk(
          buildOrderRiskInput({
            snapshots: buildSnapshots({
              costs: createCostModelSnapshot(
                buildCostsInput({ currency: 'USD' }),
              ),
            }),
          }),
        ),
      'MISMATCHED_CURRENCY',
    );
  });

  it('rejects an unrelated FX pair', () => {
    const mes = buildMesInput();
    expectRiskInputError(
      () =>
        evaluateOrderRisk({
          ...mes,
          snapshots: {
            ...mes.snapshots,
            fx: createFxSnapshot(
              buildFxInput({ baseCurrency: 'GBP', quoteCurrency: 'CHF' }),
            ),
          },
        }),
      'MISMATCHED_CURRENCY',
    );
  });

  it('rejects malformed snapshot runtime casts', () => {
    expectRiskInputError(
      () =>
        evaluateOrderRisk(
          buildOrderRiskInput({
            snapshots: {
              ...buildSnapshots(),
              margin: { version: 'FORGED' },
            } as never,
          }),
        ),
      'INVALID_SNAPSHOT',
    );
  });

  it('bounds and snapshots hostile fee-tier arrays before factory validation', () => {
    const validCosts = buildCostsInput();
    const withTiers = (tiers: unknown) => ({
      ...validCosts,
      entryFees: { minimum: '0', tiers },
    });

    expectRiskInputError(
      () =>
        evaluateOrderRisk(
          buildOrderRiskInput({
            snapshots: {
              ...buildSnapshots(),
              costs: withTiers({}) as never,
            },
          }),
        ),
      'INVALID_SNAPSHOT',
    );

    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    expectRiskInputError(
      () =>
        evaluateOrderRisk(
          buildOrderRiskInput({
            snapshots: {
              ...buildSnapshots(),
              costs: withTiers(revoked.proxy) as never,
            },
          }),
        ),
      'INVALID_SNAPSHOT',
    );

    const excessive = Array.from({ length: 257 }, () => ({
      upToQuantity: null,
      feePerContract: '0',
    }));
    expectRiskInputError(
      () =>
        evaluateOrderRisk(
          buildOrderRiskInput({
            snapshots: {
              ...buildSnapshots(),
              costs: withTiers(excessive) as never,
            },
          }),
        ),
      'INVALID_SNAPSHOT',
    );
  });

  it('rejects oversized raw snapshot decimals before an operational rejection', () => {
    const huge = '1'.repeat(100_000);
    const native = buildOrderRiskInput();
    const mes = buildMesInput();

    const inputs: readonly OrderRiskInput[] = [
      {
        ...native,
        snapshots: {
          ...native.snapshots,
          eligibility: null,
          margin: {
            ...buildMarginInput(),
            initialMarginPerContract: huge,
          } as never,
        },
      },
      {
        ...mes,
        snapshots: {
          ...mes.snapshots,
          eligibility: null,
          fx: { ...buildFxInput(), rate: huge } as never,
        },
      },
      ...[
        {
          entryFees: {
            minimum: huge,
            tiers: [{ upToQuantity: null, feePerContract: '0' }],
          },
        },
        {
          entryFees: {
            minimum: '0',
            tiers: [
              { upToQuantity: huge, feePerContract: '0' },
              { upToQuantity: null, feePerContract: '0' },
            ],
          },
        },
        {
          entryFees: {
            minimum: '0',
            tiers: [{ upToQuantity: null, feePerContract: huge }],
          },
        },
        { spreadPriceUnitsRoundTrip: huge },
        { adverseEntrySlippagePriceUnits: huge },
        { adverseExitSlippagePriceUnits: huge },
      ].map((costOverride) => ({
        ...native,
        snapshots: {
          ...native.snapshots,
          eligibility: null,
          costs: {
            ...buildCostsInput(),
            ...costOverride,
          } as never,
        },
      })),
    ];

    for (const input of inputs) {
      expectRiskInputError(() => evaluateOrderRisk(input), 'INVALID_SNAPSHOT');
    }
  });
});

describe('finite exact quantity search', () => {
  it('rejects an incomplete risk-group policy before grid evaluation', () => {
    expectRiskInputError(() =>
      evaluateOrderRisk(
        buildOrderRiskInput({
          policy: buildPolicy({
            riskGroupMaxExposurePct: { OTHER_GROUP: '100' },
          }),
        }),
      ),
    );
  });

  it('rejects an incomplete risk-group policy before a missing-margin business result', () => {
    expectRiskInputError(() =>
      evaluateOrderRisk(
        buildOrderRiskInput({
          policy: buildPolicy({
            riskGroupMaxExposurePct: { OTHER_GROUP: '100' },
          }),
          snapshots: buildSnapshots({ margin: null }),
        }),
      ),
    );
  });

  it('rejects a grid larger than the private 10000-iteration safety bound', () => {
    expectRiskInputError(
      () =>
        evaluateOrderRisk(
          buildOrderRiskInput({
            policy: buildPolicy({ maxContractsPerPosition: '10001' }),
          }),
        ),
      'GRID_TOO_LARGE',
    );
  });

  it('rejects an excessive full grid before a below-minimum request result', () => {
    const product = buildProduct({ minQuantity: '2' });
    expectRiskInputError(
      () =>
        evaluateOrderRisk(
          buildOrderRiskInput({
            product,
            contract: buildContract(product),
            requestedQuantity: '1',
            policy: buildPolicy({ maxContractsPerPosition: '10002' }),
          }),
        ),
      'GRID_TOO_LARGE',
    );
  });

  it('returns MIN_QUANTITY when the governed cap is below product minimum', () => {
    const product = buildProduct({ minQuantity: '2' });
    expect(
      evaluateOrderRisk(
        buildOrderRiskInput({
          product,
          contract: buildContract(product),
        }),
      ),
    ).toMatchObject({
      status: 'REJECT',
      quantity: '0',
      reasons: ['MIN_QUANTITY'],
      economics: null,
    });
  });

  it('searches the full nonlinear fee grid and retains the greatest admissible quantity', () => {
    const costs = createCostModelSnapshot(
      buildCostsInput({
        entryFees: {
          minimum: '2',
          tiers: [
            { upToQuantity: '2', feePerContract: '0.5' },
            { upToQuantity: null, feePerContract: '0.1' },
          ],
        },
        exitFees: {
          minimum: '2',
          tiers: [{ upToQuantity: null, feePerContract: '0.2' }],
        },
      }),
    );
    const decision = evaluateOrderRisk(
      buildOrderRiskInput({
        policy: policyForFour({ riskPerTradePct: '1' }),
        snapshots: buildSnapshots({ costs }),
      }),
    );
    expect(decision).toMatchObject({
      status: 'APPROVE',
      quantity: '4',
      economics: { estimatedCostsAccount: '4' },
    });
  });

  it.each([
    ['RISK_BUDGET', { riskPerTradePct: '0.1' }],
    ['OPEN_RISK', { maxOpenRiskPct: '0.1' }],
    ['MARGIN', { maxMarginUsagePct: '1' }],
    ['GROSS_EXPOSURE', { maxGrossExposurePct: '10' }],
    [
      'RISK_GROUP_EXPOSURE',
      { riskGroupMaxExposurePct: { EU_EQUITY_INDEX: '10' } },
    ],
    ['AVAILABLE_FUNDS', { cashReservePct: '99' }],
  ] as const)(
    'allows exact %s equality and rejects one exact quantity increment',
    (reason, limits) => {
      const policy = buildPolicy({
        maxContractsPerPosition: '2',
        ...limits,
      });
      expect(
        evaluateOrderRisk(
          buildOrderRiskInput({ requestedQuantity: '1', policy }),
        ),
      ).toMatchObject({ status: 'APPROVE', quantity: '1', reasons: [] });
      const rejectedIncrement = evaluateOrderRisk(
        buildOrderRiskInput({ requestedQuantity: '2', policy }),
      );
      expect(rejectedIncrement).toMatchObject({
        status: 'REDUCE_SIZE',
        quantity: '1',
      });
      expect(rejectedIncrement.reasons).toContain(reason);
    },
  );

  it('includes current risk-group exposure in the exact group limit', () => {
    const portfolio = buildPortfolio({
      positions: [
        {
          ...firstOtherPosition(),
          grossExposure: '50',
          riskGroup: 'EU_EQUITY_INDEX',
        },
      ],
    });
    const policy = buildPolicy({
      maxContractsPerPosition: '2',
      riskGroupMaxExposurePct: { EU_EQUITY_INDEX: '15' },
    });
    expect(
      evaluateOrderRisk(
        buildOrderRiskInput({ requestedQuantity: '1', portfolio, policy }),
      ).status,
    ).toBe('APPROVE');
    expect(
      evaluateOrderRisk(
        buildOrderRiskInput({ requestedQuantity: '2', portfolio, policy }),
      ).reasons,
    ).toContain('RISK_GROUP_EXPOSURE');
  });

  it('rejects a below-minimum aligned request with MIN_QUANTITY', () => {
    const product = buildProduct({ minQuantity: '2' });
    expect(
      evaluateOrderRisk(
        buildOrderRiskInput({
          product,
          contract: buildContract(product),
          requestedQuantity: '1',
          policy: policyForFour(),
        }),
      ),
    ).toMatchObject({
      status: 'REJECT',
      quantity: '0',
      reasons: ['MIN_QUANTITY'],
      economics: null,
    });
  });

  it('throws for an off-grid or nonpositive request', () => {
    const product = buildProduct({ quantityStep: '2', minQuantity: '2' });
    expectRiskInputError(() =>
      evaluateOrderRisk(
        buildOrderRiskInput({
          product,
          contract: buildContract(product),
          requestedQuantity: '3',
          policy: policyForFour(),
        }),
      ),
    );
    expectRiskInputError(() =>
      evaluateOrderRisk(buildOrderRiskInput({ requestedQuantity: '0' })),
    );
  });

  it('adds cap plus minimum failures when no capped quantity is feasible', () => {
    expect(
      evaluateOrderRisk(
        buildOrderRiskInput({
          requestedQuantity: '5',
          policy: buildPolicy({
            maxContractsPerPosition: '4',
            riskPerTradePct: '0',
          }),
        }),
      ),
    ).toMatchObject({
      status: 'REJECT',
      quantity: '0',
      reasons: ['MAX_CONTRACTS_PER_POSITION', 'RISK_BUDGET'],
      economics: { quantity: '1' },
    });
  });

  it('never reports the cap reason when quantity is implicit', () => {
    const decision = evaluateOrderRisk(
      buildOrderRiskInput({ policy: policyForFour() }),
    );
    expect(decision).toMatchObject({ status: 'APPROVE', quantity: '4' });
    expect(decision.reasons).not.toContain('MAX_CONTRACTS_PER_POSITION');
  });
});

describe('contract activity interval', () => {
  function inputAt(
    decisionAt: string,
    observedAt: string,
    validFrom: string,
    validUntil: string,
  ) {
    const product = buildProduct();
    const contract = buildContract(product);
    const snapshots = buildSnapshots({
      margin: createMarginSnapshot(
        buildMarginInput({ observedAt, validFrom, validUntil }),
      ),
      eligibility: createEligibilitySnapshot(
        buildEligibilityInput({ observedAt, validFrom, validUntil }),
      ),
      costs: createCostModelSnapshot(
        buildCostsInput({ observedAt, validFrom, validUntil }),
      ),
    });
    return buildOrderRiskInput({
      decisionAt,
      riskPolicyUseAt: decisionAt,
      signalExpiresAt: '2026-03-20T00:00:00Z',
      product,
      contract,
      snapshots,
      policy: buildPolicy({
        approvedAt: '2025-01-01T00:00:00Z',
        activatedAt: '2025-01-01T00:00:00Z',
      }),
    });
  }

  it('accepts firstTradeAt equality and records that exact decision time', () => {
    const decisionAt = '2025-12-01T00:00:00Z';
    const decision = evaluateOrderRisk(
      inputAt(
        decisionAt,
        '2025-11-30T23:00:00Z',
        '2025-11-30T23:00:00Z',
        '2025-12-01T01:00:00Z',
      ),
    );
    expect(decision).toMatchObject({
      status: 'APPROVE',
      context: { decisionAt },
    });
  });

  it.each([
    [
      'before firstTradeAt',
      '2025-11-30T23:59:59Z',
      '2025-11-30T23:00:00Z',
      '2025-12-01T01:00:00Z',
    ],
    [
      'at lastTradeAt',
      '2026-03-19T21:00:00Z',
      '2026-03-19T20:00:00Z',
      '2026-03-19T22:00:00Z',
    ],
    [
      'after lastTradeAt',
      '2026-03-19T21:00:01Z',
      '2026-03-19T20:00:00Z',
      '2026-03-19T22:00:00Z',
    ],
  ])('rejects a decision %s', (_label, decisionAt, validFrom, validUntil) => {
    expectRiskInputError(() =>
      evaluateOrderRisk(inputAt(decisionAt, validFrom, validFrom, validUntil)),
    );
  });
});

describe('FX integration and hostile runtime boundaries', () => {
  it('integrates direct and inverse FX and records the selected version', () => {
    const direct = evaluateOrderRisk(buildMesInput());
    expect(direct).toMatchObject({
      status: 'APPROVE',
      economics: { directionalLossAccount: '4' },
      context: { fxVersion: 'FX_V1' },
    });

    const mes = buildMesInput();
    const inverse = evaluateOrderRisk({
      ...mes,
      snapshots: {
        ...mes.snapshots,
        fx: createFxSnapshot(
          buildFxInput({
            version: 'FX_INVERSE_V1',
            baseCurrency: 'EUR',
            quoteCurrency: 'USD',
            rate: '1.25',
          }),
        ),
      },
    });
    expect(inverse).toMatchObject({
      economics: { directionalLossAccount: '4' },
      context: { fxVersion: 'FX_INVERSE_V1' },
    });
  });

  it('rejects product-contract mismatches and malformed public records', () => {
    expectRiskInputError(() =>
      evaluateOrderRisk({
        ...buildOrderRiskInput(),
        contract: { ...buildContract(), productCode: 'OTHER' },
      }),
    );
    expectRiskInputError(() =>
      evaluateOrderRisk({
        ...buildOrderRiskInput(),
        account: { ...baseAccountInput, accountCurrency: 'USD' },
      } as never),
    );
    expectRiskInputError(() =>
      evaluateOrderRisk({
        ...buildOrderRiskInput(),
        policy: { ...buildPolicy(), approvalStatus: 'DRAFT' },
      } as never),
    );
  });

  it('rejects identity FX snapshots even when their pair is otherwise valid', () => {
    expectRiskInputError(
      () =>
        evaluateOrderRisk(
          buildOrderRiskInput({
            snapshots: buildSnapshots({
              fx: createFxSnapshot(buildFxInput()),
            }),
          }),
        ),
      'MISMATCHED_CURRENCY',
    );
  });

  it('rejects invalid directions, modes, price grids, and stop sides', () => {
    expectRiskInputError(() =>
      evaluateOrderRisk({
        ...buildOrderRiskInput(),
        direction: 'SIDEWAYS',
      } as never),
    );
    expectRiskInputError(() =>
      evaluateOrderRisk({
        ...buildOrderRiskInput(),
        riskPolicyUseMode: 'REPLAY',
      } as never),
    );
    expectRiskInputError(() =>
      evaluateOrderRisk(
        buildOrderRiskInput({ entryPrice: '100.5', stopPrice: '99' }),
      ),
    );
    expectRiskInputError(() =>
      evaluateOrderRisk(
        buildOrderRiskInput({ entryPrice: '100', stopPrice: '100' }),
      ),
    );
    expectRiskInputError(() =>
      evaluateOrderRisk(
        buildOrderRiskInput({
          direction: 'SHORT',
          entryPrice: '100',
          stopPrice: '99',
        }),
      ),
    );
  });

  it('requires own top-level properties and captures accessor values once', () => {
    const original = buildOrderRiskInput({ requestedQuantity: '1' });
    const reads = new Map<string, number>();
    const accessorInput: Record<string, unknown> = {};
    for (const key of Object.keys(original) as (keyof OrderRiskInput)[]) {
      const value: unknown = original[key];
      Object.defineProperty(accessorInput, key, {
        enumerable: true,
        get() {
          reads.set(key, (reads.get(key) ?? 0) + 1);
          return value;
        },
      });
    }
    expect(evaluateOrderRisk(accessorInput as never).status).toBe('APPROVE');
    expect([...reads.values()].every((count) => count === 1)).toBe(true);

    const inherited = Object.create({ instrumentId: 'FDXS' }) as Record<
      string,
      unknown
    >;
    Object.assign(inherited, original);
    Reflect.deleteProperty(inherited, 'instrumentId');
    expectRiskInputError(() => evaluateOrderRisk(inherited as never));
  });

  it('maps native proxy traps and throwing getters to typed errors', () => {
    const trapped = new Proxy(buildOrderRiskInput(), {
      getOwnPropertyDescriptor() {
        throw new Error('native trap');
      },
    });
    expectRiskInputError(() => evaluateOrderRisk(trapped));

    const getter = { ...buildOrderRiskInput() } as Record<string, unknown>;
    Object.defineProperty(getter, 'instrumentId', {
      enumerable: true,
      get() {
        throw new Error('getter trap');
      },
    });
    expectRiskInputError(() => evaluateOrderRisk(getter as never));

    const prototypeTrap = new Proxy(buildOrderRiskInput(), {
      getPrototypeOf() {
        throw new Error('prototype trap');
      },
    });
    expectRiskInputError(() => evaluateOrderRisk(prototypeTrap));

    const setterOnly = { ...buildOrderRiskInput() } as Record<string, unknown>;
    Object.defineProperty(setterOnly, 'instrumentId', {
      enumerable: true,
      set: () => undefined,
    });
    expectRiskInputError(() => evaluateOrderRisk(setterOnly as never));
  });

  it('maps revoked top-level and nested proxies to stable input errors', () => {
    const topLevel = Proxy.revocable({}, {});
    topLevel.revoke();
    expectRiskInputError(() => evaluateOrderRisk(topLevel.proxy as never));

    const nested = Proxy.revocable({}, {});
    nested.revoke();
    expectRiskInputError(() =>
      evaluateOrderRisk({
        ...buildOrderRiskInput(),
        product: nested.proxy,
      } as never),
    );
  });

  it('uses captured account descriptors instead of divergent proxy gets', () => {
    const account = divergentProperty(
      { ...baseAccountInput },
      'killSwitchActive',
      true,
      false,
    );
    expect(
      evaluateOrderRisk(buildOrderRiskInput({ account: account as never }))
        .reasons,
    ).toContain('KILL_SWITCH');
  });

  it('uses captured policy descriptors instead of divergent proxy gets', () => {
    const policy = divergentProperty(
      {
        ...basePolicyInput,
        riskGroupMaxExposurePct: {
          ...basePolicyInput.riskGroupMaxExposurePct,
        },
      },
      'riskPerTradePct',
      '0',
      '10',
    );
    expect(
      evaluateOrderRisk(buildOrderRiskInput({ policy: policy as never }))
        .reasons,
    ).toContain('RISK_BUDGET');
  });

  it('uses captured fixed-safety descriptors instead of divergent proxy gets', () => {
    const assertions = divergentProperty(
      { ...baseSafetyAssertionsInput },
      'includeEstimatedExitCosts',
      false,
      true,
    );
    expectRiskInputError(() =>
      evaluateOrderRisk(
        buildOrderRiskInput({ safetyAssertions: assertions as never }),
      ),
    );
  });

  it('uses captured portfolio collection descriptors for positions and intents', () => {
    const positions = [activePositionRaw()];
    const positionPortfolio = divergentProperty(
      { positions, activeEntryIntents: [] },
      'positions',
      positions,
      [],
    );
    expect(
      evaluateOrderRisk(
        buildOrderRiskInput({ portfolio: positionPortfolio as never }),
      ).reasons,
    ).toContain('POSITION_ALREADY_ACTIVE');

    const intents = [
      {
        intentId: 'INTENT_ACTIVE',
        instrumentId: 'FDXS',
        contractId: baseContractInput.contractId,
        direction: 'LONG',
      },
    ];
    const intentPortfolio = divergentProperty(
      { positions: [], activeEntryIntents: intents },
      'activeEntryIntents',
      intents,
      [],
    );
    expect(
      evaluateOrderRisk(
        buildOrderRiskInput({ portfolio: intentPortfolio as never }),
      ).reasons,
    ).toContain('ENTRY_INTENT_ALREADY_ACTIVE');
  });

  it('uses captured nested risk-group, array, and item descriptors', () => {
    const riskGroups = divergentProperty(
      { EU_EQUITY_INDEX: '100' },
      'EU_EQUITY_INDEX',
      '0',
      '100',
    );
    const policy = {
      ...basePolicyInput,
      riskGroupMaxExposurePct: riskGroups,
    };
    expect(
      evaluateOrderRisk(buildOrderRiskInput({ policy: policy as never }))
        .reasons,
    ).toContain('RISK_GROUP_EXPOSURE');

    const item = divergentProperty(
      activePositionRaw(),
      'instrumentId',
      'FDXS',
      'OTHER_ITEM',
    );
    const positions = divergentProperty(
      [item],
      '0',
      item,
      activePositionRaw('OTHER_ARRAY'),
    );
    expect(
      evaluateOrderRisk(
        buildOrderRiskInput({
          portfolio: { positions, activeEntryIntents: [] } as never,
        }),
      ).reasons,
    ).toContain('POSITION_ALREADY_ACTIVE');
  });

  it('bounds risk-group keys and maps hostile key/descriptor traps to input errors', () => {
    const evaluateMap = (riskGroupMaxExposurePct: object) =>
      evaluateOrderRisk(
        buildOrderRiskInput({
          policy: {
            ...basePolicyInput,
            riskGroupMaxExposurePct,
          } as never,
        }),
      );

    const ownKeysTrap = new Proxy(
      { EU_EQUITY_INDEX: '100' },
      {
        ownKeys() {
          throw new Error('ownKeys trap');
        },
      },
    );
    expectRiskInputError(() => evaluateMap(ownKeysTrap));

    const excessive = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [
        `GROUP_${String(index)}`,
        '1',
      ]),
    );
    expectRiskInputError(() => evaluateMap(excessive));

    const symbolic = { EU_EQUITY_INDEX: '100' } as Record<PropertyKey, unknown>;
    symbolic[Symbol('group')] = '1';
    expectRiskInputError(() => evaluateMap(symbolic));

    const descriptorTrap = new Proxy(
      { EU_EQUITY_INDEX: '100' },
      {
        getOwnPropertyDescriptor() {
          throw new Error('descriptor trap');
        },
      },
    );
    expectRiskInputError(() => evaluateMap(descriptorTrap));

    const disappearing = new Proxy(
      {},
      {
        ownKeys: () => ['EU_EQUITY_INDEX'],
        getOwnPropertyDescriptor: () => undefined,
      },
    );
    expectRiskInputError(() => evaluateMap(disappearing));

    const nonEnumerable = {};
    Object.defineProperty(nonEnumerable, 'EU_EQUITY_INDEX', {
      enumerable: false,
      value: '100',
    });
    expectRiskInputError(() => evaluateMap(nonEnumerable));
  });

  it('rejects noncanonical runtime decimal casts and exact signal expiry boundary', () => {
    expectRiskInputError(() =>
      evaluateOrderRisk({
        ...buildOrderRiskInput(),
        requestedQuantity: 1,
      } as never),
    );
    expectRiskInputError(() =>
      evaluateOrderRisk(buildOrderRiskInput({ requestedQuantity: '1e2' })),
    );
    expectRiskInputError(() =>
      evaluateOrderRisk(buildOrderRiskInput({ decisionAt: 'not-an-instant' })),
    );
    expect(
      evaluateOrderRisk(buildOrderRiskInput({ signalExpiresAt: DECISION_AT }))
        .reasons,
    ).toContain('SIGNAL_EXPIRED');
  });

  it('rejects nonobjects at the public boundary', () => {
    expectRiskInputError(() => evaluateOrderRisk(null as never));
    expectRiskInputError(() => evaluateOrderRisk([] as never));
  });

  it('is isolated from global Decimal configuration and keeps exact huge bounded values', () => {
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
      Decimal.set({ precision: 2, rounding: Decimal.ROUND_DOWN });
      const huge = `1${'0'.repeat(120)}`;
      const input = buildOrderRiskInput({
        account: buildAccount({
          realizedEquity: huge,
          availableFunds: huge,
        }),
        policy: buildPolicy({ maxSizingCapital: huge }),
      });
      expect(evaluateOrderRisk(input)).toMatchObject({
        status: 'APPROVE',
        economics: {
          directionalLossAccount: '1',
          grossExposureAccount: '100',
        },
      });
    } finally {
      Decimal.set(previous);
    }
  });
});

describe('Milestone 2A synthetic futures integration', () => {
  it('publishes exact immutable FDXS and MES March 2026 fixtures', () => {
    expect(syntheticFdxsProduct).toEqual({
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
    });
    expect(syntheticFdxsContract).toEqual({
      contractId: 'FDXSH26',
      productCode: 'FDXS',
      firstTradeAt: '2025-12-19T00:00:00Z',
      lastTradeAt: '2026-03-20T12:00:00Z',
      expiryAt: '2026-03-20T13:00:00Z',
      settlementType: 'CASH',
    });
    expect(syntheticMesProduct).toEqual({
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
    });
    expect(syntheticMesContract).toEqual({
      contractId: 'MESH26',
      productCode: 'MES',
      firstTradeAt: '2025-12-19T00:00:00Z',
      lastTradeAt: '2026-03-20T13:30:00Z',
      expiryAt: '2026-03-20T14:00:00Z',
      settlementType: 'CASH',
    });
    for (const fixture of [
      syntheticFdxsProduct,
      syntheticFdxsContract,
      syntheticMesProduct,
      syntheticMesContract,
    ]) {
      expect(Object.isFrozen(fixture)).toBe(true);
    }
  });

  it.each([
    [syntheticFdxsProduct, syntheticFdxsContract, '15000', '14999.5'],
    [syntheticMesProduct, syntheticMesContract, '5000', '4999.75'],
  ] as const)(
    'rejects %s under the initial exact 100 percent gross-exposure policy',
    (product, contract, entryPrice, stopPrice) => {
      const decision = evaluateOrderRisk(
        syntheticOrderRiskInput(product, contract, {
          entryPrice,
          stopPrice,
          policy: syntheticPolicy(product, {
            version: 'RISK_M2A_INITIAL_GROSS_100',
            maxContractsPerPosition: '1',
            maxGrossExposurePct: '100',
          }),
        }),
      );
      expect(decision).toMatchObject({ status: 'REJECT', quantity: '0' });
      expect(decision.reasons).toContain('GROSS_EXPOSURE');
    },
  );

  it('approves the same FDXS order only after a manual cap policy version increase', () => {
    const account = buildAccount({
      realizedEquity: '1200',
      availableFunds: '1200',
    });
    const initialPolicy = syntheticPolicy(syntheticFdxsProduct, {
      version: 'RISK_M2A_CAP_1000',
      maxSizingCapital: '1000',
      maxContractsPerPosition: '1',
      maxGrossExposurePct: '100',
      riskGroupMaxExposurePct: {
        [syntheticFdxsProduct.riskGroup]: '100',
      },
    });
    const raisedPolicy = syntheticPolicy(syntheticFdxsProduct, {
      version: 'RISK_M2A_CAP_1200',
      maxSizingCapital: '1200',
      maxContractsPerPosition: '1',
      maxGrossExposurePct: '100',
      riskGroupMaxExposurePct: {
        [syntheticFdxsProduct.riskGroup]: '100',
      },
    });
    const order = {
      requestedQuantity: '1',
      entryPrice: '1200',
      stopPrice: '1199.5',
      account,
    } as const;
    const before = evaluateOrderRisk(
      syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
        ...order,
        policy: initialPolicy,
      }),
    );
    const after = evaluateOrderRisk(
      syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
        ...order,
        policy: raisedPolicy,
      }),
    );

    expect(before).toMatchObject({
      status: 'REJECT',
      quantity: '0',
      reasons: ['GROSS_EXPOSURE', 'RISK_GROUP_EXPOSURE'],
      context: { riskPolicyVersion: 'RISK_M2A_CAP_1000' },
    });
    expect(after).toMatchObject({
      status: 'APPROVE',
      quantity: '1',
      reasons: [],
      context: { riskPolicyVersion: 'RISK_M2A_CAP_1200' },
    });
    expect(after.context.riskPolicyVersion).not.toBe(
      before.context.riskPolicyVersion,
    );
  });

  it('produces identical MES decisions for equivalent direct and inverse FX', () => {
    const directInput = syntheticOrderRiskInput(
      syntheticMesProduct,
      syntheticMesContract,
    );
    const inverseInput = {
      ...directInput,
      snapshots: syntheticSnapshots(
        syntheticMesProduct,
        syntheticMesContract,
        'INVERSE',
      ),
    };
    expect(evaluateOrderRisk(inverseInput)).toEqual(
      evaluateOrderRisk(directInput),
    );
  });

  it('rejects a one-contract Kijun risk above EUR 5 without forcing or rounding quantity', () => {
    const decision = evaluateOrderRisk(
      syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
        entryPrice: '100',
        stopPrice: '94',
        policy: syntheticPolicy(syntheticFdxsProduct, {
          maxContractsPerPosition: '1',
          riskPerTradePct: '0.5',
          maxGrossExposurePct: '200',
        }),
      }),
    );
    expect(decision).toMatchObject({
      status: 'REJECT',
      quantity: '0',
      reasons: ['RISK_BUDGET'],
      economics: {
        quantity: '1',
        worstCaseBudgetedLossAccount: '6',
      },
    });
  });

  it('caps realized gains until a EUR 1,200 policy version explicitly increases sizing', () => {
    const cappedPolicy = syntheticPolicy(syntheticFdxsProduct, {
      version: 'RISK_CAP_1000',
      maxSizingCapital: '1000',
      riskPerTradePct: '0.125',
      maxGrossExposurePct: '200',
    });
    const baseline = evaluateOrderRisk(
      syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
        policy: cappedPolicy,
      }),
    );
    const realizedGain = evaluateOrderRisk(
      syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
        policy: cappedPolicy,
        account: buildAccount({
          realizedEquity: '5000',
          availableFunds: '5000',
        }),
      }),
    );
    expect(realizedGain).toEqual(baseline);
    expect(realizedGain.quantity).toBe('2');

    const raisedCap = evaluateOrderRisk(
      syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
        policy: syntheticPolicy(syntheticFdxsProduct, {
          version: 'RISK_CAP_1200',
          maxSizingCapital: '1200',
          riskPerTradePct: '0.125',
          maxGrossExposurePct: '200',
        }),
        account: buildAccount({
          realizedEquity: '5000',
          availableFunds: '5000',
        }),
      }),
    );
    expect(raisedCap).toMatchObject({ status: 'APPROVE', quantity: '3' });
  });

  it('ignores unrealized gains but applies unrealized losses immediately', () => {
    const policy = syntheticPolicy(syntheticFdxsProduct, {
      riskPerTradePct: '0.1',
      maxGrossExposurePct: '200',
    });
    const baseline = evaluateOrderRisk(
      syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
        policy,
      }),
    );
    const gain = evaluateOrderRisk(
      syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
        policy,
        account: buildAccount({
          unrealizedPnl: '1000',
          availableFunds: '2000',
        }),
      }),
    );
    const loss = evaluateOrderRisk(
      syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
        policy,
        account: buildAccount({
          unrealizedPnl: '-500',
          availableFunds: '500',
        }),
      }),
    );
    expect(gain).toEqual(baseline);
    expect(baseline.quantity).toBe('2');
    expect(loss).toMatchObject({ status: 'APPROVE', quantity: '1' });
  });

  it('rejects an existing position and an active intent for the same instrument', () => {
    const position = {
      positionId: 'POSITION_FDXS',
      instrumentId: syntheticFdxsProduct.productCode,
      contractId: syntheticFdxsContract.contractId,
      direction: 'LONG' as const,
      quantity: '1',
      remainingOpenRisk: '0',
      margin: '0',
      grossExposure: '0',
      riskGroup: syntheticFdxsProduct.riskGroup,
    };
    const intent = {
      intentId: 'INTENT_FDXS',
      instrumentId: syntheticFdxsProduct.productCode,
      contractId: syntheticFdxsContract.contractId,
      direction: 'LONG' as const,
    };
    expect(
      evaluateOrderRisk(
        syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
          portfolio: buildPortfolio({ positions: [position] }),
        }),
      ).reasons,
    ).toContain('POSITION_ALREADY_ACTIVE');
    expect(
      evaluateOrderRisk(
        syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
          portfolio: buildPortfolio({ activeEntryIntents: [intent] }),
        }),
      ).reasons,
    ).toContain('ENTRY_INTENT_ALREADY_ACTIVE');
  });

  it('respects aggregate and exact risk-group equality across mixed FDXS/MES positions', () => {
    const portfolio = buildPortfolio({
      positions: [
        {
          positionId: 'POSITION_EU',
          instrumentId: 'FDXS_PRIOR',
          contractId: 'FDXSM26',
          direction: 'LONG',
          quantity: '1',
          remainingOpenRisk: '0',
          margin: '0',
          grossExposure: '400',
          riskGroup: syntheticFdxsProduct.riskGroup,
        },
        {
          positionId: 'POSITION_US',
          instrumentId: 'MES_PRIOR',
          contractId: 'MESM26',
          direction: 'LONG',
          quantity: '1',
          remainingOpenRisk: '0',
          margin: '0',
          grossExposure: '400',
          riskGroup: syntheticMesProduct.riskGroup,
        },
      ],
    });
    const policy = syntheticPolicy(syntheticFdxsProduct, {
      maxContractsPerPosition: '2',
      riskPerTradePct: '100',
      maxGrossExposurePct: '90',
      riskGroupMaxExposurePct: {
        [syntheticFdxsProduct.riskGroup]: '50',
        [syntheticMesProduct.riskGroup]: '100',
      },
    });
    const common = {
      portfolio,
      policy,
      account: buildAccount({ grossExposure: '800' }),
    };
    expect(
      evaluateOrderRisk(
        syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
          ...common,
          requestedQuantity: '1',
        }),
      ),
    ).toMatchObject({ status: 'APPROVE', quantity: '1', reasons: [] });
    const over = evaluateOrderRisk(
      syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
        ...common,
        requestedQuantity: '2',
      }),
    );
    expect(over).toMatchObject({ status: 'REDUCE_SIZE', quantity: '1' });
    expect(over.reasons).toEqual(['GROSS_EXPOSURE', 'RISK_GROUP_EXPOSURE']);

    expectRiskInputError(() =>
      evaluateOrderRisk(
        syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
          policy: syntheticPolicy(syntheticFdxsProduct, {
            riskGroupMaxExposurePct: {
              [syntheticMesProduct.riskGroup]: '100',
            },
          }),
        }),
      ),
    );
  });

  it('reports an explicit cap reduction while implicit sizing uses the cap silently', () => {
    const policy = syntheticPolicy(syntheticFdxsProduct, {
      maxContractsPerPosition: '2',
      riskPerTradePct: '100',
      maxGrossExposurePct: '100',
    });
    expect(
      evaluateOrderRisk(
        syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
          policy,
          requestedQuantity: '3',
        }),
      ),
    ).toMatchObject({
      status: 'REDUCE_SIZE',
      requestedQuantity: '3',
      quantity: '2',
      reasons: ['MAX_CONTRACTS_PER_POSITION'],
    });
    const implicit = evaluateOrderRisk(
      syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
        policy,
      }),
    );
    expect(implicit).toMatchObject({ status: 'APPROVE', quantity: '2' });
    expect(implicit.reasons).not.toContain('MAX_CONTRACTS_PER_POSITION');
  });

  it('preserves FORWARD and HISTORICAL_RESEARCH policy-use invariants', () => {
    expect(
      evaluateOrderRisk(
        syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract),
      ).context,
    ).toMatchObject({
      riskPolicyUseMode: 'FORWARD',
      riskPolicyUseAt: M2A_DECISION_AT,
      backtestId: null,
      runCreatedAt: null,
    });

    const runCreatedAt = '2026-03-11T09:00:00Z';
    expect(
      evaluateOrderRisk(
        syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
          riskPolicyUseMode: 'HISTORICAL_RESEARCH',
          riskPolicyUseAt: runCreatedAt,
          backtestId: 'BACKTEST_M2A',
          runCreatedAt,
        }),
      ).context,
    ).toMatchObject({
      riskPolicyUseMode: 'HISTORICAL_RESEARCH',
      riskPolicyUseAt: runCreatedAt,
      backtestId: 'BACKTEST_M2A',
      runCreatedAt,
    });

    expectRiskInputError(() =>
      evaluateOrderRisk(
        syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
          riskPolicyUseMode: 'HISTORICAL_RESEARCH',
          riskPolicyUseAt: runCreatedAt,
        }),
      ),
    );
    expectRiskInputError(() =>
      evaluateOrderRisk(
        syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
          backtestId: 'BACKTEST_FORBIDDEN',
          runCreatedAt,
        }),
      ),
    );
  });

  it.each([
    ['futuresEligibility', 'LIVE'],
    ['requireExplicitGrossExposureLimit', false],
    ['includeEstimatedExitCosts', false],
    ['rejectIfMinQuantityExceedsRiskBudget', false],
  ] as const)(
    'rejects the fixed %s mismatch independently with an otherwise valid policy',
    (field, value) => {
      const error = expectRiskInputError(() =>
        evaluateOrderRisk(
          syntheticOrderRiskInput(syntheticFdxsProduct, syntheticFdxsContract, {
            safetyAssertions: {
              ...buildSafetyAssertions(),
              [field]: value,
            },
          }),
        ),
      );
      expect(error.details).toMatchObject({ field });
    },
  );

  it('keeps the complete futures decision isolated from ambient Decimal settings', () => {
    const input = syntheticOrderRiskInput(
      syntheticMesProduct,
      syntheticMesContract,
    );
    const expected = evaluateOrderRisk(input);
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
      Decimal.set({ precision: 2, rounding: Decimal.ROUND_DOWN });
      expect(evaluateOrderRisk(input)).toEqual(expected);
    } finally {
      Decimal.set(previous);
    }
  });
});
