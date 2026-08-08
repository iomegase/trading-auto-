import { describe, expect, it } from 'vitest';

import { asDecimalString, DomainValidationError } from './index.js';

describe('asDecimalString', () => {
  it('preserves a canonical decimal string', () => {
    expect(asDecimalString('101.50')).toBe('101.50');
  });

  it.each([
    '+1',
    '1e3',
    '01',
    '-01',
    '1.',
    'NaN',
    'Infinity',
    '-Infinity',
    '',
    'not-a-number',
  ])('rejects non-canonical decimal text: %s', (value) => {
    expect(() => asDecimalString(value)).toThrow(DomainValidationError);
  });
});
