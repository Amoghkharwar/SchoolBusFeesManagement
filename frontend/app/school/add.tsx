import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch } from '@/src/auth';
import { useTheme, spacing, fontSize } from '@/src/theme';
import { AlertModal, Button, TextField } from '@/src/components/ui';

/** Same rule as SchoolIn.contact_phone on the server: optional, but 10 digits
 *  when given — a mobile, or a landline with its STD code (a leading 0 is fine). */
function phoneError(phone: string): string | undefined {
  const digits = phone.trim();
  if (!digits) return undefined;
  const local = digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  if (!/^[1-9]\d{9}$/.test(local)) {
    return 'Enter a 10-digit number — a mobile, or a landline with its STD code';
  }
  return undefined;
}

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
  const [fieldErr, setFieldErr] = useState<{ name?: string; phone?: string }>({});
  const [successMsg, setSuccessMsg] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(editing);

  useEffect(() => {
    if (editing) {
      apiFetch(`/schools/${id}`).then((s: any) => {
        setName(s.name); setAddress(s.address || ''); setContact(s.contact_person || ''); setPhone(s.contact_phone || '');
      }).catch(() => {}).finally(() => setHydrating(false));
    }
  }, [editing, id]);

  const submit = async () => {
    setErr('');
    const errs: { name?: string; phone?: string } = {};
    if (!name.trim()) errs.name = 'Enter the school name';
    if (phoneError(phone)) errs.phone = phoneError(phone);
    setFieldErr(errs);
    if (errs.name || errs.phone) return;
    setLoading(true);
    try {
      const body = JSON.stringify({ name: name.trim(), address, contact_person: contact, contact_phone: phone.trim() });
      if (editing) {
        await apiFetch(`/schools/${id}`, { method: 'PUT', body });
      } else {
        const created = await apiFetch<{ id: string }>('/schools', { method: 'POST', body });
        setCreatedId(created.id);
      }
      setSuccessMsg(
        editing
          ? `${name.trim()} updated successfully`
          : `${name.trim()} added successfully. You can now add students to this school.`,
      );
    } catch (e: any) {
      const msg = e.message || '';
      // "<name> is already added" belongs under the name, phone rules under the phone.
      if (/already added|school name/i.test(msg)) setFieldErr({ name: msg });
      else if (/phone/i.test(msg)) setFieldErr({ phone: msg });
      else setErr(msg);
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
      {hydrating ? (
        <ActivityIndicator color={palette.brand} style={{ flex: 1 }} />
      ) : (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
          <TextField
            label="School Name *"
            value={name}
            onChangeText={(t) => { setName(t); setFieldErr((f) => ({ ...f, name: undefined })); }}
            error={fieldErr.name}
            testID="school-name"
          />
          <TextField label="Address" value={address} onChangeText={setAddress} testID="school-address" />
          <TextField label="Contact Person" value={contact} onChangeText={setContact} testID="school-contact" />
          <TextField
            label="Contact Phone"
            value={phone}
            // Digits only, as the parent and worker numbers are; 11 leaves room
            // for a landline's leading 0.
            onChangeText={(t) => { setPhone(t.replace(/[^0-9]/g, '').slice(0, 11)); setFieldErr((f) => ({ ...f, phone: undefined })); }}
            keyboardType="phone-pad"
            error={fieldErr.phone}
            testID="school-phone"
          />
          <Button title={editing ? 'Save Changes' : 'Add School'} onPress={submit} loading={loading} testID="school-submit" />
        </ScrollView>
      </KeyboardAvoidingView>
      )}

      <AlertModal
        visible={!!err}
        title="Cannot Save School"
        message={err}
        onClose={() => setErr('')}
        testID="school-form-error"
      />

      <AlertModal
        visible={!!successMsg}
        variant="success"
        title={editing ? 'School Updated' : 'School Added'}
        message={successMsg}
        onClose={() => {
          setSuccessMsg('');
          // A new school opens on its own page, where its first students get added.
          if (createdId) router.replace(`/school/${createdId}` as any);
          else router.back();
        }}
        testID="school-form-success"
      />
    </SafeAreaView>
  );
}
