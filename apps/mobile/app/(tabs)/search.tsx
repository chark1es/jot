import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '@jot/tokens/generated';
import type { SearchHit } from '@jot/local-store';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { Glyph } from '../../src/components/Glyph';
import { LargeTitle } from '../../src/components/LargeTitle';
import { GlassSurface } from '../../src/components/GlassSurface';
import { displayTitle, formatListDate } from '../../src/format';
import { pressedStyle, touchMin, typeSize, uiFontFamily, usePalette } from '../../src/theme';
import { useVault } from '../../src/vault-context';

const SEARCH_DELAY_MS = 150;

export default function SearchScreen() {
  const palette = usePalette();
  const vault = useVault();
  const [text, setText] = useState('');
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [searched, setSearched] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = text.trim();
    if (query.length === 0) {
      setHits([]);
      setSearched('');
      return;
    }
    const request = { cancelled: false };
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await vault.search({ text: query, limit: 50 });
          if (!request.cancelled) {
            setHits(result.hits);
            setSearched(query);
            setError(null);
          }
        } catch (caught) {
          if (!request.cancelled) {
            setError(caught instanceof Error ? caught.message : 'Search did not finish. Try again.');
          }
        }
      })();
    }, SEARCH_DELAY_MS);
    return () => {
      request.cancelled = true;
      clearTimeout(timer);
    };
  }, [text, vault]);

  const notesById = useMemo(() => new Map(vault.notes.map((note) => [note.id, note])), [vault.notes]);
  const results = hits.flatMap((hit) => {
    const note = notesById.get(hit.noteId);
    return note === undefined || note.trashed ? [] : [{ hit, note }];
  });

  const emptyMessage =
    text.trim().length === 0
      ? 'Search titles, text, and tags.'
      : searched.length > 0
        ? `No notes contain "${searched}".`
        : '';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]} edges={['top']}>
      <StatusBar style={palette.ink === tokens.color.dark.ink ? 'light' : 'dark'} />
      <LargeTitle palette={palette} title="Search" />
      <GlassSurface palette={palette} style={[styles.field, { borderColor: palette.hairline }]}>
        <Glyph name="search" color={palette.inkMuted} size={18} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Search notes"
          placeholderTextColor={palette.inkFaint}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
          accessibilityLabel="Search notes"
          style={[styles.input, { color: palette.ink, fontFamily: uiFontFamily() }]}
        />
        {text.length > 0 ? (
          <Pressable
            onPress={() => {
              setText('');
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={tokens.spacing.scale.space8}
            style={({ pressed }) => [styles.clear, pressedStyle(pressed)]}
          >
            <Glyph name="close" color={palette.inkMuted} size={18} />
          </Pressable>
        ) : null}
      </GlassSurface>
      {error !== null ? (
        <ErrorBanner
          palette={palette}
          message={error}
          actionLabel="Dismiss"
          onAction={() => {
            setError(null);
          }}
        />
      ) : null}
      <FlatList
        data={results}
        keyExtractor={(item) => item.note.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <Text style={[styles.empty, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>{emptyMessage}</Text>
        }
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: palette.hairline }]} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              router.push(`/note/${item.note.id}`);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${displayTitle(item.note.title)}. ${item.hit.snippet}`}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? palette.surface : palette.canvas }]}
          >
            <View style={styles.rowTop}>
              <Text numberOfLines={1} style={[styles.title, { color: palette.ink, fontFamily: uiFontFamily() }]}>
                {displayTitle(item.note.title)}
              </Text>
              <Text style={[styles.date, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
                {formatListDate(item.note.modifiedMs)}
              </Text>
            </View>
            {item.hit.snippet.length > 0 ? (
              <Text numberOfLines={2} style={[styles.snippet, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
                {item.hit.snippet}
              </Text>
            ) : null}
          </Pressable>
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
    marginHorizontal: tokens.spacing.scale.space16,
    marginBottom: tokens.spacing.scale.space8,
    paddingHorizontal: tokens.spacing.scale.space12,
    borderRadius: tokens.radius.control + tokens.spacing.scale.space2,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.scale.space8,
  },
  input: {
    flex: 1,
    minHeight: touchMin,
    fontSize: typeSize.body,
  },
  clear: {
    minWidth: touchMin,
    minHeight: touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    minHeight: touchMin,
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingVertical: tokens.spacing.scale.space12,
    gap: tokens.spacing.scale.space4,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: tokens.spacing.scale.space8,
  },
  title: {
    flex: 1,
    fontSize: typeSize.body,
    fontWeight: '600',
  },
  date: {
    fontSize: typeSize.footnote,
    fontVariant: ['tabular-nums'],
  },
  snippet: {
    fontSize: typeSize.subhead,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: tokens.spacing.scale.space16,
  },
  empty: {
    fontSize: typeSize.subhead,
    textAlign: 'center',
    paddingHorizontal: tokens.spacing.scale.space32,
    paddingTop: tokens.spacing.scale.space48,
  },
});
