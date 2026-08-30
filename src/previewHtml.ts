import { randomBytes } from 'node:crypto';
import type * as vscode from 'vscode';

/** Creates a single-use token for the webview content security policy. */
export function createNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Renders the placeholder shown while a dataset is being prepared on the
 * custom editor's second and subsequent openings.
 *
 * The nonce is generated here rather than passed in so the value embedded in
 * the script tag can never drift from the one in the content security policy.
 */
export function renderPreviewHtml(webview: vscode.Webview): string {
  const nonce = createNonce();

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
      max-width: 420px;
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
  </style>
</head>
<body>
  <main>
    <h1>Clinical Data Explorer</h1>
    <p id="status">Convert this dataset with DuckDB read_stat and open the cached Parquet result.</p>
    <button id="open">Open Dataset</button>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const button = document.getElementById('open');
    const status = document.getElementById('status');
    button.addEventListener('click', () => {
      button.disabled = true;
      status.textContent = 'Converting with DuckDB read_stat...';
      vscode.postMessage({ command: 'open' });
    });
  </script>
</body>
</html>`;
}
