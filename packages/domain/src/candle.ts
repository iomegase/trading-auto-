import { Temporal } from '@js-temporal/polyfill';
import { Decimal } from 'decimal.js';

import { asDecimalString, type DecimalString } from './decimal.js';
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
  readonly sourceTimestamp: InstantString;
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
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new DomainValidationError('INVALID_CANDLE', message, details);
}

function decimalForPrice(value: DecimalString, field: string): Decimal {
  const decimal = new Decimal(value);

  if (decimal.lte(0)) {
    invalidCandle(`${field} must be greater than zero.`, { field, value });
  }

  return decimal;
}

function assertTimeframe(value: string): asserts value is Timeframe {
  if (value !== '1h' && value !== '4h') {
    invalidCandle('timeframe must be one of the supported values.', {
      timeframe: value,
    });
  }
}

export function createCandle(input: CandleInput): Readonly<Candle> {
  assertTimeframe(input.timeframe);

  const sourceTimestamp = asInstantString(input.sourceTimestamp);
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

  if (highDecimal.lt(openDecimal) || highDecimal.lt(closeDecimal)) {
    invalidCandle('high must be at least both open and close.', {
      high,
      open,
      close,
    });
  }

  if (lowDecimal.gt(openDecimal) || lowDecimal.gt(closeDecimal)) {
    invalidCandle('low must be at most both open and close.', {
      low,
      open,
      close,
    });
  }

  if (highDecimal.lt(lowDecimal)) {
    invalidCandle('high must not be less than low.', { high, low });
  }

  if (Temporal.Instant.compare(openTime, closeTime) >= 0) {
    invalidCandle('openTime must be before closeTime.', {
      openTime,
      closeTime,
    });
  }

  if (input.isClosed && Temporal.Instant.compare(availableAt, closeTime) < 0) {
    invalidCandle(
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
    sourceTimestamp,
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
      : { ...candle, volume: asDecimalString(input.volume) },
  );
}
