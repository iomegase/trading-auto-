import { describe, expect, it } from 'vitest';

import { BacktestInputError } from './errors.js';

function expectInputError(
  operation: () => unknown,
  code:
    | 'INVALID_BACKTEST_INPUT'
    | 'BACKTEST_LIMIT_EXCEEDED' = 'INVALID_BACKTEST_INPUT',
): void {
  try {
    operation();
    throw new Error('Expected BacktestInputError.');
  } catch (error) {
    expect(error).toBeInstanceOf(BacktestInputError);
    expect(error).toMatchObject({ code });
  }
}

describe('record snapshots', () => {
  it('captures each own enumerable getter exactly once', async () => {
    const { readRequiredOwn, snapshotPlainRecord } =
      await import('./validation.js');
    let reads = 0;
    const input = {
      get field() {
        reads += 1;
        return 'captured';
      },
    };

    const snapshot = snapshotPlainRecord(input, 'input');

    expect(readRequiredOwn(snapshot, 'field', 'input.field')).toBe('captured');
    expect(reads).toBe(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('uses descriptor values instead of a divergent Proxy get trap', async () => {
    const { readRequiredOwn, snapshotPlainRecord } =
      await import('./validation.js');
    let directGets = 0;
    const input = new Proxy(
      { field: 'descriptor' },
      {
        get() {
          directGets += 1;
          return 'trap';
        },
      },
    );

    const snapshot = snapshotPlainRecord(input, 'input');

    expect(readRequiredOwn(snapshot, 'field', 'input.field')).toBe(
      'descriptor',
    );
    expect(directGets).toBe(0);
  });

  it('rejects inherited and non-enumerable required properties', async () => {
    const { readRequiredOwn } = await import('./validation.js');
    const inherited = Object.create({ field: 'inherited' }) as Record<
      string,
      unknown
    >;
    const hidden = Object.defineProperty({}, 'field', {
      enumerable: false,
      value: 'hidden',
    });

    expectInputError(() => readRequiredOwn(inherited, 'field', 'input.field'));
    expectInputError(() => readRequiredOwn(hidden, 'field', 'input.field'));
  });

  it('maps revoked proxies, descriptor traps, and throwing getters', async () => {
    const { readRequiredOwn, snapshotPlainRecord } =
      await import('./validation.js');
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const descriptorTrap = new Proxy(
      { field: 'value' },
      {
        getOwnPropertyDescriptor() {
          throw new Error('hostile descriptor');
        },
      },
    );
    const getterTrap = Object.defineProperty({}, 'field', {
      enumerable: true,
      get() {
        throw new Error('hostile getter');
      },
    });

    expectInputError(() => snapshotPlainRecord(revoked.proxy, 'input'));
    expectInputError(() =>
      readRequiredOwn(descriptorTrap, 'field', 'input.field'),
    );
    expectInputError(() => readRequiredOwn(getterTrap, 'field', 'input.field'));
  });

  it('handles setter-only fields and snapshots keys bytewise', async () => {
    const { readRequiredOwn, snapshotPlainRecord } =
      await import('./validation.js');
    const input = Object.defineProperty({ z: 1, a: 2 }, 'setterOnly', {
      enumerable: true,
      set(value: unknown) {
        void value;
      },
    });

    const snapshot = snapshotPlainRecord(input, 'input');

    expect(Object.keys(snapshot)).toEqual(['a', 'setterOnly', 'z']);
    expect(readRequiredOwn(snapshot, 'setterOnly', 'input.setterOnly')).toBe(
      undefined,
    );
  });

  it('maps disappearing and unreadable snapshot descriptors', async () => {
    const { snapshotPlainRecord } = await import('./validation.js');
    const disappearing = new Proxy(
      Object.defineProperty({}, 'field', {
        configurable: true,
        enumerable: true,
        value: 'value',
      }),
      {
        getOwnPropertyDescriptor() {
          return undefined;
        },
      },
    );
    const unreadable = new Proxy(
      { field: 'value' },
      {
        getOwnPropertyDescriptor() {
          throw new Error('unreadable');
        },
      },
    );

    expectInputError(() => snapshotPlainRecord(disappearing, 'input'));
    expectInputError(() => snapshotPlainRecord(unreadable, 'input'));
  });

  it('omits non-enumerable snapshot fields', async () => {
    const { snapshotPlainRecord } = await import('./validation.js');
    const input = Object.defineProperty({ visible: true }, 'hidden', {
      enumerable: false,
      value: true,
    });

    expect(snapshotPlainRecord(input, 'input')).toEqual({ visible: true });
  });

  it('rejects non-plain inputs and oversized records', async () => {
    const { snapshotPlainRecord } = await import('./validation.js');
    class Unsupported {
      readonly value = true;
    }
    const oversized = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [String(index), index]),
    );

    for (const input of [null, [], new Date(), new Unsupported()]) {
      expectInputError(() => snapshotPlainRecord(input, 'input'));
    }
    expectInputError(
      () => snapshotPlainRecord(oversized, 'input'),
      'BACKTEST_LIMIT_EXCEEDED',
    );
  });
});

describe('dense array snapshots', () => {
  it('captures a dense array and each accessor exactly once', async () => {
    const { snapshotDenseArray } = await import('./validation.js');
    let reads = 0;
    const input: unknown[] = ['first'];
    Object.defineProperty(input, '1', {
      enumerable: true,
      get() {
        reads += 1;
        return 'second';
      },
    });

    const snapshot = snapshotDenseArray(input, 'events', 2);

    expect(snapshot).toEqual(['first', 'second']);
    expect(reads).toBe(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('rejects sparse arrays and malformed array values', async () => {
    const { snapshotDenseArray } = await import('./validation.js');
    const sparse = new Array<unknown>(2);
    sparse[1] = 'present';

    expectInputError(() => snapshotDenseArray(sparse, 'events', 2));
    expectInputError(() => snapshotDenseArray({}, 'events', 2));
  });

  it('checks the collection limit before probing an index', async () => {
    const { snapshotDenseArray } = await import('./validation.js');
    let indexProbes = 0;
    const input = new Proxy(['a', 'b', 'c'], {
      getOwnPropertyDescriptor(target, property) {
        if (property !== 'length') indexProbes += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    expectInputError(
      () => snapshotDenseArray(input, 'events', 2),
      'BACKTEST_LIMIT_EXCEEDED',
    );
    expect(indexProbes).toBe(0);
  });

  it('maps unreadable length and item descriptors to typed errors', async () => {
    const { snapshotDenseArray } = await import('./validation.js');
    const lengthTrap = new Proxy([], {
      getOwnPropertyDescriptor(target, property) {
        if (property === 'length') throw new Error('length');
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const itemTrap = new Proxy(['value'], {
      getOwnPropertyDescriptor(target, property) {
        if (property === '0') throw new Error('item');
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    expectInputError(() => snapshotDenseArray(lengthTrap, 'events', 1));
    expectInputError(() => snapshotDenseArray(itemTrap, 'events', 1));
  });

  it('maps a revoked array and rejects an invalid configured limit', async () => {
    const { snapshotDenseArray } = await import('./validation.js');
    const revoked = Proxy.revocable([], {});
    revoked.revoke();

    expectInputError(() => snapshotDenseArray(revoked.proxy, 'events', 1));
    expectInputError(() => snapshotDenseArray([], 'events', -1));
  });
});

describe('JSON object snapshots', () => {
  it('detaches and deeply freezes JSON-compatible values', async () => {
    const { snapshotJsonObject } = await import('./validation.js');
    const input = {
      enabled: true,
      nested: { value: 'before' },
      items: [1, null, 'value'],
    };

    const snapshot = snapshotJsonObject(input, 'payload');
    input.nested.value = 'after';
    input.items[0] = 2;

    expect(snapshot).toEqual({
      enabled: true,
      nested: { value: 'before' },
      items: [1, null, 'value'],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.nested)).toBe(true);
    expect(Object.isFrozen(snapshot.items)).toBe(true);
  });

  it('preserves reserved keys without prototype pollution', async () => {
    const { snapshotJsonObject } = await import('./validation.js');
    const input = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(input, '__proto__', {
      enumerable: true,
      value: { polluted: true },
    });

    const snapshot = snapshotJsonObject(input, 'payload');

    expect(Object.getPrototypeOf(snapshot)).toBeNull();
    expect(Object.hasOwn(snapshot, '__proto__')).toBe(true);
    expect(snapshot.__proto__).toEqual({ polluted: true });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it.each([
    undefined,
    1n,
    Symbol('value'),
    () => undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    new Date(),
  ])('rejects unsupported JSON value %#', async (value) => {
    const { snapshotJsonObject } = await import('./validation.js');

    expectInputError(() => snapshotJsonObject({ value }, 'payload'));
  });

  it('rejects cycles, symbol keys, excessive depth, and collection sizes', async () => {
    const { snapshotJsonObject } = await import('./validation.js');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const symbolKey = { value: 'ok', [Symbol('hidden')]: 'unsupported' };
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let index = 0; index < 17; index += 1) deep = { child: deep };
    const oversizedObject = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [String(index), index]),
    );
    const oversizedArray = Array.from({ length: 10_001 }, () => null);

    expectInputError(() => snapshotJsonObject(cyclic, 'payload'));
    expectInputError(() => snapshotJsonObject(symbolKey, 'payload'));
    expectInputError(
      () => snapshotJsonObject(deep, 'payload'),
      'BACKTEST_LIMIT_EXCEEDED',
    );
    expectInputError(
      () => snapshotJsonObject(oversizedObject, 'payload'),
      'BACKTEST_LIMIT_EXCEEDED',
    );
    expectInputError(
      () => snapshotJsonObject({ oversizedArray }, 'payload'),
      'BACKTEST_LIMIT_EXCEEDED',
    );
  });

  it('captures JSON getters once without using a Proxy get trap', async () => {
    const { snapshotJsonObject } = await import('./validation.js');
    let getterReads = 0;
    let directGets = 0;
    const target = Object.defineProperty({}, 'value', {
      enumerable: true,
      get() {
        getterReads += 1;
        return { nested: true };
      },
    });
    const input = new Proxy(target, {
      get() {
        directGets += 1;
        return 'trap';
      },
    });

    expect(snapshotJsonObject(input, 'payload')).toEqual({
      value: { nested: true },
    });
    expect(getterReads).toBe(1);
    expect(directGets).toBe(0);
  });

  it('enforces the global JSON node cap before unbounded traversal', async () => {
    const { snapshotJsonObject } = await import('./validation.js');
    const nodes = Array.from({ length: 1024 }, () => ({}));

    expectInputError(
      () => snapshotJsonObject({ nodes }, 'payload'),
      'BACKTEST_LIMIT_EXCEEDED',
    );
  });

  it('maps nested revoked proxies and rejects non-object JSON roots', async () => {
    const { snapshotJsonObject } = await import('./validation.js');
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    expectInputError(() => snapshotJsonObject(revoked.proxy, 'payload'));
    expectInputError(() =>
      snapshotJsonObject({ nested: revoked.proxy }, 'payload'),
    );
    expectInputError(() => snapshotJsonObject(null, 'payload'));
    expectInputError(() => snapshotJsonObject([], 'payload'));
  });

  it('rejects an array root before reading any item', async () => {
    const { snapshotJsonObject } = await import('./validation.js');
    let reads = 0;
    const input: unknown[] = [];
    Object.defineProperty(input, '0', {
      enumerable: true,
      get() {
        reads += 1;
        return 'must not be read';
      },
    });

    expectInputError(() => snapshotJsonObject(input, 'payload'));
    expect(reads).toBe(0);
  });
});
