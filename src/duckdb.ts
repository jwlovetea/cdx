import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import type * as vscode from 'vscode';
import { duckdbStringLiteral } from './duckdbSql';

const READ_STAT_EXTENSION = 'read_stat';

/** An open DuckDB database together with the connection used to query it. */
export interface DuckDbSession {
  readonly instance: DuckDBInstance;
  readonly connection: DuckDBConnection;
}

/**
 * Owns a lazily created DuckDB database that has the `read_stat` community
 * extension loaded.
 *
 * Starting DuckDB and installing its extension costs hundreds of milliseconds,
 * so the database is created once per extension activation and reused for every
 * conversion instead of being rebuilt per file.
 */
export class DuckDbService {
  #session: Promise<DuckDbSession> | undefined;

  /**
   * The session once it is open, so {@link interrupt} can act synchronously.
   *
   * Interrupt has to be immediate: by the time a deferred callback ran, the
   * statement being cancelled could already have finished.
   */
  #live: DuckDbSession | undefined;

  /**
   * Set when a cancellation arrives before the session exists.
   *
   * Opening the database is itself slow (it can download `read_stat`), so a
   * cancel can land while there is no connection yet. The flag defers the
   * interrupt until the session is ready instead of dropping it.
   */
  #interruptRequested = false;

  /**
   * Returns the shared session, opening it on first use.
   *
   * The promise is cached rather than its result so that concurrent callers
   * share a single open instead of each starting their own database.
   */
  public getSession(): Promise<DuckDbSession> {
    this.#session ??= this.#openSession().then(
      (session) => {
        this.#live = session;

        if (this.#interruptRequested) {
          session.connection.interrupt();
        }

        return session;
      },
      (error: unknown) => {
        // Do not memoise a failure: the next call should try again.
        this.#session = undefined;
        throw error;
      }
    );

    return this.#session;
  }

  /**
   * Discards the current session so the next call opens a fresh database.
   *
   * Used after a query failure, which can leave DuckDB in an unusable state.
   */
  public invalidate(): void {
    const session = this.#session;
    this.#session = undefined;
    this.#live = undefined;
    void this.#close(session);
  }

  /**
   * Cancels the query currently running on the shared session, if any.
   *
   * DuckDB runs a whole `COPY` as one statement, so cancelling mid-conversion
   * is only possible by interrupting it. Nothing needs to be awaited: the
   * interrupted statement rejects on its own, which is what the caller is
   * already awaiting.
   */
  public interrupt(): void {
    // Recorded even when a session is live, so a caller that interrupts before
    // the first conversion is still cancelled if the session is rebuilt.
    this.#interruptRequested = true;

    // No connection yet: {@link getSession} applies the interrupt on open.
    this.#live?.connection.interrupt();
  }

  /**
   * Interrupts the running query when `token` is cancelled.
   *
   * The returned disposable detaches the listener; callers must dispose it once
   * the statement has settled, otherwise the listener outlives the query.
   */
  public observeCancellation(token: vscode.CancellationToken): vscode.Disposable {
    // Reset per conversion so a cancelled run does not leak into the next one.
    this.#interruptRequested = false;

    const listener = token.onCancellationRequested(() => {
      this.interrupt();
    });

    return {
      dispose: () => {
        listener.dispose();
      }
    };
  }

  /** Closes the database. Safe to call more than once. */
  public async dispose(): Promise<void> {
    const session = this.#session;
    this.#session = undefined;
    this.#live = undefined;
    await this.#close(session);
  }

  async #openSession(): Promise<DuckDbSession> {
    const instance = await DuckDBInstance.create(':memory:');

    try {
      const connection = await instance.connect();
      await loadReadStat(connection);
      return { instance, connection };
    } catch (error) {
      instance.closeSync();
      throw error;
    }
  }

  async #close(session: Promise<DuckDbSession> | undefined): Promise<void> {
    if (!session) {
      return;
    }

    try {
      const { instance, connection } = await session;
      connection.closeSync();
      instance.closeSync();
    } catch {
      // The session never opened, or opening it already failed and discarded
      // the instance. Either way there is nothing left to close.
    }
  }
}

async function loadReadStat(connection: DuckDBConnection): Promise<void> {
  if (!(await isReadStatInstalled(connection))) {
    await connection.run(`INSTALL ${READ_STAT_EXTENSION} FROM community`);
  }

  await connection.run(`LOAD ${READ_STAT_EXTENSION}`);
}

/**
 * Checks whether `read_stat` is already present in the extension directory.
 *
 * `INSTALL` is skipped when it is, which avoids touching the network on every
 * conversion. An unexpected query failure falls back to installing, which is
 * idempotent.
 */
async function isReadStatInstalled(connection: DuckDBConnection): Promise<boolean> {
  try {
    const reader = await connection.runAndReadAll(
      `SELECT installed FROM duckdb_extensions() WHERE extension_name = ${duckdbStringLiteral(READ_STAT_EXTENSION)}`
    );

    return reader.getRowObjects().some((row) => row['installed'] === true);
  } catch {
    return false;
  }
}
