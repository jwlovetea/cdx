import { CdxError } from './errors';

/**
 * Characters that cannot appear inside a SQL string literal.
 *
 * DuckDB follows the SQL standard: a literal is terminated by a single quote and
 * a quote inside the literal is doubled. That escaping is sufficient for quotes,
 * but control characters would either corrupt the statement or let a value span
 * multiple lines, so they are rejected outright.
 */
const FORBIDDEN_LITERAL_CHARACTERS = /[\p{Cc}]/u;

/**
 * Quotes `value` as a SQL string literal, including the surrounding quotes.
 *
 * Paths are interpolated into `COPY` statements, which cannot be parameterised
 * in DuckDB, so careful quoting is the only available defence.
 *
 * @throws {CdxError} if `value` contains control characters.
 */
export function duckdbStringLiteral(value: string): string {
  if (FORBIDDEN_LITERAL_CHARACTERS.test(value)) {
    throw new CdxError(
      'CDX cannot build a query for a path containing control characters.'
    );
  }

  return `'${value.replaceAll("'", "''")}'`;
}

/** Quotes an identifier such as an extension or column name. */
export function duckdbIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
