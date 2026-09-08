export class SchemaError extends Error {
  override readonly name = "SchemaError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class SchemaVersionError extends Error {
  override readonly name = "SchemaVersionError";
  readonly schemaVersion: number;
  readonly minReader: number;
  readonly minWriter: number;

  constructor(options: {
    schemaVersion: number;
    minReader: number;
    minWriter: number;
    message?: string;
  }) {
    super(
      options.message ??
        `Unsupported schema version ${String(options.schemaVersion)} (minReader=${String(options.minReader)}, minWriter=${String(options.minWriter)})`,
    );
    this.schemaVersion = options.schemaVersion;
    this.minReader = options.minReader;
    this.minWriter = options.minWriter;
  }
}

export class CanonicalJsonError extends Error {
  override readonly name = "CanonicalJsonError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class IdError extends Error {
  override readonly name = "IdError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
