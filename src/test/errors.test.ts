import { describe, expect, it } from 'vitest';
import {
  CdxError,
  formatError,
  isCancellation,
  isDuckDbInterrupt,
  OperationCancelledError
} from '../errors';

describe('isCancellation', () => {
  it('recognises cancellations', () => {
    expect(isCancellation(new OperationCancelledError())).toBe(true);
  });

  it('does not treat other errors as cancellations', () => {
    expect(isCancellation(new CdxError('nope'))).toBe(false);
    expect(isCancellation(new Error('nope'))).toBe(false);
    expect(isCancellation(undefined)).toBe(false);
  });
});

describe('isDuckDbInterrupt', () => {
  it('matches DuckDB interrupt messages', () => {
    expect(isDuckDbInterrupt(new Error('Query was interrupted'))).toBe(true);
    expect(isDuckDbInterrupt(new Error('INTERRUPT: query cancelled'))).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isDuckDbInterrupt(new Error('read_stat exploded'))).toBe(false);
    expect(isDuckDbInterrupt(new CdxError('CDX could not load'))).toBe(false);
    expect(isDuckDbInterrupt('interrupt')).toBe(false);
    expect(isDuckDbInterrupt(undefined)).toBe(false);
  });
});

describe('formatError', () => {
  it('shows a CdxError verbatim when it is already prefixed', () => {
    expect(formatError(new CdxError('CDX: cannot do that'))).toBe('CDX: cannot do that');
  });

  it('prefixes a CdxError that is missing the prefix', () => {
    expect(formatError(new CdxError('cannot do that'))).toBe('CDX: cannot do that');
  });

  it('shows only the first line of an unexpected error', () => {
    expect(formatError(new Error('boom\nsecond line'))).toBe('CDX: Operation failed. boom');
  });

  it('avoids a trailing space when an unexpected error has an empty message', () => {
    expect(formatError(new Error(''))).toBe('CDX: Operation failed.');
  });

  it('falls back for non-error values', () => {
    expect(formatError('a string')).toBe('CDX: Operation failed.');
    expect(formatError(undefined)).toBe('CDX: Operation failed.');
    expect(formatError('a string', 'Custom.')).toBe('Custom.');
  });

  it('never leaks a cancellation as a failure message', () => {
    expect(isCancellation(new OperationCancelledError())).toBe(true);
  });
});