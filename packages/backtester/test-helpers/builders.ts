import {
  asDecimalString,
  asInstantString,
  type DecimalString,
} from '@trading-auto/domain';
import {
  createEntryIntent,
  createOpenPosition,
  type EntryDirection,
  type EntryIntent,
  type EntryIntentInput,
  type ExecutionLimitation,
  type FilledEntryExecution,
  type OpenPosition,
} from '@trading-auto/execution';
import {
  createRiskPolicy,
  createRiskPortfolioState,
  type ActiveEntryIntent,
  type CandidateEconomics,
  type RiskDecision,
  type RiskDecisionContext,
  type RiskPolicyInput,
  type RiskPolicyVersion,
  type RiskPosition,
  type RiskPositionInput,
} from '@trading-auto/risk';

import type {
  BacktestIntentState,
  BacktestPositionState,
} from '../src/portfolio.js';

const LIMITATIONS: readonly ExecutionLimitation[] = Object.freeze([
  'NO_INTRABAR_PATH',
  'NO_PARTIAL_FILLS',
  'NO_ORDER_BOOK',
]);

const POLICY_INPUT: RiskPolicyInput = {
  version: 'RISK_FUTURES_V1_RESEARCH',
  approvalStatus: 'APPROVED',
  referenceCurrency: 'EUR',
  accountCurrency: 'EUR',
  initialCapital: '1000',
  maxSizingCapital: '1000',
  riskPerTradePct: '0.5',
  maxOpenRiskPct: '2',
  maxOpenPositions: 4,
  maxContractsPerPosition: '4',
  maxGrossExposurePct: '100',
  maxMarginUsagePct: '100',
  cashReservePct: '0',
  dailyLossLimitPct: '2',
  maxDrawdownPct: '10',
  riskGroupMaxExposurePct: {
    EUROPE_EQUITY_INDEX: '100',
    US_EQUITY_INDEX: '100',
  },
  allowCashInjection: false,
  sizingEquityMode: 'REALIZED_PLUS_UNREALIZED_LOSSES',
  capIncreaseMode: 'MANUAL_VERSIONED',
  approvedBy: 'RESEARCH_RISK_OWNER',
  approvedAt: '2026-01-01T00:00:00Z',
  activatedAt: '2026-01-01T00:00:00Z',
};

export function buildPolicy(
  overrides: Partial<RiskPolicyInput> = {},
): RiskPolicyVersion {
  return createRiskPolicy({ ...POLICY_INPUT, ...overrides });
}

export function buildExecutionIntent(
  overrides: Partial<EntryIntentInput> = {},
): EntryIntent {
  const direction = overrides.direction ?? 'LONG';
  return createEntryIntent({
    intentId: 'INTENT-1',
    instrumentId: 'FDXS',
    contractId: 'FDXS-202609',
    strategyVersion: 'ICHIMOKU_V1',
    datasetVersion: 'DATASET_V1',
    timeframe: '1h',
    direction,
    signalCloseTime: '2026-08-14T08:00:00Z',
    signalDecisionAt: '2026-08-14T08:00:00Z',
    expiresAt: '2026-08-14T12:00:00Z',
    stopPrice: direction === 'LONG' ? '99' : '101',
    requestedQuantity: '1',
    riskDecisionId: 'RISK-1',
    riskDecisionStatus: 'APPROVE',
    ...overrides,
  });
}

function approvedDecision(
  intent: EntryIntent,
  fillPrice: DecimalString,
  occurredAt: string,
): RiskDecision {
  const economics: CandidateEconomics = Object.freeze({
    quantity: intent.requestedQuantity,
    directionalLossAccount: asDecimalString('5'),
    estimatedCostsAccount: asDecimalString('2'),
    worstCaseBudgetedLossAccount: asDecimalString('7'),
    initialMarginAccount: asDecimalString('100'),
    maintenanceMarginAccount: asDecimalString('80'),
    grossExposureAccount: asDecimalString('200'),
  });
  const context: RiskDecisionContext = Object.freeze({
    decisionAt: asInstantString(occurredAt),
    riskPolicyUseMode: 'HISTORICAL_RESEARCH',
    riskPolicyUseAt: asInstantString('2026-08-14T08:00:00Z'),
    backtestId: 'BT-1',
    runCreatedAt: asInstantString('2026-08-14T08:00:00Z'),
    signalExpiresAt: intent.expiresAt,
    entryPrice: fillPrice,
    stopPrice: intent.stopPrice,
    datasetVersion: intent.datasetVersion,
    strategyVersion: intent.strategyVersion,
    riskPolicyVersion: 'RISK_FUTURES_V1_RESEARCH',
    fxVersion: null,
    marginVersion: 'MARGIN-1',
    costModelVersion: 'COST-1',
    eligibilityVersion: 'ELIGIBILITY-1',
    productCode: intent.instrumentId,
    contractId: intent.contractId,
  });
  return Object.freeze({
    status: 'APPROVE',
    quantity: intent.requestedQuantity,
    reasons: Object.freeze([] as const),
    economics,
    context,
  });
}

export interface ExecutionPositionOverrides {
  readonly positionId?: string;
  readonly intent?: EntryIntent;
  readonly direction?: EntryDirection;
  readonly instrumentId?: string;
  readonly contractId?: string;
  readonly intentId?: string;
  readonly fillPrice?: string;
  readonly occurredAt?: string;
  readonly entryCostAccountCurrency?: string;
}

export function buildExecutionPosition(
  overrides: ExecutionPositionOverrides = {},
): OpenPosition {
  const direction =
    overrides.direction ?? overrides.intent?.direction ?? 'LONG';
  const intent =
    overrides.intent ??
    buildExecutionIntent({
      direction,
      instrumentId: overrides.instrumentId ?? 'FDXS',
      contractId: overrides.contractId ?? 'FDXS-202609',
      intentId: overrides.intentId ?? 'INTENT-1',
      riskDecisionId: `RISK-${overrides.intentId ?? '1'}`,
    });
  const fillPrice = asDecimalString(overrides.fillPrice ?? '100');
  const occurredAt = overrides.occurredAt ?? '2026-08-14T09:00:00Z';
  const fill: FilledEntryExecution = Object.freeze({
    type: 'ENTRY_FILLED',
    intentId: intent.intentId,
    occurredAt: asInstantString(occurredAt),
    availableAt: asInstantString(occurredAt),
    fillPrice,
    quantity: intent.requestedQuantity,
    reasons: Object.freeze([] as const),
    riskDecision: approvedDecision(intent, fillPrice, occurredAt),
    limitations: LIMITATIONS,
  });
  return createOpenPosition({
    positionId: overrides.positionId ?? 'POSITION-1',
    intent,
    fill,
    entryCostAccountCurrency: overrides.entryCostAccountCurrency ?? '2',
    tickSize: '0.5',
    executionModelVersion: 'BAR_BASED_H1_V1',
    exitPolicyVersion: 'ICHIMOKU_KIJUN_EXIT_V1',
  });
}

export function buildRiskIntent(
  executionIntent: EntryIntent = buildExecutionIntent(),
): ActiveEntryIntent {
  const portfolio = createRiskPortfolioState({
    positions: [],
    activeEntryIntents: [
      {
        intentId: executionIntent.intentId,
        instrumentId: executionIntent.instrumentId,
        contractId: executionIntent.contractId,
        direction: executionIntent.direction,
      },
    ],
  });
  const result = portfolio.activeEntryIntents[0];
  if (result === undefined) throw new Error('Missing risk intent fixture.');
  return result;
}

export function buildIntentState(
  overrides: Readonly<{
    executionIntent?: EntryIntent;
    reservedMargin?: string;
    reservedOpenRisk?: string;
    reservedGrossExposure?: string;
    riskGroup?: string;
  }> = {},
): BacktestIntentState {
  const executionIntent = overrides.executionIntent ?? buildExecutionIntent();
  return Object.freeze({
    executionIntent,
    riskIntent: buildRiskIntent(executionIntent),
    reservedMargin: asDecimalString(overrides.reservedMargin ?? '100'),
    reservedOpenRisk: asDecimalString(overrides.reservedOpenRisk ?? '5'),
    reservedGrossExposure: asDecimalString(
      overrides.reservedGrossExposure ?? '200',
    ),
    riskGroup: overrides.riskGroup ?? 'EUROPE_EQUITY_INDEX',
  });
}

export function buildRiskPosition(
  executionPosition: OpenPosition = buildExecutionPosition(),
  overrides: Partial<RiskPositionInput> = {},
): RiskPosition {
  const portfolio = createRiskPortfolioState({
    positions: [
      {
        positionId: executionPosition.positionId,
        instrumentId: executionPosition.instrumentId,
        contractId: executionPosition.contractId,
        direction: executionPosition.direction,
        quantity: executionPosition.quantity,
        remainingOpenRisk: '5',
        margin: '100',
        grossExposure: '200',
        riskGroup: 'EUROPE_EQUITY_INDEX',
        ...overrides,
      },
    ],
    activeEntryIntents: [],
  });
  const result = portfolio.positions[0];
  if (result === undefined) throw new Error('Missing risk position fixture.');
  return result;
}

export function buildPositionState(
  overrides: Readonly<{
    executionPosition?: OpenPosition;
    riskPosition?: RiskPosition;
    unrealizedPnl?: string;
  }> = {},
): BacktestPositionState {
  const executionPosition =
    overrides.executionPosition ?? buildExecutionPosition();
  return Object.freeze({
    executionPosition,
    riskPosition:
      overrides.riskPosition ?? buildRiskPosition(executionPosition),
    unrealizedPnl: asDecimalString(overrides.unrealizedPnl ?? '0'),
  });
}
