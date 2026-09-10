import { describe, expect, it } from 'vitest';
import { createGoogleDriveStorage, NotImplementedError } from './index.js';

describe('@jot/storage-google-drive', () => {
  it('imports and throws', () => {
    expect(() => createGoogleDriveStorage({ wakeup: null })).toThrow(NotImplementedError);
  });
});
