import { describe, expect, it } from 'vitest';
import {
  syntheticFdxsContract,
  syntheticFdxsProduct,
} from '@trading-auto/test-helpers';
import {
  selectRiskSnapshotBundle,
  type RiskSnapshotSeriesInput,
} from '@trading-auto/risk';
import {
  buildCostsInput,
  buildEligibilityInput,
  buildMarginInput,
  buildOrderRiskInput,
} from '../../risk/test-helpers/builders.js';

import {
  buildExecutionOpen,
  buildExecutionSchedule,
} from '../test-helpers/builders.js';
import {
  applyDailySettlement,
  createDailySettlement,
  createEntryIntent,
  createOpenPosition,
  executeEntryAtNextOpen,
  selectDailySettlement,
  selectNextTradableH1Open,
} from './index.js';

describe('Milestone 2B causal-prefix invariance', () => {
  it('emits the same selected open when later observable opens are appended', () => {
    const schedule = buildExecutionSchedule(syntheticFdxsContract);
    const causalOpen = buildExecutionOpen(
      syntheticFdxsProduct,
      syntheticFdxsContract,
      '2026-01-02T10:00:00Z',
    );
    const futureOpen = buildExecutionOpen(
      syntheticFdxsProduct,
      syntheticFdxsContract,
      '2026-01-02T11:00:00Z',
    );
    const base = {
      signalCloseTime: '2026-01-02T09:00:00Z',
      decisionAt: '2026-01-02T12:00:00Z',
      contract: syntheticFdxsContract,
      schedule,
    } as const;

    expect(
      selectNextTradableH1Open({ ...base, openEvents: [causalOpen] }),
    ).toStrictEqual(
      selectNextTradableH1Open({
        ...base,
        openEvents: [causalOpen, futureOpen],
      }),
    );
  });

  it('does not inspect economic fields of an event unavailable at decisionAt', () => {
    const schedule = buildExecutionSchedule(syntheticFdxsContract);
    const causalOpen = buildExecutionOpen(
      syntheticFdxsProduct,
      syntheticFdxsContract,
      '2026-01-02T10:00:00Z',
    );
    const unavailable: Record<string, unknown> = {
      openTime: '2026-01-02T13:00:00Z',
      availableAt: '2026-01-02T13:00:00Z',
    };
    for (const field of ['instrumentId', 'contractId', 'price']) {
      Object.defineProperty(unavailable, field, {
        enumerable: true,
        get: () => {
          throw new Error(`${field} is unavailable after decisionAt`);
        },
      });
    }

    expect(
      selectNextTradableH1Open({
        signalCloseTime: '2026-01-02T09:00:00Z',
        decisionAt: '2026-01-02T12:00:00Z',
        contract: syntheticFdxsContract,
        schedule,
        openEvents: [causalOpen, unavailable as unknown as typeof causalOpen],
      }),
    ).toStrictEqual(causalOpen);
  });

  it('dates the fill economically at open and rechecks risk at availability', () => {
    const open = buildExecutionOpen(
      syntheticFdxsProduct,
      syntheticFdxsContract,
      '2026-01-02T12:00:00Z',
      { availableAt: '2026-01-02T12:00:01Z' },
    );
    const intent = createEntryIntent({
      intentId: 'DELAYED_OPEN_ENTRY',
      instrumentId: syntheticFdxsProduct.productCode,
      contractId: syntheticFdxsContract.contractId,
      strategyVersion: 'STRATEGY_V1',
      datasetVersion: 'DATASET_V1',
      timeframe: '1h',
      direction: 'LONG',
      signalCloseTime: '2026-01-02T09:00:00Z',
      expiresAt: '2026-01-02T13:00:00Z',
      stopPrice: '99',
      requestedQuantity: '1',
      riskDecisionId: 'DELAYED_OPEN_RISK',
      riskDecisionStatus: 'APPROVE',
    });
    const result = executeEntryAtNextOpen({
      intent,
      open,
      adverseEntrySlippagePriceUnits: '0',
      riskInput: buildOrderRiskInput({
        instrumentId: syntheticFdxsProduct.productCode,
        product: syntheticFdxsProduct,
        contract: syntheticFdxsContract,
        signalExpiresAt: intent.expiresAt,
      }),
    });

    expect(result).toMatchObject({
      type: 'ENTRY_FILLED',
      occurredAt: open.openTime,
      availableAt: open.availableAt,
      riskDecision: { context: { decisionAt: open.availableAt } },
    });
  });

  it('keeps the complete entry result invariant when future risk snapshots are appended', () => {
    const observedAt = '2026-01-02T11:00:00Z';
    const futureAt = '2026-01-02T12:30:00Z';
    const metadata = {
      observedAt,
      validFrom: '2026-01-02T10:00:00Z',
      validUntil: '2026-01-02T13:00:00Z',
    } as const;
    const futureMetadata = {
      observedAt: futureAt,
      validFrom: futureAt,
      validUntil: '2026-01-02T14:00:00Z',
    } as const;
    const baseSeries: RiskSnapshotSeriesInput = {
      fx: [],
      margin: [
        buildMarginInput({
          ...metadata,
          contractId: syntheticFdxsContract.contractId,
        }),
      ],
      eligibility: [
        buildEligibilityInput({
          ...metadata,
          contractId: syntheticFdxsContract.contractId,
        }),
      ],
      costs: [
        buildCostsInput({
          ...metadata,
          contractId: syntheticFdxsContract.contractId,
        }),
      ],
    };
    const appendedSeries: RiskSnapshotSeriesInput = {
      fx: [],
      margin: [
        ...baseSeries.margin,
        buildMarginInput({
          ...futureMetadata,
          version: 'FUTURE_MARGIN',
          contractId: syntheticFdxsContract.contractId,
          initialMarginPerContract: '999',
        }),
      ],
      eligibility: [
        ...baseSeries.eligibility,
        buildEligibilityInput({
          ...futureMetadata,
          version: 'FUTURE_ELIGIBILITY',
          contractId: syntheticFdxsContract.contractId,
          eligible: false,
          reason: 'FUTURE_ONLY',
        }),
      ],
      costs: [
        ...baseSeries.costs,
        buildCostsInput({
          ...futureMetadata,
          version: 'FUTURE_COSTS',
          contractId: syntheticFdxsContract.contractId,
          spreadPriceUnitsRoundTrip: '99',
        }),
      ],
    };
    const open = buildExecutionOpen(
      syntheticFdxsProduct,
      syntheticFdxsContract,
      '2026-01-02T12:00:00Z',
    );
    const intent = createEntryIntent({
      intentId: 'SNAPSHOT_CAUSAL_ENTRY',
      instrumentId: syntheticFdxsProduct.productCode,
      contractId: syntheticFdxsContract.contractId,
      strategyVersion: 'STRATEGY_V1',
      datasetVersion: 'DATASET_V1',
      timeframe: '1h',
      direction: 'LONG',
      signalCloseTime: '2026-01-02T09:00:00Z',
      expiresAt: '2026-01-02T13:00:00Z',
      stopPrice: '99',
      requestedQuantity: '1',
      riskDecisionId: 'SNAPSHOT_CAUSAL_RISK',
      riskDecisionStatus: 'APPROVE',
    });
    const select = (series: RiskSnapshotSeriesInput) =>
      selectRiskSnapshotBundle(series, {
        decisionAt: open.availableAt,
        contractId: syntheticFdxsContract.contractId,
        pnlCurrency: syntheticFdxsProduct.pnlCurrency,
        accountCurrency: 'EUR',
      });
    const execute = (series: RiskSnapshotSeriesInput) =>
      executeEntryAtNextOpen({
        intent,
        open,
        adverseEntrySlippagePriceUnits: '0',
        riskInput: buildOrderRiskInput({
          instrumentId: syntheticFdxsProduct.productCode,
          product: syntheticFdxsProduct,
          contract: syntheticFdxsContract,
          snapshots: select(series),
          signalExpiresAt: intent.expiresAt,
        }),
      });

    expect(execute(appendedSeries)).toStrictEqual(execute(baseSeries));
  });

  it('keeps the complete settlement event invariant when future settlements are appended', () => {
    const open = buildExecutionOpen(
      syntheticFdxsProduct,
      syntheticFdxsContract,
      '2026-01-02T12:00:00Z',
    );
    const intent = createEntryIntent({
      intentId: 'SETTLEMENT_CAUSAL_ENTRY',
      instrumentId: syntheticFdxsProduct.productCode,
      contractId: syntheticFdxsContract.contractId,
      strategyVersion: 'STRATEGY_V1',
      datasetVersion: 'DATASET_V1',
      timeframe: '1h',
      direction: 'LONG',
      signalCloseTime: '2026-01-02T09:00:00Z',
      expiresAt: '2026-01-02T13:00:00Z',
      stopPrice: '99',
      requestedQuantity: '1',
      riskDecisionId: 'SETTLEMENT_CAUSAL_RISK',
      riskDecisionStatus: 'APPROVE',
    });
    const fill = executeEntryAtNextOpen({
      intent,
      open,
      adverseEntrySlippagePriceUnits: '0',
      riskInput: buildOrderRiskInput({
        instrumentId: syntheticFdxsProduct.productCode,
        product: syntheticFdxsProduct,
        contract: syntheticFdxsContract,
        signalExpiresAt: intent.expiresAt,
      }),
    });
    if (fill.type === 'ENTRY_CANCELLED') {
      throw new Error('Expected causal settlement position fixture.');
    }
    const position = createOpenPosition({
      positionId: 'SETTLEMENT_CAUSAL_POSITION',
      intent,
      fill,
      entryCostAccountCurrency: '0',
      tickSize: syntheticFdxsProduct.tickSize,
      executionModelVersion: 'BAR_BASED_H1_V1',
      exitPolicyVersion: 'ICHIMOKU_KIJUN_EXIT_V1',
    });
    const constraints = {
      contractId: syntheticFdxsContract.contractId,
      currency: 'EUR',
      tickSize: syntheticFdxsProduct.tickSize,
    } as const;
    const causal = createDailySettlement(
      {
        version: 'SETTLEMENT_1700',
        source: 'SYNTHETIC_EXCHANGE',
        effectiveAt: '2026-01-02T17:00:00Z',
        observedAt: '2026-01-02T17:05:00Z',
        contractId: syntheticFdxsContract.contractId,
        currency: 'EUR',
        price: '101.5',
      },
      constraints,
    );
    const future = createDailySettlement(
      {
        version: 'SETTLEMENT_NEXT_DAY',
        source: 'SYNTHETIC_EXCHANGE',
        effectiveAt: '2026-01-03T17:00:00Z',
        observedAt: '2026-01-03T17:05:00Z',
        contractId: syntheticFdxsContract.contractId,
        currency: 'EUR',
        price: '999',
      },
      constraints,
    );
    const apply = (settlements: readonly (typeof causal)[]) => {
      const settlement = selectDailySettlement({
        settlements,
        requiredEffectiveAt: causal.effectiveAt,
        decisionAt: causal.observedAt,
        constraints,
      });
      return applyDailySettlement({
        position,
        settlement,
        decisionAt: causal.observedAt,
        currency: 'EUR',
        monetaryValuePerPriceUnit: '1',
        cash: '1000',
        realizedEquity: '1000',
      });
    };

    expect(apply([causal, future])).toStrictEqual(apply([causal]));
  });
});
