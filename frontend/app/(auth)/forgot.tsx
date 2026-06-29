import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Button, TextField } from '@/src/components/ui';
import { apiFetch } from '@/src/auth';
import { useTheme, spacing, fontSize, radii } from '@/src/theme';

type Step = 'request' | 'verify';

export default function Forgot() {
  const { palette } = useTheme();
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('kharwaramog02@gmail.com');
  const [otp, setOtp] = useState('');
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const requestOtp = async () => {
    setErr('');
    setMsg('');
    setLoading(true);
    try {
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      setMsg('Approval code sent. Check your email and enter the 6-digit code below.');
      setStep('verify');
    } catch (e: any) {
      setErr(e.message || 'Could not send code');
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setErr('');
    setMsg('');
    if (pwd !== pwd2) {
      setErr('Passwords do not match');
      return;
    }
    if (pwd.length < 6) {
      setErr('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      await apiFetch('/auth/verify-reset', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), otp: otp.trim(), new_password: pwd }),
      });
      setMsg('Password approved. Redirecting to login…');
      setTimeout(() => router.replace('/(auth)/login'), 900);
    } catch (e: any) {
      setErr(e.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingTop: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => router.back()} testID="forgot-back" style={{ marginBottom: spacing.lg }}>
          <Ionicons name="chevron-back" size={26} color={palette.onSurface} />
        </Pressable>

        <Text style={{ fontSize: 28, fontWeight: '700', color: palette.onSurface }}>
          Forgot Password
        </Text>
        <Text style={{ color: palette.muted, marginTop: 4, marginBottom: spacing.lg }}>
          {step === 'request'
            ? 'Enter your registered email. We will send an approval code.'
            : 'Enter the code from your email and choose a new password.'}
        </Text>

        <View
          style={{
            backgroundColor: '#FEF3C7',
            borderRadius: radii.md,
            padding: spacing.md,
            marginBottom: spacing.lg,
            flexDirection: 'row',
            gap: 8,
          }}
        >
          <Ionicons name="shield-checkmark" size={18} color="#92400E" />
          <Text style={{ color: '#92400E', flex: 1, fontSize: fontSize.sm }}>
            For security, the new password is only activated after you approve via the email code.
          </Text>
        </View>

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          leftIcon="mail-outline"
          editable={step === 'request'}
          testID="forgot-email"
        />

        {step === 'verify' && (
          <>
            <TextField
              label="6-digit Approval Code"
              value={otp}
              onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              leftIcon="key-outline"
              testID="forgot-otp"
              maxLength={6}
            />
            <TextField
              label="New Password"
              value={pwd}
              onChangeText={setPwd}
              secureTextEntry
              leftIcon="lock-closed-outline"
              testID="forgot-new-password"
            />
            <TextField
              label="Confirm New Password"
              value={pwd2}
              onChangeText={setPwd2}
              secureTextEntry
              leftIcon="lock-closed-outline"
              testID="forgot-confirm-password"
            />
          </>
        )}

        {err ? (
          <Text style={{ color: palette.error, marginBottom: spacing.md }} testID="forgot-error">
            {err}
          </Text>
        ) : null}
        {msg ? (
          <Text style={{ color: palette.success, marginBottom: spacing.md }} testID="forgot-msg">
            {msg}
          </Text>
        ) : null}

        {step === 'request' ? (
          <Button title="Send Approval Code" onPress={requestOtp} loading={loading} testID="forgot-send-otp" />
        ) : (
          <Button title="Approve & Set Password" onPress={verify} loading={loading} testID="forgot-verify" />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
