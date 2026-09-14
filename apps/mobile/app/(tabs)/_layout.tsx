import { StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Glyph } from '../../src/components/Glyph';
import { GlassSurface } from '../../src/components/GlassSurface';
import { typeSize, uiFontFamily, usePalette } from '../../src/theme';

export default function TabLayout() {
  const palette = usePalette();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.inkMuted,
        tabBarActiveBackgroundColor: 'transparent',
        tabBarInactiveBackgroundColor: 'transparent',
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarBackground: () => (
          <GlassSurface
            palette={palette}
            style={[styles.tabGlass, { borderTopColor: palette.hairline }]}
          />
        ),
        tabBarLabelStyle: {
          fontFamily: uiFontFamily(),
          fontSize: typeSize.caption,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Notes',
          tabBarIcon: ({ color, focused }) => (
            <Glyph name="notes" color={color} focused={focused} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color, focused }) => (
            <Glyph name="search" color={color} focused={focused} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <Glyph name="settings" color={color} focused={focused} size={24} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabGlass: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
