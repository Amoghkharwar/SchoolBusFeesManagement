import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch } from '@/src/auth';
import { useTheme, spacing, fontSize } from '@/src/theme';
import { AlertModal, Button, TextField, DateTimeField } from '@/src/components/ui';

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
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(editing);

  useEffect(() => {
    apiFetch<School[]>('/schools').then(setSchools).catch(() => {});
    if (editing) {
      apiFetch(`/students/${id}`).then((s: any) => {
        setName(s.name); setParent(s.parent_name); setMobile(s.parent_mobile);
        setSchoolId(s.school_id); setStandard(s.standard); setPickup(s.pickup_location || '');
        setFee(String(s.yearly_fee)); setAdmission(s.admission_date); setDue(s.due_date);
      }).catch(() => {}).finally(() => setHydrating(false));
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
    const feeNum = parseFloat(fee);
    if (!Number.isFinite(feeNum) || feeNum <= 0) {
      setErr('Enter a valid yearly fee amount'); return;
    }
    if (!/^[6-9]\d{9}$/.test(mobile.trim())) {
      setErr('Enter a valid 10-digit mobile number'); return;
    }
    setLoading(true);
    try {
      const body = JSON.stringify({
        name: name.trim(), parent_name: parent.trim(), parent_mobile: mobile.trim(),
        school_id: schoolId, standard: standard.trim(), pickup_location: pickup,
        yearly_fee: feeNum, admission_date: admission, due_date: due,
      });
      if (editing) await apiFetch(`/students/${id}`, { method: 'PUT', body });
      else await apiFetch('/students', { method: 'POST', body });
      setSuccessMsg(editing ? 'Student updated successfully' : 'Student created successfully');
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
      {hydrating ? (
        <ActivityIndicator color={palette.brand} style={{ flex: 1 }} />
      ) : (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <TextField label="Student Name *" value={name} onChangeText={setName} testID="student-name" />
          <TextField label="Parent Name *" value={parent} onChangeText={setParent} testID="student-parent" />
          <TextField
            label="Parent Mobile (WhatsApp) *"
            value={mobile}
            onChangeText={(t) => setMobile(t.replace(/[^0-9]/g, '').slice(0, 10))}
            keyboardType="phone-pad"
            testID="student-mobile"
          />

          <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: 6 }}>School *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }} style={{ marginBottom: spacing.md }}>
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
          <TextField
            label="Yearly Bus Fee (₹) *"
            value={fee}
            onChangeText={(t) => setFee(t.replace(/[^0-9.]/g, ''))}
            keyboardType="numeric"
            testID="student-fee"
          />
          <DateTimeField label="Admission Date & Time" value={admission} onChange={setAdmission} required testID="student-admission" />
          <DateTimeField label="Due Date & Time" value={due} onChange={setDue} required testID="student-due" />

          <Button title={editing ? 'Save Changes' : 'Add Student'} onPress={submit} loading={loading} testID="student-submit" />
        </ScrollView>
      </KeyboardAvoidingView>
      )}

      <AlertModal
        visible={!!err}
        title="Cannot Save Student"
        message={err}
        onClose={() => setErr('')}
        testID="student-form-error"
      />

      <AlertModal
        visible={!!successMsg}
        variant="success"
        title="Success"
        message={successMsg}
        onClose={() => {
          setSuccessMsg('');
          if (editing) router.back();
          else router.replace('/(tabs)/students');
        }}
        testID="student-form-success"
      />
    </SafeAreaView>
  );
}
