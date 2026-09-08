export const SCHEMA_VERSION = 1 as const;

export const ALLOWED_URL_SCHEMES = ["https", "http", "mailto"] as const;

export const CUSTOM_URL_SCHEMES: readonly string[] = [];

export type IntegerAttrSpec = {
  readonly kind: "integer";
  readonly min?: number;
  readonly max?: number;
  readonly default?: number;
};

export type StringAttrSpec = {
  readonly kind: "string";
  readonly default?: string;
};

export type IdAttrSpec = {
  readonly kind: "id";
};

export type UrlAttrSpec = {
  readonly kind: "url";
};

export type AttrSpec = IntegerAttrSpec | StringAttrSpec | IdAttrSpec | UrlAttrSpec;

export type ContentModel =
  | "blocks"
  | "inlines"
  | "text"
  | "none"
  | "listItems"
  | "taskItems"
  | "tableRows"
  | "tableCells"
  | "listItemBody"
  | "captionOrNone";

export type NodeGroup = "root" | "block" | "inline" | "listItem" | "taskItem" | "tableRow" | "tableCell" | "caption";

export type NodeSpec = {
  readonly group: NodeGroup;
  readonly content: ContentModel;
  readonly attrs: Readonly<Record<string, AttrSpec>>;
  readonly text?: true;
};

export type MarkSpec = {
  readonly attrs: Readonly<Record<string, AttrSpec>>;
};

export const NODE_SPECS = {
  doc: { group: "root", content: "blocks", attrs: {} },
  paragraph: { group: "block", content: "inlines", attrs: {} },
  heading: {
    group: "block",
    content: "inlines",
    attrs: { level: { kind: "integer", min: 1, max: 6, default: 1 } },
  },
  blockquote: { group: "block", content: "blocks", attrs: {} },
  codeBlock: {
    group: "block",
    content: "text",
    attrs: { languageId: { kind: "string", default: "" } },
  },
  horizontalRule: { group: "block", content: "none", attrs: {} },
  bulletList: { group: "block", content: "listItems", attrs: {} },
  orderedList: {
    group: "block",
    content: "listItems",
    attrs: { start: { kind: "integer", min: 1, default: 1 } },
  },
  listItem: { group: "listItem", content: "listItemBody", attrs: {} },
  taskList: { group: "block", content: "taskItems", attrs: {} },
  taskItem: {
    group: "taskItem",
    content: "listItemBody",
    attrs: { checked: { kind: "integer", min: 0, max: 1, default: 0 } },
  },
  table: { group: "block", content: "tableRows", attrs: {} },
  tableRow: { group: "tableRow", content: "tableCells", attrs: {} },
  tableCell: {
    group: "tableCell",
    content: "blocks",
    attrs: {
      header: { kind: "integer", min: 0, max: 1, default: 0 },
      colspan: { kind: "integer", min: 1, default: 1 },
      rowspan: { kind: "integer", min: 1, default: 1 },
    },
  },
  image: {
    group: "block",
    content: "captionOrNone",
    attrs: {
      attachmentId: { kind: "id" },
      widthBasisPoints: { kind: "integer", min: 1, max: 10000, default: 10000 },
      alt: { kind: "string", default: "" },
    },
  },
  caption: { group: "caption", content: "inlines", attrs: {} },
  fileAttachment: {
    group: "block",
    content: "none",
    attrs: { attachmentId: { kind: "id" } },
  },
  mathBlock: {
    group: "block",
    content: "none",
    attrs: {
      latex: { kind: "string", default: "" },
      alt: { kind: "string", default: "" },
    },
  },
  text: { group: "inline", content: "none", attrs: {}, text: true },
  hardBreak: { group: "inline", content: "none", attrs: {} },
  mathInline: {
    group: "inline",
    content: "none",
    attrs: {
      latex: { kind: "string", default: "" },
      alt: { kind: "string", default: "" },
    },
  },
} as const satisfies Record<string, NodeSpec>;

export const MARK_SPECS = {
  bold: { attrs: {} },
  italic: { attrs: {} },
  underline: { attrs: {} },
  strikethrough: { attrs: {} },
  inlineCode: { attrs: {} },
  link: {
    attrs: {
      href: { kind: "url" },
      title: { kind: "string", default: "" },
    },
  },
  textColor: { attrs: { paletteId: { kind: "string" } } },
  highlight: { attrs: { paletteId: { kind: "string" } } },
} as const satisfies Record<string, MarkSpec>;

export type NodeType = keyof typeof NODE_SPECS;
export type MarkType = keyof typeof MARK_SPECS;

export const NODE_TYPES = Object.keys(NODE_SPECS) as NodeType[];
export const MARK_TYPES = Object.keys(MARK_SPECS) as MarkType[];

export const BLOCK_TYPES: readonly NodeType[] = NODE_TYPES.filter(
  (type) => NODE_SPECS[type].group === "block",
);

export const INLINE_TYPES: readonly NodeType[] = NODE_TYPES.filter(
  (type) => NODE_SPECS[type].group === "inline",
);

export function isNodeType(value: string): value is NodeType {
  return Object.hasOwn(NODE_SPECS, value);
}

export function isMarkType(value: string): value is MarkType {
  return Object.hasOwn(MARK_SPECS, value);
}

export function isAllowedHref(href: string): boolean {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (match === null) {
    return false;
  }
  const scheme = match[1]?.toLowerCase();
  if (scheme === undefined) {
    return false;
  }
  if ((ALLOWED_URL_SCHEMES as readonly string[]).includes(scheme)) {
    return true;
  }
  return CUSTOM_URL_SCHEMES.includes(scheme);
}

export function isHexPalette(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}
