import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The real `@duckdb/node-api` binds a native library, so it is replaced with a
 * fake. That keeps these tests fast and free of a working DuckDB install.
 */
const { state, FakeInstance } = vi.hoisted(() => {
  class FakeConnection {
    public readonly statements: string[] = [];
    public interrupts = 0;
    public closed = false;
    public installed = false;
    public failInstall = false;
    public failLoad = false;

    public async run(sql: string): Promise<void> {
      this.statements.push(sql);

      if (sql.includes('INSTALL')) {
        if (this.failInstall) {
          throw new Error('HTTP Error: Unable to download extension');
        }
        this.installed = true;
      }

      if (sql.startsWith('LOAD') && this.failLoad) {
        throw new Error('Extension not found');
      }
    }

    public async runAndReadAll(sql: string): Promise<{ getRowObjects(): object[] }> {
      this.statements.push(sql);
      return { getRowObjects: () => [{ installed: this.installed }] };
    }

    public interrupt(): void {
      this.interrupts += 1;
    }

    public closeSync(): void {
      this.closed = true;
    }
  }

  class FakeInstance {
    public readonly connection = new FakeConnection();
    public closed = false;

    public async connect(): Promise<FakeConnection> {
      return this.connection;
    }

    public closeSync(): void {
      this.closed = true;
    }
  }

  return {
    state: {
      instances: [] as FakeInstance[],
      opens: 0,
      failNextOpen: false,
      startInstalled: false,
      failInstall: false,
      failLoad: false
    },
    FakeInstance
  };
});

vi.mock('@duckdb/node-api', () => ({
  DuckDBInstance: {
    create: async (): Promise<unknown> => {
      state.opens += 1;

      if (state.failNextOpen) {
        state.failNextOpen = false;
        throw new Error('open failed');
      }

      const instance = new FakeInstance();
      instance.connection.installed = state.startInstalled;
      instance.connection.failInstall = state.failInstall;
      instance.connection.failLoad = state.failLoad;
      state.instances.push(instance);

      return instance;
    }
  }
}));

import { DuckDbService } from '../duckdb';

interface FakeToken {
  token: vscode.CancellationToken;
  cancel(): void;
  listenerCount(): number;
}

function createFakeToken(): FakeToken {
  const listeners = new Set<() => void>();

  return {
    token: {
      isCancellationRequested: false,
      onCancellationRequested: (listener: () => void) => {
        listeners.add(listener);
        return {
          dispose: () => {
            listeners.delete(listener);
          }
        };
      }
    } as unknown as vscode.CancellationToken,
    cancel: () => {
      for (const listener of listeners) {
        listener();
      }
    },
    listenerCount: () => listeners.size
  };
}

function latestInstance(): InstanceType<typeof FakeInstance> {
  const instance = state.instances.at(-1);
  if (!instance) {
    throw new Error('No DuckDB instance was created');
  }

  return instance;
}

describe('DuckDbService', () => {
  beforeEach(() => {
    state.instances.length = 0;
    state.opens = 0;
    state.failNextOpen = false;
    state.startInstalled = false;
    state.failInstall = false;
    state.failLoad = false;
  });

  describe('getSession', () => {
    it('opens a single session and reuses it', async () => {
      const service = new DuckDbService();
      const first = await service.getSession();
      const second = await service.getSession();

      expect(second).toBe(first);
      expect(state.opens).toBe(1);
    });

    it('shares one open between concurrent callers', async () => {
      const service = new DuckDbService();
      const [first, second] = await Promise.all([service.getSession(), service.getSession()]);

      expect(second).toBe(first);
      expect(state.opens).toBe(1);
    });

    it('installs read_stat when it is missing', async () => {
      await new DuckDbService().getSession();
      const { statements } = latestInstance().connection;

      expect(statements.some((sql) => sql.includes('INSTALL read_stat FROM community'))).toBe(
        true
      );
      expect(statements.some((sql) => sql === 'LOAD read_stat')).toBe(true);
    });

    it('skips the network install when read_stat is already present', async () => {
      state.startInstalled = true;

      await new DuckDbService().getSession();
      const { statements } = latestInstance().connection;

      expect(statements.some((sql) => sql.includes('INSTALL'))).toBe(false);
      expect(statements.some((sql) => sql === 'LOAD read_stat')).toBe(true);
    });

    it('surfaces a friendly error when read_stat cannot be downloaded', async () => {
      state.failInstall = true;

      await expect(new DuckDbService().getSession()).rejects.toThrow(
        /could not load DuckDB’s read_stat extension.*network access/s
      );
    });

    it('surfaces a friendly error when read_stat cannot be loaded', async () => {
      state.failLoad = true;

      await expect(new DuckDbService().getSession()).rejects.toThrow(
        /could not load DuckDB’s read_stat extension/s
      );
    });

    it('does not memoise a failed open', async () => {
      const service = new DuckDbService();
      state.failNextOpen = true;

      await expect(service.getSession()).rejects.toThrow('open failed');
      await expect(service.getSession()).resolves.toBeDefined();

      expect(state.opens).toBe(2);
    });

    it('closes the instance when opening it fails partway through', async () => {
      const service = new DuckDbService();
      vi.spyOn(FakeInstance.prototype, 'connect').mockRejectedValueOnce(new Error('no connect'));

      await expect(service.getSession()).rejects.toThrow('no connect');
      expect(latestInstance().closed).toBe(true);
    });
  });

  describe('invalidate', () => {
    it('closes the session so the next call opens a fresh one', async () => {
      const service = new DuckDbService();
      const first = await service.getSession();

      service.invalidate();
      await vi.waitFor(() => {
        expect(latestInstance().closed).toBe(true);
      });

      const second = await service.getSession();

      expect(second).not.toBe(first);
      expect(state.opens).toBe(2);
    });

    it('is safe when no session was ever opened', () => {
      expect(() => new DuckDbService().invalidate()).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('closes both the connection and the instance', async () => {
      const service = new DuckDbService();
      await service.getSession();

      await service.dispose();

      expect(latestInstance().connection.closed).toBe(true);
      expect(latestInstance().closed).toBe(true);
    });

    it('is safe to call twice', async () => {
      const service = new DuckDbService();
      await service.getSession();

      await service.dispose();
      await expect(service.dispose()).resolves.toBeUndefined();
    });

    it('is safe when no session was ever opened', async () => {
      await expect(new DuckDbService().dispose()).resolves.toBeUndefined();
    });
  });

  describe('interrupt', () => {
    it('interrupts the running statement', async () => {
      const service = new DuckDbService();
      await service.getSession();

      service.interrupt();

      expect(latestInstance().connection.interrupts).toBe(1);
    });

    it('does not leave a sticky interrupt flag on a live session', async () => {
      const service = new DuckDbService();
      await service.getSession();
      service.interrupt();
      expect(latestInstance().connection.interrupts).toBe(1);

      // Re-reading the same session must not apply a leftover pending interrupt.
      await service.getSession();
      expect(latestInstance().connection.interrupts).toBe(1);

      service.interrupt();
      expect(latestInstance().connection.interrupts).toBe(2);
    });

    it('applies as soon as the session opens when cancelled before it exists', async () => {
      // Opening DuckDB can itself be slow, so a cancel can arrive before there
      // is a connection to interrupt. It must not be dropped.
      const service = new DuckDbService();
      service.interrupt();

      await service.getSession();

      expect(latestInstance().connection.interrupts).toBe(1);
    });

    it('is safe when no session was ever opened', () => {
      expect(() => new DuckDbService().interrupt()).not.toThrow();
    });
  });

  describe('observeCancellation', () => {
    it('interrupts when the token is cancelled', async () => {
      const service = new DuckDbService();
      await service.getSession();

      const fake = createFakeToken();
      service.observeCancellation(fake.token);
      fake.cancel();

      expect(latestInstance().connection.interrupts).toBe(1);
    });

    it('detaches the listener once disposed', async () => {
      const service = new DuckDbService();
      await service.getSession();

      const fake = createFakeToken();
      const subscription = service.observeCancellation(fake.token);
      subscription.dispose();
      fake.cancel();

      expect(fake.listenerCount()).toBe(0);
      expect(latestInstance().connection.interrupts).toBe(0);
    });

    it('does not carry a previous cancellation into the next conversion', async () => {
      const service = new DuckDbService();

      const first = createFakeToken();
      service.observeCancellation(first.token).dispose();
      first.cancel();

      // A new conversion starts: the earlier cancellation must not leak in.
      service.observeCancellation(createFakeToken().token);
      await service.getSession();

      expect(latestInstance().connection.interrupts).toBe(0);
    });
  });
});
