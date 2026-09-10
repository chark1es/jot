import { Database } from 'bun:sqlite';
import { createStatementDriver } from './driver.js';
import { createSqliteLocalStore } from './sqlite-store.js';
import type { LocalStore } from './store.js';
import type { LocalStoreOptions } from './types.js';

export type BunSqliteLocalStoreOptions = LocalStoreOptions & {
  readonly path?: string;
};

export function createBunSqliteLocalStore(options: BunSqliteLocalStoreOptions = {}): LocalStore {
  const path = options.path ?? ':memory:';
  const db = new Database(path);
  return createSqliteLocalStore(createStatementDriver(db), options);
}

export function createMemoryLocalStore(options: LocalStoreOptions = {}): LocalStore {
  return createBunSqliteLocalStore({ ...options, path: ':memory:' });
}
