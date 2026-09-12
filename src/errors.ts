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
 * Type guard for DuckDB's interrupt-after-cancel error.
 *
 * `connection.interrupt()` rejects the running statement with a generic
 * engine message, not {@link OperationCancelledError}. Call sites that already
 * own a cancellation token use this to reclassify the failure as a cancel.
 */
export function isDuckDbInterrupt(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /interrupt/i.test(error.message);
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

function firstLine(message: string): string {
  return message.split('\n', 1)[0]?.trim() ?? '';
}
