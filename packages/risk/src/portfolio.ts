import {
  asCurrencyCode,
  asDecimalString,
  type CurrencyCode,
  type DecimalString,
} from '@trading-auto/domain';

import { isRiskDecimalWithinBounds, riskDecimalFrom } from './decimal.js';
import { RiskInputError } from './errors.js';

export interface RiskAccountStateInput {
  accountCurrency: string;
  realizedEquity: string;
  unrealizedPnl: string;
  availableFunds: string;
  usedMargin: string;
  grossExposure: string;
  openRisk: string;
  dailyLoss: string;
  drawdownPct: string;
  killSwitchActive: boolean;
}

export interface RiskAccountState {
  readonly accountCurrency: CurrencyCode;
  readonly realizedEquity: DecimalString;
  readonly unrealizedPnl: DecimalString;
  readonly availableFunds: DecimalString;
  readonly usedMargin: DecimalString;
  readonly grossExposure: DecimalString;
  readonly openRisk: DecimalString;
  readonly dailyLoss: DecimalString;
  readonly drawdownPct: DecimalString;
  readonly killSwitchActive: boolean;
}

export interface RiskPositionInput {
  positionId: string;
  instrumentId: string;
  contractId: string;
  direction: string;
  quantity: string;
  remainingOpenRisk: string;
  margin: string;
  grossExposure: string;
  riskGroup: string;
}

export interface RiskPosition {
  readonly positionId: string;
  readonly instrumentId: string;
  readonly contractId: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly quantity: DecimalString;
  readonly remainingOpenRisk: DecimalString;
  readonly margin: DecimalString;
  readonly grossExposure: DecimalString;
  readonly riskGroup: string;
}

export interface ActiveEntryIntentInput {
  intentId: string;
  instrumentId: string;
  contractId: string;
  direction: string;
}

export interface ActiveEntryIntent {
  readonly intentId: string;
  readonly instrumentId: string;
  readonly contractId: string;
  readonly direction: 'LONG' | 'SHORT';
}

export interface RiskPortfolioStateInput {
  positions: readonly RiskPositionInput[];
  activeEntryIntents: readonly ActiveEntryIntentInput[];
}

export interface RiskPortfolioState {
  readonly positions: readonly Readonly<RiskPosition>[];
  readonly activeEntryIntents: readonly Readonly<ActiveEntryIntent>[];
}

const MAX_PORTFOLIO_ITEMS = 1000;

function fail(message: string, field: string, value?: unknown): never {
  throw new RiskInputError('INVALID_RISK_INPUT', message, { field, value });
}

function assertPlainObject(
  value: unknown,
  field: string,
): asserts value is Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      fail(`${field} must be a plain object.`, field);
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(`${field} must be a plain object.`, field);
    }
  } catch (error) {
    if (error instanceof RiskInputError) throw error;
    fail(`${field} must be a readable plain object.`, field);
  }
}

function property(
  input: Record<string, unknown>,
  propertyName: string,
  field: string,
): unknown {
  try {
    return input[propertyName];
  } catch {
    fail(`${field} must be readable.`, field);
  }
}

function requiredProperty(
  input: Record<string, unknown>,
  propertyName: string,
  field: string,
): unknown {
  try {
    if (!Object.hasOwn(input, propertyName)) {
      fail(`${field} must be an own property.`, field);
    }
  } catch (error) {
    if (error instanceof RiskInputError) throw error;
    fail(`${field} must be readable.`, field);
  }
  return property(input, propertyName, field);
}

function nonBlank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${field} must be a nonblank string.`, field, value);
  }
  return value;
}

function decimal(value: unknown, field: string): DecimalString {
  if (typeof value !== 'string' || !isRiskDecimalWithinBounds(value)) {
    fail(`${field} must be a bounded canonical decimal string.`, field, value);
  }
  try {
    return asDecimalString(value);
  } catch {
    fail(`${field} must be a bounded canonical decimal string.`, field, value);
  }
}

function nonnegativeDecimal(value: unknown, field: string): DecimalString {
  const result = decimal(value, field);
  if (result.startsWith('-')) {
    fail(`${field} must be nonnegative.`, field, value);
  }
  return result;
}

function positiveIntegerDecimal(value: unknown, field: string): DecimalString {
  const result = decimal(value, field);
  if (
    result.startsWith('-') ||
    riskDecimalFrom(result).lte(0) ||
    !riskDecimalFrom(result).isInteger()
  ) {
    fail(`${field} must be a positive integer decimal.`, field, value);
  }
  return result;
}

function direction(value: unknown, field: string): 'LONG' | 'SHORT' {
  if (value !== 'LONG' && value !== 'SHORT') {
    fail(`${field} must be LONG or SHORT.`, field, value);
  }
  return value;
}

const accountFields = [
  'accountCurrency',
  'realizedEquity',
  'unrealizedPnl',
  'availableFunds',
  'usedMargin',
  'grossExposure',
  'openRisk',
  'dailyLoss',
  'drawdownPct',
  'killSwitchActive',
] as const;

export function createRiskAccountState(
  input: RiskAccountStateInput,
): RiskAccountState {
  assertPlainObject(input, 'input');
  const raw = Object.fromEntries(
    accountFields.map((field) => [
      field,
      requiredProperty(input, field, field),
    ]),
  ) as Record<(typeof accountFields)[number], unknown>;

  if (raw.accountCurrency !== 'EUR') {
    fail(
      'accountCurrency must be EUR.',
      'accountCurrency',
      raw.accountCurrency,
    );
  }
  if (typeof raw.killSwitchActive !== 'boolean') {
    fail(
      'killSwitchActive must be a boolean.',
      'killSwitchActive',
      raw.killSwitchActive,
    );
  }
  const realizedEquity = decimal(raw.realizedEquity, 'realizedEquity');
  const unrealizedPnl = decimal(raw.unrealizedPnl, 'unrealizedPnl');
  const availableFunds = decimal(raw.availableFunds, 'availableFunds');
  const usedMargin = nonnegativeDecimal(raw.usedMargin, 'usedMargin');
  const grossExposure = nonnegativeDecimal(raw.grossExposure, 'grossExposure');
  const openRisk = nonnegativeDecimal(raw.openRisk, 'openRisk');
  const dailyLoss = nonnegativeDecimal(raw.dailyLoss, 'dailyLoss');
  const drawdownPct = nonnegativeDecimal(raw.drawdownPct, 'drawdownPct');

  if (
    !riskDecimalFrom(availableFunds)
      .plus(riskDecimalFrom(usedMargin))
      .eq(riskDecimalFrom(realizedEquity).plus(riskDecimalFrom(unrealizedPnl)))
  ) {
    fail(
      'availableFunds + usedMargin must equal realizedEquity + unrealizedPnl.',
      'availableFunds',
      availableFunds,
    );
  }

  return Object.freeze({
    accountCurrency: asCurrencyCode('EUR'),
    realizedEquity,
    unrealizedPnl,
    availableFunds,
    usedMargin,
    grossExposure,
    openRisk,
    dailyLoss,
    drawdownPct,
    killSwitchActive: raw.killSwitchActive,
  });
}

interface DenseArrayView {
  readonly input: Record<string, unknown>;
  readonly length: number;
}

function denseArrayView(value: unknown, field: string): DenseArrayView {
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    fail(`${field} must be a dense array.`, field);
  }
  if (!isArray) fail(`${field} must be a dense array.`, field);
  const input = value as Record<string, unknown>;
  const length = property(input, 'length', `${field}.length`);
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    fail(`${field} must have a valid length.`, field, length);
  }
  if ((length as number) > MAX_PORTFOLIO_ITEMS) {
    fail(`${field} exceeds its supported length.`, field, length);
  }
  for (let index = 0; index < (length as number); index += 1) {
    try {
      if (!Object.hasOwn(value as object, index)) {
        fail(`${field} must be dense.`, field);
      }
    } catch (error) {
      if (error instanceof RiskInputError) throw error;
      fail(`${field} must be dense.`, field);
    }
  }
  return { input, length: length as number };
}

const positionFields = [
  'positionId',
  'instrumentId',
  'contractId',
  'direction',
  'quantity',
  'remainingOpenRisk',
  'margin',
  'grossExposure',
  'riskGroup',
] as const;

function createPosition(value: unknown, field: string): RiskPosition {
  assertPlainObject(value, field);
  const raw = Object.fromEntries(
    positionFields.map((name) => [
      name,
      requiredProperty(value, name, `${field}.${name}`),
    ]),
  ) as Record<(typeof positionFields)[number], unknown>;
  return Object.freeze({
    positionId: nonBlank(raw.positionId, `${field}.positionId`),
    instrumentId: nonBlank(raw.instrumentId, `${field}.instrumentId`),
    contractId: nonBlank(raw.contractId, `${field}.contractId`),
    direction: direction(raw.direction, `${field}.direction`),
    quantity: positiveIntegerDecimal(raw.quantity, `${field}.quantity`),
    remainingOpenRisk: nonnegativeDecimal(
      raw.remainingOpenRisk,
      `${field}.remainingOpenRisk`,
    ),
    margin: nonnegativeDecimal(raw.margin, `${field}.margin`),
    grossExposure: nonnegativeDecimal(
      raw.grossExposure,
      `${field}.grossExposure`,
    ),
    riskGroup: nonBlank(raw.riskGroup, `${field}.riskGroup`),
  });
}

const intentFields = [
  'intentId',
  'instrumentId',
  'contractId',
  'direction',
] as const;

function createIntent(value: unknown, field: string): ActiveEntryIntent {
  assertPlainObject(value, field);
  const raw = Object.fromEntries(
    intentFields.map((name) => [
      name,
      requiredProperty(value, name, `${field}.${name}`),
    ]),
  ) as Record<(typeof intentFields)[number], unknown>;
  return Object.freeze({
    intentId: nonBlank(raw.intentId, `${field}.intentId`),
    instrumentId: nonBlank(raw.instrumentId, `${field}.instrumentId`),
    contractId: nonBlank(raw.contractId, `${field}.contractId`),
    direction: direction(raw.direction, `${field}.direction`),
  });
}

export function createRiskPortfolioState(
  input: RiskPortfolioStateInput,
): RiskPortfolioState {
  assertPlainObject(input, 'input');
  const rawPositions = requiredProperty(input, 'positions', 'positions');
  const rawIntents = requiredProperty(
    input,
    'activeEntryIntents',
    'activeEntryIntents',
  );
  const positionView = denseArrayView(rawPositions, 'positions');
  const intentView = denseArrayView(rawIntents, 'activeEntryIntents');

  const positions: RiskPosition[] = [];
  for (let index = 0; index < positionView.length; index += 1) {
    positions.push(
      createPosition(
        property(
          positionView.input,
          String(index),
          `positions[${String(index)}]`,
        ),
        `positions[${String(index)}]`,
      ),
    );
  }
  const intents: ActiveEntryIntent[] = [];
  for (let index = 0; index < intentView.length; index += 1) {
    intents.push(
      createIntent(
        property(
          intentView.input,
          String(index),
          `activeEntryIntents[${String(index)}]`,
        ),
        `activeEntryIntents[${String(index)}]`,
      ),
    );
  }

  const positionIds = new Set<string>();
  const positionInstruments = new Set<string>();
  positions.forEach((item, index) => {
    if (positionIds.has(item.positionId)) {
      fail(
        'positionId must be unique.',
        `positions[${String(index)}].positionId`,
        item.positionId,
      );
    }
    positionIds.add(item.positionId);
    if (positionInstruments.has(item.instrumentId)) {
      fail(
        'Only one position may exist per instrument.',
        `positions[${String(index)}].instrumentId`,
        item.instrumentId,
      );
    }
    positionInstruments.add(item.instrumentId);
  });

  const intentIds = new Set<string>();
  const intentInstruments = new Set<string>();
  intents.forEach((item, index) => {
    if (intentIds.has(item.intentId)) {
      fail(
        'intentId must be unique.',
        `activeEntryIntents[${String(index)}].intentId`,
        item.intentId,
      );
    }
    intentIds.add(item.intentId);
    if (intentInstruments.has(item.instrumentId)) {
      fail(
        'Only one active intent may exist per instrument.',
        `activeEntryIntents[${String(index)}].instrumentId`,
        item.instrumentId,
      );
    }
    intentInstruments.add(item.instrumentId);
    if (positionInstruments.has(item.instrumentId)) {
      fail(
        'An instrument cannot have both a position and active intent.',
        `activeEntryIntents[${String(index)}].instrumentId`,
        item.instrumentId,
      );
    }
  });

  return Object.freeze({
    positions: Object.freeze(positions),
    activeEntryIntents: Object.freeze(intents),
  });
}
