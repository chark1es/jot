import type { LocalStore } from './store.js';
import type { IntakeRecord, NoteProjection, SearchResult } from './types.js';

export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
}

export class NotImplementedLocalStore implements LocalStore {
  commitEdit(): Promise<void> {
    return Promise.reject(new NotImplementedError('LocalStore.commitEdit is not implemented'));
  }

  getNoteProjection(): Promise<NoteProjection | null> {
    return Promise.reject(
      new NotImplementedError('LocalStore.getNoteProjection is not implemented'),
    );
  }

  replayUnappliedIntake(): Promise<readonly IntakeRecord[]> {
    return Promise.reject(
      new NotImplementedError('LocalStore.replayUnappliedIntake is not implemented'),
    );
  }

  search(): Promise<SearchResult> {
    return Promise.reject(new NotImplementedError('LocalStore.search is not implemented'));
  }
}
