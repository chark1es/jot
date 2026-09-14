import { describe, expect, it } from 'vitest';
import type { NoteId } from '@jot/schema';
import { createMemoryLocalStore } from './bun-sqlite.js';
import type { LocalStore } from './store.js';
import type { StoreClock } from './types.js';

class FakeClock implements StoreClock {
  constructor(private wallMs: number) {}

  advanceMs(deltaMs: number): void {
    this.wallMs += deltaMs;
  }

  wallNow(): { readonly unixMs: number } {
    return { unixMs: this.wallMs };
  }
}

async function editedTime(store: LocalStore, noteId: NoteId): Promise<number | undefined> {
  const notes = await store.listNotes({ trash: 'all', archived: 'any' });
  return notes.find((note) => note.noteId === noteId)?.modifiedWallMs;
}

describe('edited time', () => {
  it('stays put when a note is organized and moves when it is renamed', async () => {
    const clock = new FakeClock(1_000);
    const store = createMemoryLocalStore({ clock });
    await store.open();
    const noteId = await store.createNote();
    const folderId = await store.createFolder({ name: 'Work' });
    const tagId = await store.createTag({ name: 'soon' });
    const created = await editedTime(store, noteId);

    const organize: (() => Promise<void>)[] = [
      () => store.pinNote(noteId, true),
      () => store.archiveNote(noteId, true),
      () => store.archiveNote(noteId, false),
      () => store.moveNote(noteId, folderId),
      () => store.addTagToNote(noteId, tagId),
      () => store.trashNote(noteId),
      () => store.restoreNote(noteId),
    ];
    for (const change of organize) {
      clock.advanceMs(60_000);
      await change();
      expect(await editedTime(store, noteId)).toBe(created);
    }

    clock.advanceMs(60_000);
    await store.renameTitle(noteId, 'Renamed');
    expect(await editedTime(store, noteId)).toBeGreaterThan(created ?? 0);
    await store.close();
  });
});
