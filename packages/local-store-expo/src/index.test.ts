import { describe, expect, it } from 'vitest';
import { createExpoLocalStore } from './index.js';

describe('@jot/local-store-expo', () => {
  it('createExpoLocalStore returns a working store', async () => {
    const store = createExpoLocalStore();
    await store.open();
    const noteId = await store.createNote({ title: 'ExpoNote' });
    const projection = await store.getNoteProjection(noteId);
    expect(projection?.title).toBe('ExpoNote');
    const deviceId = await store.getDeviceId();
    expect(deviceId.length).toBe(26);
    await store.close();
  });
});
