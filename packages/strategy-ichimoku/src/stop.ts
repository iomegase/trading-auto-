import { asDecimalString, type DecimalString } from '@trading-auto/domain';

import { StrategyDecimal } from './decimal.js';

export type StopProposal =
  | { readonly status: 'VALID'; readonly price: DecimalString }
  | { readonly status: 'INVALID_INITIAL_STOP' };

export function proposeKijunStop(
  direction: 'LONG' | 'SHORT',
  kijun: number | null,
  entryReference: DecimalString,
): StopProposal {
  if (kijun === null || !Number.isFinite(kijun)) {
    return { status: 'INVALID_INITIAL_STOP' };
  }

  const kijunDecimal = new StrategyDecimal(kijun);
  const entryDecimal = new StrategyDecimal(entryReference);
  const isValid =
    direction === 'LONG'
      ? kijunDecimal.lt(entryDecimal)
      : kijunDecimal.gt(entryDecimal);

  if (!isValid) {
    return { status: 'INVALID_INITIAL_STOP' };
  }

  return {
    status: 'VALID',
    price: asDecimalString(kijunDecimal.toFixed()),
  };
}
