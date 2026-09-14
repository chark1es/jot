import { File } from 'expo-file-system';
import { documentDir } from './persist';

type LegacyFileSystem = {
  readonly getInfoAsync?: (uri: string) => Promise<{ readonly exists: boolean }>;
  readonly deleteAsync?: (uri: string, options?: { readonly idempotent?: boolean }) => Promise<void>;
  readonly readDirectoryAsync?: (uri: string) => Promise<string[]>;
};

async function legacyFileSystem(): Promise<LegacyFileSystem | null> {
  try {
    const mod: unknown = await import('expo-file-system/legacy');
    return mod !== null && typeof mod === 'object' ? mod : null;
  } catch {
    return null;
  }
}

/**
 * Attachment files live in `Documents/attachments/<attachment id>`, so the native editor can
 * draw an image from its id alone. The bytes are also kept in SQLite, which is the copy that
 * export reads and that restores a file someone deleted.
 */
export async function attachmentsDirectoryUri(): Promise<string | null> {
  const root = await documentDir();
  if (root === null) {
    return null;
  }
  return `${root.endsWith('/') ? root : `${root}/`}attachments/`;
}

export function fileUri(pathOrUri: string): string {
  return pathOrUri.includes('://') ? pathOrUri : `file://${pathOrUri}`;
}

export async function fileExists(uri: string): Promise<boolean> {
  const fs = await legacyFileSystem();
  if (fs?.getInfoAsync === undefined) {
    return false;
  }
  try {
    return (await fs.getInfoAsync(uri)).exists;
  } catch {
    return false;
  }
}

export function writeAttachmentFile(directoryUri: string, attachmentId: string, bytes: Uint8Array): string {
  const file = new File(`${directoryUri}${attachmentId}`);
  file.create({ intermediates: true, overwrite: true });
  file.write(bytes);
  return file.uri;
}

export async function readFileBytes(uri: string): Promise<Uint8Array> {
  const buffer = await new File(fileUri(uri)).arrayBuffer();
  return new Uint8Array(buffer);
}

/** Deletes attachment files that no note references any more. */
export async function removeAttachmentFilesExcept(
  directoryUri: string,
  keep: ReadonlySet<string>,
): Promise<void> {
  const fs = await legacyFileSystem();
  if (fs?.readDirectoryAsync === undefined || fs.deleteAsync === undefined) {
    return;
  }
  let names: string[];
  try {
    names = await fs.readDirectoryAsync(directoryUri);
  } catch {
    return;
  }
  for (const name of names) {
    if (!keep.has(name)) {
      await fs.deleteAsync(`${directoryUri}${name}`, { idempotent: true }).catch(() => undefined);
    }
  }
}
