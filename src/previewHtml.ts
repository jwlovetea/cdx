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
 * The host always starts in `loading` and closes the tab on success, so the
 * idle "Open Dataset" state is only a fallback. `error` keeps the file open
 * with a retry button instead of a blank webview.
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
    .spinner {
      animation: cdx-spin 0.9s linear infinite;
      border: 2px solid var(--vscode-widget-border, rgba(127, 127, 127, 0.35));
      border-radius: 50%;
      border-top-color: var(--vscode-progressBar-background, #0e70c0);
      display: ${state.kind === 'loading' ? 'block' : 'none'};
      height: 22px;
      margin-bottom: 4px;
      width: 22px;
    }
    @keyframes cdx-spin {
      to {
        transform: rotate(360deg);
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>Clinical Data Explorer</h1>
    <div class="spinner" aria-hidden="true"></div>
    <p id="status"${state.kind === 'error' ? ' class="error"' : state.kind === 'loading' ? ' class="loading"' : ''}>${escapeHtml(statusMessage)}</p>
    ${showButton ? `<button id="open"${buttonDisabled ? ' disabled' : ''}>${buttonLabel}</button>` : ''}
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const button = document.getElementById('open');
    const status = document.getElementById('status');
    const spinner = document.querySelector('.spinner');
    if (button) {
      button.addEventListener('click', () => {
        button.disabled = true;
        status.classList.remove('error');
        status.classList.add('loading');
        status.textContent = ${JSON.stringify(LOADING_MESSAGE)};
        if (spinner) {
          spinner.style.display = 'block';
        }
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
