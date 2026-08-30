import { describe, expect, it } from 'vitest';
import { createCacheFileName, createCacheKey, sanitizeBaseName } from '../cacheUtils';

const SOURCE = {
  sourcePath: '/study/adam/adsl.sas7bdat',
  modifiedTime: 123,
  size: 456
};

describe('createCacheKey', () => {
  it('creates stable keys for unchanged source metadata', () => {
    expect(createCacheKey(SOURCE)).toBe(createCacheKey(SOURCE));
  });

  it('changes keys when file metadata changes', () => {
    expect(createCacheKey(SOURCE)).not.toBe(
      createCacheKey({ ...SOURCE, modifiedTime: 124 })
    );
    expect(createCacheKey(SOURCE)).not.toBe(createCacheKey({ ...SOURCE, size: 457 }));
  });

  it('changes keys when the source path changes', () => {
    expect(createCacheKey(SOURCE)).not.toBe(
      createCacheKey({ ...SOURCE, sourcePath: '/study/adam/ae.sas7bdat' })
    );
  });

  it('does not let field boundaries be shifted between fields', () => {
    // Without a separator, ("a", 1, 23) and ("a1", 2, 3) would hash identically.
    const first = createCacheKey({ sourcePath: 'a', modifiedTime: 1, size: 23 });
    const second = createCacheKey({ sourcePath: 'a1', modifiedTime: 2, size: 3 });

    expect(first).not.toBe(second);
  });

  it('produces a hex sha256 digest', () => {
    expect(createCacheKey(SOURCE)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('createCacheFileName', () => {
  it('sanitises the base name and appends a hash prefix', () => {
    expect(createCacheFileName('/study/adam/ad sl.sas7bdat', '0123456789abcdef0123')).toBe(
      'ad_sl-0123456789abcdef.parquet'
    );
  });

  it('keeps the total length inside the usual 255 byte component limit', () => {
    const longName = `${'a'.repeat(500)}.sas7bdat`;
    const fileName = createCacheFileName(`/study/${longName}`, 'f'.repeat(64));

    expect(fileName.length).toBeLessThanOrEqual(255);
  });
});

describe('sanitizeBaseName', () => {
  it('strips the extension', () => {
    expect(sanitizeBaseName('/study/adsl.sas7bdat')).toBe('adsl');
    expect(sanitizeBaseName('/study/adsl.xpt')).toBe('adsl');
  });

  it('replaces characters that are unsafe on common file systems', () => {
    expect(sanitizeBaseName('/study/ad sl.xpt')).toBe('ad_sl');
    expect(sanitizeBaseName('/study/a:b*c?.xpt')).toBe('a_b_c_');
    expect(sanitizeBaseName('/study/ad sl\\rel.xpt')).toBe('ad_sl_rel');
  });

  it('strips leading dots and dashes', () => {
    expect(sanitizeBaseName('/study/...hidden.xpt')).toBe('hidden');
    expect(sanitizeBaseName('/study/--flag.xpt')).toBe('flag');
  });

  it('strips trailing dots and dashes', () => {
    expect(sanitizeBaseName('/study/name..xpt')).toBe('name');
    expect(sanitizeBaseName('/study/name-.xpt')).toBe('name');
  });

  it('falls back when the name sanitises down to nothing', () => {
    expect(sanitizeBaseName('/study/...xpt')).toBe('dataset');
    expect(sanitizeBaseName('/study/---.xpt')).toBe('dataset');
  });

  it('falls back for names reserved on Windows', () => {
    expect(sanitizeBaseName('/study/CON.xpt')).toBe('dataset');
    expect(sanitizeBaseName('/study/nul.sas7bdat')).toBe('dataset');
    expect(sanitizeBaseName('/study/com1.xpt')).toBe('dataset');
  });

  it('does not reject names that merely start with a reserved one', () => {
    expect(sanitizeBaseName('/study/control.xpt')).toBe('control');
  });

  it('keeps dots in the middle of a name', () => {
    expect(sanitizeBaseName('/study/adsl.v2.xpt')).toBe('adsl.v2');
  });
});
