import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch } from '@/src/auth';
import { useTheme, spacing, radii, fontSize } from '@/src/theme';
import { AlertModal, Button, TextField, DateTimeField } from '@/src/components/ui';
import { wholeRupeeError } from '@/src/utils/format';

type FieldKey = 'name' | 'mobile' | 'salary' | 'joinDate';

/** Which field a server rejection is about, so it can sit under that field
 *  instead of in a popup. Anything unrecognised still goes to the popup. */
function fieldForServerError(msg: string): FieldKey | null {
  if (/mobile/i.test(msg)) return 'mobile';
  if (/joining date|salary month .* starts/i.test(msg)) return 'joinDate';
  if (/salary/i.test(msg)) return 'salary';
  if (/name/i.test(msg)) return 'name';
  return null;
}

/** Local midnight today — the latest day a joining date can be. */
const todayLocal = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export default function WorkerForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id && id !== 'add';
  const { palette } = useTheme();

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [designation, setDesignation] = useState('');
  const [salary, setSalary] = useState('');
  const [joinDate, setJoinDate] = useState(new Date().toISOString());
  const [active, setActive] = useState(true);
  const [err, setErr] = useState('');
  const [fieldErr, setFieldErr] = useState<Partial<Record<FieldKey, string>>>({});
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(editing);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Same reason as the worker screen: this route can be the first history entry.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/work' as any);
  };

  useEffect(() => {
    if (!editing) {
      setJoinDate(todayLocal().toISOString());
      return;
    }
    apiFetch(`/workers/${id}`)
      .then((w: any) => {
        setName(w.name);
        setMobile(w.mobile || '');
        setDesignation(w.designation || '');
        setSalary(String(w.monthly_salary));
        setJoinDate(w.join_date);
        setActive(w.active !== false);
      })
      .catch(() => {})
      .finally(() => setHydrating(false));
  }, [editing, id]);

  const submit = async () => {
    setErr('');
    const salaryNum = parseInt(salary, 10);
    const errs: Partial<Record<FieldKey, string>> = {};
    if (!name.trim()) errs.name = "Enter the worker's name";
    if (mobile.trim() && !/^[6-9]\d{9}$/.test(mobile.trim())) {
      errs.mobile = 'Enter a valid 10-digit mobile number, or leave it blank';
    }
    if (!salary) errs.salary = 'Enter the monthly salary';
    else if (wholeRupeeError(salary)) errs.salary = wholeRupeeError(salary);
    else if (!Number.isFinite(salaryNum) || salaryNum <= 0) errs.salary = 'Enter a salary above ₹0';
    if (!joinDate) errs.joinDate = 'Pick the joining date';
    else if (new Date(joinDate) > new Date()) errs.joinDate = 'Joining date cannot be in the future';
    setFieldErr(errs);
    if (Object.keys(errs).length) return;
    setLoading(true);
    try {
      const body = JSON.stringify({
        name: name.trim(),
        mobile: mobile.trim(),
        designation: designation.trim(),
        monthly_salary: salaryNum,
        join_date: joinDate,
        active,
      });
      if (editing) {
        await apiFetch(`/workers/${id}`, { method: 'PUT', body });
        setSuccessMsg('Worker updated successfully');
      } else {
        const created = await apiFetch<{ id: string }>('/workers', { method: 'POST', body });
        setCreatedId(created.id);
        setSuccessMsg('Worker added. Next, add the salary month so payments can be tracked against it.');
      }
    } catch (e: any) {
      const field = fieldForServerError(e.message || '');
      if (field) setFieldErr({ [field]: e.message });
      else setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Typing into a field clears its own complaint, not the others'.
  const clearErr = (k: FieldKey) => setFieldErr((f) => (f[k] ? { ...f, [k]: undefined } : f));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <Pressable onPress={goBack} style={{ padding: 6 }} testID="worker-form-back">
          <Ionicons name="chevron-back" size={24} color={palette.onSurface} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface, marginLeft: 8 }}>
          {editing ? 'Edit Worker' : 'Add Worker'}
        </Text>
      </View>

      {hydrating ? (
        <ActivityIndicator color={palette.brand} style={{ flex: 1 }} />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            <TextField
              label="Worker Name *"
              value={name}
              onChangeText={(t) => { setName(t); clearErr('name'); }}
              error={fieldErr.name}
              testID="worker-name"
            />
            <TextField
              label="Mobile (optional)"
              value={mobile}
              onChangeText={(t) => { setMobile(t.replace(/[^0-9]/g, '').slice(0, 10)); clearErr('mobile'); }}
              keyboardType="phone-pad"
              error={fieldErr.mobile}
              testID="worker-mobile"
            />
            <TextField
              label="Role / Designation"
              placeholder="Driver, Cleaner, Helper…"
              value={designation}
              onChangeText={setDesignation}
              testID="worker-designation"
            />
            <TextField
              label="Monthly Salary (₹) *"
              value={salary}
              // Whole rupees. The "." stays visible and gets flagged — stripping
              // it merged the paise into the rupees (6000.75 → 600075).
              onChangeText={(t) => { setSalary(t.replace(/[^0-9.]/g, '')); clearErr('salary'); }}
              keyboardType="number-pad"
              error={fieldErr.salary || wholeRupeeError(salary)}
              testID="worker-salary"
            />
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: -6, marginBottom: spacing.md }}>
              Used to pre-fill each new salary month. Every month stores its own amount, so changing this never rewrites past months.
            </Text>

            <DateTimeField
              label="Joining Date"
              mode="date"
              maxDate={todayLocal()}
              value={joinDate}
              onChange={(v) => { setJoinDate(v); clearErr('joinDate'); }}
              error={fieldErr.joinDate}
              required
              testID="worker-join-date"
            />

            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: 6 }}>Status</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.lg }}>
              {[
                { key: true, label: 'Active' },
                { key: false, label: 'Inactive' },
              ].map((opt) => {
                const isOn = active === opt.key;
                return (
                  <Pressable
                    key={String(opt.key)}
                    testID={`worker-active-${opt.key}`}
                    onPress={() => setActive(opt.key)}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: radii.md,
                      alignItems: 'center',
                      backgroundColor: isOn ? palette.brand : palette.surfaceTertiary,
                      borderWidth: 1,
                      borderColor: isOn ? palette.brand : palette.border,
                    }}
                  >
                    <Text style={{ color: isOn ? '#fff' : palette.onSurface, fontWeight: '600' }}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Button
              title={editing ? 'Save Changes' : 'Add Worker'}
              onPress={submit}
              loading={loading}
              testID="worker-submit"
            />
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <AlertModal
        visible={!!err}
        title="Cannot Save Worker"
        message={err}
        onClose={() => setErr('')}
        testID="worker-form-error"
      />

      <AlertModal
        visible={!!successMsg}
        variant="success"
        title="Success"
        message={successMsg}
        onClose={() => {
          setSuccessMsg('');
          if (editing) goBack();
          else if (createdId) router.replace(`/worker/${createdId}` as any);
          else router.replace('/(tabs)/work' as any);
        }}
        testID="worker-form-success"
      />
    </SafeAreaView>
  );
}
