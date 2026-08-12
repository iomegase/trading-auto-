import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

describe('risk decimal isolation', () => {
  it('pins division and modulo semantics at module initialization', async () => {
    const previous = {
      precision: Decimal.precision,
      rounding: Decimal.rounding,
      toExpNeg: Decimal.toExpNeg,
      toExpPos: Decimal.toExpPos,
      minE: Decimal.minE,
      maxE: Decimal.maxE,
      modulo: Decimal.modulo,
      crypto: Decimal.crypto,
    };

    try {
      Decimal.set({
        rounding: Decimal.ROUND_DOWN,
        modulo: Decimal.ROUND_FLOOR,
      });
      vi.resetModules();
      const { riskDecimalFrom } = await import('./decimal.js');

      expect(riskDecimalFrom('1').div(6).toString().at(-1)).toBe('7');
      expect(riskDecimalFrom('-5').mod(3).toString()).toBe('-2');
    } finally {
      Decimal.set(previous);
      vi.resetModules();
    }
  });
});
