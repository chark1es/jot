import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '@jot/tokens/generated';
import type { DiagnosticEntry } from '@jot/local-store';
import type { SemanticPalette } from '@jot/ui-mobile';
import { ActionSheet } from '../../src/components/ActionSheet';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { Glyph } from '../../src/components/Glyph';
import { LargeTitle } from '../../src/components/LargeTitle';
import { exportEverything } from '../../src/export';
import { formatFullDate } from '../../src/format';
import { pressedStyle, touchMin, typeSize, uiFontFamily, usePalette } from '../../src/theme';
import { useVault } from '../../src/vault-context';

function shortId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function describeEvent(entry: DiagnosticEntry): string {
  const words = entry.eventType.replaceAll('_', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export default function SettingsScreen() {
  const palette = usePalette();
  const vault = useVault();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [diagnostics, setDiagnostics] = useState<readonly DiagnosticEntry[] | null>(null);
  const deviceName = Platform.OS === 'ios' ? 'this iPhone' : 'this device';

  const onExport = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setExported(false);
    try {
      await exportEverything(await vault.exportForShare());
      setExported(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Export did not finish. Your notes are unchanged.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]} edges={['top']}>
      <StatusBar style={palette.ink === tokens.color.dark.ink ? 'light' : 'dark'} />
      <LargeTitle palette={palette} title="Settings" />
      <ScrollView contentContainerStyle={styles.content}>
        <Section palette={palette} title="Storage">
          <Row
            palette={palette}
            title={vault.usingMemoryFallback ? 'Saved to a backup file' : `Stored on ${deviceName}`}
            detail={
              vault.usingMemoryFallback
                ? 'The database did not open, so search and version history are limited until Jot restarts.'
                : 'Notes save as you type. There is no account, and nothing leaves the device.'
            }
          />
        </Section>
        <Section palette={palette} title="Export">
          <Row
            palette={palette}
            title={busy ? 'Preparing export…' : 'Export everything'}
            detail="Markdown files and images in a .zip, shared from the share sheet."
            onPress={
              busy
                ? undefined
                : () => {
                    void onExport();
                  }
            }
          />
        </Section>
        {error !== null ? (
          <ErrorBanner
            palette={palette}
            message={error}
            actionLabel="Try again"
            onAction={() => {
              void onExport();
            }}
          />
        ) : null}
        {exported ? (
          <Text style={[styles.note, { color: palette.success, fontFamily: uiFontFamily() }]}>
            The export was handed to the share sheet.
          </Text>
        ) : null}
        <Section palette={palette} title="Troubleshooting">
          <Row
            palette={palette}
            title="Activity log"
            detail="Recent saves, repairs, and deletions on this device. It never includes note text."
            onPress={() => {
              void vault.listDiagnostics(40).then(setDiagnostics);
            }}
          />
        </Section>
        <Text style={[styles.footer, { color: palette.inkFaint, fontFamily: uiFontFamily() }]}>
          {`Jot ${Constants.expoConfig?.version ?? ''}`}
          {vault.deviceId === null ? '' : `  ·  Device ${shortId(vault.deviceId)}`}
        </Text>
      </ScrollView>
      <ActionSheet
        palette={palette}
        visible={diagnostics !== null}
        title="Activity log"
        {...(diagnostics?.length === 0 ? { message: 'Nothing has been logged yet.' } : {})}
        align="leading"
        cancelLabel="Done"
        actions={(diagnostics ?? []).map((entry, index) => ({
          key: `${String(entry.wallMs)}-${String(index)}`,
          label: describeEvent(entry),
          detail: formatFullDate(entry.wallMs),
          keepOpen: true,
          onPress: () => undefined,
        }))}
        onClose={() => {
          setDiagnostics(null);
        }}
      />
    </SafeAreaView>
  );
}

function Section({
  palette,
  title,
  children,
}: {
  readonly palette: SemanticPalette;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>{title}</Text>
      <View style={[styles.block, { borderColor: palette.hairline }]}>{children}</View>
    </View>
  );
}

function Row({
  palette,
  title,
  detail,
  onPress,
}: {
  readonly palette: SemanticPalette;
  readonly title: string;
  readonly detail: string;
  readonly onPress?: (() => void) | undefined;
}) {
  const body = (
    <>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: palette.ink, fontFamily: uiFontFamily() }]}>{title}</Text>
        <Text style={[styles.rowDetail, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>{detail}</Text>
      </View>
      {onPress !== undefined ? <Glyph name="chevron" color={palette.inkFaint} size={18} /> : null}
    </>
  );
  if (onPress === undefined) {
    return <View style={styles.row}>{body}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? palette.surface : palette.canvas }, pressedStyle(pressed)]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  content: {
    paddingBottom: tokens.spacing.scale.space32,
  },
  section: {
    paddingTop: tokens.spacing.scale.space16,
  },
  sectionTitle: {
    fontSize: typeSize.footnote,
    fontWeight: '600',
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingBottom: tokens.spacing.scale.space8,
  },
  block: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    minHeight: touchMin,
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingVertical: tokens.spacing.scale.space12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.scale.space12,
  },
  rowText: {
    flex: 1,
    gap: tokens.spacing.scale.space4,
  },
  rowTitle: {
    fontSize: typeSize.body,
  },
  rowDetail: {
    fontSize: typeSize.footnote,
  },
  note: {
    fontSize: typeSize.subhead,
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingTop: tokens.spacing.scale.space12,
  },
  footer: {
    fontSize: typeSize.footnote,
    textAlign: 'center',
    paddingTop: tokens.spacing.scale.space32,
  },
});
