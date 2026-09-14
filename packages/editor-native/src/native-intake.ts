import * as ExpoModulesCore from 'expo-modules-core';
import { parseDocument, parseId, SchemaError } from '@jot/schema';
import type { Document, SchemaOperation, TransactionId } from '@jot/schema';
import { isRecord, parseSchemaOperations, readString } from './operation-parse.js';
import { JOT_EDITOR_VIEW_NAME } from './view-name.js';

export { parseSchemaOperations } from './operation-parse.js';

export type NativeIntakeRow = {
  readonly transactionId: TransactionId;
  readonly operations: readonly SchemaOperation[];
};

export type NativeIntakeClient = {
  readonly listUnappliedIntake?: () => Promise<readonly unknown[]>;
  readonly markIntakeApplied?: (transactionId: string) => Promise<void>;
  readonly getDocumentSnapshot?: () => Promise<unknown>;
};

export type NativeIntakeClientSource =
  | NativeIntakeClient
  | null
  | undefined
  | (() => NativeIntakeClient | null | undefined);

type ExpoModulesShape = {
  readonly requireNativeModule?: (name: string) => unknown;
};

type JotEditorNativeModule = {
  readonly listUnappliedIntake?: () => Promise<unknown>;
  readonly markIntakeApplied?: (transactionId: string) => Promise<unknown>;
};

export type NativeIntakeLedger = {
  listUnapplied(): Promise<readonly NativeIntakeRow[]>;
  markApplied(transactionId: TransactionId): Promise<void>;
};

export function parseJournalPayload(payload: unknown): NativeIntakeRow {
  const raw: unknown =
    typeof payload === 'string' ? (JSON.parse(payload) as unknown) : payload;
  if (!isRecord(raw)) {
    throw new SchemaError('invalid-payload', 'journal payload must be an object');
  }
  return {
    transactionId: parseId<TransactionId>(readString(raw.transactionId, 'transactionId')),
    operations: parseSchemaOperations(raw.operations),
  };
}

function parseIntakeRow(value: unknown): NativeIntakeRow {
  if (!isRecord(value)) {
    throw new SchemaError('invalid-row', 'intake row must be an object');
  }
  if (value.payload !== undefined) {
    const parsed = parseJournalPayload(value.payload);
    if (typeof value.transactionId === 'string') {
      return {
        transactionId: parseId<TransactionId>(value.transactionId),
        operations: parsed.operations,
      };
    }
    return parsed;
  }
  return {
    transactionId: parseId<TransactionId>(readString(value.transactionId, 'transactionId')),
    operations: parseSchemaOperations(value.operations),
  };
}

function resolveClient(source: NativeIntakeClientSource): NativeIntakeClient | undefined {
  if (typeof source === 'function') {
    return source() ?? undefined;
  }
  return source ?? undefined;
}

function asModuleMethod(
  loaded: Record<string, unknown>,
  name: 'listUnappliedIntake' | 'markIntakeApplied',
): ((...args: string[]) => Promise<unknown>) | undefined {
  const value = loaded[name];
  if (typeof value !== 'function') {
    return undefined;
  }
  return (...args: string[]) => Promise.resolve(value.apply(loaded, args) as unknown);
}

function readNativeModule(): JotEditorNativeModule | undefined {
  const expo = ExpoModulesCore as ExpoModulesShape;
  const requireNativeModule = expo.requireNativeModule;
  if (typeof requireNativeModule !== 'function') {
    return undefined;
  }
  try {
    const loaded: unknown = requireNativeModule(JOT_EDITOR_VIEW_NAME);
    if (!isRecord(loaded)) {
      return undefined;
    }
    const listUnappliedIntake = asModuleMethod(loaded, 'listUnappliedIntake');
    const markIntakeApplied = asModuleMethod(loaded, 'markIntakeApplied');
    if (listUnappliedIntake !== undefined && markIntakeApplied !== undefined) {
      return {
        listUnappliedIntake: () => listUnappliedIntake(),
        markIntakeApplied: (transactionId: string) => markIntakeApplied(transactionId),
      };
    }
    if (listUnappliedIntake !== undefined) {
      return { listUnappliedIntake: () => listUnappliedIntake() };
    }
    if (markIntakeApplied !== undefined) {
      return { markIntakeApplied: (transactionId: string) => markIntakeApplied(transactionId) };
    }
    return {};
  } catch {
    return undefined;
  }
}

async function readRawUnapplied(source?: NativeIntakeClientSource): Promise<unknown> {
  const client = resolveClient(source);
  if (typeof client?.listUnappliedIntake === 'function') {
    return client.listUnappliedIntake();
  }
  const native = readNativeModule();
  if (typeof native?.listUnappliedIntake !== 'function') {
    return [];
  }
  return native.listUnappliedIntake();
}

export async function listUnappliedIntake(
  source?: NativeIntakeClientSource,
): Promise<readonly NativeIntakeRow[]> {
  let raw: unknown;
  try {
    raw = await readRawUnapplied(source);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((row) => parseIntakeRow(row));
}

export async function markIntakeApplied(
  transactionId: TransactionId,
  source?: NativeIntakeClientSource,
): Promise<void> {
  try {
    const client = resolveClient(source);
    if (typeof client?.markIntakeApplied === 'function') {
      await client.markIntakeApplied(transactionId);
      return;
    }
    const native = readNativeModule();
    if (typeof native?.markIntakeApplied === 'function') {
      await native.markIntakeApplied(transactionId);
    }
  } catch {
    // Headless / missing native: ack is a no-op.
  }
}

export async function readNativeDocumentSnapshot(
  source?: NativeIntakeClientSource,
): Promise<Document | undefined> {
  try {
    const client = resolveClient(source);
    if (typeof client?.getDocumentSnapshot !== 'function') {
      return undefined;
    }
    const snapshot: unknown = await client.getDocumentSnapshot();
    if (!isRecord(snapshot)) {
      return undefined;
    }
    return parseDocument(snapshot.canonicalDocument);
  } catch {
    return undefined;
  }
}

export function createNativeIntakeLedger(source?: NativeIntakeClientSource): NativeIntakeLedger {
  return {
    listUnapplied: () => listUnappliedIntake(source),
    markApplied: (transactionId) => markIntakeApplied(transactionId, source),
  };
}
