/**
 * Minimal `vscode` stand-in for headless smoke tests.
 *
 * Registers itself for the `vscode` module id so compiled `out/*.js` can be
 * required outside an extension host. Implements only what the converter and
 * cache layers use: Uri arithmetic and workspace.fs over a temp directory.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

class Uri {
  constructor(scheme, fsPath) {
    this.scheme = scheme;
    this.fsPath = fsPath;
    this.path = fsPath;
  }

  static file(p) {
    return new Uri('file', p);
  }

  static joinPath(base, ...segments) {
    return Uri.file(path.join(base.fsPath, ...segments));
  }

  with(change) {
    return new Uri(change.scheme ?? this.scheme, change.path ?? this.fsPath);
  }

  toString() {
    return `${this.scheme}://${this.fsPath}`;
  }
}

const workspace = {
  fs: {
    async stat(uri) {
      const s = await fs.promises.stat(uri.fsPath);
      return { type: s.isDirectory() ? 2 : 1, ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size };
    },
    async createDirectory(uri) {
      await fs.promises.mkdir(uri.fsPath, { recursive: true });
    },
    async delete(uri) {
      await fs.promises.rm(uri.fsPath, { force: true, recursive: false });
    },
    async rename(a, b) {
      await fs.promises.rename(a.fsPath, b.fsPath);
    },
    async writeFile(uri, content) {
      await fs.promises.writeFile(uri.fsPath, content);
    },
    async readFile(uri) {
      return new Uint8Array(await fs.promises.readFile(uri.fsPath));
    },
    async readDirectory(uri) {
      const names = await fs.promises.readdir(uri.fsPath, { withFileTypes: true });
      return names.map((entry) => [entry.name, entry.isDirectory() ? 2 : 1]);
    }
  }
};

const configValues = { autoOpen: true, cacheMaxMb: 0 };

const vscode = {
  Uri,
  workspace: {
    ...workspace,
    getConfiguration: () => ({
      get: (key, defaultValue) =>
        configValues[key] === undefined ? defaultValue : configValues[key]
    })
  },
  FileType: { File: 1, Directory: 2 }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return vscode;
  }

  return originalLoad.call(this, request, parent, isMain);
};

module.exports = vscode;
