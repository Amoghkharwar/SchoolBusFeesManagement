/**
 * Reusable Skeleton placeholder with a pulse animation.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, ViewStyle } from 'react-native';
import { useTheme, radii } from '@/src/theme';

export function Skeleton({ width, height, style, radius }: { width?: number | string; height?: number; style?: ViewStyle; radius?: number }) {
  const { palette } = useTheme();
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[
        {
          width: (width as any) ?? '100%',
          height: height ?? 14,
          borderRadius: radius ?? 6,
          backgroundColor: palette.surfaceTertiary,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function SkeletonCard() {
  const { palette } = useTheme();
  return (
    <View
      style={{
        backgroundColor: palette.surfaceSecondary,
        borderRadius: radii.lg,
        padding: 16,
        borderWidth: 1,
        borderColor: palette.border,
        marginBottom: 12,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Skeleton width={44} height={44} radius={22} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Skeleton width="60%" height={14} />
          <View style={{ height: 8 }} />
          <Skeleton width="40%" height={11} />
        </View>
        <Skeleton width={60} height={22} radius={11} />
      </View>
      <Skeleton width="80%" height={11} />
    </View>
  );
}

export function SkeletonKPI() {
  const { palette } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minWidth: '46%',
        backgroundColor: palette.surfaceSecondary,
        padding: 12,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: palette.border,
      }}
    >
      <Skeleton width={36} height={36} radius={18} />
      <View style={{ height: 10 }} />
      <Skeleton width="50%" height={11} />
      <View style={{ height: 6 }} />
      <Skeleton width="70%" height={20} />
    </View>
  );
}
