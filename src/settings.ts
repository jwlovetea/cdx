import * as vscode from 'vscode';

const SECTION = 'cdx';

/** `cdx.autoOpen` — convert and open when the custom editor resolves. */
export function isAutoOpenEnabled(): boolean {
  return vscode.workspace.getConfiguration(SECTION).get<boolean>('autoOpen', true);
}

/**
 * `cdx.cacheMaxMb` in bytes; `0` means unlimited.
 *
 * Used as a soft cap: after a successful convert, oldest cache folders are
 * removed until the cache fits.
 */
export function getCacheMaxBytes(): number {
  const mb = vscode.workspace.getConfiguration(SECTION).get<number>('cacheMaxMb', 0);
  if (!Number.isFinite(mb) || mb <= 0) {
    return 0;
  }

  return Math.floor(mb * 1024 * 1024);
}
