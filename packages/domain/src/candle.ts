import { Temporal } from '@js-temporal/polyfill';

import { asDecimalString, decimalFrom, type DecimalString } from './decimal.js';
import { DomainValidationError } from './errors.js';
import { asInstantString, type InstantString, type Timeframe } from './time.js';

export interface CandleInput {
  instrumentId: string;
  timeframe: Timeframe;
  sourceTimestamp: string;
  sourceTimezone: string;
  exchangeTimezone: string;
  openTime: string;
  closeTime: string;
  availableAt: string;
  ingestedAt: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
  isClosed: boolean;
  provider: string;
}

export interface Candle {
  readonly instrumentId: string;
  readonly timeframe: Timeframe;
  readonly sourceTimestamp: string;
  readonly sourceTimezone: string;
  readonly exchangeTimezone: string;
  readonly openTime: InstantString;
  readonly closeTime: InstantString;
  readonly availableAt: InstantString;
  readonly ingestedAt: InstantString;
  readonly open: DecimalString;
  readonly high: DecimalString;
  readonly low: DecimalString;
  readonly close: DecimalString;
  readonly volume?: DecimalString;
  readonly isClosed: boolean;
  readonly provider: string;
}

function invalidCandle(
  code: 'INVALID_CANDLE' | 'INVALID_TIMEFRAME' | 'HIGH_BELOW_LOW',
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new DomainValidationError(code, message, details);
}

function decimalForPrice(value: DecimalString, field: string) {
  const decimal = decimalFrom(value);

  if (decimal.lte(0)) {
    invalidCandle('INVALID_CANDLE', `${field} must be greater than zero.`, {
      field,
      value,
    });
  }

  return decimal;
}

function assertTimeframe(value: unknown): asserts value is Timeframe {
  if (value !== '1h' && value !== '4h') {
    invalidCandle(
      'INVALID_TIMEFRAME',
      'timeframe must be one of the supported values.',
      { timeframe: value },
    );
  }
}

function assertNonEmptyString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalidCandle('INVALID_CANDLE', `${field} must be a non-empty string.`, {
      field,
      value,
    });
  }
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string') {
    invalidCandle('INVALID_CANDLE', `${field} must be a string.`, {
      field,
      value,
    });
  }
}

function validateCandleInput(input: CandleInput): void {
  const candidate: unknown = input;

  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    invalidCandle('INVALID_CANDLE', 'input must be an object.', {
      field: 'input',
    });
  }

  const record = candidate as Record<string, unknown>;

  assertNonEmptyString(record.instrumentId, 'instrumentId');
  assertTimeframe(record.timeframe);
  assertNonEmptyString(record.sourceTimestamp, 'sourceTimestamp');
  assertNonEmptyString(record.sourceTimezone, 'sourceTimezone');
  assertNonEmptyString(record.exchangeTimezone, 'exchangeTimezone');
  assertString(record.openTime, 'openTime');
  assertString(record.closeTime, 'closeTime');
  assertString(record.availableAt, 'availableAt');
  assertString(record.ingestedAt, 'ingestedAt');
  assertString(record.open, 'open');
  assertString(record.high, 'high');
  assertString(record.low, 'low');
  assertString(record.close, 'close');
  assertNonEmptyString(record.provider, 'provider');

  if (typeof record.isClosed !== 'boolean') {
    invalidCandle('INVALID_CANDLE', 'isClosed must be a boolean.', {
      field: 'isClosed',
      value: record.isClosed,
    });
  }

  if (
    Object.prototype.hasOwnProperty.call(record, 'volume') &&
    typeof record.volume !== 'string'
  ) {
    invalidCandle('INVALID_CANDLE', 'volume must be a string when supplied.', {
      field: 'volume',
      value: record.volume,
    });
  }
}

function decimalForVolume(value: string): DecimalString {
  let volume: DecimalString;

  try {
    volume = asDecimalString(value);
  } catch {
    invalidCandle('INVALID_CANDLE', 'volume must be a canonical decimal.', {
      field: 'volume',
      value,
    });
  }

  if (decimalFrom(volume).isNegative()) {
    invalidCandle('INVALID_CANDLE', 'volume must not be negative.', {
      field: 'volume',
      value,
    });
  }

  return volume;
}

export function createCandle(input: CandleInput): Readonly<Candle> {
  validateCandleInput(input);

  const openTime = asInstantString(input.openTime);
  const closeTime = asInstantString(input.closeTime);
  const availableAt = asInstantString(input.availableAt);
  const ingestedAt = asInstantString(input.ingestedAt);
  const open = asDecimalString(input.open);
  const high = asDecimalString(input.high);
  const low = asDecimalString(input.low);
  const close = asDecimalString(input.close);
  const openDecimal = decimalForPrice(open, 'open');
  const highDecimal = decimalForPrice(high, 'high');
  const lowDecimal = decimalForPrice(low, 'low');
  const closeDecimal = decimalForPrice(close, 'close');

  if (highDecimal.lt(lowDecimal)) {
    invalidCandle('HIGH_BELOW_LOW', 'high must not be less than low.', {
      high,
      low,
    });
  }

  if (highDecimal.lt(openDecimal) || highDecimal.lt(closeDecimal)) {
    invalidCandle(
      'INVALID_CANDLE',
      'high must be at least both open and close.',
      {
        high,
        open,
        close,
      },
    );
  }

  if (lowDecimal.gt(openDecimal) || lowDecimal.gt(closeDecimal)) {
    invalidCandle(
      'INVALID_CANDLE',
      'low must be at most both open and close.',
      {
        low,
        open,
        close,
      },
    );
  }

  if (Temporal.Instant.compare(openTime, closeTime) >= 0) {
    invalidCandle('INVALID_CANDLE', 'openTime must be before closeTime.', {
      openTime,
      closeTime,
    });
  }

  if (input.isClosed && Temporal.Instant.compare(availableAt, closeTime) < 0) {
    invalidCandle(
      'INVALID_CANDLE',
      'availableAt must not be before closeTime for closed candles.',
      {
        availableAt,
        closeTime,
      },
    );
  }

  const candle: Candle = {
    instrumentId: input.instrumentId,
    timeframe: input.timeframe,
    sourceTimestamp: input.sourceTimestamp,
    sourceTimezone: input.sourceTimezone,
    exchangeTimezone: input.exchangeTimezone,
    openTime,
    closeTime,
    availableAt,
    ingestedAt,
    open,
    high,
    low,
    close,
    isClosed: input.isClosed,
    provider: input.provider,
  };

  return Object.freeze(
    input.volume === undefined
      ? candle
      : { ...candle, volume: decimalForVolume(input.volume) },
  );
}
