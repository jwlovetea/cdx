import * as vscode from 'vscode';

const CHANNEL_NAME = 'CDX';

let channel: vscode.OutputChannel | undefined;

/**
 * Returns the shared output channel, creating it on first use.
 *
 * Diagnostics go here rather than to notifications: conversion problems are
 * usually invisible from the UI, and an unobtrusive log is the only way to see
 * whether a run hit the cache, wrote a file, or was cancelled.
 */
function getChannel(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel(CHANNEL_NAME);
  return channel;
}

export function logInfo(message: string): void {
  getChannel().appendLine(`${timestamp()} ${message}`);
}

export function logError(message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  getChannel().appendLine(`${timestamp()} ERROR ${message}: ${detail}`);
}

/** Reveals the channel, so failures point the user somewhere useful. */
export function revealLog(): void {
  getChannel().show(true);
}

export function disposeLog(): void {
  channel?.dispose();
  channel = undefined;
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}
