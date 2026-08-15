export type BacktestInputErrorCode =
  'INVALID_BACKTEST_INPUT' | 'BACKTEST_LIMIT_EXCEEDED' | 'DUPLICATE_EVENT';

export type BacktestStateErrorCode =
  'INVALID_BACKTEST_STATE' | 'EVENT_ORDER_VIOLATION' | 'UNBALANCED_LEDGER';

const CIRCULAR_DETAIL = '[circular]';
const UNSUPPORTED_DETAIL = '[unsupported]';
const UNREADABLE_DETAIL = '[unreadable]';
const TRUNCATED_DETAIL = '[truncated]';
const MAX_DETAIL_DEPTH = 16;
const MAX_DETAIL_NODES = 1024;
const MAX_DETAIL_OBJECT_KEYS = 256;
const MAX_DETAIL_ARRAY_ITEMS = 10_000;

interface DetailCloneState {
  nodes: number;
  readonly active: WeakSet<object>;
}

function cloneDetailArray(
  input: object,
  depth: number,
  state: DetailCloneState,
): unknown {
  let lengthDescriptor: PropertyDescriptor | undefined;

  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(input, 'length');
  } catch {
    return UNREADABLE_DETAIL;
  }

  // A real Array has a non-configurable own data `length`; Proxy invariants
  // force the same descriptor or throw in the guarded call above.
  const length = (lengthDescriptor as { readonly value: number }).value;
  if (length > MAX_DETAIL_ARRAY_ITEMS) {
    return TRUNCATED_DETAIL;
  }

  const result: unknown[] = new Array(length);
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    } catch {
      result[index] = UNREADABLE_DETAIL;
      continue;
    }
    if (descriptor === undefined) continue;
    result[index] =
      'value' in descriptor
        ? cloneDetailValue(descriptor.value, depth + 1, state)
        : UNREADABLE_DETAIL;
  }
  return Object.freeze(result);
}

function cloneDetailObject(
  input: object,
  depth: number,
  state: DetailCloneState,
): unknown {
  let keys: string[];
  let prototype: object | null;

  try {
    prototype = Object.getPrototypeOf(input) as object | null;
    keys = Object.keys(input);
  } catch {
    return UNREADABLE_DETAIL;
  }

  if (prototype !== Object.prototype && prototype !== null) {
    return UNSUPPORTED_DETAIL;
  }
  if (keys.length > MAX_DETAIL_OBJECT_KEYS) return TRUNCATED_DETAIL;

  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(input, key);
    } catch {
      descriptor = undefined;
    }
    Object.defineProperty(result, key, {
      configurable: false,
      enumerable: true,
      value:
        descriptor !== undefined && 'value' in descriptor
          ? cloneDetailValue(descriptor.value, depth + 1, state)
          : UNREADABLE_DETAIL,
      writable: false,
    });
  }
  return Object.freeze(result);
}

function cloneDetailValue(
  value: unknown,
  depth: number,
  state: DetailCloneState,
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value !== 'object') return UNSUPPORTED_DETAIL;
  if (state.active.has(value)) return CIRCULAR_DETAIL;
  if (depth >= MAX_DETAIL_DEPTH || state.nodes >= MAX_DETAIL_NODES) {
    return TRUNCATED_DETAIL;
  }

  state.nodes += 1;
  state.active.add(value);
  try {
    let isArray: boolean;
    try {
      isArray = Array.isArray(value);
    } catch {
      return UNREADABLE_DETAIL;
    }
    return isArray
      ? cloneDetailArray(value, depth, state)
      : cloneDetailObject(value, depth, state);
  } finally {
    state.active.delete(value);
  }
}

function cloneDetails(
  details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const result = cloneDetailValue(details, 0, {
    nodes: 0,
    active: new WeakSet(),
  });
  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    return result as Readonly<Record<string, unknown>>;
  }
  return Object.freeze({ value: result });
}

abstract class BacktestError<Code extends string> extends Error {
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    readonly code: Code,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    if (details !== undefined) this.details = cloneDetails(details);
  }
}

export class BacktestInputError extends BacktestError<BacktestInputErrorCode> {
  override readonly name = 'BacktestInputError';
}

export class BacktestStateError extends BacktestError<BacktestStateErrorCode> {
  override readonly name = 'BacktestStateError';
}
