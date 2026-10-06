import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch } from '@/src/auth';
import { useTheme, spacing, radii, fontSize } from '@/src/theme';
import { Card, EmptyState, FAB, TextField } from '@/src/components/ui';
import { formatINR } from '@/src/utils/format';

interface StudentRow {
  id: string;
  name: string;
  parent_name: string;
  parent_mobile: string;
  school_id: string;
  school_name: string;
  standard: string;
  /** False once the student has left — kept on record, off the due lists. */
  active?: boolean;
  overdue_days?: number;
  yearly_fee: number;
  paid_amount: number;
  pending_amount: number;
  status: string;
  due_date?: string;
  next_due_date?: string;
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'partial', label: 'Partial' },
  { key: 'completed', label: 'Paid' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'due_today', label: 'Due Today' },
  { key: 'due_week', label: 'Due This Week' },
  { key: 'inactive', label: 'Inactive' },
];

/** Lower-cased with runs of spaces collapsed, so "QA  Test School " finds "QA Test School". */
const norm = (v?: string | null) => (v || '').toLowerCase().replace(/\s+/g, ' ').trim();

export default function Students() {
  const { palette, isDark } = useTheme();
  const [items, setItems] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [error, setError] = useState('');

  // The server applies search/status/due over the full collection in memory
  // anyway, so fetching once and narrowing here keeps chip taps and typing
  // instant instead of costing a round-trip each.
  const load = useCallback(async () => {
    try {
      setError('');
      const list = await apiFetch<StudentRow[]>('/students');
      setItems(list);
    } catch (e: any) {
      setError(e?.message || 'Could not load students.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Every school that has students, for the school filter row.
  const schools = useMemo(() => {
    const seen = new Map<string, string>();
    items.forEach((s) => { if (s.school_id && !seen.has(s.school_id)) seen.set(s.school_id, s.school_name); });
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const visible = useMemo(() => {
    const needle = norm(q);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);

    return items.filter((s) => {
      if (schoolFilter && s.school_id !== schoolFilter) return false;
      if (needle) {
        // School and class are searchable too — "Class 5" as well as "5".
        const hay = [s.name, s.parent_name, s.parent_mobile, s.school_name, s.standard, `class ${s.standard}`];
        if (!hay.some((h) => norm(h).includes(needle))) return false;
      }

      if (filter === 'inactive') return s.active === false;
      if (filter === 'all') return true;
      // The fee filters are about students still riding — someone marked
      // inactive only shows under "Inactive" (and "All").
      if (s.active === false) return false;

      if (filter === 'pending' || filter === 'partial' || filter === 'completed') {
        return s.status === filter;
      }

      if (filter === 'overdue') return s.status !== 'completed' && (s.overdue_days || 0) > 0;

      if (filter === 'due_today' || filter === 'due_week') {
        const raw = s.next_due_date || s.due_date;
        if (!raw) return false;
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return false;
        d.setHours(0, 0, 0, 0);
        return filter === 'due_today'
          ? d.getTime() === today.getTime()
          : d >= today && d <= weekEnd;
      }

      return true;
    });
  }, [items, q, filter, schoolFilter]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: spacing.md }}>Students</Text>
        <TextField placeholder="Search name, parent, mobile, school, class" value={q} onChangeText={setQ} leftIcon="search" testID="students-search" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 8, paddingVertical: 6 }}
          style={{ marginBottom: 4 }}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                testID={`filter-chip-${f.key}`}
                onPress={() => setFilter(f.key)}
                style={{
                  height: 36,
                  paddingHorizontal: 14,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? palette.brand : palette.surfaceTertiary,
                  borderWidth: 1,
                  borderColor: active ? palette.brand : palette.border,
                  flexShrink: 0,
                }}
              >
                <Text style={{ color: active ? '#fff' : palette.onSurface, fontWeight: '600', fontSize: fontSize.sm }}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {schools.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 8, paddingBottom: 6 }}
            style={{ marginBottom: 4 }}
          >
            {[{ id: '', name: 'All schools' }, ...schools].map((sc) => {
              const active = schoolFilter === sc.id;
              return (
                <Pressable
                  key={sc.id || 'all'}
                  testID={`school-chip-${sc.id || 'all'}`}
                  onPress={() => setSchoolFilter(sc.id)}
                  style={{
                    height: 32,
                    paddingHorizontal: 12,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? palette.brandTertiary : 'transparent',
                    borderWidth: 1,
                    borderColor: active ? palette.brand : palette.border,
                    flexShrink: 0,
                  }}
                >
                  <Text style={{ color: active ? palette.brand : palette.muted, fontWeight: '600', fontSize: fontSize.sm }}>{sc.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator color={palette.brand} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(s) => s.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <Card>
              <EmptyState
                icon={error ? 'cloud-offline-outline' : items.length ? 'search-outline' : 'people-outline'}
                title={error ? 'Could not load students' : items.length ? 'No matching students' : 'No students yet'}
                subtitle={
                  error ||
                  (items.length
                    ? q.trim()
                      ? `Nobody matches "${q.trim()}" here. Try a name, mobile, school or class.`
                      : 'No students fall under this filter right now.'
                    : 'Tap + to add the first student.')
                }
              />
            </Card>
          }
          renderItem={({ item }) => <StudentItem item={item} />}
        />
      )}

      <FAB onPress={() => router.push('/student/add')} testID="add-student-fab" />
    </SafeAreaView>
  );
}

function StudentItem({ item }: { item: StudentRow }) {
  const { palette, isDark } = useTheme();
  const free = item.yearly_fee <= 0;
  const meta =
    free
      ? { color: palette.success, label: 'Free' }
      : item.status === 'completed'
      ? { color: palette.success, label: 'Paid' }
      : item.status === 'partial'
      ? { color: palette.warning, label: 'Partial' }
      : { color: palette.error, label: 'Pending' };
  return (
    <Pressable
      testID={`student-row-${item.id}`}
      onPress={() => router.push(`/student/${item.id}`)}
      style={{ marginBottom: spacing.md }}
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: palette.brandTertiary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: palette.brand, fontWeight: '700' }}>{item.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface }} numberOfLines={1}>
              {item.name}
              {item.active === false ? <Text style={{ color: palette.muted, fontWeight: '400' }}>  · inactive</Text> : null}
            </Text>
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>
              {item.school_name} · Class {item.standard}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: meta.color + '22' }}>
              <Text style={{ color: meta.color, fontWeight: '700', fontSize: fontSize.sm }}>{meta.label}</Text>
            </View>
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 4 }}>
              {free ? 'No fee' : item.status === 'completed' ? formatINR(item.paid_amount) : formatINR(item.pending_amount) + ' due'}
            </Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}
