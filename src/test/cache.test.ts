import { describe, expect, it } from 'vitest';
import { createCacheFileName, createCacheKey } from '../cacheUtils';

describe('cache utilities', () => {
  it('creates stable keys for unchanged source metadata', () => {
    const input = {
      sourcePath: '/study/adam/adsl.sas7bdat',
      modifiedTime: 123,
      size: 456
    };

    expect(createCacheKey(input)).toBe(createCacheKey(input));
  });

  it('changes keys when file metadata changes', () => {
    const first = createCacheKey({
      sourcePath: '/study/adam/adsl.sas7bdat',
      modifiedTime: 123,
      size: 456
    });
    const second = createCacheKey({
      sourcePath: '/study/adam/adsl.sas7bdat',
      modifiedTime: 124,
      size: 456
    });

    expect(first).not.toBe(second);
  });

  it('creates safe parquet file names', () => {
    const fileName = createCacheFileName('/study/adam/ad sl.sas7bdat', '0123456789abcdef0123');

    expect(fileName).toBe('ad_sl-0123456789abcdef.parquet');
  });
});
