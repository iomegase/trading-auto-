import {
  createFuturesContract,
  createFuturesProduct,
  type FuturesContract,
  type FuturesContractInput,
  type FuturesProduct,
  type FuturesProductInput,
} from '@trading-auto/domain';

import {
  assertM2ARiskSafetyAssertions,
  createCostModelSnapshot,
  createEligibilitySnapshot,
  createFxSnapshot,
  createMarginSnapshot,
  createRiskAccountState,
  createRiskPolicy,
  createRiskPortfolioState,
  type CostModelSnapshotInput,
  type EligibilitySnapshotInput,
  type FxSnapshotInput,
  type MarginSnapshotInput,
  type M2ARiskSafetyAssertionsInput,
  type OrderRiskInput,
  type RiskAccountStateInput,
  type RiskPolicyInput,
  type RiskPortfolioStateInput,
  type RiskSnapshotBundle,
} from '../src/index.js';

export const DECISION_AT = '2026-01-02T12:00:00Z';
export const RUN_CREATED_AT = '2026-01-03T12:00:00Z';

export type OrderRiskInputOverrides = Omit<
  Partial<OrderRiskInput>,
  | 'entryPrice'
  | 'stopPrice'
  | 'requestedQuantity'
  | 'decisionAt'
  | 'riskPolicyUseAt'
  | 'runCreatedAt'
  | 'signalExpiresAt'
> & {
  entryPrice?: string;
  stopPrice?: string;
  requestedQuantity?: string;
  decisionAt?: string;
  riskPolicyUseAt?: string;
  runCreatedAt?: string;
  signalExpiresAt?: string;
};

const metadata = {
  version: 'SNAPSHOT_V1',
  source: 'SYNTHETIC_TEST_PROVIDER',
  observedAt: '2026-01-02T11:00:00Z',
  validFrom: '2026-01-02T10:00:00Z',
  validUntil: '2026-01-02T13:00:00Z',
} as const;

export const baseProductInput: FuturesProductInput = {
  productCode: 'FDXS',
  exchange: 'EUREX',
  underlyingId: 'DAX',
  quoteCurrency: 'EUR',
  pnlCurrency: 'EUR',
  tickSize: '1',
  tickValue: '1',
  monetaryValuePerPriceUnit: '1',
  quantityStep: '1',
  minQuantity: '1',
  riskGroup: 'EU_EQUITY_INDEX',
};

export const baseContractInput: FuturesContractInput = {
  contractId: 'FDXS-202603',
  productCode: 'FDXS',
  firstTradeAt: '2025-12-01T00:00:00Z',
  lastTradeAt: '2026-03-19T21:00:00Z',
  expiryAt: '2026-03-20T12:00:00Z',
  settlementType: 'CASH',
};

export const basePolicyInput: RiskPolicyInput = {
  version: 'RISK_FUTURES_V1_RESEARCH',
  approvalStatus: 'APPROVED',
  referenceCurrency: 'EUR',
  accountCurrency: 'EUR',
  initialCapital: '1000',
  maxSizingCapital: '1000',
  riskPerTradePct: '10',
  maxOpenRiskPct: '100',
  maxOpenPositions: 4,
  maxContractsPerPosition: '1',
  maxGrossExposurePct: '100',
  maxMarginUsagePct: '100',
  cashReservePct: '0',
  dailyLossLimitPct: '10',
  maxDrawdownPct: '10',
  riskGroupMaxExposurePct: { EU_EQUITY_INDEX: '100' },
  allowCashInjection: false,
  sizingEquityMode: 'REALIZED_PLUS_UNREALIZED_LOSSES',
  capIncreaseMode: 'MANUAL_VERSIONED',
  approvedBy: 'SYNTHETIC_RISK_OWNER',
  approvedAt: '2026-01-01T00:00:00Z',
  activatedAt: '2026-01-01T00:00:00Z',
};

export const baseAccountInput: RiskAccountStateInput = {
  accountCurrency: 'EUR',
  realizedEquity: '1000',
  unrealizedPnl: '0',
  availableFunds: '1000',
  usedMargin: '0',
  grossExposure: '0',
  openRisk: '0',
  dailyLoss: '0',
  drawdownPct: '0',
  killSwitchActive: false,
};

export const baseSafetyAssertionsInput: M2ARiskSafetyAssertionsInput = {
  futuresEligibility: 'RESEARCH_ONLY',
  requireExplicitGrossExposureLimit: true,
  includeEstimatedExitCosts: true,
  rejectIfMinQuantityExceedsRiskBudget: true,
};

export function buildProduct(
  overrides: Partial<FuturesProductInput> = {},
): Readonly<FuturesProduct> {
  return createFuturesProduct({ ...baseProductInput, ...overrides });
}

export function buildContract(
  product: Readonly<FuturesProduct> = buildProduct(),
  overrides: Partial<FuturesContractInput> = {},
): Readonly<FuturesContract> {
  return createFuturesContract(
    {
      ...baseContractInput,
      productCode: product.productCode,
      ...overrides,
    },
    product,
  );
}

export function buildPolicy(overrides: Partial<RiskPolicyInput> = {}) {
  return createRiskPolicy({
    ...basePolicyInput,
    ...overrides,
    riskGroupMaxExposurePct:
      overrides.riskGroupMaxExposurePct ??
      basePolicyInput.riskGroupMaxExposurePct,
  });
}

export function buildAccount(overrides: Partial<RiskAccountStateInput> = {}) {
  return createRiskAccountState({ ...baseAccountInput, ...overrides });
}

export function buildPortfolio(
  overrides: Partial<RiskPortfolioStateInput> = {},
) {
  return createRiskPortfolioState({
    positions: overrides.positions ?? [],
    activeEntryIntents: overrides.activeEntryIntents ?? [],
  });
}

export function buildSafetyAssertions(
  overrides: Partial<M2ARiskSafetyAssertionsInput> = {},
) {
  return assertM2ARiskSafetyAssertions({
    ...baseSafetyAssertionsInput,
    ...overrides,
  });
}

export function buildFxInput(
  overrides: Partial<FxSnapshotInput> = {},
): FxSnapshotInput {
  return {
    ...metadata,
    version: 'FX_V1',
    baseCurrency: 'USD',
    quoteCurrency: 'EUR',
    rate: '0.8',
    ...overrides,
  };
}

export function buildMarginInput(
  overrides: Partial<MarginSnapshotInput> = {},
): MarginSnapshotInput {
  return {
    ...metadata,
    version: 'MARGIN_V1',
    contractId: baseContractInput.contractId,
    currency: 'EUR',
    initialMarginPerContract: '10',
    maintenanceMarginPerContract: '8',
    ...overrides,
  };
}

export function buildEligibilityInput(
  overrides: Partial<EligibilitySnapshotInput> = {},
): EligibilitySnapshotInput {
  return {
    ...metadata,
    version: 'ELIGIBILITY_V1',
    contractId: baseContractInput.contractId,
    researchOnly: true,
    eligible: true,
    reason: null,
    ...overrides,
  };
}

export function buildCostsInput(
  overrides: Partial<CostModelSnapshotInput> = {},
): CostModelSnapshotInput {
  const zeroFees = {
    minimum: '0',
    tiers: [{ upToQuantity: null, feePerContract: '0' }],
  } as const;
  return {
    ...metadata,
    version: 'COSTS_V1',
    contractId: baseContractInput.contractId,
    currency: 'EUR',
    entryFees: zeroFees,
    exitFees: zeroFees,
    spreadPriceUnitsRoundTrip: '0',
    adverseEntrySlippagePriceUnits: '0',
    adverseExitSlippagePriceUnits: '0',
    ...overrides,
  };
}

export function buildSnapshots(
  overrides: Partial<RiskSnapshotBundle> = {},
): Readonly<RiskSnapshotBundle> {
  return Object.freeze({
    fx: null,
    margin: createMarginSnapshot(buildMarginInput()),
    eligibility: createEligibilitySnapshot(buildEligibilityInput()),
    costs: createCostModelSnapshot(buildCostsInput()),
    ...overrides,
  });
}

export function buildMesInput(
  overrides: OrderRiskInputOverrides = {},
): OrderRiskInput {
  const product = buildProduct({
    productCode: 'MES',
    exchange: 'CME',
    underlyingId: 'SP500',
    quoteCurrency: 'USD',
    pnlCurrency: 'USD',
    tickSize: '0.25',
    tickValue: '1.25',
    monetaryValuePerPriceUnit: '5',
    riskGroup: 'US_EQUITY_INDEX',
  });
  const contract = buildContract(product, {
    contractId: 'MES-202603',
  });
  const snapshots = buildSnapshots({
    fx: createFxSnapshot(buildFxInput()),
    margin: createMarginSnapshot(
      buildMarginInput({ contractId: contract.contractId, currency: 'USD' }),
    ),
    eligibility: createEligibilitySnapshot(
      buildEligibilityInput({ contractId: contract.contractId }),
    ),
    costs: createCostModelSnapshot(
      buildCostsInput({ contractId: contract.contractId, currency: 'USD' }),
    ),
  });
  return buildOrderRiskInput({
    instrumentId: 'MES',
    entryPrice: '100',
    stopPrice: '99',
    product,
    contract,
    snapshots,
    policy: buildPolicy({
      riskGroupMaxExposurePct: { US_EQUITY_INDEX: '100' },
    }),
    ...overrides,
  });
}

export function buildOrderRiskInput(
  overrides: OrderRiskInputOverrides = {},
): OrderRiskInput {
  const product = overrides.product ?? buildProduct();
  const contract = overrides.contract ?? buildContract(product);
  const snapshots =
    overrides.snapshots ??
    buildSnapshots({
      margin: createMarginSnapshot(
        buildMarginInput({
          contractId: contract.contractId,
          currency: product.pnlCurrency,
        }),
      ),
      eligibility: createEligibilitySnapshot(
        buildEligibilityInput({ contractId: contract.contractId }),
      ),
      costs: createCostModelSnapshot(
        buildCostsInput({
          contractId: contract.contractId,
          currency: product.pnlCurrency,
        }),
      ),
    });

  return {
    instrumentId: 'FDXS',
    direction: 'LONG',
    entryPrice: '100',
    stopPrice: '99',
    decisionAt: DECISION_AT,
    riskPolicyUseMode: 'FORWARD',
    riskPolicyUseAt: DECISION_AT,
    signalExpiresAt: '2026-01-02T13:00:00Z',
    datasetVersion: 'DATASET_V1',
    strategyVersion: 'STRATEGY_V1',
    product,
    contract,
    snapshots,
    policy: buildPolicy(),
    safetyAssertions: buildSafetyAssertions(),
    account: buildAccount(),
    portfolio: buildPortfolio(),
    ...overrides,
  } as OrderRiskInput;
}
