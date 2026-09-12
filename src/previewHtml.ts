import { randomBytes } from 'node:crypto';
import type * as vscode from 'vscode';

/** Creates a single-use token for the webview content security policy. */
export function createNonce(): string {
  return randomBytes(16).toString('hex');
}

/** What the custom editor should show while the dataset is prepared. */
export type PreviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly message?: string }
  | { readonly kind: 'error'; readonly message: string };

const IDLE_MESSAGE =
  'Convert this dataset with DuckDB read_stat and open the cached Parquet result.';
const LOADING_MESSAGE = 'Converting with DuckDB read_stat...';

/**
 * Renders the custom-editor placeholder.
 *
 * The nonce is generated here rather than passed in so the value embedded in
 * the script tag can never drift from the one in the content security policy.
 *
 * The host sets `loading` as soon as the editor opens so a conversion in
 * flight never leaves a blank webview, and `error` when conversion fails so
 * the button can be used again instead of looking stuck.
 */
export function renderPreviewHtml(
  webview: vscode.Webview,
  state: PreviewState = { kind: 'idle' }
): string {
  const nonce = createNonce();
  const statusMessage = statusFor(state);
  const buttonDisabled = state.kind === 'loading';
  const buttonLabel = state.kind === 'error' ? 'Try Again' : 'Open Dataset';
  const showButton = state.kind !== 'loading';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    body {
      align-items: center;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      display: flex;
      font-family: var(--vscode-font-family);
      height: 100vh;
      justify-content: center;
      margin: 0;
    }
    main {
      display: grid;
      gap: 12px;
      justify-items: center;
      max-width: 480px;
      padding: 24px;
      text-align: center;
    }
    button {
      background: var(--vscode-button-background);
      border: 0;
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font: inherit;
      padding: 8px 12px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button:disabled {
      cursor: default;
      opacity: 0.6;
    }
    .error {
      color: var(--vscode-errorForeground);
      white-space: pre-wrap;
    }
    .loading {
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <main>
    <h1>Clinical Data Explorer</h1>
    <p id="status"${state.kind === 'error' ? ' class="error"' : state.kind === 'loading' ? ' class="loading"' : ''}>${escapeHtml(statusMessage)}</p>
    ${showButton ? `<button id="open"${buttonDisabled ? ' disabled' : ''}>${buttonLabel}</button>` : ''}
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const button = document.getElementById('open');
    const status = document.getElementById('status');
    if (button) {
      button.addEventListener('click', () => {
        button.disabled = true;
        status.classList.remove('error');
        status.classList.add('loading');
        status.textContent = ${JSON.stringify(LOADING_MESSAGE)};
        vscode.postMessage({ command: 'open' });
      });
    }
  </script>
</body>
</html>`;
}

function statusFor(state: PreviewState): string {
  if (state.kind === 'loading') {
    return state.message ?? LOADING_MESSAGE;
  }

  if (state.kind === 'error') {
    return state.message;
  }

  return IDLE_MESSAGE;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
