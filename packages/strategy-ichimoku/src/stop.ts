import { asDecimalString, type DecimalString } from '@trading-auto/domain';
import { Decimal } from 'decimal.js';

export type StopProposal =
  | { readonly status: 'VALID'; readonly price: DecimalString }
  | { readonly status: 'INVALID_INITIAL_STOP' };

function assertDirection(value: unknown): asserts value is 'LONG' | 'SHORT' {
  if (value !== 'LONG' && value !== 'SHORT') {
    throw new RangeError('direction must be LONG or SHORT.');
  }
}

function exactDecimalConstructor(
  ...values: readonly DecimalString[]
): typeof Decimal {
  const precision = Math.min(
    1_000_000_000,
    Math.max(
      20,
      values.reduce((length, value) => length + value.length, 8),
    ),
  );

  return Decimal.clone({
    precision,
    rounding: Decimal.ROUND_HALF_UP,
    maxE: 9e15,
    minE: -9e15,
  });
}

export function proposeKijunStop(
  direction: 'LONG' | 'SHORT',
  kijunPrice: DecimalString | null,
  entryReference: DecimalString,
  tickSize: DecimalString,
): StopProposal {
  assertDirection(direction);

  let entry: DecimalString;
  let tick: DecimalString;

  try {
    entry = asDecimalString(entryReference);
  } catch {
    throw new RangeError('entryReference must be a canonical decimal string.');
  }

  try {
    tick = asDecimalString(tickSize);
  } catch {
    throw new RangeError('tickSize must be a canonical decimal string.');
  }

  const InputDecimal = exactDecimalConstructor(entry, tick);
  const inputEntryDecimal = new InputDecimal(entry);
  const inputTickDecimal = new InputDecimal(tick);

  if (!inputEntryDecimal.gt(0)) {
    throw new RangeError('entryReference must be positive.');
  }

  if (!inputTickDecimal.gt(0)) {
    throw new RangeError('tickSize must be positive.');
  }

  let kijun: DecimalString;

  try {
    if (kijunPrice === null) {
      return { status: 'INVALID_INITIAL_STOP' };
    }

    kijun = asDecimalString(kijunPrice);
  } catch {
    return { status: 'INVALID_INITIAL_STOP' };
  }

  const StopDecimal = exactDecimalConstructor(kijun, entry, tick);
  const kijunDecimal = new StopDecimal(kijun);
  const entryDecimal = new StopDecimal(entry);
  const tickDecimal = new StopDecimal(tick);

  if (!kijunDecimal.gt(0)) {
    return { status: 'INVALID_INITIAL_STOP' };
  }

  const roundedTicks = kijunDecimal
    .div(tickDecimal)
    .toDecimalPlaces(
      0,
      direction === 'LONG' ? StopDecimal.ROUND_CEIL : StopDecimal.ROUND_FLOOR,
    );
  const roundedStop = roundedTicks.mul(tickDecimal);
  const isValid =
    direction === 'LONG'
      ? roundedStop.lt(entryDecimal)
      : roundedStop.gt(entryDecimal);

  if (!isValid) {
    return { status: 'INVALID_INITIAL_STOP' };
  }

  return {
    status: 'VALID',
    price: asDecimalString(roundedStop.toFixed()),
  };
}
