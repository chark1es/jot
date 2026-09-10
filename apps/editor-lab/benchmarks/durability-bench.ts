/**
 * Host bun durability microbench. Run from repo root:
 *   bun apps/editor-lab/benchmarks/durability-bench.ts
 *
 * Times MemoryDurableIntake.append (baseline, not the gate) and a bun:sqlite
 * INSERT with PRAGMA synchronous=FULL. Production journal is native SQLite on
 * device. This file cannot fsync iOS or Android from bun.
 *
 * Do not copy these timings into PRODUCT.md or technical-design.md.
 * Do not treat them as Hermes or device-journal p95/p99.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MemoryDurableIntake,
  type DurableIntakeRecord,
} from '../../../packages/editor-native/src/durable-intake.ts';
import { createId, parseId } from '@jot/schema';
import type { NoteId, NodeId, TransactionId } from '@jot/schema';

type CaseStatus = 'ran' | 'skipped';

type Percentiles = {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
};

type BenchCase = {
  readonly name: string;
  readonly status: CaseStatus;
  readonly role: string;
  readonly notes: string;
  readonly n: number;
  readonly percentilesMs: Percentiles | null;
};

type BenchFile = {
  readonly environment: 'bun';
  readonly bunVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly generatedAt: string;
  readonly notHermes: true;
  readonly notDeviceJournal: true;
  readonly comment: string;
  readonly n: number;
  readonly warmup: number;
  readonly payloadBytes: number;
  readonly cases: readonly BenchCase[];
};

const ROOT = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(ROOT, 'results');
const N = 1000;
const WARMUP = 50;

function nowMs(): number {
  return performance.now();
}

function revision(value: number): DurableIntakeRecord['baseRevision'] {
  return value as DurableIntakeRecord['baseRevision'];
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function percentilesOf(samples: readonly number[]): Percentiles {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
  };
}

function representativePayload(): {
  record: DurableIntakeRecord;
  json: string;
} {
  const documentId = parseId<NoteId>('aaaaaaaaaaaaaaaaaaaaaaaaaa');
  const nodeId = parseId<NodeId>('aeaaaaaaaaaaaaaaaaaaaaaaaa');
  const record: DurableIntakeRecord = {
    id: parseId<TransactionId>('baaaaaaaaaaaaaaaaaaaaaaaaa'),
    documentId,
    baseRevision: revision(0),
    origin: 'local',
    operations: [
      {
        type: 'insertText',
        position: {
          nodeId,
          offsetUtf16: 0,
          affinity: 'after',
          revision: 0,
        },
        text: 'x',
        storedMarks: [],
      },
    ],
  };
  return { record, json: JSON.stringify(record) };
}

function nextRecord(template: DurableIntakeRecord): DurableIntakeRecord {
  return { ...template, id: createId<TransactionId>() };
}

async function timeLoop(
  n: number,
  warmup: number,
  once: () => Promise<void> | void,
): Promise<number[]> {
  for (let i = 0; i < warmup; i += 1) {
    await once();
  }
  const samples: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const start = nowMs();
    await once();
    samples.push(nowMs() - start);
  }
  return samples;
}

async function benchMemory(template: DurableIntakeRecord): Promise<BenchCase> {
  const intake = new MemoryDurableIntake();
  const samples = await timeLoop(N, WARMUP, () => intake.append(nextRecord(template)));
  return {
    name: 'memoryDurableIntake',
    status: 'ran',
    role: 'baseline-not-gate',
    notes: 'In-process array push. Not SQLite, not fsync, not the Phase 0.5 durability gate.',
    n: N,
    percentilesMs: percentilesOf(samples),
  };
}

async function benchBunSqlite(payloadJson: string): Promise<BenchCase> {
  const skipped = (notes: string): BenchCase => ({
    name: 'bunSqliteSynchronousFull',
    status: 'skipped',
    role: 'host-sqlite-not-device-journal',
    notes,
    n: N,
    percentilesMs: null,
  });

  let Database: typeof import('bun:sqlite').Database;
  try {
    ({ Database } = await import('bun:sqlite'));
  } catch (error) {
    return skipped(error instanceof Error ? error.message : String(error));
  }

  const dir = mkdtempSync(join(tmpdir(), 'jot-durability-'));
  const file = join(dir, 'editor_intake.sqlite');
  try {
    const db = new Database(file);
    try {
      db.exec('PRAGMA synchronous = FULL');
      db.exec('PRAGMA journal_mode = DELETE');
      db.exec(
        `CREATE TABLE IF NOT EXISTS editor_intake(
          transaction_id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          applied INTEGER NOT NULL DEFAULT 0
        )`,
      );
      const insert = db.prepare(
        'INSERT INTO editor_intake(transaction_id, payload, applied) VALUES (?, ?, 0)',
      );
      const samples = await timeLoop(N, WARMUP, () => {
        db.exec('BEGIN IMMEDIATE');
        insert.run(createId<TransactionId>(), payloadJson);
        db.exec('COMMIT');
      });
      return {
        name: 'bunSqliteSynchronousFull',
        status: 'ran',
        role: 'host-sqlite-not-device-journal',
        notes:
          'bun:sqlite file DB, synchronous=FULL, journal_mode=DELETE, BEGIN IMMEDIATE + INSERT + COMMIT. Host process, not iOS/Android journal, not Hermes.',
        n: N,
        percentilesMs: percentilesOf(samples),
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return skipped(error instanceof Error ? error.message : String(error));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const { record, json } = representativePayload();
const cases: BenchCase[] = [await benchMemory(record), await benchBunSqlite(json)];

const payload: BenchFile = {
  environment: 'bun',
  bunVersion: Bun.version,
  platform: process.platform,
  arch: process.arch,
  generatedAt: new Date().toISOString(),
  notHermes: true,
  notDeviceJournal: true,
  comment:
    'Host bun timings only. Phase 0.5 p95/p99 durability latency is native SQLite on a release device build. MemoryDurableIntake is a baseline, not a substitute.',
  n: N,
  warmup: WARMUP,
  payloadBytes: new TextEncoder().encode(json).byteLength,
  cases,
};

mkdirSync(RESULTS_DIR, { recursive: true });
writeFileSync(join(RESULTS_DIR, 'durability-latest.json'), `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify(payload, null, 2));
