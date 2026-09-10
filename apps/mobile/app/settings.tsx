import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '@jot/tokens/generated';
import { AppHeader } from '../src/components/AppHeader';
import { ErrorBanner } from '../src/components/ErrorBanner';
import { exportEverything } from '../src/export';
import { editorBodySize, touchMin, uiFontFamily, usePalette } from '../src/theme';
import { useVault } from '../src/vault-context';

export default function SettingsScreen() {
  const palette = usePalette();
  const vault = useVault();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const onExport = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const snapshot = await vault.exportForShare();
      await exportEverything(snapshot);
      setDone('Export is ready. Notes never left this device except through the share sheet you chose.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Export failed. Notes are still on this device. Try again while online or offline, export does not need a network.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]} edges={['top', 'bottom']}>
      <StatusBar style={palette.ink === tokens.color.dark.ink ? 'light' : 'dark'} />
      <AppHeader
        palette={palette}
        title="Settings"
        leftLabel="Notes"
        onLeft={() => {
          router.back();
        }}
      />
      <View style={styles.body}>
        <Text style={[styles.copy, { color: palette.ink, fontFamily: uiFontFamily() }]}>
          This device is offline-capable. Notes stay here. There is no account.
        </Text>
        <Text style={[styles.meta, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
          Device {vault.deviceId ?? '…'}
        </Text>
        {vault.usingMemoryFallback ? (
          <Text style={[styles.meta, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
            Local store is using on-device files until SQLite is linked.
          </Text>
        ) : null}
        <Pressable
          onPress={() => {
            void onExport();
          }}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Export everything now"
          style={[styles.export, { borderColor: palette.hairline }]}
        >
          <Text
            style={[
              styles.exportLabel,
              { color: busy ? palette.inkFaint : palette.accent, fontFamily: uiFontFamily() },
            ]}
          >
            {busy ? 'Exporting…' : 'Export everything now'}
          </Text>
        </Pressable>
        <Text style={[styles.meta, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
          Writes Markdown to cache, then opens the share sheet. Works offline.
        </Text>
        {error !== null ? (
          <ErrorBanner palette={palette} message={error} actionLabel="Try again" onAction={() => { void onExport(); }} />
        ) : null}
        {done !== null ? (
          <Text style={[styles.copy, { color: palette.success, fontFamily: uiFontFamily() }]}>{done}</Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  body: {
    padding: tokens.spacing.scale.space16,
    gap: tokens.spacing.scale.space12,
  },
  copy: {
    fontSize: editorBodySize,
  },
  meta: {
    fontSize: editorBodySize,
  },
  export: {
    minHeight: touchMin,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: tokens.radius.compact,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.scale.space12,
  },
  exportLabel: {
    fontSize: editorBodySize,
    fontWeight: '600',
  },
});
