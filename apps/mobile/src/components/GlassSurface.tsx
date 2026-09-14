import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { tokens } from '@jot/tokens/generated';
import type { SemanticPalette } from '@jot/ui-mobile';

type SurfaceProps = {
  readonly palette: SemanticPalette;
  readonly children?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly interactive?: boolean;
  readonly accessibilityLabel?: string;
};

export function GlassSurface({
  palette,
  children,
  style,
  interactive = false,
  accessibilityLabel,
}: SurfaceProps) {
  const reduceTransparency = useReduceTransparency();
  const dark = palette.ink === tokens.color.dark.ink;

  if (reduceTransparency) {
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        style={[styles.surface, { backgroundColor: palette.surface }, style]}
      >
        {children}
      </View>
    );
  }

  if (Platform.OS === 'ios' && isGlassEffectAPIAvailable()) {
    return (
      <GlassView
        accessibilityLabel={accessibilityLabel}
        glassEffectStyle="regular"
        isInteractive={interactive}
        style={[styles.surface, style]}
      >
        {children}
      </GlassView>
    );
  }

  return (
    <BlurView
      accessibilityLabel={accessibilityLabel}
      blurMethod="none"
      intensity={72}
      tint={dark ? 'systemMaterialDark' : 'systemMaterialLight'}
      style={[styles.surface, style]}
    >
      {children}
    </BlurView>
  );
}

function useReduceTransparency(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return undefined;
    }

    void AccessibilityInfo.isReduceTransparencyEnabled().then(setEnabled);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setEnabled,
    );
    return () => {
      subscription.remove();
    };
  }, []);

  return enabled;
}

const styles = StyleSheet.create({
  surface: {
    overflow: 'hidden',
  },
});
