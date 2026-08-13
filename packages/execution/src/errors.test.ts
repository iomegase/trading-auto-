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
});
