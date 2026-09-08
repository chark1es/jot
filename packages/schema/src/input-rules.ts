import type { NodeType } from "./schema-table.js";

export type InputRuleTerminator = "space-or-enter";

export type InputRule = {
  readonly id: string;
  readonly pattern: string;
  readonly terminator: InputRuleTerminator;
  readonly nodeType: NodeType;
  readonly attrs?: Readonly<Record<string, string | number>>;
};

export const INPUT_RULES: readonly InputRule[] = [
  { id: "heading-1", pattern: "^#$", terminator: "space-or-enter", nodeType: "heading", attrs: { level: 1 } },
  { id: "heading-2", pattern: "^##$", terminator: "space-or-enter", nodeType: "heading", attrs: { level: 2 } },
  { id: "heading-3", pattern: "^###$", terminator: "space-or-enter", nodeType: "heading", attrs: { level: 3 } },
  { id: "heading-4", pattern: "^####$", terminator: "space-or-enter", nodeType: "heading", attrs: { level: 4 } },
  { id: "heading-5", pattern: "^#####$", terminator: "space-or-enter", nodeType: "heading", attrs: { level: 5 } },
  { id: "heading-6", pattern: "^######$", terminator: "space-or-enter", nodeType: "heading", attrs: { level: 6 } },
  { id: "bullet", pattern: "^-$", terminator: "space-or-enter", nodeType: "bulletList" },
  { id: "ordered", pattern: "^1\\.$", terminator: "space-or-enter", nodeType: "orderedList", attrs: { start: 1 } },
  { id: "task-unchecked", pattern: "^\\[\\]$", terminator: "space-or-enter", nodeType: "taskList" },
  { id: "task-checked", pattern: "^\\[[xX]\\]$", terminator: "space-or-enter", nodeType: "taskList", attrs: { checked: 1 } },
  { id: "code", pattern: "^```$", terminator: "space-or-enter", nodeType: "codeBlock" },
  { id: "quote", pattern: "^>$", terminator: "space-or-enter", nodeType: "blockquote" },
];
