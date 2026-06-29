/**
 * Small UI primitives — Button, TextField, Card, Badge, FAB, EmptyState.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii, fontSize } from '@/src/theme';

interface BtnProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'success' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  testID?: string;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  testID,
  fullWidth = true,
  style,
}: BtnProps) {
  const { palette } = useTheme();
  const bg =
    variant === 'primary'
      ? palette.brand
      : variant === 'secondary'
      ? palette.brandSecondary
      : variant === 'success'
      ? palette.success
      : variant === 'danger'
      ? palette.error
      : 'transparent';
  const fg =
    variant === 'primary' || variant === 'success' || variant === 'danger'
      ? '#fff'
      : palette.onBrandSecondary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radii.md,
          paddingVertical: 14,
          paddingHorizontal: spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed || disabled ? 0.7 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        variant === 'ghost' && { borderWidth: 1, borderColor: palette.border },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 8 }} />}
          <Text style={{ color: fg, fontSize: fontSize.lg, fontWeight: '600' }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

interface FieldProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
}

export function TextField({ label, error, leftIcon, style, ...rest }: FieldProps) {
  const { palette } = useTheme();
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label && (
        <Text
          style={{
            color: palette.onSurfaceSecondary,
            fontSize: fontSize.base,
            fontWeight: '500',
            marginBottom: 6,
          }}
        >
          {label}
        </Text>
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: error ? palette.error : palette.border,
          backgroundColor: palette.surfaceSecondary,
          borderRadius: radii.md,
          paddingHorizontal: spacing.md,
        }}
      >
        {leftIcon && (
          <Ionicons name={leftIcon} size={18} color={palette.muted} style={{ marginRight: 8 }} />
        )}
        <TextInput
          placeholderTextColor={palette.muted}
          style={[
            { flex: 1, paddingVertical: 12, color: palette.onSurface, fontSize: fontSize.lg },
            style as any,
          ]}
          {...rest}
        />
      </View>
      {error ? (
        <Text style={{ color: palette.error, fontSize: fontSize.sm, marginTop: 4 }}>{error}</Text>
      ) : null}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { palette, isDark } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: palette.surfaceSecondary,
          borderRadius: radii.lg,
          padding: spacing.lg,
          borderWidth: isDark ? 1 : 0,
          borderColor: palette.border,
          shadowColor: '#000',
          shadowOpacity: isDark ? 0 : 0.05,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: isDark ? 0 : 1,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { isDark } = useTheme();
  const meta =
    status === 'completed'
      ? { label: 'Paid', bg: '#D1FAE5', fg: '#065F46', dbg: '#064E3B', dfg: '#A7F3D0' }
      : status === 'partial'
      ? { label: 'Partial', bg: '#FEF3C7', fg: '#92400E', dbg: '#78350F', dfg: '#FDE68A' }
      : { label: 'Pending', bg: '#FEE2E2', fg: '#991B1B', dbg: '#7F1D1D', dfg: '#FECACA' };
  return (
    <View
      style={{
        backgroundColor: isDark ? meta.dbg : meta.bg,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: radii.pill,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: isDark ? meta.dfg : meta.fg, fontSize: fontSize.sm, fontWeight: '600' }}>
        {meta.label}
      </Text>
    </View>
  );
}

export function EmptyState({
  icon = 'document-text-outline',
  title,
  subtitle,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: spacing.xxl }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 999,
          backgroundColor: palette.brandTertiary,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.md,
        }}
      >
        <Ionicons name={icon} size={32} color={palette.brand} />
      </View>
      <Text style={{ fontSize: fontSize.lg, fontWeight: '600', color: palette.onSurface }}>
        {title}
      </Text>
      {subtitle && (
        <Text
          style={{
            marginTop: 4,
            fontSize: fontSize.base,
            color: palette.muted,
            textAlign: 'center',
          }}
        >
          {subtitle}
        </Text>
      )}
    </View>
  );
}

export function FAB({
  onPress,
  icon = 'add',
  testID,
}: {
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  testID?: string;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => ({
        position: 'absolute',
        right: spacing.lg,
        bottom: spacing.xl,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: palette.brand,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={icon} size={28} color="#fff" />
    </Pressable>
  );
}

export const styles = StyleSheet.create({});
