import { Temporal } from '@js-temporal/polyfill';
import { asInstantString, type InstantString } from '@trading-auto/domain';

import { BacktestInputError } from './errors.js';
import {
  createBacktestEventWithAvailableAt,
  type BacktestEvent,
  type BacktestEventInput,
} from './event.js';
import {
  readRequiredOwn,
  snapshotDenseArray,
  snapshotSelectedOwn,
} from './validation.js';

const MAX_QUEUED_EVENTS = 1_000_000;
const ORDER_INPUT_FIELDS = Object.freeze(['endAt', 'events'] as const);

export interface OrderBacktestEventsInput {
  endAt: string;
  events: readonly BacktestEventInput[];
}

interface ParsedInstant {
  readonly canonical: InstantString;
  readonly instant: Temporal.Instant;
}

interface OrderedEvent {
  readonly event: BacktestEvent;
  readonly instant: Temporal.Instant;
}

interface ClockKeyParts {
  readonly instant: Temporal.Instant;
  readonly priority: number;
  readonly semanticId: string;
}

function invalid(message: string, field: string, value?: unknown): never {
  throw new BacktestInputError('INVALID_BACKTEST_INPUT', message, {
    field,
    value,
  });
}

function parseInstant(value: unknown, field: string): ParsedInstant {
  if (typeof value !== 'string') {
    invalid(`${field} must be an ISO instant.`, field, value);
  }
  try {
    const instant = Temporal.Instant.from(value);
    return Object.freeze({
      canonical: asInstantString(instant.toString()),
      instant,
    });
  } catch {
    invalid(`${field} must be an ISO instant.`, field, value);
  }
}

function compareOrderedEvents(left: OrderedEvent, right: OrderedEvent): number {
  const instantOrder = Temporal.Instant.compare(left.instant, right.instant);
  if (instantOrder !== 0) return instantOrder;
  if (left.event.priority !== right.event.priority) {
    return left.event.priority - right.event.priority;
  }
  return left.event.semanticId < right.event.semanticId ? -1 : 1;
}

export function clockKeyOf(event: Readonly<BacktestEvent>): string {
  return `${event.availableAt}|${String(event.priority).padStart(2, '0')}|${event.semanticId}`;
}

function parseClockKey(value: string): ClockKeyParts {
  const firstSeparator = value.indexOf('|');
  const secondSeparator = value.indexOf('|', firstSeparator + 1);
  const instantText = value.slice(0, firstSeparator);
  const priorityText = value.slice(firstSeparator + 1, secondSeparator);
  const semanticId = value.slice(secondSeparator + 1);
  if (
    firstSeparator <= 0 ||
    secondSeparator <= firstSeparator + 1 ||
    !/^0[0-8]$/.test(priorityText) ||
    semanticId.length === 0
  ) {
    invalid('clock key is malformed.', 'clockKey', value);
  }
  try {
    return Object.freeze({
      instant: Temporal.Instant.from(instantText),
      priority: Number(priorityText),
      semanticId,
    });
  } catch {
    invalid('clock key is malformed.', 'clockKey', value);
  }
}

export function compareClockKeys(left: string, right: string): number {
  const leftParts = parseClockKey(left);
  const rightParts = parseClockKey(right);
  const instantOrder = Temporal.Instant.compare(
    leftParts.instant,
    rightParts.instant,
  );
  if (instantOrder !== 0) return instantOrder;
  if (leftParts.priority !== rightParts.priority) {
    return leftParts.priority - rightParts.priority;
  }
  return leftParts.semanticId < rightParts.semanticId
    ? -1
    : leftParts.semanticId > rightParts.semanticId
      ? 1
      : 0;
}

export function orderBacktestEvents(
  input: OrderBacktestEventsInput,
): readonly BacktestEvent[] {
  const snapshot = snapshotSelectedOwn(input, 'input', ORDER_INPUT_FIELDS);
  const endAt = parseInstant(
    readRequiredOwn(snapshot, 'endAt', 'endAt'),
    'endAt',
  );
  const sourceEvents = snapshotDenseArray(
    readRequiredOwn(snapshot, 'events', 'events'),
    'events',
    MAX_QUEUED_EVENTS,
  );
  const identities = new Set<string>();
  const eligible: OrderedEvent[] = [];

  for (const [index, rawEvent] of sourceEvents.entries()) {
    const field = `events[${String(index)}]`;
    const availableAt = parseInstant(
      readRequiredOwn(
        rawEvent as Readonly<Record<string, unknown>>,
        'availableAt',
        `${field}.availableAt`,
      ),
      `${field}.availableAt`,
    );
    if (Temporal.Instant.compare(availableAt.instant, endAt.instant) > 0) {
      continue;
    }

    const event = createBacktestEventWithAvailableAt(
      rawEvent as BacktestEventInput,
      availableAt.canonical,
    );
    if (identities.has(event.semanticId)) {
      throw new BacktestInputError(
        'DUPLICATE_EVENT',
        'Eligible events must have unique semantic identities.',
        { semanticId: event.semanticId },
      );
    }
    identities.add(event.semanticId);
    eligible.push(Object.freeze({ event, instant: availableAt.instant }));
  }

  eligible.sort(compareOrderedEvents);
  return Object.freeze(eligible.map(({ event }) => event));
}
