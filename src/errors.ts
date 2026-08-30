/**
 * Error types and formatting helpers shared by the extension.
 *
 * This module deliberately does not import `vscode` so it can be unit tested
 * outside of an extension host.
 */

/**
 * An error whose message is written for end users and is therefore safe to
 * surface verbatim in a notification.
 */
export class CdxError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CdxError';
  }
}

/** Raised when the user cancels an in-progress operation. */
export class OperationCancelledError extends CdxError {
  public constructor(message = 'Operation cancelled.') {
    super(message);
    this.name = 'OperationCancelledError';
  }
}

/** Type guard for cancellations, which should never be reported as failures. */
export function isCancellation(error: unknown): boolean {
  return error instanceof OperationCancelledError;
}

/**
 * Renders an unknown thrown value as a single line suitable for a VS Code
 * notification.
 *
 * Only `CdxError` messages are shown verbatim: everything else is collapsed to
 * a generic message so internal stack details and DuckDB internals are not
 * leaked into the UI.
 */
export function formatError(error: unknown, fallback = 'CDX: Operation failed.'): string {
  if (error instanceof CdxError) {
    return error.message.startsWith('CDX') ? error.message : `CDX: ${error.message}`;
  }

  if (error instanceof Error) {
    const reason = firstLine(error.message);
    return reason ? `${fallback} ${reason}` : fallback;
  }

  return fallback;
}

/** Wraps an unknown thrown value as a `CdxError`, preserving the cause. */
export function toCdxError(error: unknown, message = 'Operation failed.'): CdxError {
  if (error instanceof CdxError) {
    return error;
  }

  return new CdxError(message, { cause: error });
}

function firstLine(message: string): string {
  return message.split('\n', 1)[0]?.trim() ?? '';
}
