import {
  createSqliteLocalStore,
  createStatementDriver,
  type LocalStore,
  type LocalStoreOptions,
  type SqliteDriver,
  type SqlRow,
  type SqlValue,
} from '@jot/local-store';

export type ExpoLocalStoreOptions = LocalStoreOptions & {
  readonly databaseName?: string;
  readonly driver?: SqliteDriver;
};

type ExpoDatabase = {
  execSync(source: string): void;
  runSync(source: string, params?: unknown[]): unknown;
  getAllSync(source: string, params?: unknown[]): unknown[];
  getFirstSync(source: string, params?: unknown[]): unknown;
  withTransactionSync(task: () => void): void;
  closeSync(): void;
};

type ExpoSqliteModule = {
  openDatabaseSync: (databaseName: string) => ExpoDatabase;
};

/**
 * Thin expo-sqlite wrapper over the shared LocalStore SQL.
 * TypeScript in React never issues SQL; every statement lives in @jot/local-store.
 */
export function createExpoLocalStore(options: ExpoLocalStoreOptions = {}): LocalStore {
  if (options.driver !== undefined) {
    return createSqliteLocalStore(options.driver, options);
  }
  const expo = tryExpoDriver(options.databaseName ?? 'jot.sqlite');
  if (expo !== null) {
    return createSqliteLocalStore(expo, options);
  }
  return createSqliteLocalStore(openBunFallbackDriver(), options);
}

function tryExpoDriver(databaseName: string): SqliteDriver | null {
  try {
    const loaded = loadExpoSqlite();
    if (loaded === null) {
      return null;
    }
    return adaptExpo(loaded.openDatabaseSync(databaseName));
  } catch {
    return null;
  }
}

function openBunFallbackDriver(): SqliteDriver {
  const loaded = loadBunSqliteModule();
  if (loaded === null) {
    throw new Error('expo-sqlite is unavailable and bun:sqlite cannot be loaded');
  }
  return createStatementDriver(new loaded.Database(':memory:'));
}

function loadBunSqliteModule(): { Database: new (filename: string) => BunDatabase } | null {
  const specifier = ['bun', 'sqlite'].join(':');
  const getter = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
    ?.getBuiltinModule;
  if (typeof getter === 'function') {
    const mod = getter(specifier) as { Database: new (filename: string) => BunDatabase } | undefined;
    if (mod !== undefined && typeof mod.Database === 'function') {
      return mod;
    }
  }
  const meta = import.meta as ImportMeta & {
    require?: (id: string) => { Database: new (filename: string) => BunDatabase };
  };
  if (typeof meta.require === 'function') {
    return meta.require(specifier);
  }
  return null;
}

type BunDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: SqlValue[]): unknown;
    all(...params: SqlValue[]): SqlRow[];
    get(...params: SqlValue[]): SqlRow | null | undefined;
  };
  transaction<T>(fn: () => T): () => T;
  close(): void;
};

/**
 * Metro hands every module a CommonJS `require` and collects this literal specifier as a
 * bundle dependency, so this is the only loader that works under Hermes on iOS and Android.
 * `import.meta.require` is a Bun API; Hermes does not define it.
 */
declare const require: ((id: string) => unknown) | undefined;

function asExpoSqlite(value: unknown): ExpoSqliteModule | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const candidate = value as { openDatabaseSync?: unknown };
  return typeof candidate.openDatabaseSync === 'function' ? (value as ExpoSqliteModule) : null;
}

function loadExpoSqlite(): ExpoSqliteModule | null {
  if (typeof require === 'function') {
    try {
      return asExpoSqlite(require('expo-sqlite'));
    } catch {
      // Not a Metro bundle, or expo-sqlite is not installed for this platform.
    }
  }
  const meta = import.meta as ImportMeta & {
    require?: (id: string) => unknown;
  };
  if (typeof meta.require !== 'function') {
    return null;
  }
  try {
    return asExpoSqlite(meta.require('expo-sqlite'));
  } catch {
    return null;
  }
}

function adaptExpo(db: ExpoDatabase): SqliteDriver {
  return {
    exec(sql: string): void {
      db.execSync(sql);
    },
    run(sql: string, params: readonly SqlValue[] = []): void {
      db.runSync(sql, [...params]);
    },
    all(sql: string, params: readonly SqlValue[] = []): SqlRow[] {
      return db.getAllSync(sql, [...params]).map(asSqlRow);
    },
    get(sql: string, params: readonly SqlValue[] = []): SqlRow | undefined {
      const row = db.getFirstSync(sql, [...params]);
      if (row === null || row === undefined) {
        return undefined;
      }
      return asSqlRow(row);
    },
    transaction<T>(fn: () => T): T {
      let value!: T;
      db.withTransactionSync(() => {
        value = fn();
      });
      return value;
    },
    close(): void {
      db.closeSync();
    },
  };
}

function asSqlRow(value: unknown): SqlRow {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected sqlite row object');
  }
  return value as SqlRow;
}
