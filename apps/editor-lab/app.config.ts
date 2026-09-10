import type { ExpoConfig } from 'expo/config';
import { tokens } from '@jot/tokens/generated';

const config = {
  name: 'Editor lab',
  slug: 'jot-editor-lab',
  scheme: 'jot-editor-lab',
  version: '0.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  platforms: ['ios', 'android'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'app.jot.editorlab',
  },
  android: {
    package: 'app.jot.editorlab',
    adaptiveIcon: {
      backgroundColor: tokens.color.light.canvas,
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: ['expo-router', 'expo-dev-client', './plugins/with-valid-gradle-wrapper'],
  experiments: {
    autolinkingModuleResolution: true,
  },
} as ExpoConfig;

export default config;
