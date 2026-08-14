export type ExecutionInputErrorCode =
  | 'INVALID_EXECUTION_INPUT'
  | 'INVALID_EXECUTION_SCHEDULE'
  | 'INVALID_EXECUTION_STATE'
  | 'INVALID_DATA';

const UNSUPPORTED_DETAIL = '[unsupported]';
const UNREADABLE_DETAIL = '[unreadable]';
const TRUNCATED_DETAIL = '[truncated]';
const MAX_DETAIL_DEPTH = 16;
const MAX_DETAIL_NODES = 1024;
const MAX_DETAIL_COLLECTION_LENGTH = 1024;

interface DetailCloneState {
  nodes: number;
  readonly seen: WeakMap<object, unknown>;
}

function cloneDetailArray(
  input: object,
  depth: number,
  state: DetailCloneState,
): unknown {
  let length: unknown;

  try {
    length = (input as { readonly length: unknown }).length;
  } catch {
    return UNREADABLE_DETAIL;
  }

  if (
    !Number.isSafeInteger(length) ||
    (length as number) < 0 ||
    (length as number) > MAX_DETAIL_COLLECTION_LENGTH
  ) {
    return TRUNCATED_DETAIL;
  }

  const clone: unknown[] = new Array(length as number);
  state.seen.set(input, clone);

  for (let index = 0; index < (length as number); index += 1) {
    let descriptor: PropertyDescriptor | undefined;

    try {
      descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    } catch {
      clone[index] = UNREADABLE_DETAIL;
      continue;
    }

    if (descriptor !== undefined) {
      clone[index] =
        'value' in descriptor
          ? cloneDetailValue(descriptor.value, depth + 1, state)
          : UNREADABLE_DETAIL;
    }
  }

  return Object.freeze(clone);
}

function cloneDetailObject(
  input: object,
  depth: number,
  state: DetailCloneState,
): unknown {
  let prototype: object | null;
  let keys: string[];

  try {
    prototype = Object.getPrototypeOf(input) as object | null;
    keys = Object.keys(input);
  } catch {
    return UNREADABLE_DETAIL;
  }

  if (prototype !== Object.prototype && prototype !== null) {
    return UNSUPPORTED_DETAIL;
  }
  if (keys.length > MAX_DETAIL_COLLECTION_LENGTH) {
    return TRUNCATED_DETAIL;
  }

  const clone: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  state.seen.set(input, clone);

  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;

    try {
      descriptor = Object.getOwnPropertyDescriptor(input, key);
    } catch {
      descriptor = undefined;
    }

    Object.defineProperty(clone, key, {
      configurable: false,
      enumerable: true,
      value:
        descriptor !== undefined && 'value' in descriptor
          ? cloneDetailValue(descriptor.value, depth + 1, state)
          : UNREADABLE_DETAIL,
      writable: false,
    });
  }

  return Object.freeze(clone);
}

function cloneDetailValue(
  value: unknown,
  depth: number,
  state: DetailCloneState,
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value;
  }
  if (typeof value !== 'object') return UNSUPPORTED_DETAIL;

  const seen = state.seen.get(value);
  if (seen !== undefined) return seen;
  if (depth >= MAX_DETAIL_DEPTH || state.nodes >= MAX_DETAIL_NODES) {
    return TRUNCATED_DETAIL;
  }
  state.nodes += 1;

  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    return UNREADABLE_DETAIL;
  }

  return isArray
    ? cloneDetailArray(value, depth, state)
    : cloneDetailObject(value, depth, state);
}

function cloneDetails(
  details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const cloned = cloneDetailValue(details, 0, {
    nodes: 0,
    seen: new WeakMap(),
  });

  if (typeof cloned === 'object' && cloned !== null && !Array.isArray(cloned)) {
    return cloned as Readonly<Record<string, unknown>>;
  }
  return Object.freeze({ value: cloned });
}

export class ExecutionInputError extends Error {
  override readonly name = 'ExecutionInputError';
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    readonly code: ExecutionInputErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);

    if (details !== undefined) {
      this.details = cloneDetails(details);
    }
  }
}
