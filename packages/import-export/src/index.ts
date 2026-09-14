export { archiveExportFiles } from './archive.js';
export { ExportError, exportNotes, exportVault, exportVaultToFiles } from './export-vault.js';
export { looksLikeMarkdown, markdownToBlocks, parseInlineMarkdown } from './markdown-import.js';
export type {
  ExportAttachment,
  ExportFile,
  ExportFolder,
  ExportNote,
  ExportRequest,
  ManifestAttachment,
  ManifestNote,
  PortableManifest,
  VaultExportInput,
  VaultExportResult,
} from './types.js';

/**
 * Portable Markdown export. Apple Notes conversion is not implemented.
 */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
}
