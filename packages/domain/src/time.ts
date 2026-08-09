import { Temporal } from '@js-temporal/polyfill';

import { DomainValidationError } from './errors.js';

declare const instantStringBrand: unique symbol;

export type InstantString = string & {
  readonly [instantStringBrand]: 'InstantString';
};

export type Timeframe = '1h' | '4h';

export function asInstantString(value: string): InstantString {
  if (typeof value !== 'string') {
    throw new DomainValidationError(
      'INVALID_INSTANT',
      'Instant values must be ISO-8601 instant strings.',
      { value },
    );
  }

  try {
    return Temporal.Instant.from(value).toString() as InstantString;
  } catch {
    throw new DomainValidationError(
      'INVALID_INSTANT',
      'Instant values must be ISO-8601 instant strings.',
      { value },
    );
  }
}
