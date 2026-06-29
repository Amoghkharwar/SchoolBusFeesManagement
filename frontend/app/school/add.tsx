import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch } from '@/src/auth';
import { useTheme, spacing, fontSize } from '@/src/theme';
import { Button, TextField } from '@/src/components/ui';

export default function SchoolForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id && id !== 'add';
  const { palette } = useTheme();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (editing) {
      apiFetch(`/schools/${id}`).then((s: any) => {
        setName(s.name); setAddress(s.address || ''); setContact(s.contact_person || ''); setPhone(s.contact_phone || '');
      }).catch(() => {});
    }
  }, [editing, id]);

  const submit = async () => {
    setErr('');
    if (!name.trim()) { setErr('Name is required'); return; }
    setLoading(true);
    try {
      const body = JSON.stringify({ name: name.trim(), address, contact_person: contact, contact_phone: phone });
      if (editing) await apiFetch(`/schools/${id}`, { method: 'PUT', body });
      else await apiFetch('/schools', { method: 'POST', body });
      router.back();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <Pressable onPress={() => router.back()} style={{ padding: 6 }}><Ionicons name="chevron-back" size={24} color={palette.onSurface} /></Pressable>
        <Text style={{ flex: 1, fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface, marginLeft: 8 }}>{editing ? 'Edit School' : 'Add School'}</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <TextField label="School Name *" value={name} onChangeText={setName} testID="school-name" />
          <TextField label="Address" value={address} onChangeText={setAddress} testID="school-address" />
          <TextField label="Contact Person" value={contact} onChangeText={setContact} testID="school-contact" />
          <TextField label="Contact Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" testID="school-phone" />
          {err ? <Text style={{ color: palette.error, marginBottom: spacing.md }}>{err}</Text> : null}
          <Button title={editing ? 'Save Changes' : 'Add School'} onPress={submit} loading={loading} testID="school-submit" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
