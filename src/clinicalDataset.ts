import { extname } from 'node:path';
import { CdxError } from './errors';

/** Clinical dataset formats CDX knows how to read. */
export type ClinicalDatasetFormat = 'sas7bdat' | 'xpt';

const FORMAT_BY_EXTENSION: Readonly<Record<string, ClinicalDatasetFormat>> = {
  '.sas7bdat': 'sas7bdat',
  '.xpt': 'xpt'
};

/** Detects the dataset format from a file path, ignoring extension case. */
export function detectClinicalDatasetFormat(filePath: string): ClinicalDatasetFormat | undefined {
  return FORMAT_BY_EXTENSION[extname(filePath).toLowerCase()];
}

/**
 * Detects the dataset format, throwing a user-facing error for unsupported
 * files.
 *
 * @throws {CdxError} if the extension is not a supported clinical dataset.
 */
export function requireClinicalDatasetFormat(filePath: string): ClinicalDatasetFormat {
  const format = detectClinicalDatasetFormat(filePath);

  if (!format) {
    throw new CdxError('CDX supports only .sas7bdat and .xpt files.');
  }

  return format;
}
