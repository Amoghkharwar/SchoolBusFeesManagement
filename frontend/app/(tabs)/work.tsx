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

export interface WorkerRow {
  id: string;
  name: string;
  mobile?: string;
  designation?: string;
  monthly_salary: number;
  active?: boolean;
  period_count: number;
  total_salary: number;
  total_paid: number;
  total_pending: number;
  /** Pending only on months that have already ended — an in-progress month isn't late. */
  matured_pending: number;
  status: 'pending' | 'partial' | 'completed';
  pending_months: string[];
  oldest_pending_month?: string | null;
  max_overdue_days: number;
  last_payment_date?: string | null;
}

interface WorkSummary {
  total_workers: number;
  active_workers: number;
  total_salary: number;
  total_paid: number;
  total_pending: number;
  matured_pending: number;
  workers_with_pending: number;
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'due', label: 'Salary Due' },
  { key: 'partial', label: 'Partial' },
  { key: 'completed', label: 'Cleared' },
  { key: 'inactive', label: 'Inactive' },
];

export default function Work() {
  const { palette } = useTheme();
  const [items, setItems] = useState<WorkerRow[]>([]);
  const [summary, setSummary] = useState<WorkSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const [list, s] = await Promise.all([
        apiFetch<WorkerRow[]>('/workers'),
        apiFetch<WorkSummary>('/work/summary'),
      ]);
      setItems(list);
      setSummary(s);
    } catch (e: any) {
      // A 404 here means the server predates this tab, which is a deployment
      // state rather than a user error — say so instead of an empty screen.
      setError(
        e?.message === 'Not Found'
          ? 'The server does not have the Work Management API yet. Deploy the updated backend, then pull to refresh.'
          : e?.message || 'Could not load workers.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((w) => {
      if (
        needle &&
        !w.name.toLowerCase().includes(needle) &&
        !(w.mobile || '').includes(needle) &&
        !(w.designation || '').toLowerCase().includes(needle)
      ) {
        return false;
      }
      if (filter === 'due') return w.matured_pending > 0;
      if (filter === 'partial') return w.status === 'partial';
      if (filter === 'completed') return w.status === 'completed' && w.period_count > 0;
      if (filter === 'inactive') return w.active === false;
      return true;
    });
  }, [items, q, filter]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: spacing.md }}>
          Work Management
        </Text>

        {summary ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
            <MiniStat label="Workers" value={String(summary.total_workers)} color={palette.onSurface} />
            <MiniStat label="Paid" value={formatINR(summary.total_paid)} color={palette.success} />
            <MiniStat label="Salary Due" value={formatINR(summary.matured_pending)} color={palette.error} />
          </View>
        ) : null}

        <TextField
          placeholder="Search by name, mobile, role"
          value={q}
          onChangeText={setQ}
          leftIcon="search"
          testID="workers-search"
        />
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
                testID={`worker-filter-${f.key}`}
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
                <Text style={{ color: active ? '#fff' : palette.onSurface, fontWeight: '600', fontSize: fontSize.sm }}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <ActivityIndicator color={palette.brand} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(w) => w.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <Card>
              <EmptyState
                icon={error ? 'cloud-offline-outline' : 'hammer-outline'}
                title={error ? 'Could not load workers' : 'No workers found'}
                subtitle={error || 'Add a worker to start tracking monthly salary.'}
              />
            </Card>
          }
          renderItem={({ item }) => <WorkerItem item={item} />}
        />
      )}

      <FAB onPress={() => router.push('/worker/add')} testID="add-worker-fab" />
    </SafeAreaView>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceTertiary, borderRadius: radii.md, paddingVertical: 8, paddingHorizontal: 10 }}>
      <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>{label}</Text>
      <Text style={{ color, fontSize: fontSize.lg, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function WorkerItem({ item }: { item: WorkerRow }) {
  const { palette } = useTheme();

  // "Salary due" is the state that matters on this screen, so an overdue month
  // outranks the plain paid/partial split the badge would otherwise show.
  const meta =
    item.matured_pending > 0
      ? { color: palette.error, label: 'Salary Due' }
      : item.period_count === 0
      ? { color: palette.muted, label: 'No Months' }
      : item.status === 'completed'
      ? { color: palette.success, label: 'Cleared' }
      : { color: palette.warning, label: 'Partial' };

  const monthsLine =
    item.pending_months.length === 0
      ? null
      : item.pending_months.length === 1
      ? `Pending: ${item.pending_months[0]}`
      : `Pending: ${item.pending_months[0]} +${item.pending_months.length - 1} more`;

  return (
    <Pressable
      testID={`worker-row-${item.id}`}
      onPress={() => router.push(`/worker/${item.id}` as any)}
      style={{ marginBottom: spacing.md }}
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: palette.brandTertiary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: palette.brand, fontWeight: '700' }}>
              {item.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface }} numberOfLines={1}>
              {item.name}
              {item.active === false ? <Text style={{ color: palette.muted, fontWeight: '400' }}>  · inactive</Text> : null}
            </Text>
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }} numberOfLines={1}>
              {(item.designation || 'Worker')} · {formatINR(item.monthly_salary)}/month
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: meta.color + '22' }}>
              <Text style={{ color: meta.color, fontWeight: '700', fontSize: fontSize.sm }}>{meta.label}</Text>
            </View>
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 4 }}>
              {item.matured_pending > 0 ? `${formatINR(item.matured_pending)} due` : formatINR(item.total_paid) + ' paid'}
            </Text>
          </View>
        </View>

        {monthsLine ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: palette.border }}>
            <Ionicons name="alert-circle" size={14} color={palette.error} />
            <Text style={{ color: palette.error, fontSize: fontSize.sm, marginLeft: 6, flex: 1 }} numberOfLines={1}>
              {monthsLine}
            </Text>
            {item.max_overdue_days > 0 ? (
              <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>
                {item.max_overdue_days}d late
              </Text>
            ) : null}
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}
