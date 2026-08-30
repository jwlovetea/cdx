/**
 * Minimal in-memory stand-in for the `vscode` module.
 *
 * The extension host API is only available inside VS Code, so unit tests alias
 * `vscode` to this module (see `vitest.config.mts`). It implements just enough
 * of `Uri` and `workspace.fs` for the cache and converter layers to run, backed
 * by a map rather than the real file system so tests stay deterministic.
 *
 * This is test scaffolding, not production code: it is excluded from the build.
 */

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64
}

export interface FileStat {
  type: FileType;
  ctime: number;
  mtime: number;
  size: number;
}

export interface Disposable {
  dispose(): void;
}

export class FileSystemError extends Error {
  public constructor(
    public readonly code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = code;
  }

  public static FileNotFound(message?: string): FileSystemError {
    return new FileSystemError('FileNotFound', message);
  }

  public static FileExists(message?: string): FileSystemError {
    return new FileSystemError('FileExists', message);
  }
}

/** A `Uri` faithful enough for path arithmetic and as a map key. */
export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query: string,
    public readonly fragment: string
  ) {}

  public static file(path: string): Uri {
    return new Uri('file', '', path.replaceAll('\\', '/'), '', '');
  }

  public static parse(value: string): Uri {
    const match = /^([^:/?#]+):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value);
    if (!match) {
      return Uri.file(value);
    }

    return new Uri(
      match[1] ?? 'file',
      match[2] ?? '',
      match[3] ?? '',
      match[4] ?? '',
      match[5] ?? ''
    );
  }

  public static joinPath(base: Uri, ...segments: string[]): Uri {
    const joined = [base.path, ...segments]
      .map((segment, index) => (index === 0 ? segment : segment.replace(/^\/+/, '')))
      .join('/')
      .replaceAll('//', '/');

    return base.with({ path: joined });
  }

  public get fsPath(): string {
    return this.path;
  }

  public with(change: {
    scheme?: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment
    );
  }

  public toString(): string {
    const authority = this.authority ? `//${this.authority}` : '///';
    return `${this.scheme}:${authority}${this.path}`;
  }
}

type Entry =
  | { readonly kind: 'file'; content: Uint8Array; mtime: number }
  | { readonly kind: 'directory'; mtime: number };

const entries = new Map<string, Entry>();

/** Empties the in-memory file system. Call between tests. */
export function resetFileSystem(): void {
  entries.clear();
}

/** Test helper: creates a file with fixed metadata. */
export function seedFile(path: string, content = '', mtime = 1_000): void {
  entries.set(path, {
    kind: 'file',
    content: new TextEncoder().encode(content),
    mtime
  });
}

export function listPaths(): string[] {
  return [...entries.keys()].sort();
}

function normalise(uri: Uri): string {
  return uri.fsPath.replaceAll('//', '/').replace(/\/$/, '');
}

function toFileStat(entry: Entry): FileStat {
  return {
    type: entry.kind === 'file' ? FileType.File : FileType.Directory,
    ctime: entry.mtime,
    mtime: entry.mtime,
    size: entry.kind === 'file' ? entry.content.byteLength : 0
  };
}

export const workspace = {
  fs: {
    async stat(uri: Uri): Promise<FileStat> {
      const entry = entries.get(normalise(uri));
      if (!entry) {
        throw FileSystemError.FileNotFound(uri.fsPath);
      }

      return toFileStat(entry);
    },

    async createDirectory(uri: Uri): Promise<void> {
      const path = normalise(uri);
      if (!entries.has(path)) {
        entries.set(path, { kind: 'directory', mtime: Date.now() });
      }
    },

    async delete(uri: Uri, options?: { recursive?: boolean }): Promise<void> {
      const path = normalise(uri);
      const entry = entries.get(path);
      if (!entry) {
        throw FileSystemError.FileNotFound(uri.fsPath);
      }

      if (entry.kind === 'directory' && options?.recursive !== true) {
        throw new FileSystemError('FileIsADirectory', uri.fsPath);
      }

      if (options?.recursive === true) {
        for (const key of [...entries.keys()]) {
          if (key === path || key.startsWith(`${path}/`)) {
            entries.delete(key);
          }
        }
        return;
      }

      entries.delete(path);
    },

    async rename(source: Uri, target: Uri, options?: { overwrite?: boolean }): Promise<void> {
      const from = normalise(source);
      const to = normalise(target);
      const entry = entries.get(from);
      if (!entry) {
        throw FileSystemError.FileNotFound(source.fsPath);
      }

      if (entries.has(to) && options?.overwrite !== true) {
        throw FileSystemError.FileExists(target.fsPath);
      }

      entries.delete(from);
      entries.set(to, entry);
    },

    async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
      entries.set(normalise(uri), { kind: 'file', content, mtime: Date.now() });
    }
  }
};
