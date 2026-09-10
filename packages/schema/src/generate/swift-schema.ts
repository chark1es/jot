import { MARK_SPECS, NODE_SPECS, SCHEMA_VERSION } from "../schema-table.js";
import type { AttrSpec } from "../schema-table.js";
import { GENERATED_HEADER, swiftTypeName } from "./header.js";

function swiftAttrType(spec: AttrSpec): string {
  switch (spec.kind) {
    case "integer":
      return "Int";
    case "string":
    case "id":
    case "url":
      return "String";
  }
}

function emitAttrStruct(name: string, attrs: Readonly<Record<string, AttrSpec>>): string {
  const fields = Object.entries(attrs);
  if (fields.length === 0) {
    return "";
  }
  const props = fields
    .map(([field, spec]) => `    public var ${field}: ${swiftAttrType(spec)}`)
    .join("\n");
  const params = fields
    .map(([field, spec]) => `${field}: ${swiftAttrType(spec)}`)
    .join(", ");
  const assigns = fields.map(([field]) => `        self.${field} = ${field}`).join("\n");
  return `
public struct Jot${swiftTypeName(name)}Attrs: Sendable, Equatable {
${props}

    public init(${params}) {
${assigns}
    }
}
`;
}

export function emitJotSchemaSwift(): string {
  const nodeCases = Object.keys(NODE_SPECS)
    .map((name) => `    case ${name} = "${name}"`)
    .join("\n");
  const markCases = Object.keys(MARK_SPECS)
    .map((name) => `    case ${name} = "${name}"`)
    .join("\n");
  const nodeAttrs = Object.entries(NODE_SPECS)
    .map(([name, spec]) => emitAttrStruct(name, spec.attrs))
    .join("");
  const markAttrs = Object.entries(MARK_SPECS)
    .map(([name, spec]) => emitAttrStruct(name, spec.attrs))
    .join("");
  return `${GENERATED_HEADER}

public enum JotSchema {
    public static let version: Int = ${String(SCHEMA_VERSION)}
}

public enum JotNodeType: String, CaseIterable, Sendable, Equatable {
${nodeCases}
}

public enum JotMarkType: String, CaseIterable, Sendable, Equatable {
${markCases}
}
${nodeAttrs}${markAttrs}`;
}
