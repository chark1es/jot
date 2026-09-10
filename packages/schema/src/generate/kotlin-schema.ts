import { MARK_SPECS, NODE_SPECS, SCHEMA_VERSION } from "../schema-table.js";
import type { AttrSpec } from "../schema-table.js";
import { GENERATED_HEADER, kotlinEnumName, swiftTypeName } from "./header.js";

function kotlinAttrType(spec: AttrSpec): string {
  switch (spec.kind) {
    case "integer":
      return "Int";
    case "string":
    case "id":
    case "url":
      return "String";
  }
}

function emitAttrData(name: string, attrs: Readonly<Record<string, AttrSpec>>): string {
  const fields = Object.entries(attrs);
  if (fields.length === 0) {
    return "";
  }
  const params = fields
    .map(([field, spec]) => `    val ${field}: ${kotlinAttrType(spec)}`)
    .join(",\n");
  return `
data class Jot${swiftTypeName(name)}Attrs(
${params},
)
`;
}

export function emitJotSchemaKt(): string {
  const nodeCases = Object.keys(NODE_SPECS)
    .map((name) => `    ${kotlinEnumName(name)}("${name}"),`)
    .join("\n");
  const markCases = Object.keys(MARK_SPECS)
    .map((name) => `    ${kotlinEnumName(name)}("${name}"),`)
    .join("\n");
  const nodeAttrs = Object.entries(NODE_SPECS)
    .map(([name, spec]) => emitAttrData(name, spec.attrs))
    .join("");
  const markAttrs = Object.entries(MARK_SPECS)
    .map(([name, spec]) => emitAttrData(name, spec.attrs))
    .join("");
  return `${GENERATED_HEADER}

object JotSchema {
    const val VERSION: Int = ${String(SCHEMA_VERSION)}
}

enum class JotNodeType(val typeName: String) {
${nodeCases}
}

enum class JotMarkType(val typeName: String) {
${markCases}
}
${nodeAttrs}${markAttrs}`;
}
