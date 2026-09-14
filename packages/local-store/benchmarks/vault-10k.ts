#!/usr/bin/env bun
/**
 * Phase 1 storage budgets against a synthetic 10,000-note vault, through the real LocalStore API:
 * top-50 search p95 under 100 ms, note list p95 under 150 ms, and opening a 5,000-word note
 * p95 under 300 ms. The design sets these for a mid-range phone, so numbers from a desktop are a
 * lower bound, not a pass for the phone. Exits 1 when a budget is missed.
 *
 *   bun packages/local-store/benchmarks/vault-10k.ts
 *   JOT_BENCH_NOTES=2000 bun packages/local-store/benchmarks/vault-10k.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createId, deriveId, parseDocument } from '@jot/schema';
import type { Document, NoteId, TransactionId } from '@jot/schema';
import { createBunSqliteLocalStore } from '../src/bun-sqlite.js';

const NOTE_COUNT = Number(process.env.JOT_BENCH_NOTES ?? 10_000);
const SAMPLES = 60;
const WORDS =
  'quiet river morning garden letter window paper coffee station market bright thought simple table travel winter summer plan music street friend city light local draft idea small green minute answer reason detail harbor lantern orchard pepper violet'.split(
    ' ',
  );

let seed = 20260910;
function random(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

function words(count: number): string {
  return Array.from({ length: count }, () => WORDS[Math.floor(random() * WORDS.length)] ?? 'note').join(' ');
}

function documentFor(docId: string, paragraphs: readonly string[]): Document {
  return parseDocument({
    type: 'doc',
    id: docId,
    content: paragraphs.map((text, index) => {
      const paragraphId = deriveId(docId, 'paragraph', index);
      return { type: 'paragraph', id: paragraphId, content: [{ type: 'text', id: deriveId(paragraphId, 'text', 0), text, marks: [] }] };
    }),
  });
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

async function time<T>(run: () => Promise<T>): Promise<number> {
  const started = performance.now();
  await run();
  return performance.now() - started;
}

const dir = mkdtempSync(join(tmpdir(), 'jot-bench-'));
const store = createBunSqliteLocalStore({ path: join(dir, 'vault.sqlite') });
await store.open();

const seedStarted = performance.now();
let longNote: NoteId | undefined;
for (let index = 0; index < NOTE_COUNT; index += 1) {
  const noteId = await store.createNote({ title: '' });
  const loaded = await store.getNoteDocument(noteId);
  if (loaded === null) {
    throw new Error('seeded note is missing');
  }
  const isLong = index === Math.floor(NOTE_COUNT / 2);
  const paragraphs = isLong
    ? Array.from({ length: 80 }, () => words(63))
    : Array.from({ length: 1 + Math.floor(random() * 4) }, () => words(10 + Math.floor(random() * 30)));
  const document = documentFor(loaded.document.id, paragraphs);
  const transactionId = createId<TransactionId>();
  await store.commitEdit({
    transactionId,
    noteId,
    operations: [],
    crdtUpdate: new Uint8Array([1]),
    document,
    projection: {
      noteId,
      title: paragraphs[0]?.slice(0, 60) ?? '',
      folderId: null,
      pinned: false,
      archived: false,
      trashed: false,
      plainBody: paragraphs.join('\n'),
    },
    undo: { transactionId, noteId, inverse: new Uint8Array([1]) },
    outbox: { transactionId, noteId, payload: new Uint8Array([1]) },
  });
  if (isLong) {
    longNote = noteId;
  }
}
const seedMs = performance.now() - seedStarted;
if (longNote === undefined) {
  throw new Error('long note was not seeded');
}
const longNoteId = longNote;

const listTimes: number[] = [];
const searchTimes: number[] = [];
const openTimes: number[] = [];
for (let i = 0; i < SAMPLES; i += 1) {
  listTimes.push(await time(() => store.listNotes({ trash: 'all', archived: 'any' })));
  const term = WORDS[Math.floor(random() * WORDS.length)] ?? 'note';
  searchTimes.push(
    await time(async () => {
      const result = await store.search({ text: term, limit: 50 });
      if (result.hits.length === 0) {
        throw new Error(`search for "${term}" found nothing, so its timing is meaningless`);
      }
    }),
  );
  openTimes.push(await time(() => store.getNoteDocument(longNoteId)));
}
await store.close();
rmSync(dir, { recursive: true, force: true });

const rows = [
  { name: 'Note list (all notes)', p50: percentile(listTimes, 50), p95: percentile(listTimes, 95), budget: 150 },
  { name: 'Search, top 50', p50: percentile(searchTimes, 50), p95: percentile(searchTimes, 95), budget: 100 },
  { name: 'Open 5,000-word note', p50: percentile(openTimes, 50), p95: percentile(openTimes, 95), budget: 300 },
];
console.log(`Seeded ${String(NOTE_COUNT)} notes in ${(seedMs / 1000).toFixed(1)} s (${SAMPLES} samples each)`);
for (const row of rows) {
  const verdict = row.p95 <= row.budget ? 'within budget' : 'OVER BUDGET';
  console.log(
    `${row.name.padEnd(24)} p50 ${row.p50.toFixed(1).padStart(7)} ms  p95 ${row.p95.toFixed(1).padStart(7)} ms  budget ${String(row.budget)} ms  ${verdict}`,
  );
}
process.exit(rows.every((row) => row.p95 <= row.budget) ? 0 : 1);
