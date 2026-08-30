import { describe, expect, it } from 'vitest';
import { detectClinicalDatasetFormat, requireClinicalDatasetFormat } from '../clinicalDataset';
import { CdxError } from '../errors';

describe('clinical dataset utilities', () => {
  it('detects supported formats case-insensitively', () => {
    expect(detectClinicalDatasetFormat('/tmp/adsl.sas7bdat')).toBe('sas7bdat');
    expect(detectClinicalDatasetFormat('/tmp/ae.XPT')).toBe('xpt');
    expect(detectClinicalDatasetFormat('/tmp/DM.Sas7Bdat')).toBe('sas7bdat');
  });

  it('returns undefined for unsupported extensions', () => {
    expect(detectClinicalDatasetFormat('/tmp/adsl.csv')).toBeUndefined();
    expect(detectClinicalDatasetFormat('/tmp/adsl')).toBeUndefined();
    expect(detectClinicalDatasetFormat('/tmp/adsl.sas7bdat.bak')).toBeUndefined();
  });

  it('rejects unsupported formats with a user-facing error', () => {
    expect(() => requireClinicalDatasetFormat('/tmp/adsl.csv')).toThrow(CdxError);
    expect(() => requireClinicalDatasetFormat('/tmp/adsl.csv')).toThrow(/supports only/);
  });

  it('returns the format for supported files', () => {
    expect(requireClinicalDatasetFormat('/tmp/adsl.sas7bdat')).toBe('sas7bdat');
    expect(requireClinicalDatasetFormat('/tmp/adsl.xpt')).toBe('xpt');
  });
});
