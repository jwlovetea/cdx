import { describe, expect, it } from 'vitest';
import {
  detectClinicalDatasetFormat,
  duckdbStringLiteral,
  requireClinicalDatasetFormat
} from '../clinicalDataset';

describe('clinical dataset utilities', () => {
  it('detects supported formats case-insensitively', () => {
    expect(detectClinicalDatasetFormat('/tmp/adsl.sas7bdat')).toBe('sas7bdat');
    expect(detectClinicalDatasetFormat('/tmp/ae.XPT')).toBe('xpt');
  });

  it('rejects unsupported formats', () => {
    expect(detectClinicalDatasetFormat('/tmp/adsl.csv')).toBeUndefined();
    expect(() => requireClinicalDatasetFormat('/tmp/adsl.csv')).toThrow(/supports only/);
  });

  it('escapes DuckDB string literals', () => {
    expect(duckdbStringLiteral("/tmp/it's.xpt")).toBe("'/tmp/it''s.xpt'");
  });
});
