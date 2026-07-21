import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch } from '@/src/auth';
import { useTheme, spacing, fontSize } from '@/src/theme';
import { Button, TextField, DateTimeField } from '@/src/components/ui';

interface School { id: string; name: string }

export default function StudentForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id && id !== 'add';
  const { palette } = useTheme();
  const [schools, setSchools] = useState<School[]>([]);
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [mobile, setMobile] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [standard, setStandard] = useState('');
  const [pickup, setPickup] = useState('');
  const [fee, setFee] = useState('');
  const [admission, setAdmission] = useState(new Date().toISOString());
  const [due, setDue] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<School[]>('/schools').then(setSchools).catch(() => {});
    if (editing) {
      apiFetch(`/students/${id}`).then((s: any) => {
        setName(s.name); setParent(s.parent_name); setMobile(s.parent_mobile);
        setSchoolId(s.school_id); setStandard(s.standard); setPickup(s.pickup_location || '');
        setFee(String(s.yearly_fee)); setAdmission(s.admission_date); setDue(s.due_date);
      }).catch(() => {});
    } else {
      setAdmission(new Date().toISOString());
    }
  }, [editing, id]);

  const submit = async () => {
    setErr('');
    if (!name.trim() || !parent.trim() || !mobile.trim() || !schoolId || !standard.trim() || !fee || !admission || !due) {
      setErr('Please fill all required fields'); return;
    }
    if (!admission) { setErr('Please select an admission date'); return; }
    if (!due) { setErr('Please select a due date'); return; }
    setLoading(true);
    try {
      const body = JSON.stringify({
        name: name.trim(), parent_name: parent.trim(), parent_mobile: mobile.trim(),
        school_id: schoolId, standard: standard.trim(), pickup_location: pickup,
        yearly_fee: parseFloat(fee), admission_date: admission, due_date: due,
      });
      if (editing) await apiFetch(`/students/${id}`, { method: 'PUT', body });
      else await apiFetch('/students', { method: 'POST', body });
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
        <Text style={{ flex: 1, fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface, marginLeft: 8 }}>{editing ? 'Edit Student' : 'Add Student'}</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <TextField label="Student Name *" value={name} onChangeText={setName} testID="student-name" />
          <TextField label="Parent Name *" value={parent} onChangeText={setParent} testID="student-parent" />
          <TextField label="Parent Mobile (WhatsApp) *" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" testID="student-mobile" />

          <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: 6 }}>School *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginBottom: spacing.md }}>
            {schools.map((s) => {
              const active = schoolId === s.id;
              return (
                <Pressable
                  key={s.id}
                  testID={`student-school-${s.id}`}
                  onPress={() => setSchoolId(s.id)}
                  style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? palette.brand : palette.surfaceTertiary, borderWidth: 1, borderColor: active ? palette.brand : palette.border }}
                >
                  <Text style={{ color: active ? '#fff' : palette.onSurface, fontWeight: '600', fontSize: fontSize.sm }}>{s.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <TextField label="Standard / Class *" value={standard} onChangeText={setStandard} testID="student-standard" />
          <TextField label="Pickup Location" value={pickup} onChangeText={setPickup} testID="student-pickup" />
          <TextField label="Yearly Bus Fee (₹) *" value={fee} onChangeText={setFee} keyboardType="numeric" testID="student-fee" />
          <DateTimeField label="Admission Date & Time" value={admission} onChange={setAdmission} required testID="student-admission" />
          <DateTimeField label="Due Date & Time" value={due} onChange={setDue} required testID="student-due" />

          {err ? <Text style={{ color: palette.error, marginBottom: spacing.md }}>{err}</Text> : null}
          <Button title={editing ? 'Save Changes' : 'Add Student'} onPress={submit} loading={loading} testID="student-submit" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
