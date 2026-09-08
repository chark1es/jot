import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Jolt',
  slug: 'jolt',
  scheme: 'jolt',
  version: '0.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  platforms: ['ios', 'android'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'app.jolt.mobile',
  },
  android: {
    package: 'app.jolt.mobile',
    adaptiveIcon: {
      backgroundColor: '#f6f1e8',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: ['expo-router', 'expo-dev-client'],
  experiments: {
    autolinkingModuleResolution: true,
  },
};

export default config;
