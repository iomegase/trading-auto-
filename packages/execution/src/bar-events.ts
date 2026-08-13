import {
  asInstantString,
  type DecimalString,
  type InstantString,
} from '@trading-auto/domain';
import { Temporal } from '@js-temporal/polyfill';

import { ExecutionDecimal, positiveExecutionDecimal } from './decimal.js';
import { ExecutionInputError } from './errors.js';

export interface H1OpenEventInput {
  instrumentId: string;
  contractId: string;
  openTime: string;
  availableAt: string;
  price: string;
}

export interface H1OpenEvent {
  readonly instrumentId: string;
  readonly contractId: string;
  readonly openTime: InstantString;
  readonly availableAt: InstantString;
  readonly price: DecimalString;
}

export interface H1ClosedBarEventInput {
  instrumentId: string;
  contractId: string;
  openTime: string;
  closeTime: string;
  availableAt: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface H1ClosedBarEvent {
  readonly instrumentId: string;
  readonly contractId: string;
  readonly openTime: InstantString;
  readonly closeTime: InstantString;
  readonly availableAt: InstantString;
  readonly open: DecimalString;
  readonly high: DecimalString;
  readonly low: DecimalString;
  readonly close: DecimalString;
}

function invalid(field: string, value?: unknown): never {
  throw new ExecutionInputError(
    'INVALID_EXECUTION_INPUT',
    `${field} is invalid for an H1 market-data event.`,
    { field, value },
  );
}

function assertRecord(value: unknown): asserts value is object {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      invalid('input');
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) invalid('input');
  } catch {
    invalid('input');
  }
}

function ownValue(input: object, field: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, field);
  } catch {
    invalid(field);
  }

  if (descriptor === undefined || !descriptor.enumerable) invalid(field);
  if ('value' in descriptor) return descriptor.value;
  if (descriptor.get === undefined) return undefined;

  try {
    return descriptor.get.call(input);
  } catch {
    invalid(field);
  }
}

function nonBlankString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(field, value);
  }
  return value;
}

function instant(value: unknown, field: string): InstantString {
  if (typeof value !== 'string') invalid(field, value);
  try {
    return asInstantString(value);
  } catch {
    invalid(field, value);
  }
}

function compare(left: InstantString, right: InstantString): number {
  return Temporal.Instant.compare(left, right);
}

export function createH1OpenEvent(input: H1OpenEventInput): H1OpenEvent {
  assertRecord(input);
  const instrumentId = nonBlankString(
    ownValue(input, 'instrumentId'),
    'instrumentId',
  );
  const contractId = nonBlankString(
    ownValue(input, 'contractId'),
    'contractId',
  );
  const openTime = instant(ownValue(input, 'openTime'), 'openTime');
  const availableAt = instant(ownValue(input, 'availableAt'), 'availableAt');
  const price = positiveExecutionDecimal(ownValue(input, 'price'), 'price');

  if (compare(availableAt, openTime) < 0) invalid('availableAt', availableAt);

  return Object.freeze({
    instrumentId,
    contractId,
    openTime,
    availableAt,
    price,
  });
}

export function createH1ClosedBarEvent(
  input: H1ClosedBarEventInput,
): H1ClosedBarEvent {
  assertRecord(input);
  const instrumentId = nonBlankString(
    ownValue(input, 'instrumentId'),
    'instrumentId',
  );
  const contractId = nonBlankString(
    ownValue(input, 'contractId'),
    'contractId',
  );
  const openTime = instant(ownValue(input, 'openTime'), 'openTime');
  const closeTime = instant(ownValue(input, 'closeTime'), 'closeTime');
  const availableAt = instant(ownValue(input, 'availableAt'), 'availableAt');
  const open = positiveExecutionDecimal(ownValue(input, 'open'), 'open');
  const high = positiveExecutionDecimal(ownValue(input, 'high'), 'high');
  const low = positiveExecutionDecimal(ownValue(input, 'low'), 'low');
  const close = positiveExecutionDecimal(ownValue(input, 'close'), 'close');

  if (compare(closeTime, openTime) <= 0) invalid('closeTime', closeTime);
  if (compare(availableAt, closeTime) < 0) invalid('availableAt', availableAt);

  const openDecimal = new ExecutionDecimal(open);
  const highDecimal = new ExecutionDecimal(high);
  const lowDecimal = new ExecutionDecimal(low);
  const closeDecimal = new ExecutionDecimal(close);

  if (highDecimal.lt(openDecimal) || highDecimal.lt(closeDecimal)) {
    invalid('high', high);
  }
  if (lowDecimal.gt(openDecimal) || lowDecimal.gt(closeDecimal)) {
    invalid('low', low);
  }

  return Object.freeze({
    instrumentId,
    contractId,
    openTime,
    closeTime,
    availableAt,
    open,
    high,
    low,
    close,
  });
}
