import * as path from 'node:path';

export type ClinicalDatasetFormat = 'sas7bdat' | 'xpt';

export function detectClinicalDatasetFormat(filePath: string): ClinicalDatasetFormat | undefined {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.sas7bdat') {
    return 'sas7bdat';
  }

  if (extension === '.xpt') {
    return 'xpt';
  }

  return undefined;
}

export function requireClinicalDatasetFormat(filePath: string): ClinicalDatasetFormat {
  const format = detectClinicalDatasetFormat(filePath);

  if (!format) {
    throw new Error('CDX supports only .sas7bdat and .xpt files.');
  }

  return format;
}

export function duckdbStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
