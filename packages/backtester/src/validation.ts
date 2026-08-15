import { BacktestInputError } from './errors.js';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

const MAX_RECORD_KEYS = 256;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 1024;
const MAX_JSON_ARRAY_ITEMS = 10_000;

interface JsonCloneState {
  nodes: number;
  readonly active: WeakSet<object>;
}

function invalid(message: string, field: string, value?: unknown): never {
  throw new BacktestInputError('INVALID_BACKTEST_INPUT', message, {
    field,
    value,
  });
}

function limit(message: string, field: string, value?: unknown): never {
  throw new BacktestInputError('BACKTEST_LIMIT_EXCEEDED', message, {
    field,
    value,
  });
}

function plainObjectKeys(value: unknown, field: string): readonly string[] {
  let input: object;
  let isArray: boolean;
  let keys: readonly PropertyKey[];
  let prototype: object | null;

  try {
    if (typeof value !== 'object' || value === null) {
      invalid(`${field} must be a plain object.`, field, value);
    }
    input = value;
    isArray = Array.isArray(input);
    prototype = Object.getPrototypeOf(input) as object | null;
    keys = Reflect.ownKeys(input);
  } catch (error) {
    if (error instanceof BacktestInputError) throw error;
    invalid(`${field} must be a readable plain object.`, field);
  }

  if (isArray || (prototype !== Object.prototype && prototype !== null)) {
    invalid(`${field} must be a plain object.`, field, value);
  }
  if (keys.length > MAX_RECORD_KEYS) {
    limit(
      `${field} exceeds ${String(MAX_RECORD_KEYS)} keys.`,
      field,
      keys.length,
    );
  }

  const stringKeys: string[] = [];
  for (const key of keys) {
    if (typeof key !== 'string') {
      invalid(`${field} must not contain symbol keys.`, field);
    }
    stringKeys.push(key);
  }
  return Object.freeze(stringKeys.sort());
}

function descriptorValue(
  input: object,
  descriptor: PropertyDescriptor,
  field: string,
): unknown {
  if ('value' in descriptor) {
    return (descriptor as { readonly value: unknown }).value;
  }
  const getter = descriptor.get?.bind(input) as (() => unknown) | undefined;
  if (getter === undefined) return undefined;
  try {
    return getter();
  } catch {
    invalid(`${field} must be readable.`, field);
  }
}

function ownEnumerableDescriptor(
  input: object,
  property: string,
  field: string,
): PropertyDescriptor {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, property);
  } catch {
    invalid(`${field} must be readable.`, field);
  }
  if (descriptor === undefined || descriptor.enumerable !== true) {
    invalid(`${field} must be an own enumerable property.`, field);
  }
  return descriptor;
}

export function readRequiredOwn(
  input: Readonly<Record<string, unknown>>,
  property: string,
  field: string,
): unknown {
  const descriptor = ownEnumerableDescriptor(input, property, field);
  return descriptorValue(input, descriptor, field);
}

export function snapshotPlainRecord(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> {
  const keys = plainObjectKeys(value, field);
  const input = value as object;
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;

  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(input, key);
    } catch {
      invalid(`${field}.${key} must be readable.`, `${field}.${key}`);
    }
    if (descriptor === undefined) {
      invalid(
        `${field}.${key} must remain an own property.`,
        `${field}.${key}`,
      );
    }
    if (descriptor.enumerable !== true) continue;
    Object.defineProperty(result, key, {
      configurable: false,
      enumerable: true,
      value: descriptorValue(input, descriptor, `${field}.${key}`),
      writable: false,
    });
  }
  return Object.freeze(result);
}

export function snapshotSelectedOwn(
  value: unknown,
  field: string,
  properties: readonly string[],
): Readonly<Record<string, unknown>> {
  plainObjectKeys(value, field);
  const input = value as Readonly<Record<string, unknown>>;
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;

  for (const property of properties) {
    Object.defineProperty(result, property, {
      configurable: false,
      enumerable: true,
      value: readRequiredOwn(input, property, `${field}.${property}`),
      writable: false,
    });
  }
  return Object.freeze(result);
}

export function snapshotDenseArray(
  value: unknown,
  field: string,
  maximumLength: number,
): readonly unknown[] {
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    invalid(`${field} must be a readable dense array.`, field);
  }
  if (!isArray) invalid(`${field} must be a dense array.`, field, value);
  if (!Number.isSafeInteger(maximumLength) || maximumLength < 0) {
    invalid(
      `${field} maximum length must be a nonnegative safe integer.`,
      field,
    );
  }

  const input = value as object;
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(input, 'length');
  } catch {
    invalid(`${field}.length must be readable.`, `${field}.length`);
  }
  // Every real Array has a non-configurable own data `length`; Proxy invariants
  // force the same descriptor or throw in the guarded call above.
  const length = (lengthDescriptor as { readonly value: number }).value;
  if (length > maximumLength) {
    limit(`${field} exceeds ${String(maximumLength)} items.`, field, length);
  }

  const result: unknown[] = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const itemField = `${field}[${String(index)}]`;
    const descriptor = ownEnumerableDescriptor(input, String(index), itemField);
    result[index] = descriptorValue(input, descriptor, itemField);
  }
  return Object.freeze(result);
}

function cloneJsonArray(
  value: object,
  field: string,
  depth: number,
  state: JsonCloneState,
): readonly JsonValue[] {
  const items = snapshotDenseArray(value, field, MAX_JSON_ARRAY_ITEMS);
  return Object.freeze(
    items.map((item, index) =>
      cloneJsonValue(item, `${field}[${String(index)}]`, depth + 1, state),
    ),
  );
}

function cloneJsonObject(
  value: object,
  field: string,
  depth: number,
  state: JsonCloneState,
): JsonObject {
  const snapshot = snapshotPlainRecord(value, field);
  const result: Record<string, JsonValue> = Object.create(null) as Record<
    string,
    JsonValue
  >;
  for (const key of Object.keys(snapshot)) {
    Object.defineProperty(result, key, {
      configurable: false,
      enumerable: true,
      value: cloneJsonValue(snapshot[key], `${field}.${key}`, depth + 1, state),
      writable: false,
    });
  }
  return Object.freeze(result);
}

function cloneJsonValue(
  value: unknown,
  field: string,
  depth: number,
  state: JsonCloneState,
): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      invalid(`${field} must be a finite JSON number.`, field, value);
    }
    return value;
  }
  if (typeof value !== 'object') {
    invalid(`${field} must be JSON-compatible.`, field, value);
  }
  if (state.active.has(value)) {
    invalid(`${field} must not contain a cycle.`, field);
  }
  if (depth > MAX_JSON_DEPTH) {
    limit(`${field} exceeds the maximum JSON depth.`, field, depth);
  }
  if (state.nodes >= MAX_JSON_NODES) {
    limit(`${field} exceeds the maximum JSON node count.`, field, state.nodes);
  }

  state.nodes += 1;
  state.active.add(value);
  try {
    let isArray: boolean;
    try {
      isArray = Array.isArray(value);
    } catch {
      invalid(`${field} must be readable.`, field);
    }
    return isArray
      ? cloneJsonArray(value, field, depth, state)
      : cloneJsonObject(value, field, depth, state);
  } finally {
    state.active.delete(value);
  }
}

export function snapshotJsonObject(value: unknown, field: string): JsonObject {
  if (typeof value !== 'object' || value === null) {
    invalid(`${field} must be a JSON object.`, field, value);
  }
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    invalid(`${field} must be a readable JSON object.`, field);
  }
  if (isArray) invalid(`${field} must be a JSON object.`, field, value);

  const result = cloneJsonValue(value, field, 0, {
    nodes: 0,
    active: new WeakSet(),
  });
  return result as JsonObject;
}
