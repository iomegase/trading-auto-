import { ExecutionInputError } from './errors.js';

export interface ExecutionModelInput {
  version: string;
  signalModel: string;
  entryFillModel: string;
  trendExitFillModel: string;
  intrabarConflictPolicy: string;
  partialFillPolicy: string;
}

export interface ExecutionModel {
  readonly version: 'BAR_BASED_H1_V1';
  readonly signalModel: 'SIGNAL_ON_CLOSE';
  readonly entryFillModel: 'NEXT_BAR_OPEN';
  readonly trendExitFillModel: 'NEXT_TRADABLE_PRICE';
  readonly intrabarConflictPolicy: 'STOP_FIRST';
  readonly partialFillPolicy: 'FULL_FILL_OR_REJECT';
}

type ModelField = keyof ExecutionModelInput;

const expected: Readonly<ExecutionModel> = Object.freeze({
  version: 'BAR_BASED_H1_V1',
  signalModel: 'SIGNAL_ON_CLOSE',
  entryFillModel: 'NEXT_BAR_OPEN',
  trendExitFillModel: 'NEXT_TRADABLE_PRICE',
  intrabarConflictPolicy: 'STOP_FIRST',
  partialFillPolicy: 'FULL_FILL_OR_REJECT',
});

const fields: readonly ModelField[] = Object.freeze([
  'version',
  'signalModel',
  'entryFillModel',
  'trendExitFillModel',
  'intrabarConflictPolicy',
  'partialFillPolicy',
]);

function invalid(field: string, value?: unknown): never {
  throw new ExecutionInputError(
    'INVALID_EXECUTION_INPUT',
    `${field} does not match BAR_BASED_H1_V1.`,
    { field, value },
  );
}

function assertRecord(value: unknown): asserts value is object {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      invalid('input');
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      invalid('input');
    }
  } catch {
    invalid('input');
  }
}

function ownValue(input: object, field: ModelField): unknown {
  let descriptor: PropertyDescriptor | undefined;

  try {
    descriptor = Object.getOwnPropertyDescriptor(input, field);
  } catch {
    invalid(field);
  }

  if (descriptor === undefined) invalid(field);
  if ('value' in descriptor) return descriptor.value;
  if (descriptor.get === undefined) return undefined;

  try {
    return descriptor.get.call(input);
  } catch {
    invalid(field);
  }
}

export function createExecutionModel(
  input: ExecutionModelInput,
): Readonly<ExecutionModel> {
  assertRecord(input);
  const values = Object.create(null) as Record<ModelField, unknown>;

  for (const field of fields) {
    values[field] = ownValue(input, field);
    if (values[field] !== expected[field]) invalid(field, values[field]);
  }

  return Object.freeze({ ...expected });
}
