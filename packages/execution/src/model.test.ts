import { describe, expect, it } from 'vitest';

import {
  createExecutionModel,
  ExecutionInputError,
  type ExecutionModelInput,
} from './index.js';

const baseline: ExecutionModelInput = {
  version: 'BAR_BASED_H1_V1',
  signalModel: 'SIGNAL_ON_CLOSE',
  entryFillModel: 'NEXT_BAR_OPEN',
  trendExitFillModel: 'NEXT_TRADABLE_PRICE',
  intrabarConflictPolicy: 'STOP_FIRST',
  partialFillPolicy: 'FULL_FILL_OR_REJECT',
};

function expectInvalid(action: () => unknown, field: string): void {
  let received: unknown;

  try {
    action();
  } catch (error) {
    received = error;
  }

  expect(received).toBeInstanceOf(ExecutionInputError);
  expect(received).toMatchObject({
    code: 'INVALID_EXECUTION_INPUT',
    details: { field },
  });
}

describe('createExecutionModel', () => {
  it('creates the exact immutable BAR_BASED_H1_V1 model', () => {
    const model = createExecutionModel(baseline);

    expect(model).toEqual(baseline);
    expect(Object.isFrozen(model)).toBe(true);
  });

  it.each([
    ['version', 'BAR_BASED_H1_V2'],
    ['signalModel', 'SIGNAL_INTRABAR'],
    ['entryFillModel', 'SIGNAL_CLOSE'],
    ['trendExitFillModel', 'SAME_CLOSE'],
    ['intrabarConflictPolicy', 'TARGET_FIRST'],
    ['partialFillPolicy', 'ALLOW_PARTIAL'],
  ] as const)('rejects unsupported %s value %s', (field, value) => {
    expectInvalid(
      () => createExecutionModel({ ...baseline, [field]: value }),
      field,
    );
  });

  it('requires every field to be supplied as an own property', () => {
    Object.defineProperty(Object.prototype, 'version', {
      configurable: true,
      value: baseline.version,
    });

    try {
      const missingOwnVersion: Partial<ExecutionModelInput> = { ...baseline };
      Reflect.deleteProperty(missingOwnVersion, 'version');
      expectInvalid(
        () =>
          createExecutionModel(
            missingOwnVersion as unknown as ExecutionModelInput,
          ),
        'version',
      );
    } finally {
      Reflect.deleteProperty(Object.prototype, 'version');
    }
  });

  it('reads every own accessor exactly once', () => {
    const reads: Record<string, number> = {};
    const input: Record<string, unknown> = {};

    for (const field of Object.keys(baseline) as Array<
      keyof ExecutionModelInput
    >) {
      const value = baseline[field];
      Object.defineProperty(input, field, {
        enumerable: true,
        get: () => {
          reads[field] = (reads[field] ?? 0) + 1;
          return reads[field] === 1 ? value : 'CHANGED';
        },
      });
    }

    expect(
      createExecutionModel(input as unknown as ExecutionModelInput),
    ).toEqual(baseline);
    expect(reads).toEqual(
      Object.fromEntries(Object.keys(baseline).map((field) => [field, 1])),
    );
  });

  it('converts a revoked Proxy into a stable execution error', () => {
    const revoked = Proxy.revocable(baseline, {});
    revoked.revoke();

    expectInvalid(() => createExecutionModel(revoked.proxy), 'input');
  });

  it('rejects primitive, array, and custom-prototype inputs', () => {
    for (const value of [null, [], new Date(0)]) {
      expectInvalid(
        () => createExecutionModel(value as unknown as ExecutionModelInput),
        'input',
      );
    }
  });

  it('maps hostile field descriptors and accessors to typed errors', () => {
    const descriptorTrap = new Proxy(baseline, {
      getOwnPropertyDescriptor: () => {
        throw new Error('descriptor trap');
      },
    });
    expectInvalid(() => createExecutionModel(descriptorTrap), 'version');

    for (const descriptor of [
      { enumerable: true, set: () => undefined },
      {
        enumerable: true,
        get: () => {
          throw new Error('getter trap');
        },
      },
    ]) {
      const input = { ...baseline } as Record<string, unknown>;
      Object.defineProperty(input, 'version', descriptor);
      expectInvalid(
        () => createExecutionModel(input as unknown as ExecutionModelInput),
        'version',
      );
    }
  });
});
