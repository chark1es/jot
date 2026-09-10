import type { EditorCommand } from '@jot/editor-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@jot/tokens/generated';
import type { SemanticPalette } from '@jot/ui-mobile';
import { editorBodySize, touchMin, uiFontFamily } from '../theme';

export type FormatCommand = EditorCommand;

type Tool = {
  readonly key: string;
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly command: FormatCommand | 'undo' | 'redo' | 'link';
};

const TOOLS: readonly Tool[] = [
  { key: 'undo', label: 'Undo', accessibilityLabel: 'Undo', command: 'undo' },
  { key: 'redo', label: 'Redo', accessibilityLabel: 'Redo', command: 'redo' },
  { key: 'b', label: 'B', accessibilityLabel: 'Bold', command: { name: 'toggleBold' } },
  { key: 'i', label: 'I', accessibilityLabel: 'Italic', command: { name: 'toggleItalic' } },
  { key: 'u', label: 'U', accessibilityLabel: 'Underline', command: { name: 'toggleUnderline' } },
  {
    key: 's',
    label: 'S',
    accessibilityLabel: 'Strikethrough',
    command: { name: 'toggleStrikethrough' },
  },
  { key: 'code', label: '`', accessibilityLabel: 'Inline code', command: { name: 'toggleInlineCode' } },
  { key: 'h', label: 'H', accessibilityLabel: 'Heading', command: { name: 'setHeading', level: 1 } },
  { key: 'p', label: 'P', accessibilityLabel: 'Paragraph', command: { name: 'setParagraph' } },
  {
    key: 'ul',
    label: 'List',
    accessibilityLabel: 'Bullet list',
    command: { name: 'toggleBulletList' },
  },
  {
    key: 'ol',
    label: '1.',
    accessibilityLabel: 'Numbered list',
    command: { name: 'toggleOrderedList' },
  },
  { key: 'task', label: 'Task', accessibilityLabel: 'Task list', command: { name: 'toggleTaskList' } },
  {
    key: 'block',
    label: 'Code',
    accessibilityLabel: 'Code block',
    command: { name: 'toggleCodeBlock' },
  },
  {
    key: 'quote',
    label: 'Quote',
    accessibilityLabel: 'Quote',
    command: { name: 'toggleBlockquote' },
  },
  {
    key: 'hr',
    label: 'HR',
    accessibilityLabel: 'Horizontal rule',
    command: { name: 'insertHorizontalRule' },
  },
  { key: 'link', label: 'Link', accessibilityLabel: 'Link', command: 'link' },
];

type Props = {
  readonly palette: SemanticPalette;
  readonly onCommand: (command: FormatCommand) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onLink: () => void;
};

export function FormatBar({ palette, onCommand, onUndo, onRedo, onLink }: Props) {
  return (
    <View style={[styles.bar, { borderTopColor: palette.hairline, backgroundColor: palette.surface }]}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {TOOLS.map((tool) => (
          <Pressable
            key={tool.key}
            onPress={() => {
              if (tool.command === 'undo') {
                onUndo();
                return;
              }
              if (tool.command === 'redo') {
                onRedo();
                return;
              }
              if (tool.command === 'link') {
                onLink();
                return;
              }
              onCommand(tool.command);
            }}
            accessibilityRole="button"
            accessibilityLabel={tool.accessibilityLabel}
            style={[styles.tool, { borderColor: palette.hairline, backgroundColor: palette.canvas }]}
          >
            <Text style={[styles.label, { color: palette.ink, fontFamily: uiFontFamily() }]}>
              {tool.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export function asNativeCommand(command: FormatCommand): EditorCommand {
  return command;
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  content: {
    paddingHorizontal: tokens.spacing.scale.space8,
    paddingVertical: tokens.spacing.scale.space8,
    gap: tokens.spacing.scale.space8,
    alignItems: 'center',
  },
  tool: {
    minHeight: touchMin,
    minWidth: touchMin,
    paddingHorizontal: tokens.spacing.scale.space8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: tokens.radius.compact,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: editorBodySize,
    fontWeight: '600',
  },
});
