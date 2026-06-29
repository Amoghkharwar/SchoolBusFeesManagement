import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Button, TextField } from '@/src/components/ui';
import { useAuth } from '@/src/auth';
import { useTheme, spacing, fontSize } from '@/src/theme';

const HERO = 'https://images.unsplash.com/photo-1649861742672-20152f77c1f5?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHwxfHxhYnN0cmFjdCUyMGdyZWVuJTIwZ3JhZGllbnQlMjBmaW5hbmNpYWwlMjBiYWNrZ3JvdW5kfGVufDB8fHx8MTc4MjYyMTA0MHww&ixlib=rb-4.1.0&q=85';

export default function Login() {
  const { login } = useAuth();
  const { palette } = useTheme();
  const [email, setEmail] = useState('admin@busfee.com');
  const [password, setPassword] = useState('Admin@123');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
      router.replace('/(tabs)/dashboard');
    } catch (e: any) {
      setError(e.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={{ height: 240, position: 'relative' }}>
          <Image source={{ uri: HERO }} style={StyleSheet.absoluteFill as any} contentFit="cover" />
          <LinearGradient
            colors={['rgba(11,17,16,0.2)', 'rgba(11,17,16,0.85)']}
            style={StyleSheet.absoluteFill}
          />
          <View style={{ position: 'absolute', bottom: spacing.xl, left: spacing.lg, right: spacing.lg }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                backgroundColor: '#5BA983',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: spacing.md,
              }}
            >
              <Ionicons name="bus" size={28} color="#0B1110" />
            </View>
            <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700' }}>Bus Fee Manager</Text>
            <Text style={{ color: '#E1E7E4', fontSize: fontSize.base, marginTop: 4 }}>
              Manage students, payments and pending fees.
            </Text>
          </View>
        </View>

        <View style={{ padding: spacing.xl }}>
          <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: spacing.lg }}>
            Welcome back
          </Text>

          <TextField
            label="Email"
            placeholder="admin@busfee.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            leftIcon="mail-outline"
            testID="login-email-input"
          />
          <TextField
            label="Password"
            placeholder="Your password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!show}
            leftIcon="lock-closed-outline"
            testID="login-password-input"
          />
          <Pressable onPress={() => setShow((s) => !s)} style={{ marginBottom: spacing.md }}>
            <Text style={{ color: palette.brand, fontSize: fontSize.sm }}>
              {show ? 'Hide' : 'Show'} password
            </Text>
          </Pressable>

          {error ? (
            <Text style={{ color: palette.error, marginBottom: spacing.md, fontSize: fontSize.base }} testID="login-error">
              {error}
            </Text>
          ) : null}

          <Button title="Login" onPress={submit} loading={loading} testID="login-submit-button" />

          <Pressable
            onPress={() => router.push('/(auth)/forgot')}
            style={{ alignSelf: 'center', marginTop: spacing.lg }}
            testID="login-forgot-link"
          >
            <Text style={{ color: palette.brand, fontSize: fontSize.base, fontWeight: '500' }}>
              Forgot password?
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
