import { tokens } from '@jolt/tokens/generated';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';

export default function Index() {
  const dark = useColorScheme() === 'dark';

  return (
    <View style={[styles.container, dark ? styles.containerDark : styles.containerLight]}>
      <Text style={[styles.title, dark ? styles.titleDark : styles.titleLight]}>Jolt</Text>
      <Text style={[styles.subtitle, dark ? styles.subtitleDark : styles.subtitleLight]}>
        Local notes. Your Drive. No account.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.scale.space24,
  },
  containerLight: {
    backgroundColor: tokens.color.light.canvas,
  },
  containerDark: {
    backgroundColor: tokens.color.dark.canvas,
  },
  title: {
    fontSize: 36,
    fontWeight: '600',
  },
  titleLight: {
    color: tokens.color.light.ink,
  },
  titleDark: {
    color: tokens.color.dark.ink,
  },
  subtitle: {
    marginTop: tokens.spacing.scale.space8,
    fontSize: 16,
  },
  subtitleLight: {
    color: tokens.color.light.inkMuted,
  },
  subtitleDark: {
    color: tokens.color.dark.inkMuted,
  },
});
