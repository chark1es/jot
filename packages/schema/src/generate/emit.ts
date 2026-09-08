import { emitCanonicalJsonKt } from "./canonical-json-kotlin.js";
import { emitCanonicalJsonSwift } from "./canonical-json-swift.js";
import { GENERATED_HEADER } from "./header.js";
import { emitJoltSchemaKt } from "./kotlin-schema.js";
import { emitProsemirror } from "./prosemirror.js";
import { emitJoltSchemaSwift } from "./swift-schema.js";

export { GENERATED_HEADER };

export function generateAll(): Record<string, string> {
  return {
    "JoltSchema.swift": emitJoltSchemaSwift(),
    "JoltSchema.kt": emitJoltSchemaKt(),
    "prosemirror.ts": emitProsemirror(),
    "CanonicalJson.swift": emitCanonicalJsonSwift(),
    "CanonicalJson.kt": emitCanonicalJsonKt(),
  };
}
