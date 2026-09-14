import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { VaultProvider } from '../src/vault-context';

export default function Layout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <VaultProvider>
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
        </VaultProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
