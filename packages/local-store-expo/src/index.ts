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
  openDatabaseSync: (
    databaseName: string,
    options?: { readonly finalizeUnusedStatementsBeforeClosing?: boolean },
  ) => ExpoDatabase;
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
    // Closing finalizes every statement on the connection by default, including the ones FTS5
    // owns. FTS5 then finalizes them again while disconnecting, which crashed on JS reload.
    // The sync calls used here finalize their own statements, so nothing is left to clean up.
    return adaptExpo(loaded.openDatabaseSync(databaseName, { finalizeUnusedStatementsBeforeClosing: false }));
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

function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value instanceof Uint8Array) {
    return `${value.constructor.name}(${String(value.byteLength)})`;
  }
  return typeof value;
}

/**
 * Native SQLite errors do not say which statement failed. This adds the statement and the
 * types of its parameters, never their values, because parameters can hold note text.
 */
function withStatement<T>(sql: string, params: readonly SqlValue[], run: () => T): T {
  try {
    return run();
  } catch (error) {
    const statement = sql.replace(/\s+/g, ' ').trim().slice(0, 80);
    const types = params.map(describeValue).join(', ');
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`SQLite failed on "${statement}" with [${types}]: ${message}`, { cause: error });
  }
}

/**
 * expo-sqlite cannot bind a zero-length Uint8Array: the native call fails to downcast it.
 * Empty blobs are written into the statement as `zeroblob(0)` instead of passed as parameters.
 */
export function inlineEmptyBlobs(
  sql: string,
  params: readonly SqlValue[],
): { readonly sql: string; readonly params: SqlValue[] } {
  if (!params.some((value) => value instanceof Uint8Array && value.byteLength === 0)) {
    return { sql, params: [...params] };
  }
  let index = 0;
  let quote: string | null = null;
  let statement = '';
  const kept: SqlValue[] = [];
  for (const char of sql) {
    if (quote !== null) {
      statement += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      statement += char;
      continue;
    }
    if (char === '?') {
      const value = params[index];
      index += 1;
      if (value instanceof Uint8Array && value.byteLength === 0) {
        statement += 'zeroblob(0)';
        continue;
      }
      if (value !== undefined) {
        kept.push(value);
      }
    }
    statement += char;
  }
  return { sql: statement, params: kept };
}

function adaptExpo(db: ExpoDatabase): SqliteDriver {
  return {
    exec(sql: string): void {
      withStatement(sql, [], () => {
        db.execSync(sql);
      });
    },
    run(sql: string, params: readonly SqlValue[] = []): void {
      const bound = inlineEmptyBlobs(sql, params);
      withStatement(sql, params, () => db.runSync(bound.sql, bound.params));
    },
    all(sql: string, params: readonly SqlValue[] = []): SqlRow[] {
      const bound = inlineEmptyBlobs(sql, params);
      return withStatement(sql, params, () => db.getAllSync(bound.sql, bound.params).map(asSqlRow));
    },
    get(sql: string, params: readonly SqlValue[] = []): SqlRow | undefined {
      const bound = inlineEmptyBlobs(sql, params);
      const row = withStatement(sql, params, () => db.getFirstSync(bound.sql, bound.params));
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
