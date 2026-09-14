import type { ExpoConfig } from 'expo/config';

const config = {
  name: 'Jot',
  slug: 'jot',
  scheme: 'jot',
  version: '0.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  platforms: ['ios', 'android'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'app.jot.mobile',
  },
  android: {
    package: 'app.jot.mobile',
    adaptiveIcon: {
      // Android adaptive icon still needs a hex color here.
      // eslint-disable-next-line tokens/no-raw-design-values -- Expo adaptiveIcon.backgroundColor
      backgroundColor: '#f6f5f1',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-dev-client',
    'expo-font',
    'expo-file-system',
    'expo-sharing',
    './plugins/with-valid-gradle-wrapper',
  ],
  experiments: {
    autolinkingModuleResolution: true,
  },
} as ExpoConfig;

export default config;
