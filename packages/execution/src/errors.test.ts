import { describe, expect, it } from 'vitest';

import { ExecutionInputError } from './index.js';

describe('ExecutionInputError', () => {
  it('copies and deeply freezes stable error details', () => {
    const details = { field: 'bar', nested: { value: 'before' } };
    const error = new ExecutionInputError(
      'INVALID_EXECUTION_INPUT',
      'Invalid execution input.',
      details,
    );

    details.nested.value = 'after';

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ExecutionInputError);
    expect(error).toMatchObject({
      name: 'ExecutionInputError',
      code: 'INVALID_EXECUTION_INPUT',
      details: { field: 'bar', nested: { value: 'before' } },
    });
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(Object.isFrozen(error.details?.nested)).toBe(true);
  });

  it('clones cyclic details without recursion failure', () => {
    const details: Record<string, unknown> = { field: 'position' };
    details.self = details;

    const error = new ExecutionInputError(
      'INVALID_EXECUTION_STATE',
      'Invalid execution state.',
      details,
    );

    expect(error.details?.self).toBe(error.details);
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it('turns an unreadable detail object into a stable marker', () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    const error = new ExecutionInputError(
      'INVALID_DATA',
      'Unreadable details.',
      revoked.proxy,
    );

    expect(error.details).toEqual({ value: '[unreadable]' });
  });

  it('bounds retained detail collections', () => {
    const error = new ExecutionInputError(
      'INVALID_EXECUTION_INPUT',
      'Oversized details.',
      { values: new Array(1025).fill('x') },
    );

    expect(error.details).toEqual({ values: '[truncated]' });
  });

  it('stabilizes unsupported, deep, and hostile nested details', () => {
    const oversizedObject = Object.fromEntries(
      Array.from({ length: 1025 }, (_value, index) => [
        `k${String(index)}`,
        index,
      ]),
    );
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 18; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    const revokedArray = Proxy.revocable([], {});
    revokedArray.revoke();

    const error = new ExecutionInputError('INVALID_DATA', 'Hostile details.', {
      bigint: 1n,
      date: new Date(0),
      oversizedObject,
      deep,
      revokedArray: revokedArray.proxy,
    });

    expect(error.details).toMatchObject({
      bigint: '[unsupported]',
      date: '[unsupported]',
      oversizedObject: '[truncated]',
      revokedArray: '[unreadable]',
    });
    let cloned: unknown = error.details?.deep;
    for (let index = 0; index < 18 && typeof cloned === 'object'; index += 1) {
      cloned = (cloned as { readonly next: unknown }).next;
    }
    expect(cloned).toBe('[truncated]');
  });

  it('stabilizes hostile array length, elements, and object descriptors', () => {
    const hostileLength = new Proxy([], {
      get: (_target, property) => {
        if (property === 'length') throw new Error('unreadable length');
        return undefined;
      },
    });
    const hostileElement = new Proxy(['x'], {
      getOwnPropertyDescriptor: (_target, property) => {
        if (property === '0') throw new Error('unreadable item');
        return Reflect.getOwnPropertyDescriptor(['x'], property);
      },
    });
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, '0', {
      enumerable: true,
      get: () => 'not read',
    });
    Object.defineProperty(accessorArray, 'length', { value: 1 });

    let descriptorReads = 0;
    const hostileObject = new Proxy(
      { value: 'x' },
      {
        getOwnPropertyDescriptor: (target, property) => {
          descriptorReads += 1;
          if (descriptorReads > 1) throw new Error('changed descriptor');
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      },
    );

    const error = new ExecutionInputError('INVALID_DATA', 'Hostile details.', {
      hostileLength,
      hostileElement,
      accessorArray,
      hostileObject,
    });
    expect(error.details).toEqual({
      hostileLength: '[unreadable]',
      hostileElement: ['[unreadable]'],
      accessorArray: ['[unreadable]'],
      hostileObject: { value: '[unreadable]' },
    });
  });

  it('stabilizes an object whose prototype cannot be inspected', () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error('prototype trap');
        },
      },
    );
    expect(
      new ExecutionInputError('INVALID_DATA', 'Hostile details.', {
        hostile,
      }).details,
    ).toEqual({ hostile: '[unreadable]' });
  });

  it('handles absent details and both dense and sparse detail arrays', () => {
    expect(new ExecutionInputError('INVALID_DATA', 'No details.').details).toBe(
      undefined,
    );
    const sparse = new Array(1);
    const error = new ExecutionInputError('INVALID_DATA', 'Arrays.', {
      dense: [1],
      sparse,
    });
    expect(error.details?.dense).toEqual([1]);
    expect(error.details?.sparse).toHaveLength(1);
    expect(Object.hasOwn(error.details?.sparse as object, '0')).toBe(false);
  });
});
