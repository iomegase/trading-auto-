import { Temporal } from '@js-temporal/polyfill';
import {
  asInstantString,
  type DecimalString,
  type InstantString,
} from '@trading-auto/domain';

import { asBacktestDecimal, decimalCompare, decimalSum } from './decimal.js';
import { BacktestInputError, BacktestStateError } from './errors.js';
import {
  readRequiredOwn,
  snapshotDenseArray,
  snapshotSelectedOwn,
} from './validation.js';

const LEDGER_ACCOUNTS = Object.freeze([
  'CASH',
  'CAPITAL',
  'COSTS',
  'PNL_CLEARING',
  'FX_TRANSLATION',
] as const);

export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

export interface LedgerPostingInput {
  account: string;
  amount: string;
}

export interface LedgerPosting {
  readonly account: LedgerAccount;
  readonly amount: DecimalString;
}

export interface LedgerEntryInput {
  entryId: string;
  eventId: string;
  occurredAt: string;
  description: string;
  fxSnapshotVersion: string | null;
  postings: readonly LedgerPostingInput[];
}

export interface LedgerEntry {
  readonly entryId: string;
  readonly eventId: string;
  readonly occurredAt: InstantString;
  readonly description: string;
  readonly fxSnapshotVersion: string | null;
  readonly postings: readonly LedgerPosting[];
}

export type BacktestLedger = readonly LedgerEntry[];

const ENTRY_FIELDS = Object.freeze([
  'entryId',
  'eventId',
  'occurredAt',
  'description',
  'fxSnapshotVersion',
  'postings',
] as const);
const POSTING_FIELDS = Object.freeze(['account', 'amount'] as const);
const INITIAL_LEDGER_FIELDS = Object.freeze([
  'backtestId',
  'runCreatedAt',
] as const);
const MAX_POSTINGS = 32;
const MAX_LEDGER_ENTRIES = 1_000_000;

function invalid(message: string, field: string, value?: unknown): never {
  throw new BacktestInputError('INVALID_BACKTEST_INPUT', message, {
    field,
    value,
  });
}

function invalidState(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new BacktestStateError('INVALID_BACKTEST_STATE', message, details);
}

function nonblank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(`${field} must be a nonblank string.`, field, value);
  }
  return value;
}

function nullableNonblank(value: unknown, field: string): string | null {
  return value === null ? null : nonblank(value, field);
}

function instant(value: unknown, field: string): InstantString {
  if (typeof value !== 'string') {
    invalid(`${field} must be an ISO instant.`, field, value);
  }
  try {
    return asInstantString(value);
  } catch {
    invalid(`${field} must be an ISO instant.`, field, value);
  }
}

function ledgerAccount(value: unknown, field: string): LedgerAccount {
  if (
    typeof value !== 'string' ||
    !LEDGER_ACCOUNTS.some((candidate) => candidate === value)
  ) {
    invalid(`${field} must be a supported ledger account.`, field, value);
  }
  return value as LedgerAccount;
}

function createPosting(value: unknown, index: number): LedgerPosting {
  const field = `postings[${String(index)}]`;
  const snapshot = snapshotSelectedOwn(value, field, POSTING_FIELDS);
  return Object.freeze({
    account: ledgerAccount(
      readRequiredOwn(snapshot, 'account', `${field}.account`),
      `${field}.account`,
    ),
    amount: asBacktestDecimal(
      readRequiredOwn(snapshot, 'amount', `${field}.amount`),
      `${field}.amount`,
    ),
  });
}

function createLedgerEntryFromSnapshot(
  snapshot: Readonly<Record<string, unknown>>,
  existingState: boolean,
): LedgerEntry {
  const entryId = nonblank(
    readRequiredOwn(snapshot, 'entryId', 'entryId'),
    'entryId',
  );
  const eventId = nonblank(
    readRequiredOwn(snapshot, 'eventId', 'eventId'),
    'eventId',
  );
  const occurredAt = instant(
    readRequiredOwn(snapshot, 'occurredAt', 'occurredAt'),
    'occurredAt',
  );
  const description = nonblank(
    readRequiredOwn(snapshot, 'description', 'description'),
    'description',
  );
  const fxSnapshotVersion = nullableNonblank(
    readRequiredOwn(snapshot, 'fxSnapshotVersion', 'fxSnapshotVersion'),
    'fxSnapshotVersion',
  );
  const rawPostings = snapshotDenseArray(
    readRequiredOwn(snapshot, 'postings', 'postings'),
    'postings',
    MAX_POSTINGS,
  );
  if (rawPostings.length < 2) {
    invalid('postings must contain at least two items.', 'postings');
  }

  const postings = Object.freeze(rawPostings.map(createPosting));
  const accounts = new Set<LedgerAccount>();
  let hasPositive = false;
  let hasNegative = false;
  let hasFxTranslation = false;

  for (const posting of postings) {
    if (accounts.has(posting.account)) {
      invalid('posting accounts must be unique.', 'postings', posting.account);
    }
    accounts.add(posting.account);

    const comparison = decimalCompare(posting.amount, '0');
    if (comparison === 0) {
      invalid('posting amounts must be non-zero.', 'postings', posting.amount);
    }
    hasPositive ||= comparison > 0;
    hasNegative ||= comparison < 0;
    hasFxTranslation ||= posting.account === 'FX_TRANSLATION';
  }

  const isBalanced =
    decimalCompare(decimalSum(postings.map(({ amount }) => amount)), '0') === 0;
  if (!isBalanced && existingState) {
    throw new BacktestStateError(
      'UNBALANCED_LEDGER',
      'ledger entry postings must sum exactly to zero.',
      { entryId },
    );
  }
  if (!hasPositive || !hasNegative) {
    invalid(
      'postings must contain both positive and negative amounts.',
      'postings',
    );
  }
  if (!isBalanced) {
    throw new BacktestStateError(
      'UNBALANCED_LEDGER',
      'ledger entry postings must sum exactly to zero.',
      { entryId },
    );
  }
  if (hasFxTranslation && fxSnapshotVersion === null) {
    invalid(
      'fxSnapshotVersion is required for FX_TRANSLATION postings.',
      'fxSnapshotVersion',
      fxSnapshotVersion,
    );
  }
  if (!hasFxTranslation && fxSnapshotVersion !== null) {
    invalid(
      'fxSnapshotVersion is only allowed for FX_TRANSLATION postings.',
      'fxSnapshotVersion',
      fxSnapshotVersion,
    );
  }

  return Object.freeze({
    entryId,
    eventId,
    occurredAt,
    description,
    fxSnapshotVersion,
    postings,
  });
}

export function createLedgerEntry(input: LedgerEntryInput): LedgerEntry {
  return createLedgerEntryFromSnapshot(
    snapshotSelectedOwn(input, 'input', ENTRY_FIELDS),
    false,
  );
}

export function createInitialLedger(input: {
  backtestId: string;
  runCreatedAt: string;
}): BacktestLedger {
  const snapshot = snapshotSelectedOwn(input, 'input', INITIAL_LEDGER_FIELDS);
  const backtestId = nonblank(
    readRequiredOwn(snapshot, 'backtestId', 'backtestId'),
    'backtestId',
  );
  const runCreatedAt = instant(
    readRequiredOwn(snapshot, 'runCreatedAt', 'runCreatedAt'),
    'runCreatedAt',
  );

  return Object.freeze([
    createLedgerEntry({
      entryId: `initialization:${backtestId}`,
      eventId: `run:${backtestId}:initialization`,
      occurredAt: runCreatedAt,
      description: 'Initial capital',
      fxSnapshotVersion: null,
      postings: [
        { account: 'CASH', amount: '1000' },
        { account: 'CAPITAL', amount: '-1000' },
      ],
    }),
  ]);
}

function compareInstants(left: InstantString, right: InstantString): number {
  return Temporal.Instant.compare(
    Temporal.Instant.from(left),
    Temporal.Instant.from(right),
  );
}

export function appendLedgerEntry(
  ledger: BacktestLedger,
  entry: LedgerEntryInput,
): BacktestLedger {
  const rawEntries = snapshotDenseArray(
    ledger,
    'ledger',
    MAX_LEDGER_ENTRIES - 1,
  );
  const entries: LedgerEntry[] = [];
  const entryIds = new Set<string>();
  let previous: LedgerEntry | undefined;

  for (const rawEntry of rawEntries) {
    const current = createLedgerEntryFromSnapshot(
      snapshotSelectedOwn(rawEntry, 'ledger entry', ENTRY_FIELDS),
      true,
    );
    if (entryIds.has(current.entryId)) {
      invalidState('ledger entry IDs must be unique.', {
        entryId: current.entryId,
      });
    }
    if (
      previous !== undefined &&
      compareInstants(current.occurredAt, previous.occurredAt) < 0
    ) {
      throw new BacktestStateError(
        'EVENT_ORDER_VIOLATION',
        'ledger entries must be chronological.',
        { entryId: current.entryId },
      );
    }
    entries.push(current);
    entryIds.add(current.entryId);
    previous = current;
  }

  const appended = createLedgerEntry(entry);
  if (entryIds.has(appended.entryId)) {
    invalidState('ledger entry IDs must be unique.', {
      entryId: appended.entryId,
    });
  }
  if (
    previous !== undefined &&
    compareInstants(appended.occurredAt, previous.occurredAt) < 0
  ) {
    throw new BacktestStateError(
      'EVENT_ORDER_VIOLATION',
      'ledger entries must be chronological.',
      { entryId: appended.entryId },
    );
  }

  entries.push(appended);
  return Object.freeze(entries);
}
