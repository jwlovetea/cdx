import * as vscode from 'vscode';
import { createCacheFileName, createCacheKey } from './cacheUtils';

export async function getCachedParquetUri(context: vscode.ExtensionContext, sourceUri: vscode.Uri): Promise<vscode.Uri> {
  const stat = await vscode.workspace.fs.stat(sourceUri);
  const cacheKey = createCacheKey({
    sourcePath: sourceUri.fsPath,
    modifiedTime: stat.mtime,
    size: stat.size
  });
  const cacheDir = vscode.Uri.joinPath(context.globalStorageUri, 'parquet');
  await vscode.workspace.fs.createDirectory(cacheDir);
  return vscode.Uri.joinPath(cacheDir, createCacheFileName(sourceUri.fsPath, cacheKey));
}
