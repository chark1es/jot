import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { EditorCommand } from '@jot/editor-native';
import { tokens } from '@jot/tokens/generated';
import type { SemanticPalette } from '@jot/ui-mobile';
import { pressedStyle, touchMin, typeSize, uiFontFamily } from '../theme';
import { GlassSurface } from './GlassSurface';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type FormatState = {
  readonly marks: ReadonlySet<string>;
  readonly blockKind: string;
  readonly headingLevel: number | undefined;
  readonly inQuote: boolean;
};

export const EMPTY_FORMAT_STATE: FormatState = {
  marks: new Set(),
  blockKind: 'paragraph',
  headingLevel: undefined,
  inQuote: false,
};

type Props = {
  readonly palette: SemanticPalette;
  readonly state: FormatState;
  readonly panelOpen: boolean;
  readonly keyboardVisible: boolean;
  readonly bottomInset: number;
  readonly onTogglePanel: () => void;
  readonly onCommand: (command: EditorCommand) => void;
  readonly onInsertImage: () => void;
  readonly onLink: () => void;
  readonly onDismissKeyboard: () => void;
};

type StyleOption = {
  readonly key: string;
  readonly label: string;
  readonly command: EditorCommand;
  readonly active: (state: FormatState) => boolean;
};

const STYLES: readonly StyleOption[] = [
  {
    key: 'title',
    label: 'Title',
    command: { name: 'setHeading', level: 1 },
    active: (state) => state.blockKind === 'heading' && state.headingLevel === 1,
  },
  {
    key: 'heading',
    label: 'Heading',
    command: { name: 'setHeading', level: 2 },
    active: (state) => state.blockKind === 'heading' && state.headingLevel === 2,
  },
  {
    key: 'subheading',
    label: 'Subheading',
    command: { name: 'setHeading', level: 3 },
    active: (state) => state.blockKind === 'heading' && (state.headingLevel ?? 0) >= 3,
  },
  {
    key: 'body',
    label: 'Body',
    command: { name: 'setParagraph' },
    active: (state) => state.blockKind === 'paragraph',
  },
  {
    key: 'mono',
    label: 'Monospaced',
    command: { name: 'toggleCodeBlock' },
    active: (state) => state.blockKind === 'codeBlock',
  },
];

type Tool = {
  readonly key: string;
  readonly icon: IconName;
  readonly label: string;
  readonly command: EditorCommand;
  readonly active: (state: FormatState) => boolean;
};

const MARK_TOOLS: readonly Tool[] = [
  { key: 'bold', icon: 'format-bold', label: 'Bold', command: { name: 'toggleBold' }, active: (s) => s.marks.has('bold') },
  { key: 'italic', icon: 'format-italic', label: 'Italic', command: { name: 'toggleItalic' }, active: (s) => s.marks.has('italic') },
  {
    key: 'underline',
    icon: 'format-underline',
    label: 'Underline',
    command: { name: 'toggleUnderline' },
    active: (s) => s.marks.has('underline'),
  },
  {
    key: 'strike',
    icon: 'format-strikethrough-variant',
    label: 'Strikethrough',
    command: { name: 'toggleStrikethrough' },
    active: (s) => s.marks.has('strikethrough'),
  },
  {
    key: 'code',
    icon: 'code-tags',
    label: 'Inline code',
    command: { name: 'toggleInlineCode' },
    active: (s) => s.marks.has('inlineCode'),
  },
];

const BLOCK_TOOLS: readonly Tool[] = [
  {
    key: 'numbered',
    icon: 'format-list-numbered',
    label: 'Numbered list',
    command: { name: 'toggleOrderedList' },
    active: (s) => s.blockKind === 'orderedItem',
  },
  {
    key: 'quote',
    icon: 'format-quote-close',
    label: 'Quote',
    command: { name: 'toggleBlockquote' },
    active: (s) => s.inQuote,
  },
  {
    key: 'divider',
    icon: 'minus',
    label: 'Divider',
    command: { name: 'insertHorizontalRule' },
    active: () => false,
  },
];

export function FormatBar({
  palette,
  state,
  panelOpen,
  keyboardVisible,
  bottomInset,
  onTogglePanel,
  onCommand,
  onInsertImage,
  onLink,
  onDismissKeyboard,
}: Props) {
  return (
    <GlassSurface
      palette={palette}
      style={[
        styles.wrap,
        {
          borderTopColor: palette.hairline,
          paddingBottom: keyboardVisible ? 0 : bottomInset,
        },
      ]}
    >
      {panelOpen ? (
        <View style={[styles.panel, { borderBottomColor: palette.hairline }]}>
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.styleRow}
          >
            {STYLES.map((option) => {
              const active = option.active(state);
              return (
                <Pressable
                  key={option.key}
                  onPress={() => {
                    onCommand(option.command);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={option.label}
                  style={({ pressed }) => [
                    styles.styleChip,
                    { backgroundColor: active ? palette.accentMuted : palette.surface },
                    pressedStyle(pressed),
                  ]}
                >
                  <Text
                    style={[
                      styles.styleLabel,
                      option.key === 'title' ? styles.styleTitle : null,
                      option.key === 'heading' ? styles.styleHeading : null,
                      option.key === 'mono' ? styles.styleMono : null,
                      { color: palette.ink, fontFamily: option.key === 'mono' ? 'Menlo' : uiFontFamily() },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toolRow}
          >
            <View style={[styles.group, { backgroundColor: palette.surface }]}>
              {MARK_TOOLS.map((tool) => (
                <ToolButton key={tool.key} palette={palette} tool={tool} state={state} onCommand={onCommand} />
              ))}
            </View>
            <View style={[styles.group, { backgroundColor: palette.surface }]}>
              {BLOCK_TOOLS.map((tool) => (
                <ToolButton key={tool.key} palette={palette} tool={tool} state={state} onCommand={onCommand} />
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}
      <View style={styles.bar}>
        <IconButton
          palette={palette}
          icon="format-text"
          label={panelOpen ? 'Hide text styles' : 'Text styles'}
          active={panelOpen}
          onPress={onTogglePanel}
        />
        <IconButton
          palette={palette}
          icon="checkbox-marked-circle-outline"
          label="Checklist"
          active={state.blockKind === 'taskItem'}
          onPress={() => {
            onCommand({ name: 'toggleTaskList' });
          }}
        />
        <IconButton
          palette={palette}
          icon="format-list-bulleted"
          label="Bulleted list"
          active={state.blockKind === 'bulletItem'}
          onPress={() => {
            onCommand({ name: 'toggleBulletList' });
          }}
        />
        <IconButton palette={palette} icon="image-outline" label="Add image" onPress={onInsertImage} />
        <IconButton
          palette={palette}
          icon="link-variant"
          label={state.marks.has('link') ? 'Edit link' : 'Add link'}
          active={state.marks.has('link')}
          onPress={onLink}
        />
        <View style={styles.spacer} />
        {keyboardVisible ? (
          <IconButton palette={palette} icon="keyboard-close" label="Hide keyboard" onPress={onDismissKeyboard} />
        ) : null}
      </View>
    </GlassSurface>
  );
}

function ToolButton({
  palette,
  tool,
  state,
  onCommand,
}: {
  readonly palette: SemanticPalette;
  readonly tool: Tool;
  readonly state: FormatState;
  readonly onCommand: (command: EditorCommand) => void;
}) {
  return (
    <IconButton
      palette={palette}
      icon={tool.icon}
      label={tool.label}
      active={tool.active(state)}
      compact
      onPress={() => {
        onCommand(tool.command);
      }}
    />
  );
}

function IconButton({
  palette,
  icon,
  label,
  active = false,
  compact = false,
  onPress,
}: {
  readonly palette: SemanticPalette;
  readonly icon: IconName;
  readonly label: string;
  readonly active?: boolean;
  readonly compact?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={compact ? 0 : tokens.spacing.scale.space4}
      style={({ pressed }) => [
        compact ? styles.compactButton : styles.button,
        active ? { backgroundColor: palette.accentMuted } : null,
        pressedStyle(pressed),
      ]}
    >
      <MaterialCommunityIcons name={icon} size={compact ? 22 : 24} color={active ? palette.accent : palette.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  panel: {
    paddingTop: tokens.spacing.scale.space8,
    paddingBottom: tokens.spacing.scale.space8,
    gap: tokens.spacing.scale.space8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  styleRow: {
    paddingHorizontal: tokens.spacing.scale.space12,
    gap: tokens.spacing.scale.space8,
    alignItems: 'center',
  },
  styleChip: {
    minHeight: touchMin,
    paddingHorizontal: tokens.spacing.scale.space12,
    borderRadius: tokens.radius.control,
    justifyContent: 'center',
  },
  styleLabel: {
    fontSize: typeSize.subhead,
  },
  styleTitle: {
    fontWeight: '700',
    fontSize: typeSize.body,
  },
  styleHeading: {
    fontWeight: '600',
  },
  styleMono: {
    fontSize: typeSize.footnote,
  },
  toolRow: {
    flexDirection: 'row',
    paddingHorizontal: tokens.spacing.scale.space12,
    gap: tokens.spacing.scale.space8,
  },
  group: {
    flexDirection: 'row',
    borderRadius: tokens.radius.control,
    padding: tokens.spacing.scale.space2,
  },
  bar: {
    minHeight: touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: tokens.spacing.scale.space8,
    gap: tokens.spacing.scale.space4,
  },
  spacer: {
    flex: 1,
  },
  button: {
    minWidth: touchMin,
    minHeight: touchMin,
    borderRadius: tokens.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactButton: {
    minWidth: touchMin,
    minHeight: touchMin,
    borderRadius: tokens.radius.compact + tokens.spacing.scale.space2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
