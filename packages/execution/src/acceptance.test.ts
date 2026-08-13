import { describe, expect, it } from 'vitest';
import type { FuturesContract, FuturesProduct } from '@trading-auto/domain';
import {
  createCostModelSnapshot,
  createEligibilitySnapshot,
  createFxSnapshot,
  createMarginSnapshot,
  type OrderRiskInput,
} from '@trading-auto/risk';
import {
  syntheticFdxsContract,
  syntheticFdxsProduct,
  syntheticMesContract,
  syntheticMesProduct,
} from '@trading-auto/test-helpers';
import {
  buildCostsInput,
  buildEligibilityInput,
  buildFxInput,
  buildMarginInput,
  buildOrderRiskInput,
  buildPolicy,
} from '../../risk/test-helpers/builders.js';

import {
  buildExecutionOpen,
  buildExecutionSchedule,
} from '../test-helpers/builders.js';
import {
  createEntryIntent,
  createOpenPosition,
  executeEntryAtNextOpen,
  ExecutionInputError,
  processPositionH1Bar,
  selectNextTradableH1Open,
  type H1ClosedBarEvent,
} from './index.js';

interface AcceptanceCase {
  readonly product: Readonly<FuturesProduct>;
  readonly contract: Readonly<FuturesContract>;
  readonly entryAdjustment: string;
  readonly expectedFill: string;
  readonly expectedCosts: string;
  readonly expectedDirectionalLoss: string;
  readonly gapOpen: string;
  readonly exitAdjustment: string;
  readonly expectedGapFill: string;
}

const feeSchedule = Object.freeze({
  minimum: '0',
  tiers: Object.freeze([
    Object.freeze({ upToQuantity: null, feePerContract: '1' }),
  ]),
});

function riskInputFor(testCase: AcceptanceCase): OrderRiskInput {
  const { product, contract } = testCase;
  const costs = createCostModelSnapshot(
    buildCostsInput({
      contractId: contract.contractId,
      currency: product.pnlCurrency,
      entryFees: feeSchedule,
      exitFees: feeSchedule,
      spreadPriceUnitsRoundTrip: product.tickSize,
      adverseEntrySlippagePriceUnits: testCase.entryAdjustment,
      adverseExitSlippagePriceUnits: testCase.exitAdjustment,
    }),
  );
  const snapshots = Object.freeze({
    fx:
      product.pnlCurrency === 'EUR'
        ? null
        : createFxSnapshot(buildFxInput({ rate: '0.8' })),
    margin: createMarginSnapshot(
      buildMarginInput({
        contractId: contract.contractId,
        currency: product.pnlCurrency,
      }),
    ),
    eligibility: createEligibilitySnapshot(
      buildEligibilityInput({ contractId: contract.contractId }),
    ),
    costs,
  });
  return buildOrderRiskInput({
    instrumentId: product.productCode,
    product,
    contract,
    snapshots,
    policy: buildPolicy({
      maxContractsPerPosition: '2',
      riskGroupMaxExposurePct: { [product.riskGroup]: '100' },
    }),
    direction: 'LONG',
    entryPrice: testCase.expectedFill,
    stopPrice: '99',
    requestedQuantity: '1',
    decisionAt: '2026-01-02T12:00:00Z',
    riskPolicyUseAt: '2026-01-02T12:00:00Z',
    signalExpiresAt: '2026-01-02T13:00:00Z',
    strategyVersion: 'ACCEPTANCE_STRATEGY_V1',
    datasetVersion: 'ACCEPTANCE_DATASET_V1',
  });
}

function exerciseCase(testCase: AcceptanceCase) {
  const { product, contract } = testCase;
  const schedule = buildExecutionSchedule(contract, {
    maintenanceBreaks: [
      { start: '2026-01-02T10:00:00Z', end: '2026-01-02T11:00:00Z' },
    ],
  });
  const selected = selectNextTradableH1Open({
    signalCloseTime: '2026-01-02T09:00:00Z',
    decisionAt: '2026-01-02T12:00:00Z',
    contract,
    schedule,
    openEvents: [
      buildExecutionOpen(product, contract, '2026-01-02T10:00:00Z'),
      buildExecutionOpen(product, contract, '2026-01-02T12:00:00Z'),
    ],
  });
  if (selected === null) throw new Error('Expected a tradable open fixture.');

  const intent = createEntryIntent({
    intentId: `${product.productCode}_ACCEPTANCE_ENTRY`,
    instrumentId: product.productCode,
    contractId: contract.contractId,
    strategyVersion: 'ACCEPTANCE_STRATEGY_V1',
    datasetVersion: 'ACCEPTANCE_DATASET_V1',
    timeframe: '1h',
    direction: 'LONG',
    signalCloseTime: '2026-01-02T09:00:00Z',
    expiresAt: '2026-01-02T13:00:00Z',
    stopPrice: '99',
    requestedQuantity: '1',
    riskDecisionId: `${product.productCode}_ACCEPTANCE_RISK`,
    riskDecisionStatus: 'APPROVE',
  });
  const fill = executeEntryAtNextOpen({
    intent,
    open: selected,
    adverseEntrySlippagePriceUnits: testCase.entryAdjustment,
    riskInput: riskInputFor(testCase),
  });
  if (fill.type === 'ENTRY_CANCELLED') {
    throw new Error(`Unexpected entry cancellation: ${fill.reasons.join(',')}`);
  }
  const position = createOpenPosition({
    positionId: `${product.productCode}_ACCEPTANCE_POSITION`,
    intent,
    fill,
    entryCostAccountCurrency: '0',
    tickSize: product.tickSize,
    executionModelVersion: 'BAR_BASED_H1_V1',
    exitPolicyVersion: 'ICHIMOKU_KIJUN_EXIT_V1',
  });
  const gapOpen = buildExecutionOpen(
    product,
    contract,
    '2026-01-02T13:00:00Z',
    { price: testCase.gapOpen },
  );
  const unavailableBar = new Proxy(
    {},
    {
      get: () => {
        throw new Error(
          'The H1 close is not observable during gap processing.',
        );
      },
    },
  ) as H1ClosedBarEvent;
  const exit = processPositionH1Bar({
    position,
    openEvent: gapOpen,
    bar: unavailableBar,
    currentKijun: null,
    decisionAt: gapOpen.availableAt,
    adverseExitSlippagePriceUnits: testCase.exitAdjustment,
  });
  return { schedule, selected, fill, position, exit };
}

describe('Milestone 2B exact futures acceptance', () => {
  it.each([
    {
      product: syntheticFdxsProduct,
      contract: syntheticFdxsContract,
      entryAdjustment: '0.5',
      expectedFill: '100.5',
      expectedCosts: '3.5',
      expectedDirectionalLoss: '1.5',
      gapOpen: '98.5',
      exitAdjustment: '0.5',
      expectedGapFill: '98',
    },
    {
      product: syntheticMesProduct,
      contract: syntheticMesContract,
      entryAdjustment: '0.25',
      expectedFill: '100.25',
      expectedCosts: '4.6',
      expectedDirectionalLoss: '5',
      gapOpen: '98.75',
      exitAdjustment: '0.25',
      expectedGapFill: '98.5',
    },
  ] as const)(
    'fills and stops $product.productCode with exact causal economics',
    (testCase) => {
      const result = exerciseCase(testCase);
      expect(result.selected.openTime).toBe('2026-01-02T12:00:00Z');
      expect(result.fill).toMatchObject({
        type: 'ENTRY_FILLED',
        fillPrice: testCase.expectedFill,
        quantity: '1',
        riskDecision: {
          status: 'APPROVE',
          economics: {
            estimatedCostsAccount: testCase.expectedCosts,
            directionalLossAccount: testCase.expectedDirectionalLoss,
          },
        },
      });
      expect(result.exit).toMatchObject({
        type: 'STOP_GAP_EXIT',
        fillPrice: testCase.expectedGapFill,
        protectiveStopPrice: '99',
        limitations: ['NO_INTRABAR_PATH', 'NO_PARTIAL_FILLS', 'NO_ORDER_BOOK'],
      });
      expect(Object.isFrozen(result.exit)).toBe(true);
    },
  );

  it('rejects the continuous product symbol at the entry boundary', () => {
    expect(() =>
      createEntryIntent({
        intentId: 'CONTINUOUS',
        instrumentId: syntheticFdxsProduct.productCode,
        contractId: syntheticFdxsProduct.productCode,
        strategyVersion: 'ACCEPTANCE_STRATEGY_V1',
        datasetVersion: 'ACCEPTANCE_DATASET_V1',
        timeframe: '1h',
        direction: 'LONG',
        signalCloseTime: '2026-01-02T09:00:00Z',
        expiresAt: '2026-01-02T13:00:00Z',
        stopPrice: '99',
        requestedQuantity: '1',
        riskDecisionId: 'CONTINUOUS_RISK',
        riskDecisionStatus: 'APPROVE',
      }),
    ).toThrow(ExecutionInputError);
  });
});
