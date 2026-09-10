declare module 'bun:sqlite' {
  type Value = string | number | bigint | Uint8Array | null;
  type Row = Readonly<Record<string, Value>>;

  export class Database {
    constructor(filename: string, options?: { readonly?: boolean; create?: boolean });
    exec(sql: string): void;
    prepare(sql: string): Statement;
    transaction<T>(fn: () => T): () => T;
    close(): void;
  }

  export class Statement {
    run(...params: Value[]): { lastInsertRowid: number | bigint; changes: number };
    all(...params: Value[]): Row[];
    get(...params: Value[]): Row | null | undefined;
  }
}
