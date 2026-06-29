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
  school_name: string;
  standard: string;
  yearly_fee: number;
  paid_amount: number;
  pending_amount: number;
  status: string;
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'partial', label: 'Partial' },
  { key: 'completed', label: 'Paid' },
  { key: 'due_today', label: 'Due Today' },
  { key: 'due_week', label: 'Due This Week' },
];

export default function Students() {
  const { palette, isDark } = useTheme();
  const [items, setItems] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    try {
      let path = '/students';
      const params = new URLSearchParams();
      if (q) params.set('search', q);
      if (filter === 'pending' || filter === 'partial' || filter === 'completed') {
        params.set('status', filter);
      }
      if (filter === 'due_today') params.set('due', 'today');
      if (filter === 'due_week') params.set('due', 'week');
      if ([...params].length) path += `?${params.toString()}`;
      const list = await apiFetch<StudentRow[]>(path);
      setItems(list);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [q, filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: spacing.md }}>Students</Text>
        <TextField placeholder="Search by name, parent, mobile" value={q} onChangeText={setQ} leftIcon="search" testID="students-search" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
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
      </View>

      {loading ? (
        <ActivityIndicator color={palette.brand} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <Card>
              <EmptyState icon="people-outline" title="No students found" subtitle="Adjust filters or add a student." />
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
  const meta =
    item.status === 'completed'
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
            <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface }}>{item.name}</Text>
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>
              {item.school_name} · Class {item.standard}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: meta.color + '22' }}>
              <Text style={{ color: meta.color, fontWeight: '700', fontSize: fontSize.sm }}>{meta.label}</Text>
            </View>
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 4 }}>
              {item.status === 'completed' ? formatINR(item.paid_amount) : formatINR(item.pending_amount) + ' due'}
            </Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}
