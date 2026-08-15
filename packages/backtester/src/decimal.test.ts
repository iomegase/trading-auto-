import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

describe('backtester decimal primitives', () => {
  it('accepts bounded canonical signed decimals', async () => {
    const { asBacktestDecimal } = await import('./decimal.js');

    expect(asBacktestDecimal('0', 'amount')).toBe('0');
    expect(asBacktestDecimal('-12.50', 'amount')).toBe('-12.50');
    expect(asBacktestDecimal('9'.repeat(256), 'amount')).toBe('9'.repeat(256));
    expect(asBacktestDecimal(`0.${'1'.repeat(128)}`, 'amount')).toBe(
      `0.${'1'.repeat(128)}`,
    );
  });

  it.each([
    '1e3',
    '+1',
    '01',
    '.1',
    '1.',
    '-0',
    '-0.0',
    '9'.repeat(257),
    `0.${'1'.repeat(129)}`,
  ])('rejects noncanonical or oversized decimal %s', async (value) => {
    const { asBacktestDecimal } = await import('./decimal.js');
    const { BacktestInputError } = await import('./errors.js');

    expect(() => asBacktestDecimal(value, 'amount')).toThrow(
      BacktestInputError,
    );
    expect(() => asBacktestDecimal(value, 'amount')).toThrow(/amount/);
  });

  it.each([undefined, null, 1, Number.NaN, {}, []])(
    'rejects non-string decimal input %#',
    async (value) => {
      const { asBacktestDecimal } = await import('./decimal.js');
      const { BacktestInputError } = await import('./errors.js');

      expect(() => asBacktestDecimal(value, 'amount')).toThrow(
        BacktestInputError,
      );
    },
  );

  it('enforces nonnegative and positive domains', async () => {
    const { asBacktestNonnegativeDecimal, asBacktestPositiveDecimal } =
      await import('./decimal.js');

    expect(asBacktestNonnegativeDecimal('0', 'margin')).toBe('0');
    expect(asBacktestNonnegativeDecimal('12.50', 'margin')).toBe('12.50');
    expect(asBacktestPositiveDecimal('0.0001', 'quantity')).toBe('0.0001');
    expect(() => asBacktestNonnegativeDecimal('-0.1', 'margin')).toThrow(
      /margin/,
    );
    expect(() => asBacktestPositiveDecimal('0', 'quantity')).toThrow(
      /quantity/,
    );
  });

  it('adds and compares decimals without binary floating-point loss', async () => {
    const { decimalCompare, decimalSum } = await import('./decimal.js');

    expect(decimalSum(['0.1', '0.2'])).toBe('0.3');
    expect(decimalSum(['1000', '-2.40', '1.15'])).toBe('998.75');
    expect(decimalSum(['1', '-1'])).toBe('0');
    expect(decimalCompare('1.000', '1')).toBe(0);
    expect(decimalCompare('-1', '0')).toBe(-1);
    expect(decimalCompare('2', '1.999')).toBe(1);
  });

  it('rejects an aggregate result outside the bounded decimal domain', async () => {
    const { decimalSum } = await import('./decimal.js');
    const { BacktestInputError } = await import('./errors.js');

    expect(() => decimalSum(['9'.repeat(256), '1'])).toThrow(
      BacktestInputError,
    );
    expect(() => decimalSum(['9'.repeat(256), '1'])).toThrow(
      /bounded canonical decimal/,
    );
  });

  it('is isolated from mutable global Decimal configuration', async () => {
    const previous = {
      precision: Decimal.precision,
      rounding: Decimal.rounding,
      toExpNeg: Decimal.toExpNeg,
      toExpPos: Decimal.toExpPos,
      maxE: Decimal.maxE,
      minE: Decimal.minE,
      modulo: Decimal.modulo,
      crypto: Decimal.crypto,
    };

    try {
      Decimal.set({ maxE: 2, minE: -2, precision: 1 });
      const { asBacktestDecimal, decimalSum } = await import('./decimal.js');

      expect(asBacktestDecimal('1000', 'amount')).toBe('1000');
      expect(decimalSum(['1000', '0.25'])).toBe('1000.25');
    } finally {
      Decimal.set(previous);
    }
  });
});
