import type { AttachmentId, NodeId } from "./ids.js";
import type { MarkType, NodeType } from "./schema-table.js";

export type AttrValue = string | number;

export type Mark = {
  readonly type: MarkType;
  readonly attrs: Readonly<Record<string, AttrValue>>;
};

export type SchemaNode = {
  readonly type: NodeType;
  readonly id: NodeId;
  readonly attrs: Readonly<Record<string, AttrValue>>;
  readonly content: readonly SchemaNode[];
  readonly text?: string;
  readonly marks: readonly Mark[];
};

export type Document = SchemaNode & {
  readonly type: "doc";
};

export type SchemaSelection = {
  readonly nodeId: NodeId;
  readonly offsetUtf16: number;
  readonly affinity: "before" | "after";
  readonly revision: number;
};

export type SchemaRange = {
  readonly from: SchemaSelection;
  readonly to: SchemaSelection;
};

export type DocumentSlice = {
  readonly nodes: readonly SchemaNode[];
};

export type InsertTextOperation = {
  readonly type: "insertText";
  readonly position: SchemaSelection;
  readonly text: string;
  readonly storedMarks: readonly Mark[];
};

export type DeleteRangeOperation = {
  readonly type: "deleteRange";
  readonly from: SchemaSelection;
  readonly to: SchemaSelection;
  readonly deletedSlice: DocumentSlice;
};

export type ReplaceRangeOperation = {
  readonly type: "replaceRange";
  readonly from: SchemaSelection;
  readonly to: SchemaSelection;
  readonly slice: DocumentSlice;
  readonly deletedSlice: DocumentSlice;
};

export type AddMarkOperation = {
  readonly type: "addMark";
  readonly range: SchemaRange;
  readonly mark: Mark;
};

export type RemoveMarkOperation = {
  readonly type: "removeMark";
  readonly range: SchemaRange;
  readonly markType: MarkType;
};

export type SetNodeAttributesOperation = {
  readonly type: "setNodeAttributes";
  readonly nodeId: NodeId;
  readonly patch: Readonly<Record<string, AttrValue>>;
  readonly priorValues: Readonly<Record<string, AttrValue>>;
};

export type InsertNodeOperation = {
  readonly type: "insertNode";
  readonly parentId: NodeId;
  readonly index: number;
  readonly node: SchemaNode;
};

export type DeleteNodeOperation = {
  readonly type: "deleteNode";
  readonly nodeId: NodeId;
  readonly deletedNode: SchemaNode;
};

export type SchemaOperation =
  | InsertTextOperation
  | DeleteRangeOperation
  | ReplaceRangeOperation
  | AddMarkOperation
  | RemoveMarkOperation
  | SetNodeAttributesOperation
  | InsertNodeOperation
  | DeleteNodeOperation;

export type ImageAttrs = {
  readonly attachmentId: AttachmentId;
  readonly widthBasisPoints: number;
  readonly alt: string;
};
