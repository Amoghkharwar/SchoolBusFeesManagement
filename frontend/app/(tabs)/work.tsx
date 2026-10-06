import React, { useCallback, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  Linking,
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

import { apiFetch, useAuth, API_BASE, TOKEN_STORAGE_KEY } from '@/src/auth';
import { useTheme, spacing, radii, fontSize } from '@/src/theme';
import { AlertModal, Card, DangerConfirmModal, EmptyState, FAB, TextField } from '@/src/components/ui';
import { formatINR } from '@/src/utils/format';
import { owed, workerBadge, workerBadgeKind } from '@/src/utils/workerStatus';

export interface WorkerRow {
  id: string;
  name: string;
  mobile?: string;
  designation?: string;
  monthly_salary: number;
  active?: boolean;
  period_count: number;
  /** Gross, before absences are taken off. */
  total_salary: number;
  /** Taken off for absences flagged to deduct. */
  total_deduction: number;
  /** total_salary − total_deduction: what is actually owed across all months. */
  total_payable: number;
  absence_count: number;
  total_absent_days: number;
  deducted_days: number;
  per_day_wage: number;
  total_paid: number;
  total_pending: number;
  /** Pending only on months that have already ended — an in-progress month isn't late. */
  matured_pending: number;
  /** Still owed on a month that hasn't ended yet — not due, but not cleared. */
  upcoming_pending: number;
  upcoming_month?: string | null;
  upcoming_matures_on?: string | null;
  /** Read off ended months only — see workerBadge. */
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
  total_deduction: number;
  total_payable: number;
  total_absent_days: number;
  total_paid: number;
  total_pending: number;
  matured_pending: number;
  workers_with_pending: number;
  total_periods: number;
  total_payments: number;
  total_absences: number;
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
  const { admin } = useAuth();
  // The reset endpoint needs the server's "delete" capability, which is admin-only.
  const isAdmin = admin?.role === 'admin';
  const [items, setItems] = useState<WorkerRow[]>([]);
  const [summary, setSummary] = useState<WorkSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [showPurge, setShowPurge] = useState(false);
  const [purging, setPurging] = useState(false);
  const [notice, setNotice] = useState('');
  const [downloading, setDownloading] = useState(false);
  // Every focus fires a load, and an older one can come back after a newer one —
  // only the latest request is allowed to paint, so the list never steps back
  // to what it looked like before an edit.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      setError('');
      const [list, s] = await Promise.all([
        apiFetch<WorkerRow[]>('/workers'),
        apiFetch<WorkSummary>('/work/summary'),
      ]);
      if (seq !== loadSeq.current) return;
      setItems(list);
      setSummary(s);
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
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

  // Streams the file, so it goes through the URL with the token as a query param
  // rather than apiFetch — the same route the fee reports take.
  const downloadAll = async () => {
    setDownloading(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      await Linking.openURL(`${API_BASE}/work/report/pdf${qs}`);
    } catch (e: any) {
      setError(e?.message || 'Could not open the PDF.');
    } finally {
      setDownloading(false);
    }
  };

  const purgeAll = async () => {
    setPurging(true);
    try {
      const res = await apiFetch<any>('/work/records', { method: 'DELETE' });
      setShowPurge(false);
      await load();
      setNotice(
        `Deleted ${res.deleted_workers} worker${res.deleted_workers === 1 ? '' : 's'}, ` +
          `${res.deleted_periods} salary month${res.deleted_periods === 1 ? '' : 's'} and ` +
          `${res.deleted_payments} payment${res.deleted_payments === 1 ? '' : 's'}.`,
      );
    } catch (e: any) {
      setShowPurge(false);
      setError(e.message || 'Could not delete work data.');
    } finally {
      setPurging(false);
    }
  };

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
      if (filter === 'inactive') return w.active === false;
      if (filter === 'all') return true;
      // The salary filters are about people still on the payroll — someone
      // marked inactive only shows under "Inactive" (and "All").
      if (w.active === false) return false;
      // Same decision as the badge, so a row never sits under a filter that
      // contradicts the label on it.
      const kind = workerBadgeKind(w);
      if (filter === 'due') return kind === 'due' || kind === 'partial';
      if (filter === 'partial') return kind === 'partial';
      if (filter === 'completed') return kind === 'cleared' || kind === 'progress';
      return true;
    });
  }, [items, q, filter]);

  // Totals for exactly the rows on screen, from the same response that drew
  // them — so the cards follow the search and filter, and can't drift from the
  // list the way a separately fetched summary did.
  const totals = useMemo(() => ({
    workers: visible.length,
    paid: visible.reduce((s, w) => s + w.total_paid, 0),
    due: visible.reduce((s, w) => s + owed(w.matured_pending), 0),
  }), [visible]);
  const narrowed = q.trim() !== '' || filter !== 'all';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
          <Text style={{ flex: 1, fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface }}>
            Work Management
          </Text>
          {items.length > 0 ? (
            <Pressable onPress={downloadAll} testID="download-all-work" style={{ padding: 6 }}>
              <Ionicons
                name={downloading ? 'hourglass-outline' : 'download-outline'}
                size={20}
                color={palette.onSurface}
              />
            </Pressable>
          ) : null}
          {isAdmin && items.length > 0 ? (
            <Pressable onPress={() => setShowPurge(true)} testID="purge-all-work" style={{ padding: 6 }}>
              <Ionicons name="trash-outline" size={20} color={palette.error} />
            </Pressable>
          ) : null}
        </View>

        {!loading && !error ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
            <MiniStat label={narrowed ? 'Showing' : 'Workers'} value={String(totals.workers)} color={palette.onSurface} />
            <MiniStat label="Paid" value={formatINR(totals.paid)} color={palette.success} />
            <MiniStat label="Salary Due" value={formatINR(totals.due)} color={palette.error} />
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
          // Room under the last card for the floating "+" so it never sits on an amount.
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <Card>
              <EmptyState
                icon={error ? 'cloud-offline-outline' : items.length ? 'search-outline' : 'hammer-outline'}
                title={error ? 'Could not load workers' : items.length ? 'No matching workers' : 'No workers yet'}
                subtitle={
                  error ||
                  (items.length
                    ? q.trim()
                      ? `Nobody matches "${q.trim()}"${filter !== 'all' ? ' under this filter' : ''}. Try another name, mobile or role.`
                      : 'No workers fall under this filter right now.'
                    : 'Add a worker to start tracking monthly salary.')
                }
              />
            </Card>
          }
          renderItem={({ item }) => <WorkerItem item={item} />}
        />
      )}

      <FAB onPress={() => router.push('/worker/add')} testID="add-worker-fab" />

      <DangerConfirmModal
        visible={showPurge}
        title="Delete all work data?"
        message="Every worker, salary month, absence and payment in Work Management will be removed. Students, schools, fees and financial years are stored separately and are not affected."
        bullets={
          summary
            ? [
                `${summary.total_workers} worker${summary.total_workers === 1 ? '' : 's'}`,
                `${summary.total_periods} salary month${summary.total_periods === 1 ? '' : 's'} worth ${formatINR(summary.total_salary)}`,
                `${summary.total_payments} payment${summary.total_payments === 1 ? '' : 's'} totalling ${formatINR(summary.total_paid)}`,
                `${summary.total_absences} absence${summary.total_absences === 1 ? '' : 's'} covering ${summary.total_absent_days} day${summary.total_absent_days === 1 ? '' : 's'}`,
              ]
            : []
        }
        busy={purging}
        note="Download the full record first — this is the only copy, and it cannot be recovered afterwards."
        actionLabel={downloading ? 'Opening PDF…' : 'Download all data as PDF'}
        onAction={downloadAll}
        onCancel={() => setShowPurge(false)}
        onConfirm={purgeAll}
        testID="work-purge-confirm"
      />

      <AlertModal
        visible={!!notice}
        variant="success"
        title="Work data deleted"
        message={notice}
        onClose={() => setNotice('')}
        testID="work-purge-done"
      />
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

  const meta = workerBadge(item, palette);

  // Paise left on an old month aren't "pending" — the badge already says so.
  const monthsLine =
    !owed(item.matured_pending) || item.pending_months.length === 0
      ? null
      : item.pending_months.length === 1
      ? `Pending: ${item.pending_months[0]}`
      : `Pending: ${item.pending_months[0]} +${item.pending_months.length - 1} more`;

  // Absences only earn a line once they have actually cost the worker money —
  // paid leave is detail for the worker screen, not the list.
  const absenceLine =
    item.total_deduction > 0
      ? `${item.total_absent_days} day${item.total_absent_days === 1 ? '' : 's'} absent · ${formatINR(item.total_deduction)} deducted`
      : null;

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
              {owed(item.matured_pending) ? `${formatINR(item.matured_pending)} due` : formatINR(item.total_paid) + ' paid'}
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

        {absenceLine ? (
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            marginTop: monthsLine ? spacing.sm : spacing.md,
            paddingTop: monthsLine ? 0 : spacing.sm,
            borderTopWidth: monthsLine ? 0 : 1, borderTopColor: palette.border,
          }}>
            <Ionicons name="calendar-clear-outline" size={14} color={palette.muted} />
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginLeft: 6, flex: 1 }} numberOfLines={1}>
              {absenceLine}
            </Text>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}
