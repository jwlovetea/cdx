import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import { createNonce, renderPreviewHtml } from '../previewHtml';

function createWebview(): vscode.Webview {
  return { cspSource: 'vscode-webview://abc123' } as unknown as vscode.Webview;
}

describe('createNonce', () => {
  it('produces a hex string', () => {
    expect(createNonce()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces a different value each time', () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});

describe('renderPreviewHtml', () => {
  it('ties the content security policy to the nonce on the script tag', () => {
    const html = renderPreviewHtml(createWebview());

    const cspNonce = /script-src 'nonce-([0-9a-f]+)'/.exec(html)?.[1];
    const scriptNonce = /<script nonce="([0-9a-f]+)">/.exec(html)?.[1];

    expect(cspNonce).toBeDefined();
    expect(scriptNonce).toBeDefined();
    expect(scriptNonce).toBe(cspNonce);
  });

  it('uses a fresh nonce on every render', () => {
    const first = /<script nonce="([0-9a-f]+)">/.exec(renderPreviewHtml(createWebview()))?.[1];
    const second = /<script nonce="([0-9a-f]+)">/.exec(renderPreviewHtml(createWebview()))?.[1];

    expect(first).not.toBe(second);
  });

  it('does not allow loading remote resources', () => {
    const html = renderPreviewHtml(createWebview());

    expect(html).toContain("default-src 'none'");
  });

  it('posts the open command back to the extension', () => {
    expect(renderPreviewHtml(createWebview())).toContain("postMessage({ command: 'open' })");
  });

  it('shows a loading message and hides the button while converting', () => {
    const html = renderPreviewHtml(createWebview(), {
      kind: 'loading',
      message: 'Preparing clinical dataset...'
    });

    expect(html).toContain('Preparing clinical dataset...');
    expect(html).not.toContain('id="open"');
  });

  it('shows a retryable error message when conversion fails', () => {
    const html = renderPreviewHtml(createWebview(), {
      kind: 'error',
      message: 'CDX: conversion <failed>'
    });

    expect(html).toContain('CDX: conversion &lt;failed&gt;');
    expect(html).toContain('Try Again');
    expect(html).toContain('id="open"');
  });
});
