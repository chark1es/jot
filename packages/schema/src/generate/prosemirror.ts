import { MARK_SPECS, NODE_SPECS, SCHEMA_VERSION } from "../schema-table.js";
import type { AttrSpec, ContentModel } from "../schema-table.js";
import { GENERATED_HEADER } from "./header.js";

function contentExpr(model: ContentModel): string | undefined {
  switch (model) {
    case "blocks":
      return "block*";
    case "inlines":
      return "inline*";
    case "text":
      return "text*";
    case "none":
      return undefined;
    case "listItems":
      return "listItem*";
    case "taskItems":
      return "taskItem*";
    case "tableRows":
      return "tableRow*";
    case "tableCells":
      return "tableCell*";
    case "listItemBody":
      return "(paragraph | bulletList | orderedList | taskList)*";
    case "captionOrNone":
      return "caption?";
  }
}

function emitDefault(spec: AttrSpec): string | undefined {
  if (spec.kind === "integer" && spec.default !== undefined) {
    return String(spec.default);
  }
  if (spec.kind === "string" && spec.default !== undefined) {
    return JSON.stringify(spec.default);
  }
  return undefined;
}

function emitAttrs(attrs: Readonly<Record<string, AttrSpec>>, includeId: boolean): string {
  const lines: string[] = [];
  if (includeId) {
    lines.push("    id: {}");
  }
  for (const [name, spec] of Object.entries(attrs)) {
    const fallback = emitDefault(spec);
    lines.push(fallback === undefined ? `    ${name}: {}` : `    ${name}: { default: ${fallback} }`);
  }
  if (lines.length === 0) {
    return "{}";
  }
  return `{\n${lines.join(",\n")},\n  }`;
}

export function emitProsemirror(): string {
  const nodes = Object.entries(NODE_SPECS)
    .map(([name, spec]) => {
      const fields: string[] = [];
      if (spec.group === "block") {
        fields.push(`    group: "block"`);
      }
      if (spec.group === "inline") {
        fields.push(`    group: "inline"`);
        fields.push(`    inline: true`);
      }
      const content = contentExpr(spec.content);
      if (content !== undefined) {
        fields.push(`    content: ${JSON.stringify(content)}`);
      }
      if (name === "text") {
        fields.push(`    attrs: ${emitAttrs(spec.attrs, true)}`);
      } else {
        fields.push(`    attrs: ${emitAttrs(spec.attrs, true)}`);
      }
      return `  ${name}: {\n${fields.join(",\n")},\n  }`;
    })
    .join(",\n");
  const marks = Object.entries(MARK_SPECS)
    .map(([name, spec]) => {
      const attrKeys = Object.keys(spec.attrs);
      if (attrKeys.length === 0) {
        return `  ${name}: {}`;
      }
      return `  ${name}: {\n    attrs: ${emitAttrs(spec.attrs, false)},\n  }`;
    })
    .join(",\n");
  return `${GENERATED_HEADER}

export const schemaVersion = ${String(SCHEMA_VERSION)} as const;

export const nodeNames = ${JSON.stringify(Object.keys(NODE_SPECS), null, 2)} as const;

export const markNames = ${JSON.stringify(Object.keys(MARK_SPECS), null, 2)} as const;

export const nodes = {
${nodes},
};

export const marks = {
${marks},
};
`;
}
