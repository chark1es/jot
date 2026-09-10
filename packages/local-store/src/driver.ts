export type SqlValue = string | number | bigint | Uint8Array | null;

export type SqlRow = Readonly<Record<string, SqlValue>>;

/**
 * Minimal SQLite driver. bun:sqlite and expo-sqlite both wrap this.
 * All SQL strings live in this package. Callers never concatenate user text into SQL.
 */
export type SqliteDriver = {
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): void;
  all(sql: string, params?: readonly SqlValue[]): SqlRow[];
  get(sql: string, params?: readonly SqlValue[]): SqlRow | undefined;
  transaction<T>(fn: () => T): T;
  close(): void;
};

export function asString(value: SqlValue | undefined, column: string): string {
  if (value === undefined) {
    throw new Error(`missing column ${column}`);
  }
  if (typeof value !== 'string') {
    throw new Error(`expected string column ${column}`);
  }
  return value;
}

export function asStringOrNull(value: SqlValue | undefined, column: string): string | null {
  if (value === undefined) {
    throw new Error(`missing column ${column}`);
  }
  if (value === null) {
    return null;
  }
  return asString(value, column);
}

export function asNumber(value: SqlValue | undefined, column: string): number {
  if (value === undefined) {
    throw new Error(`missing column ${column}`);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  throw new Error(`expected number column ${column}`);
}

export function asNumberOrNull(value: SqlValue | undefined, column: string): number | null {
  if (value === undefined) {
    throw new Error(`missing column ${column}`);
  }
  if (value === null) {
    return null;
  }
  return asNumber(value, column);
}

export function asBytes(value: SqlValue | undefined, column: string): Uint8Array {
  if (value === undefined) {
    throw new Error(`missing column ${column}`);
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  throw new Error(`expected blob column ${column}`);
}

export function asBytesOrNull(value: SqlValue | undefined, column: string): Uint8Array | null {
  if (value === undefined) {
    throw new Error(`missing column ${column}`);
  }
  if (value === null) {
    return null;
  }
  return asBytes(value, column);
}

export function asBool(value: SqlValue | undefined, column: string): boolean {
  return asNumber(value, column) !== 0;
}

export function createStatementDriver(db: {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: SqlValue[]): unknown;
    all(...params: SqlValue[]): SqlRow[];
    get(...params: SqlValue[]): SqlRow | null | undefined;
  };
  transaction<T>(fn: () => T): () => T;
  close(): void;
}): SqliteDriver {
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    run(sql: string, params: readonly SqlValue[] = []): void {
      db.prepare(sql).run(...params);
    },
    all(sql: string, params: readonly SqlValue[] = []): SqlRow[] {
      return db.prepare(sql).all(...params);
    },
    get(sql: string, params: readonly SqlValue[] = []): SqlRow | undefined {
      const row = db.prepare(sql).get(...params);
      return row === null || row === undefined ? undefined : row;
    },
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
    close(): void {
      db.close();
    },
  };
}
