import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch } from '@/src/auth';
import { useTheme, spacing, fontSize, radii } from '@/src/theme';
import { Button, Card, ConfirmModal, EmptyState } from '@/src/components/ui';
import { formatINR, openWhatsApp, reminderMessage, formatDate } from '@/src/utils/format';

interface Student {
  id: string; name: string; parent_mobile: string; parent_name: string;
  standard: string; school_name: string;
  yearly_fee: number; paid_amount: number; pending_amount: number;
  status: string; due_date: string;
  /** Null once the fee is fully paid — there is nothing left to fall due. */
  next_due_date?: string | null;
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
  const [loadError, setLoadError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoadError('');
      const [sc, st] = await Promise.all([
        apiFetch(`/schools/${id}`),
        apiFetch<Student[]>(`/students?school_id=${id}`),
      ]);
      setSchool(sc);
      setStudents(st);
    } catch (e: any) {
      // Without this the page sat on its spinner forever when a request failed.
      setLoadError(e?.message || 'Could not load this school.');
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
    await apiFetch(`/schools/${id}`, { method: 'DELETE' });
    router.back();
  };

  if (loading) return <ActivityIndicator color={palette.brand} style={{ flex: 1, marginTop: 80 }} />;

  if (!school) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border }}>
          <Pressable onPress={() => router.back()} testID="school-back" style={{ padding: 6 }}>
            <Ionicons name="chevron-back" size={24} color={palette.onSurface} />
          </Pressable>
          <Text style={{ flex: 1, fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface, marginLeft: 8 }}>School</Text>
        </View>
        <View style={{ padding: spacing.lg }}>
          <Card>
            <EmptyState icon="cloud-offline-outline" title="Could not load this school" subtitle={loadError || 'Please try again.'} />
            <Button title="Retry" onPress={() => { setLoading(true); load(); }} testID="school-retry" />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

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
        <Pressable testID="school-delete" onPress={() => setShowDeleteConfirm(true)} style={{ padding: 6 }}>
          <Ionicons name="trash-outline" size={22} color={palette.error} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}>
        <Card>
          <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>{school.address || 'No address'}</Text>
          {school.contact_person || school.contact_phone ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
              <Ionicons name="call-outline" size={14} color={palette.muted} />
              <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm, marginLeft: 6, flex: 1 }}>
                {[school.contact_person, school.contact_phone].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
            <Mini label="Students" value={String(students.length)} />
            <Mini label="Collected" value={formatINR(totals.paid)} color={palette.success} />
            <Mini label="Pending" value={formatINR(totals.pending)} color={palette.warning} />
          </View>
          <View style={{ marginTop: spacing.md }}>
            <Button
              title="Add Student"
              icon="person-add-outline"
              variant="secondary"
              onPress={() => router.push(`/student/add?school_id=${id}` as any)}
              testID="school-add-student"
            />
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
            <Card>
              <EmptyState
                icon={students.length ? 'checkmark-done-outline' : 'people-outline'}
                title={students.length ? 'Nothing here' : 'No students yet'}
                subtitle={students.length ? `No ${TABS.find((t) => t.key === tab)?.label.toLowerCase()} students.` : 'Tap Add Student above to add the first one.'}
              />
            </Card>
          ) : filtered.map((s) => (
            <Card key={s.id} style={{ marginBottom: spacing.md }}>
              <Pressable onPress={() => router.push(`/student/${s.id}`)} testID={`detail-student-${s.id}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface }}>{s.name}</Text>
                    <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>Class {s.standard} · {s.parent_mobile}</Text>
                    <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>
                      {s.next_due_date ? `Due: ${formatDate(s.next_due_date)}` : 'Fully paid'}
                    </Text>
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

      <ConfirmModal
        visible={showDeleteConfirm}
        title="Delete school?"
        message="This will remove all students and payments."
        confirmLabel="Delete"
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={() => { setShowDeleteConfirm(false); remove(); }}
        testID="school-delete-confirm"
      />
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
