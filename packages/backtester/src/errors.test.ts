import { describe, expect, it } from 'vitest';

describe('backtester errors', () => {
  it('copies and freezes stable error details', async () => {
    const { BacktestInputError } = await import('./index.js');
    const details = { field: 'events', nested: { value: 'before' } };
    const error = new BacktestInputError(
      'INVALID_BACKTEST_INPUT',
      'invalid',
      details,
    );

    details.nested.value = 'after';

    expect(error).toMatchObject({
      name: 'BacktestInputError',
      code: 'INVALID_BACKTEST_INPUT',
      details: { field: 'events', nested: { value: 'before' } },
    });
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it('uses a distinct invariant-failure class', async () => {
    const { BacktestStateError } = await import('./index.js');
    expect(
      new BacktestStateError('UNBALANCED_LEDGER', 'unbalanced'),
    ).toMatchObject({
      name: 'BacktestStateError',
      code: 'UNBALANCED_LEDGER',
    });
  });

  it('never invokes accessors while cloning details', async () => {
    const { BacktestInputError } = await import('./index.js');
    let reads = 0;
    const details = Object.defineProperty({}, 'hostile', {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error('must not run');
      },
    });

    const error = new BacktestInputError(
      'INVALID_BACKTEST_INPUT',
      'invalid',
      details,
    );

    expect(reads).toBe(0);
    expect(error.details).toEqual({ hostile: '[unreadable]' });
  });

  it('replaces circular and unsupported detail values with markers', async () => {
    const { BacktestInputError } = await import('./index.js');
    const details: Record<string, unknown> = {};
    details.self = details;
    details.callable = () => undefined;

    const error = new BacktestInputError(
      'INVALID_BACKTEST_INPUT',
      'invalid',
      details,
    );

    expect(error.details).toEqual({
      callable: '[unsupported]',
      self: '[circular]',
    });
  });

  it('contains unreadable root details instead of leaking a native error', async () => {
    const { BacktestInputError } = await import('./index.js');
    const target = {};
    const proxy = new Proxy(target, {});
    const revocable = Proxy.revocable(proxy, {});
    revocable.revoke();

    expect(
      () =>
        new BacktestInputError(
          'INVALID_BACKTEST_INPUT',
          'invalid',
          revocable.proxy,
        ),
    ).not.toThrow();
    expect(
      new BacktestInputError(
        'INVALID_BACKTEST_INPUT',
        'invalid',
        revocable.proxy,
      ).details,
    ).toEqual({ value: '[unreadable]' });
  });

  it('truncates oversized detail collections deterministically', async () => {
    const { BacktestInputError } = await import('./index.js');
    const details = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [
        `field${String(index)}`,
        index,
      ]),
    );

    expect(
      new BacktestInputError('BACKTEST_LIMIT_EXCEEDED', 'too large', details)
        .details,
    ).toEqual({ value: '[truncated]' });
  });

  it('contains invalid array lengths reported by a Proxy', async () => {
    const { BacktestInputError } = await import('./index.js');
    const hostile = new Proxy([1, 2, 3], {
      getOwnPropertyDescriptor(target, property) {
        if (property === 'length') {
          return {
            configurable: false,
            enumerable: false,
            value: 1.5,
            writable: true,
          };
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    expect(
      () =>
        new BacktestInputError('INVALID_BACKTEST_INPUT', 'invalid', {
          hostile,
        }),
    ).not.toThrow();
    expect(
      new BacktestInputError('INVALID_BACKTEST_INPUT', 'invalid', {
        hostile,
      }).details,
    ).toEqual({ hostile: '[unreadable]' });
  });
});
