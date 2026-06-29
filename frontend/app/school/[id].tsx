import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch } from '@/src/auth';
import { useTheme, spacing, fontSize, radii } from '@/src/theme';
import { Card, EmptyState } from '@/src/components/ui';
import { formatINR, openWhatsApp, reminderMessage, formatDate } from '@/src/utils/format';

interface Student {
  id: string; name: string; parent_mobile: string; parent_name: string;
  standard: string; school_name: string;
  yearly_fee: number; paid_amount: number; pending_amount: number;
  status: string; due_date: string;
}

const TABS: { key: 'pending' | 'partial' | 'completed'; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'partial', label: 'Partial' },
  { key: 'completed', label: 'Paid' },
];

export default function SchoolDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { palette } = useTheme();
  const [school, setSchool] = useState<any>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [tab, setTab] = useState<'pending' | 'partial' | 'completed'>('pending');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [sc, st] = await Promise.all([
        apiFetch(`/schools/${id}`),
        apiFetch<Student[]>(`/students?school_id=${id}`),
      ]);
      setSchool(sc);
      setStudents(st);
    } catch (e: any) {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = students.filter((s) => s.status === tab);
  const totals = students.reduce(
    (a, s) => {
      a.yearly += s.yearly_fee;
      a.paid += s.paid_amount;
      a.pending += s.pending_amount;
      return a;
    },
    { yearly: 0, paid: 0, pending: 0 },
  );

  const remove = async () => {
    Alert.alert?.('Delete school?', 'This will remove all students and payments.', [
      { text: 'Cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await apiFetch(`/schools/${id}`, { method: 'DELETE' });
          router.back();
        },
      },
    ]);
  };

  if (loading || !school) return <ActivityIndicator color={palette.brand} style={{ flex: 1, marginTop: 80 }} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <Pressable onPress={() => router.back()} testID="school-back" style={{ padding: 6 }}>
          <Ionicons name="chevron-back" size={24} color={palette.onSurface} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface, marginLeft: 8 }}>{school.name}</Text>
        <Pressable testID="school-edit" onPress={() => router.push(`/school/edit/${id}` as any)} style={{ padding: 6, marginRight: 4 }}>
          <Ionicons name="create-outline" size={22} color={palette.onSurface} />
        </Pressable>
        <Pressable testID="school-delete" onPress={remove} style={{ padding: 6 }}>
          <Ionicons name="trash-outline" size={22} color={palette.error} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}>
        <Card>
          <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>{school.address || 'No address'}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
            <Mini label="Students" value={String(students.length)} />
            <Mini label="Collected" value={formatINR(totals.paid)} color={palette.success} />
            <Mini label="Pending" value={formatINR(totals.pending)} color={palette.warning} />
          </View>
        </Card>

        <View style={{ flexDirection: 'row', marginTop: spacing.lg, backgroundColor: palette.surfaceTertiary, borderRadius: radii.md, padding: 4 }}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              testID={`school-tab-${t.key}`}
              onPress={() => setTab(t.key)}
              style={{
                flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: radii.md - 2,
                backgroundColor: tab === t.key ? palette.surfaceSecondary : 'transparent',
              }}
            >
              <Text style={{ color: tab === t.key ? palette.onSurface : palette.muted, fontWeight: '600' }}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ marginTop: spacing.md }}>
          {filtered.length === 0 ? (
            <Card><EmptyState icon="checkmark-done-outline" title="Nothing here" subtitle={`No ${tab} students.`} /></Card>
          ) : filtered.map((s) => (
            <Card key={s.id} style={{ marginBottom: spacing.md }}>
              <Pressable onPress={() => router.push(`/student/${s.id}`)} testID={`detail-student-${s.id}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface }}>{s.name}</Text>
                    <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>Class {s.standard} · {s.parent_mobile}</Text>
                    <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>Due: {formatDate(s.due_date)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: tab === 'completed' ? palette.success : palette.warning }}>
                      {formatINR(tab === 'completed' ? s.paid_amount : s.pending_amount)}
                    </Text>
                  </View>
                </View>
              </Pressable>
              {tab !== 'completed' && (
                <Pressable
                  testID={`whatsapp-${s.id}`}
                  onPress={() => openWhatsApp(s.parent_mobile, reminderMessage({ studentName: s.name, school: s.school_name, pending: s.pending_amount, dueDate: s.due_date }))}
                  style={{ marginTop: spacing.md, backgroundColor: palette.success, borderRadius: radii.md, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons name="logo-whatsapp" size={18} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '600', marginLeft: 6 }}>Send WhatsApp Reminder</Text>
                </Pressable>
              )}
            </Card>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Mini({ label, value, color }: { label: string; value: string; color?: string }) {
  const { palette } = useTheme();
  return (
    <View>
      <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>{label}</Text>
      <Text style={{ color: color || palette.onSurface, fontWeight: '700', fontSize: fontSize.lg, marginTop: 2 }}>{value}</Text>
    </View>
  );
}
