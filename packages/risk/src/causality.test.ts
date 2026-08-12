import {
  syntheticMesContract,
  syntheticMesProduct,
} from '@trading-auto/test-helpers';
import { describe, expect, it } from 'vitest';

import {
  evaluateOrderRisk,
  selectRiskSnapshotBundle,
  type CostModelSnapshotInput,
  type EligibilitySnapshotInput,
  type FxSnapshotInput,
  type MarginSnapshotInput,
  type RiskSnapshotBundle,
  type RiskSnapshotSeriesInput,
} from './index.js';
import { buildOrderRiskInput, buildPolicy } from '../test-helpers/builders.js';

const DECISION_AT = '2026-03-10T09:00:00Z';
const SOURCE = 'SYNTHETIC_TEST_ONLY';

function metadata(version: string, observedAt: string, validFrom: string) {
  return {
    version,
    source: SOURCE,
    observedAt,
    validFrom,
    validUntil: '2026-03-10T12:00:00Z',
  } as const;
}

function fx(
  version: string,
  observedAt: string,
  validFrom: string,
  rate: string,
): FxSnapshotInput {
  return {
    ...metadata(version, observedAt, validFrom),
    baseCurrency: 'USD',
    quoteCurrency: 'EUR',
    rate,
  };
}

function margin(
  version: string,
  observedAt: string,
  validFrom: string,
  initialMarginPerContract: string,
): MarginSnapshotInput {
  return {
    ...metadata(version, observedAt, validFrom),
    contractId: syntheticMesContract.contractId,
    currency: 'USD',
    initialMarginPerContract,
    maintenanceMarginPerContract: initialMarginPerContract,
  };
}

function eligibility(
  version: string,
  observedAt: string,
  validFrom: string,
  eligible: boolean,
): EligibilitySnapshotInput {
  return {
    ...metadata(version, observedAt, validFrom),
    contractId: syntheticMesContract.contractId,
    researchOnly: true,
    eligible,
    reason: eligible ? null : 'FUTURE_SYNTHETIC_CHANGE',
  };
}

function costs(
  version: string,
  observedAt: string,
  validFrom: string,
  feePerContract: string,
): CostModelSnapshotInput {
  const fees = {
    minimum: '0',
    tiers: [{ upToQuantity: null, feePerContract }],
  } as const;
  return {
    ...metadata(version, observedAt, validFrom),
    contractId: syntheticMesContract.contractId,
    currency: 'USD',
    entryFees: fees,
    exitFees: fees,
    spreadPriceUnitsRoundTrip: feePerContract,
    adverseEntrySlippagePriceUnits: feePerContract,
    adverseExitSlippagePriceUnits: feePerContract,
  };
}

function select(
  series: RiskSnapshotSeriesInput,
  decisionAt: string = DECISION_AT,
) {
  return selectRiskSnapshotBundle(series, {
    decisionAt,
    contractId: syntheticMesContract.contractId,
    pnlCurrency: syntheticMesProduct.pnlCurrency,
    accountCurrency: 'EUR',
  });
}

function evaluate(snapshots: Readonly<RiskSnapshotBundle>) {
  return evaluateOrderRisk(
    buildOrderRiskInput({
      instrumentId: syntheticMesProduct.productCode,
      entryPrice: '100',
      stopPrice: '99.75',
      decisionAt: DECISION_AT,
      riskPolicyUseAt: DECISION_AT,
      signalExpiresAt: '2026-03-10T10:00:00Z',
      product: syntheticMesProduct,
      contract: syntheticMesContract,
      snapshots,
      policy: buildPolicy({
        version: 'RISK_CAUSALITY_M2A',
        riskGroupMaxExposurePct: {
          [syntheticMesProduct.riskGroup]: '100',
        },
      }),
    }),
  );
}

describe('Milestone 2A snapshot causality', () => {
  it('keeps the entire 09:00 decision invariant when relevant 10:00 snapshots are appended', () => {
    const oldObservedAt = '2026-03-10T08:00:00Z';
    const futureObservedAt = '2026-03-10T10:00:00Z';
    const baseSeries: RiskSnapshotSeriesInput = {
      fx: [fx('FX_0800', oldObservedAt, oldObservedAt, '0.8')],
      margin: [margin('MARGIN_0800', oldObservedAt, oldObservedAt, '10')],
      eligibility: [
        eligibility('ELIGIBILITY_0800', oldObservedAt, oldObservedAt, true),
      ],
      costs: [costs('COSTS_0800', oldObservedAt, oldObservedAt, '0')],
    };
    const appendedSeries: RiskSnapshotSeriesInput = {
      fx: [
        ...baseSeries.fx,
        fx('FX_1000', futureObservedAt, futureObservedAt, '0.7'),
      ],
      margin: [
        ...baseSeries.margin,
        margin('MARGIN_1000', futureObservedAt, futureObservedAt, '20'),
      ],
      eligibility: [
        ...baseSeries.eligibility,
        eligibility(
          'ELIGIBILITY_1000',
          futureObservedAt,
          futureObservedAt,
          false,
        ),
      ],
      costs: [
        ...baseSeries.costs,
        costs('COSTS_1000', futureObservedAt, futureObservedAt, '1'),
      ],
    };
    const baseBefore = structuredClone(baseSeries);
    const appendedBefore = structuredClone(appendedSeries);
    const fixturesBefore = structuredClone({
      product: syntheticMesProduct,
      contract: syntheticMesContract,
    });

    const beforeBundle = select(baseSeries);
    const afterBundle = select(appendedSeries);
    const before = evaluate(beforeBundle);
    const after = evaluate(afterBundle);
    const laterBundle = select(appendedSeries, futureObservedAt);

    for (const bundle of [beforeBundle, afterBundle]) {
      expect(bundle).toMatchObject({
        fx: {
          version: 'FX_0800',
          observedAt: oldObservedAt,
          source: SOURCE,
        },
        margin: {
          version: 'MARGIN_0800',
          observedAt: oldObservedAt,
          source: SOURCE,
        },
        eligibility: {
          version: 'ELIGIBILITY_0800',
          observedAt: oldObservedAt,
          source: SOURCE,
        },
        costs: {
          version: 'COSTS_0800',
          observedAt: oldObservedAt,
          source: SOURCE,
        },
      });
      expect(Object.isFrozen(bundle)).toBe(true);
      for (const snapshot of [
        bundle.fx,
        bundle.margin,
        bundle.eligibility,
        bundle.costs,
      ]) {
        expect(snapshot).not.toBeNull();
        expect(Object.isFrozen(snapshot)).toBe(true);
      }
    }
    expect(before).toMatchObject({
      status: 'APPROVE',
      quantity: '1',
      reasons: [],
      context: {
        decisionAt: DECISION_AT,
        riskPolicyVersion: 'RISK_CAUSALITY_M2A',
        fxVersion: 'FX_0800',
        marginVersion: 'MARGIN_0800',
        eligibilityVersion: 'ELIGIBILITY_0800',
        costModelVersion: 'COSTS_0800',
        productCode: 'MES',
        contractId: 'MESH26',
      },
    });
    expect(after).toEqual(before);
    expect(laterBundle).toMatchObject({
      fx: { version: 'FX_1000' },
      margin: { version: 'MARGIN_1000' },
      eligibility: { version: 'ELIGIBILITY_1000' },
      costs: { version: 'COSTS_1000' },
    });
    expect(baseSeries).toEqual(baseBefore);
    expect(appendedSeries).toEqual(appendedBefore);
    expect({
      product: syntheticMesProduct,
      contract: syntheticMesContract,
    }).toEqual(fixturesBefore);
    for (const decision of [before, after]) {
      expect(Object.isFrozen(decision)).toBe(true);
      expect(Object.isFrozen(decision.reasons)).toBe(true);
      expect(Object.isFrozen(decision.context)).toBe(true);
      expect(Object.isFrozen(decision.economics)).toBe(true);
    }
    expect(Object.isFrozen(syntheticMesProduct)).toBe(true);
    expect(Object.isFrozen(syntheticMesContract)).toBe(true);
  });
});
