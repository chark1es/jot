import { emitCanonicalJsonKt } from "./canonical-json-kotlin.js";
import { emitCanonicalJsonSwift } from "./canonical-json-swift.js";
import { GENERATED_HEADER } from "./header.js";
import { emitJotSchemaKt } from "./kotlin-schema.js";
import { emitProsemirror } from "./prosemirror.js";
import { emitJotSchemaSwift } from "./swift-schema.js";

export { GENERATED_HEADER };

export function generateAll(): Record<string, string> {
  return {
    "JotSchema.swift": emitJotSchemaSwift(),
    "JotSchema.kt": emitJotSchemaKt(),
    "prosemirror.ts": emitProsemirror(),
    "CanonicalJson.swift": emitCanonicalJsonSwift(),
    "CanonicalJson.kt": emitCanonicalJsonKt(),
  };
}
