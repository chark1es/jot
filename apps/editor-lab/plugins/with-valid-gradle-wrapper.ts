import { cpSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import {
  withDangerousMod,
  withGradleProperties,
  type ConfigPlugin,
} from 'expo/config-plugins';

function reactNativeGradleWrapperJar(projectRoot: string): string {
  const requireFromApp = createRequire(join(resolve(projectRoot), 'package.json'));
  const jar = join(
    dirname(requireFromApp.resolve('react-native/package.json')),
    '..',
    '@react-native/gradle-plugin',
    'gradle',
    'wrapper',
    'gradle-wrapper.jar',
  );
  if (!existsSync(jar)) {
    throw new Error(`gradle-wrapper.jar missing at ${jar}`);
  }
  return jar;
}

const withValidGradleWrapper: ConfigPlugin = (config) => {
  const withJar = withDangerousMod(config, [
    'android',
    (mod) => {
      cpSync(
        reactNativeGradleWrapperJar(mod.modRequest.projectRoot),
        join(mod.modRequest.platformProjectRoot, 'gradle/wrapper/gradle-wrapper.jar'),
      );
      return mod;
    },
  ]);
  return withGradleProperties(withJar, (mod) => {
    const rest = mod.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'android.minSdkVersion'),
    );
    rest.push({ type: 'property', key: 'android.minSdkVersion', value: '29' });
    mod.modResults = rest;
    return mod;
  });
};

export default withValidGradleWrapper;
