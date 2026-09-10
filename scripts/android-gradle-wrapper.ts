import { cpSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

export function resolveReactNativeGradleWrapperJar(projectRoot: string): string {
  const root = resolve(projectRoot);
  const requireFromApp = createRequire(join(root, 'package.json'));
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

export function replaceGradleWrapperJar(projectRoot: string): void {
  const dest = join(resolve(projectRoot), 'android/gradle/wrapper/gradle-wrapper.jar');
  if (!existsSync(dirname(dest))) {
    return;
  }
  cpSync(resolveReactNativeGradleWrapperJar(projectRoot), dest);
}
