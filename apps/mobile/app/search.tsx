import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '@jot/tokens/generated';
import type { SearchHit } from '@jot/local-store';
import { AppHeader } from '../src/components/AppHeader';
import { ErrorBanner } from '../src/components/ErrorBanner';
import { editorBodySize, touchMin, uiFontFamily, usePalette } from '../src/theme';
import { useVault } from '../src/vault-context';

export default function SearchScreen() {
  const palette = usePalette();
  const vault = useVault();
  const [text, setText] = useState('');
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      void (async () => {
        const query = text.trim();
        if (query.length === 0) {
          setHits([]);
          return;
        }
        try {
          const result = await vault.search({ text: query, limit: 50 });
          setHits(result.hits);
          setError(null);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Search failed.');
        }
      })();
    }, tokens.motion.duration.standard);
    return () => {
      clearTimeout(handle);
    };
  }, [text, vault]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]} edges={['top', 'bottom']}>
      <StatusBar style={palette.ink === tokens.color.dark.ink ? 'light' : 'dark'} />
      <AppHeader
        palette={palette}
        title="Search"
        leftLabel="Notes"
        onLeft={() => {
          router.back();
        }}
      />
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Find notes"
        placeholderTextColor={palette.inkFaint}
        autoFocus
        autoCorrect={false}
        accessibilityLabel="Search notes"
        style={[
          styles.field,
          {
            color: palette.ink,
            borderBottomColor: palette.hairline,
            fontFamily: uiFontFamily(),
            fontSize: editorBodySize,
          },
        ]}
      />
      {error !== null ? (
        <ErrorBanner palette={palette} message={error} actionLabel="Dismiss" onAction={() => { setError(null); }} />
      ) : null}
      <FlatList
        data={hits}
        keyExtractor={(item) => item.noteId}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={[styles.empty, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
            {text.trim().length === 0 ? 'Type to search local notes.' : 'No matches.'}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              router.push(`/note/${item.noteId}`);
            }}
            accessibilityRole="button"
            accessibilityLabel={item.snippet}
            style={styles.row}
          >
            <Text style={[styles.snippet, { color: palette.ink, fontFamily: uiFontFamily() }]}>
              {item.snippet}
            </Text>
          </Pressable>
        )}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: palette.hairline }]} />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  field: {
    minHeight: touchMin,
    paddingHorizontal: tokens.spacing.scale.space16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    minHeight: touchMin,
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingVertical: tokens.spacing.scale.space12,
    justifyContent: 'center',
  },
  snippet: {
    fontSize: editorBodySize,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: tokens.spacing.scale.space16,
  },
  empty: {
    fontSize: editorBodySize,
    padding: tokens.spacing.scale.space16,
  },
});
