import {
  asInstantString,
  type FuturesContract,
  type InstantString,
} from '@trading-auto/domain';
import { Temporal } from '@js-temporal/polyfill';

import {
  createH1OpenEvent,
  type H1OpenEvent,
  type H1OpenEventInput,
} from './bar-events.js';
import { ExecutionInputError } from './errors.js';

const MAX_INTERVALS = 10_000;
const MAX_OPEN_EVENTS = 10_000;

export interface ExecutionIntervalInput {
  start: string;
  end: string;
}

export interface ExecutionInterval {
  readonly start: InstantString;
  readonly end: InstantString;
}

export interface ExecutionScheduleInput {
  version: string;
  source: string;
  observedAt: string;
  validFrom: string;
  validUntil: string;
  contractId: string;
  tradableIntervals: readonly ExecutionIntervalInput[];
  maintenanceBreaks: readonly ExecutionIntervalInput[];
}

export interface ExecutionSchedule {
  readonly version: string;
  readonly source: string;
  readonly observedAt: InstantString;
  readonly validFrom: InstantString;
  readonly validUntil: InstantString;
  readonly contractId: string;
  readonly tradableIntervals: readonly Readonly<ExecutionInterval>[];
  readonly maintenanceBreaks: readonly Readonly<ExecutionInterval>[];
}

export interface SelectNextTradableH1OpenInput {
  signalCloseTime: string;
  decisionAt: string;
  contract: Readonly<FuturesContract>;
  schedule: Readonly<ExecutionSchedule>;
  openEvents: readonly Readonly<H1OpenEvent>[];
}

function scheduleError(field: string, value?: unknown): never {
  throw new ExecutionInputError(
    'INVALID_EXECUTION_SCHEDULE',
    `${field} is invalid for the execution schedule.`,
    { field, value },
  );
}

function dataError(field: string, value?: unknown): never {
  throw new ExecutionInputError(
    'INVALID_DATA',
    `${field} is missing or inconsistent in the execution dataset.`,
    { field, value },
  );
}

function assertPlainRecord(
  value: unknown,
  field: string,
  invalid: (field: string, value?: unknown) => never,
): asserts value is object {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      invalid(field);
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) invalid(field);
  } catch {
    invalid(field);
  }
}

function ownValue(
  input: object,
  field: string,
  invalid: (field: string, value?: unknown) => never,
): unknown {
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

function nonBlank(
  value: unknown,
  field: string,
  invalid: (field: string, value?: unknown) => never,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(field, value);
  }
  return value;
}

function instant(
  value: unknown,
  field: string,
  invalid: (field: string, value?: unknown) => never,
): InstantString {
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

function denseArray(
  value: unknown,
  field: string,
  maximum: number,
  invalid: (field: string, value?: unknown) => never,
): readonly unknown[] {
  let isArray: boolean;
  let length: number;
  try {
    isArray = Array.isArray(value);
    if (!isArray) invalid(field, value);
    length = (value as unknown[]).length;
  } catch {
    invalid(field);
  }
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
    invalid(field, { length, maximum });
  }

  const result: unknown[] = new Array(length);
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      invalid(field, { index });
    }
    if (descriptor === undefined || !descriptor.enumerable) {
      invalid(field, { index });
    }
    if ('value' in descriptor) {
      result[index] = descriptor.value;
    } else if (descriptor.get === undefined) {
      result[index] = undefined;
    } else {
      try {
        result[index] = descriptor.get.call(value);
      } catch {
        invalid(field, { index });
      }
    }
  }
  return result;
}

function intervalList(
  value: unknown,
  field: 'tradableIntervals' | 'maintenanceBreaks',
  validFrom: InstantString,
  validUntil: InstantString,
): readonly Readonly<ExecutionInterval>[] {
  const values = denseArray(value, field, MAX_INTERVALS, scheduleError);
  const intervals: Array<Readonly<ExecutionInterval>> = [];

  for (let index = 0; index < values.length; index += 1) {
    const interval = values[index];
    assertPlainRecord(interval, field, scheduleError);
    const start = instant(
      ownValue(interval, 'start', scheduleError),
      field,
      scheduleError,
    );
    const end = instant(
      ownValue(interval, 'end', scheduleError),
      field,
      scheduleError,
    );

    if (
      compare(start, end) >= 0 ||
      compare(start, validFrom) < 0 ||
      compare(end, validUntil) > 0
    ) {
      scheduleError(field, { index, start, end });
    }
    const previous = intervals[index - 1];
    if (previous !== undefined && compare(previous.end, start) > 0) {
      scheduleError(field, { index, start, previousEnd: previous.end });
    }
    intervals.push(Object.freeze({ start, end }));
  }

  return Object.freeze(intervals);
}

export function createExecutionSchedule(
  input: ExecutionScheduleInput,
): Readonly<ExecutionSchedule> {
  assertPlainRecord(input, 'input', scheduleError);
  const version = nonBlank(
    ownValue(input, 'version', scheduleError),
    'version',
    scheduleError,
  );
  const source = nonBlank(
    ownValue(input, 'source', scheduleError),
    'source',
    scheduleError,
  );
  const observedAt = instant(
    ownValue(input, 'observedAt', scheduleError),
    'observedAt',
    scheduleError,
  );
  const validFrom = instant(
    ownValue(input, 'validFrom', scheduleError),
    'validFrom',
    scheduleError,
  );
  const validUntil = instant(
    ownValue(input, 'validUntil', scheduleError),
    'validUntil',
    scheduleError,
  );
  const contractId = nonBlank(
    ownValue(input, 'contractId', scheduleError),
    'contractId',
    scheduleError,
  );
  const rawTradableIntervals = ownValue(
    input,
    'tradableIntervals',
    scheduleError,
  );
  const rawMaintenanceBreaks = ownValue(
    input,
    'maintenanceBreaks',
    scheduleError,
  );

  if (compare(validFrom, validUntil) >= 0) {
    scheduleError('validUntil', validUntil);
  }

  const tradableIntervals = intervalList(
    rawTradableIntervals,
    'tradableIntervals',
    validFrom,
    validUntil,
  );
  const maintenanceBreaks = intervalList(
    rawMaintenanceBreaks,
    'maintenanceBreaks',
    validFrom,
    validUntil,
  );

  return Object.freeze({
    version,
    source,
    observedAt,
    validFrom,
    validUntil,
    contractId,
    tradableIntervals,
    maintenanceBreaks,
  });
}

function includesInstant(
  intervals: readonly Readonly<ExecutionInterval>[],
  value: InstantString,
): boolean {
  return intervals.some(
    ({ start, end }) => compare(start, value) <= 0 && compare(value, end) < 0,
  );
}

interface ContractWindow {
  readonly contractId: string;
  readonly productCode: string;
  readonly firstTradeAt: InstantString;
  readonly lastTradeAt: InstantString;
}

function contractWindow(value: unknown): ContractWindow {
  assertPlainRecord(value, 'contract', dataError);
  const contractId = nonBlank(
    ownValue(value, 'contractId', dataError),
    'contractId',
    dataError,
  );
  const productCode = nonBlank(
    ownValue(value, 'productCode', dataError),
    'productCode',
    dataError,
  );
  const firstTradeAt = instant(
    ownValue(value, 'firstTradeAt', dataError),
    'firstTradeAt',
    dataError,
  );
  const lastTradeAt = instant(
    ownValue(value, 'lastTradeAt', dataError),
    'lastTradeAt',
    dataError,
  );
  if (compare(firstTradeAt, lastTradeAt) >= 0) dataError('contract');
  return Object.freeze({ contractId, productCode, firstTradeAt, lastTradeAt });
}

export function selectNextTradableH1Open(
  input: SelectNextTradableH1OpenInput,
): H1OpenEvent | null {
  assertPlainRecord(input, 'input', dataError);
  const signalCloseTime = instant(
    ownValue(input, 'signalCloseTime', dataError),
    'signalCloseTime',
    dataError,
  );
  const decisionAt = instant(
    ownValue(input, 'decisionAt', dataError),
    'decisionAt',
    dataError,
  );
  const contract = contractWindow(ownValue(input, 'contract', dataError));
  const schedule = createExecutionSchedule(
    ownValue(input, 'schedule', dataError) as ExecutionScheduleInput,
  );
  const openEvents = denseArray(
    ownValue(input, 'openEvents', dataError),
    'openEvents',
    MAX_OPEN_EVENTS,
    dataError,
  );

  if (compare(signalCloseTime, decisionAt) > 0)
    dataError('decisionAt', decisionAt);
  if (compare(schedule.observedAt, decisionAt) > 0) {
    scheduleError('observedAt', schedule.observedAt);
  }
  if (schedule.contractId !== contract.contractId) {
    scheduleError('contractId', schedule.contractId);
  }
  if (
    compare(signalCloseTime, schedule.validFrom) < 0 ||
    compare(decisionAt, schedule.validUntil) >= 0
  ) {
    dataError('scheduleCoverage', {
      signalCloseTime,
      decisionAt,
      validFrom: schedule.validFrom,
      validUntil: schedule.validUntil,
    });
  }

  let selected: H1OpenEvent | null = null;
  for (const rawEvent of openEvents) {
    let event: H1OpenEvent;
    try {
      event = createH1OpenEvent(rawEvent as H1OpenEventInput);
    } catch {
      dataError('openEvents');
    }
    if (event.contractId !== contract.contractId) {
      dataError('contractId', event.contractId);
    }
    if (event.instrumentId !== contract.productCode) {
      dataError('instrumentId', event.instrumentId);
    }
    if (
      compare(event.openTime, signalCloseTime) <= 0 ||
      compare(event.availableAt, decisionAt) > 0 ||
      compare(event.openTime, contract.firstTradeAt) < 0 ||
      compare(event.openTime, contract.lastTradeAt) >= 0 ||
      !includesInstant(schedule.tradableIntervals, event.openTime) ||
      includesInstant(schedule.maintenanceBreaks, event.openTime)
    ) {
      continue;
    }
    if (selected === null || compare(event.openTime, selected.openTime) < 0) {
      selected = event;
    }
  }

  return selected;
}
