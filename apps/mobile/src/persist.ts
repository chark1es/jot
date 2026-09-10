const VAULT_DIR = 'jot';

type FileSystemModule = {
  readonly documentDirectory?: string | null;
  readonly cacheDirectory?: string | null;
  readonly EncodingType?: { readonly UTF8: string };
  readonly writeAsStringAsync?: (
    fileUri: string,
    contents: string,
    options?: { readonly encoding?: string },
  ) => Promise<void>;
  readonly readAsStringAsync?: (
    fileUri: string,
    options?: { readonly encoding?: string },
  ) => Promise<string>;
  readonly getInfoAsync?: (fileUri: string) => Promise<{ readonly exists: boolean }>;
  readonly makeDirectoryAsync?: (
    fileUri: string,
    options?: { readonly intermediates?: boolean },
  ) => Promise<void>;
  readonly deleteAsync?: (
    fileUri: string,
    options?: { readonly idempotent?: boolean },
  ) => Promise<void>;
};

type BinaryFile = {
  readonly uri: string;
  create(options?: { readonly intermediates?: boolean; readonly overwrite?: boolean }): void;
  write(contents: Uint8Array): void;
};

type BinaryFileSystemModule = {
  readonly File?: new (uri: string) => BinaryFile;
};

let memoryFiles = new Map<string, string>();

function isFileSystemModule(value: unknown): value is FileSystemModule {
  return value !== null && typeof value === 'object';
}

async function loadFs(): Promise<FileSystemModule | null> {
  try {
    const mod: unknown = await import('expo-file-system/legacy');
    if (isFileSystemModule(mod)) {
      return mod;
    }
    return null;
  } catch {
    return null;
  }
}

function joinUri(root: string, name: string): string {
  if (root.endsWith('/')) {
    return `${root}${name}`;
  }
  return `${root}/${name}`;
}

async function ensureRoot(fs: FileSystemModule, root: string): Promise<void> {
  if (typeof fs.makeDirectoryAsync !== 'function') {
    return;
  }
  try {
    await fs.makeDirectoryAsync(joinUri(root, VAULT_DIR), { intermediates: true });
  } catch {
    // Directory may already exist.
  }
}

export async function documentDir(): Promise<string | null> {
  const fs = await loadFs();
  const root = fs?.documentDirectory;
  return typeof root === 'string' && root.length > 0 ? root : null;
}

export async function cacheDir(): Promise<string | null> {
  const fs = await loadFs();
  const root = fs?.cacheDirectory;
  return typeof root === 'string' && root.length > 0 ? root : null;
}

export async function readJsonFile(name: string): Promise<unknown> {
  const fs = await loadFs();
  const root = fs?.documentDirectory;
  if (fs === null || typeof root !== 'string' || typeof fs.readAsStringAsync !== 'function') {
    const raw = memoryFiles.get(name);
    if (raw === undefined) {
      return null;
    }
    return JSON.parse(raw) as unknown;
  }
  const uri = joinUri(root, name);
  try {
    const info =
      typeof fs.getInfoAsync === 'function' ? await fs.getInfoAsync(uri) : { exists: true };
    if (!info.exists) {
      return null;
    }
    const raw = await fs.readAsStringAsync(uri);
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function writeJsonFile(name: string, value: unknown): Promise<void> {
  const raw = JSON.stringify(value);
  const fs = await loadFs();
  const root = fs?.documentDirectory;
  if (fs === null || typeof root !== 'string' || typeof fs.writeAsStringAsync !== 'function') {
    memoryFiles = new Map(memoryFiles).set(name, raw);
    return;
  }
  await ensureRoot(fs, root);
  await fs.writeAsStringAsync(joinUri(root, name), raw);
}

export async function writeTextFile(
  directory: string,
  name: string,
  contents: string,
): Promise<string> {
  const fs = await loadFs();
  const relative = name.replace(/^\/+/, '');
  if (fs === null || typeof fs.writeAsStringAsync !== 'function') {
    const path = `${directory.replace(/\/$/, '')}/${relative}`;
    memoryFiles = new Map(memoryFiles).set(path, contents);
    return path;
  }
  const nested = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '';
  if (nested.length > 0 && typeof fs.makeDirectoryAsync === 'function') {
    try {
      await fs.makeDirectoryAsync(joinUri(directory, nested), { intermediates: true });
    } catch {
      // already exists
    }
  } else if (typeof fs.makeDirectoryAsync === 'function') {
    try {
      await fs.makeDirectoryAsync(directory, { intermediates: true });
    } catch {
      // already exists
    }
  }
  const uri = joinUri(directory, relative);
  await fs.writeAsStringAsync(uri, contents);
  return uri;
}

export async function writeBytesFile(
  directory: string,
  name: string,
  contents: Uint8Array,
): Promise<string> {
  const uri = joinUri(directory, name.replace(/^\/+/, ''));
  try {
    const module: unknown = await import('expo-file-system');
    if (module !== null && typeof module === 'object') {
      const File = (module as BinaryFileSystemModule).File;
      if (File !== undefined) {
        const file = new File(uri);
        file.create({ intermediates: true, overwrite: true });
        file.write(contents);
        return file.uri;
      }
    }
  } catch {
    // Tests and non-native runtimes use the in-memory fallback.
  }
  memoryFiles = new Map(memoryFiles).set(uri, `[${String(contents.byteLength)} binary bytes]`);
  return uri;
}

export async function clearDirectory(directory: string): Promise<void> {
  const fs = await loadFs();
  if (fs === null || typeof fs.deleteAsync !== 'function') {
    return;
  }
  try {
    await fs.deleteAsync(directory, { idempotent: true });
  } catch {
    // ignore
  }
}

export function fileNameFromTitle(title: string, id: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const base = slug.length === 0 ? 'note' : slug;
  return `${base}-${id.slice(0, 8)}.md`;
}
