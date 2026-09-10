import { archiveExportFiles, exportVaultToFiles, type VaultExportInput } from '@jot/import-export';
import { cacheDir, writeBytesFile } from './persist';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type SharingModule = {
  readonly isAvailableAsync: () => Promise<boolean>;
  readonly shareAsync: (
    uri: string,
    options?: { readonly mimeType?: string; readonly dialogTitle?: string; readonly UTI?: string },
  ) => Promise<void>;
};

function isSharingModule(value: unknown): value is SharingModule {
  return (
    isRecord(value) &&
    typeof value.isAvailableAsync === 'function' &&
    typeof value.shareAsync === 'function'
  );
}

async function shareUri(uri: string): Promise<void> {
  try {
    const Sharing: unknown = await import('expo-sharing');
    if (isSharingModule(Sharing) && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/zip',
        dialogTitle: 'Export Jot notes',
        UTI: 'public.zip-archive',
      });
      return;
    }
  } catch {
    // Fall through to React Native Share.
  }
  const { Share } = await import('react-native');
  await Share.share({
    url: uri,
    message: 'Jot notes export',
    title: 'Export Jot notes',
  });
}

export async function exportEverything(input: VaultExportInput): Promise<void> {
  const cache = await cacheDir();
  if (cache === null) {
    throw new Error(
      'Could not write an export folder on this device. Notes are still local. Try again after restarting Jot.',
    );
  }
  let sharePath: string;
  try {
    const result = exportVaultToFiles(input);
    sharePath = await writeBytesFile(cache, 'jot-export.zip', archiveExportFiles(result.files));
  } catch (error) {
    if (error instanceof Error && error.name === 'NotImplementedError') {
      throw new Error(
        'Export is not available yet. Notes are still on this device. Try again after updating Jot.',
        { cause: error },
      );
    }
    throw error;
  }
  try {
    await shareUri(sharePath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Share sheet failed.';
    throw new Error(
      `Export files were written, but sharing failed (${detail}). Notes are still on this device. Try Export everything now again.`,
      { cause: error },
    );
  }
}
