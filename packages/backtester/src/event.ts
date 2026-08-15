import { asInstantString, type InstantString } from '@trading-auto/domain';

import { BacktestInputError } from './errors.js';
import {
  readRequiredOwn,
  snapshotJsonObject,
  snapshotSelectedOwn,
  type JsonObject,
} from './validation.js';

export type { JsonObject, JsonValue } from './validation.js';

export const BACKTEST_EVENT_TYPES = Object.freeze([
  'DATA_AVAILABLE',
  'CLOSED_BAR_POSITION',
  'DAILY_SETTLEMENT',
  'ROLL',
  'OPEN_EXIT',
  'OPEN_ENTRY',
  'SIGNAL_DECISION',
  'PORTFOLIO_SNAPSHOT',
  'SESSION_END',
] as const);

export type BacktestEventType = (typeof BACKTEST_EVENT_TYPES)[number];

export const BACKTEST_EVENT_PRIORITY: Readonly<
  Record<BacktestEventType, number>
> = Object.freeze({
  DATA_AVAILABLE: 0,
  CLOSED_BAR_POSITION: 1,
  DAILY_SETTLEMENT: 2,
  ROLL: 3,
  OPEN_EXIT: 4,
  OPEN_ENTRY: 5,
  SIGNAL_DECISION: 6,
  PORTFOLIO_SNAPSHOT: 7,
  SESSION_END: 8,
});

export interface BacktestEventInput {
  semanticId: string;
  type: string;
  availableAt: string;
  instrumentId: string | null;
  contractId: string | null;
  version: string | null;
  payload: Readonly<Record<string, unknown>>;
}

export interface BacktestEvent {
  readonly semanticId: string;
  readonly type: BacktestEventType;
  readonly priority: number;
  readonly availableAt: InstantString;
  readonly instrumentId: string | null;
  readonly contractId: string | null;
  readonly version: string | null;
  readonly payload: JsonObject;
}

const EVENT_INPUT_FIELDS = Object.freeze([
  'semanticId',
  'type',
  'availableAt',
  'instrumentId',
  'contractId',
  'version',
  'payload',
] as const);

const EVENT_INPUT_FIELDS_AFTER_AVAILABLE_AT = Object.freeze([
  'semanticId',
  'type',
  'instrumentId',
  'contractId',
  'version',
  'payload',
] as const);
const PRINTABLE_ASCII_SEMANTIC_ID = /^[\x21-\x7e]+$/;

function invalid(message: string, field: string, value?: unknown): never {
  throw new BacktestInputError('INVALID_BACKTEST_INPUT', message, {
    field,
    value,
  });
}

function nonblank(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    invalid(
      `${field} must be a nonblank string without surrounding whitespace.`,
      field,
      value,
    );
  }
  return value;
}

export function isBacktestSemanticId(value: unknown): value is string {
  return typeof value === 'string' && PRINTABLE_ASCII_SEMANTIC_ID.test(value);
}

function semanticIdentifier(value: unknown): string {
  if (!isBacktestSemanticId(value)) {
    invalid(
      'semanticId must contain only printable non-space US-ASCII characters.',
      'semanticId',
      value,
    );
  }
  return value;
}

function nullableNonblank(value: unknown, field: string): string | null {
  return value === null ? null : nonblank(value, field);
}

function eventType(value: unknown): BacktestEventType {
  if (
    typeof value !== 'string' ||
    !BACKTEST_EVENT_TYPES.some((candidate) => candidate === value)
  ) {
    invalid('type must be a supported backtest event type.', 'type', value);
  }
  return value as BacktestEventType;
}

function instant(value: unknown): InstantString {
  if (typeof value !== 'string') {
    invalid('availableAt must be an ISO instant.', 'availableAt', value);
  }
  try {
    return asInstantString(value);
  } catch {
    invalid('availableAt must be an ISO instant.', 'availableAt', value);
  }
}

function createEventFromSnapshot(
  snapshot: Readonly<Record<string, unknown>>,
  availableAt: InstantString,
): BacktestEvent {
  const semanticId = semanticIdentifier(
    readRequiredOwn(snapshot, 'semanticId', 'semanticId'),
  );
  const type = eventType(readRequiredOwn(snapshot, 'type', 'type'));
  const instrumentId = nullableNonblank(
    readRequiredOwn(snapshot, 'instrumentId', 'instrumentId'),
    'instrumentId',
  );
  const contractId = nullableNonblank(
    readRequiredOwn(snapshot, 'contractId', 'contractId'),
    'contractId',
  );
  const version = nullableNonblank(
    readRequiredOwn(snapshot, 'version', 'version'),
    'version',
  );
  const payload = snapshotJsonObject(
    readRequiredOwn(snapshot, 'payload', 'payload'),
    'payload',
  );

  return Object.freeze({
    semanticId,
    type,
    priority: BACKTEST_EVENT_PRIORITY[type],
    availableAt,
    instrumentId,
    contractId,
    version,
    payload,
  });
}

export function createBacktestEvent(input: BacktestEventInput): BacktestEvent {
  const snapshot = snapshotSelectedOwn(input, 'input', EVENT_INPUT_FIELDS);
  return createEventFromSnapshot(
    snapshot,
    instant(readRequiredOwn(snapshot, 'availableAt', 'availableAt')),
  );
}

export function createBacktestEventWithAvailableAt(
  input: BacktestEventInput,
  availableAt: InstantString,
): BacktestEvent {
  return createEventFromSnapshot(
    snapshotSelectedOwn(input, 'input', EVENT_INPUT_FIELDS_AFTER_AVAILABLE_AT),
    availableAt,
  );
}
