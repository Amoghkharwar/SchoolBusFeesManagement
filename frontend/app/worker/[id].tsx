import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch, useAuth, API_BASE, TOKEN_STORAGE_KEY } from '@/src/auth';
import { useTheme, spacing, fontSize, radii } from '@/src/theme';
import { AlertModal, Button, Card, ConfirmModal, DangerConfirmModal, EmptyState, TextField, DateTimeField } from '@/src/components/ui';
import { formatINR } from '@/src/utils/format';
import { calendarDateToDisplay, calendarDateToLocalIso, isoToCalendarDate, isoToDisplay } from '@/src/utils/datetime';

interface Period {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  total_salary: number;
  paid_amount: number;
  pending_amount: number;
  status: 'pending' | 'partial' | 'completed';
  matured: boolean;
  overdue_days: number;
  note?: string;
}

interface AllocationLabel {
  label: string;
  amount: number;
}

interface SalaryPayment {
  id: string;
  amount: number;
  payment_date: string;
  mode: string;
  note?: string;
  allocation_labels: AllocationLabel[];
  created_at: string;
}

const MODES = ['cash', 'upi', 'bank'];

/** Month boundaries the way payroll means them: 1st 00:00 → last day 23:59. */
function monthBounds(base: Date) {
  const start = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Spells out which months a part-payment actually settled. */
function settlementSummary(paidLabel: string, allocs: AllocationLabel[], worker: any): string {
  if (!allocs || allocs.length === 0) return `${paidLabel} recorded successfully.`;
  const parts = allocs.map((a) => `${formatINR(a.amount)} to ${a.label}`).join(', ');
  const tail =
    worker && worker.matured_pending > 0
      ? ` ${formatINR(worker.matured_pending)} is still pending${worker.oldest_pending_month ? ` from ${worker.oldest_pending_month}` : ''}.`
      : ' All matured salary is now cleared.';
  return `${paidLabel} recorded — ${parts}.${tail}`;
}

export default function WorkerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { palette } = useTheme();
  const { admin } = useAuth();
  // Every delete endpoint here is behind the server's "delete" capability, which
  // only an admin holds — so hide what a non-admin would only get a 403 from.
  const isAdmin = admin?.role === 'admin';

  const [worker, setWorker] = useState<any>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [payments, setPayments] = useState<SalaryPayment[]>([]);
  const [loading, setLoading] = useState(true);

  const [showPayModal, setShowPayModal] = useState(false);
  const [showMonthModal, setShowMonthModal] = useState(false);

  // pay-salary form
  const [amount, setAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString());
  const [mode, setMode] = useState('cash');
  const [note, setNote] = useState('');
  const [targetPeriod, setTargetPeriod] = useState<string>(''); // '' = oldest-pending-first

  // add/edit-month form — a non-null editingPeriod switches it to edit mode
  const [editingPeriod, setEditingPeriod] = useState<Period | null>(null);
  const [mStart, setMStart] = useState('');
  const [mEnd, setMEnd] = useState('');
  const [mSalary, setMSalary] = useState('');
  const [mNote, setMNote] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [modalErr, setModalErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [confirmDeleteWorker, setConfirmDeleteWorker] = useState(false);
  const [confirmDeletePeriod, setConfirmDeletePeriod] = useState<Period | null>(null);
  const [confirmDeletePayment, setConfirmDeletePayment] = useState<SalaryPayment | null>(null);
  // 'payments' keeps the salary months; 'records' clears those too.
  const [purgeScope, setPurgeScope] = useState<'payments' | 'records' | null>(null);
  const [purging, setPurging] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [loadError, setLoadError] = useState('');

  // router.back() quietly does nothing when there is no history to pop — which
  // is the normal case here, since creating a worker lands on this screen via
  // replace(), and a page reload on the web build starts a fresh history.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/work' as any);
  };

  const load = useCallback(async () => {
    if (!id) return null;
    try {
      setLoadError('');
      const [w, p, pay] = await Promise.all([
        apiFetch<any>(`/workers/${id}`),
        apiFetch<Period[]>(`/workers/${id}/periods`),
        apiFetch<SalaryPayment[]>(`/workers/${id}/salary-payments`),
      ]);
      setWorker(w);
      setPeriods(p);
      setPayments(pay);
      return w;
    } catch (e: any) {
      setLoadError(
        e?.message === 'Not Found'
          ? 'The server does not have the Work Management API yet. Deploy the updated backend and try again.'
          : e?.message || 'Could not load this worker.',
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pendingPeriods = useMemo(
    () => periods.filter((p) => p.pending_amount > 0).sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [periods],
  );

  const openPayModal = () => {
    setModalErr('');
    setAmount('');
    setNote('');
    setMode('cash');
    setTargetPeriod('');
    setPayDate(new Date().toISOString());
    setShowPayModal(true);
  };

  const closeMonthModal = () => {
    setShowMonthModal(false);
    setEditingPeriod(null);
  };

  const openMonthModal = (period?: Period) => {
    setModalErr('');
    if (period) {
      setEditingPeriod(period);
      setMStart(calendarDateToLocalIso(period.start_date));
      setMEnd(calendarDateToLocalIso(period.end_date));
      setMSalary(String(period.total_salary));
      setMNote(period.note || '');
      setShowMonthModal(true);
      return;
    }
    setEditingPeriod(null);
    // Default to the month after the latest recorded one, else the current month.
    const latest = periods[0];
    const base = latest ? new Date(new Date(latest.end_date).getTime() + 24 * 3600 * 1000) : new Date();
    const { start, end } = monthBounds(base);
    setMStart(start);
    setMEnd(end);
    setMSalary(worker?.monthly_salary ? String(worker.monthly_salary) : '');
    setMNote('');
    setShowMonthModal(true);
  };

  const submitPayment = async () => {
    setModalErr('');
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setModalErr('Enter a valid amount'); return; }
    if (!payDate) { setModalErr('Please select a payment date'); return; }
    setSubmitting(true);
    try {
      const res = await apiFetch<any>(`/workers/${id}/salary-payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: amt,
          payment_date: payDate,
          mode,
          note,
          period_id: targetPeriod || null,
        }),
      });
      setShowPayModal(false);
      await load();
      setSuccessMsg(settlementSummary(formatINR(amt), res.allocation_labels, res.worker));
    } catch (e: any) {
      setModalErr(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitMonth = async () => {
    setModalErr('');
    const total = parseFloat(mSalary);
    if (!mStart || !mEnd) { setModalErr('Select both the start and end date of the salary month'); return; }
    if (!total || total <= 0) { setModalErr('Enter a valid total salary for this month'); return; }
    setSubmitting(true);
    try {
      // Calendar dates, not instants — otherwise a month picked in IST is
      // stored as the previous day in UTC and labelled with the wrong month.
      const body = JSON.stringify({
        start_date: isoToCalendarDate(mStart),
        end_date: isoToCalendarDate(mEnd),
        total_salary: total,
        note: mNote,
      });
      const saved = editingPeriod
        ? await apiFetch<Period>(`/periods/${editingPeriod.id}`, { method: 'PUT', body })
        : await apiFetch<Period>(`/workers/${id}/periods`, { method: 'POST', body });
      setShowMonthModal(false);
      setEditingPeriod(null);
      await load();
      setSuccessMsg(
        editingPeriod
          ? `Salary month ${saved.label} updated to ${formatINR(total)}.`
          : `Salary month ${saved.label} added for ${formatINR(total)}.`,
      );
    } catch (e: any) {
      setModalErr(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const removeWorker = async () => {
    await apiFetch(`/workers/${id}`, { method: 'DELETE' });
    // Replace rather than pop: the entry behind this one is the deleted worker.
    router.replace('/(tabs)/work' as any);
  };

  const removePeriod = async (p: Period) => {
    try {
      await apiFetch(`/periods/${p.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setModalErr(e.message);
    }
  };

  // Downloads stream the file, so they go through the URL with the token as a
  // query param rather than apiFetch — same route the fee reports take.
  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      await Linking.openURL(`${API_BASE}/workers/${id}/report/pdf${qs}`);
    } catch (e: any) {
      setModalErr(e?.message || 'Could not open the PDF.');
    } finally {
      setDownloading(false);
    }
  };

  const runPurge = async () => {
    if (!purgeScope) return;
    setPurging(true);
    try {
      const res = await apiFetch<any>(
        purgeScope === 'payments' ? `/workers/${id}/payments` : `/workers/${id}/records`,
        { method: 'DELETE' },
      );
      setPurgeScope(null);
      await load();
      setSuccessMsg(
        purgeScope === 'payments'
          ? `Deleted ${res.deleted_payments} payment${res.deleted_payments === 1 ? '' : 's'}. Every salary month is pending again.`
          : `Deleted ${res.deleted_periods} salary month${res.deleted_periods === 1 ? '' : 's'} and ${res.deleted_payments} payment${res.deleted_payments === 1 ? '' : 's'}.`,
      );
    } catch (e: any) {
      setPurgeScope(null);
      setModalErr(e.message);
    } finally {
      setPurging(false);
    }
  };

  const removePayment = async (p: SalaryPayment) => {
    try {
      await apiFetch(`/salary-payments/${p.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setModalErr(e.message);
    }
  };

  if (loading) {
    return <ActivityIndicator color={palette.brand} style={{ flex: 1, marginTop: 80 }} />;
  }

  if (!worker) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border }}>
          <Pressable onPress={goBack} style={{ padding: 6 }} testID="worker-back">
            <Ionicons name="chevron-back" size={24} color={palette.onSurface} />
          </Pressable>
          <Text style={{ flex: 1, fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface, marginLeft: 8 }}>Worker</Text>
        </View>
        <View style={{ padding: spacing.lg }}>
          <Card>
            <EmptyState
              icon="cloud-offline-outline"
              title="Could not load this worker"
              subtitle={loadError || 'Please try again.'}
            />
            <Button title="Retry" onPress={() => { setLoading(true); load(); }} testID="worker-retry" />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  const dueColor = worker.matured_pending > 0 ? palette.error : palette.success;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <Pressable onPress={goBack} style={{ padding: 6 }} testID="worker-back">
          <Ionicons name="chevron-back" size={24} color={palette.onSurface} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface, marginLeft: 8 }}>Worker</Text>
        <Pressable onPress={downloadPdf} testID="worker-download-pdf" style={{ padding: 6 }}>
          <Ionicons name={downloading ? 'hourglass-outline' : 'download-outline'} size={22} color={palette.onSurface} />
        </Pressable>
        <Pressable onPress={() => router.push(`/worker/edit/${id}` as any)} testID="worker-edit" style={{ padding: 6 }}>
          <Ionicons name="create-outline" size={22} color={palette.onSurface} />
        </Pressable>
        {isAdmin ? (
          <Pressable onPress={() => setConfirmDeleteWorker(true)} testID="worker-delete" style={{ padding: 6, marginLeft: 4 }}>
            <Ionicons name="trash-outline" size={22} color={palette.error} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: palette.brandTertiary, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: palette.brand, fontWeight: '700', fontSize: 20 }}>
                {worker.name.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface }}>{worker.name}</Text>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>
                {(worker.designation || 'Worker')} · {formatINR(worker.monthly_salary)}/month
              </Text>
            </View>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: dueColor + '22' }}>
              <Text style={{ color: dueColor, fontWeight: '700', fontSize: fontSize.sm }}>
                {worker.matured_pending > 0 ? 'Salary Due' : 'Cleared'}
              </Text>
            </View>
          </View>

          <View style={{ marginTop: spacing.lg, gap: 6 }}>
            <InfoRow icon="call" label="Mobile" value={worker.mobile || '—'} />
            <InfoRow icon="calendar" label="Joined" value={isoToDisplay(worker.join_date) || '—'} />
            <InfoRow icon="time" label="Last Paid" value={isoToDisplay(worker.last_payment_date) || 'Never'} />
            <InfoRow icon="layers" label="Months" value={`${worker.period_count} salary month${worker.period_count === 1 ? '' : 's'} recorded`} />
          </View>

          <View style={{ flexDirection: 'row', marginTop: spacing.lg, gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>Total Salary</Text>
              <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface }}>{formatINR(worker.total_salary)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>Paid</Text>
              <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.success }}>{formatINR(worker.total_paid)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>Pending</Text>
              <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.warning }}>{formatINR(worker.total_pending)}</Text>
            </View>
          </View>
        </Card>

        {worker.pending_months?.length > 0 ? (
          <View style={{ marginTop: spacing.md, backgroundColor: palette.error + '15', borderRadius: radii.md, borderWidth: 1, borderColor: palette.error + '40', padding: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="alert-circle" size={18} color={palette.error} />
              <Text style={{ color: palette.error, fontWeight: '700', marginLeft: 6, flex: 1 }}>
                {formatINR(worker.matured_pending)} pending
              </Text>
              {worker.max_overdue_days > 0 ? (
                <Text style={{ color: palette.error, fontSize: fontSize.sm }}>{worker.max_overdue_days} days late</Text>
              ) : null}
            </View>
            <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm, marginTop: 6 }}>
              Unpaid month{worker.pending_months.length === 1 ? '' : 's'}: {worker.pending_months.join(', ')}
            </Text>
            <Pressable
              testID="worker-clear-all"
              onPress={() => {
                openPayModal();
                setAmount(String(worker.matured_pending));
              }}
              style={{ marginTop: spacing.md, backgroundColor: palette.error, borderRadius: radii.md, paddingVertical: 10, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>
                Clear all {formatINR(worker.matured_pending)} at once
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.md }}>
          <Text style={{ flex: 1, fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface }}>Salary Months</Text>
          <Pressable onPress={() => openMonthModal()} testID="add-salary-month" style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="add-circle" size={18} color={palette.brand} />
            <Text style={{ color: palette.brand, fontWeight: '700', marginLeft: 4 }}>Add Month</Text>
          </Pressable>
        </View>

        {periods.length === 0 ? (
          <Card>
            <EmptyState
              icon="calendar-outline"
              title="No salary months yet"
              subtitle="Add the month's start date, end date and total salary to start tracking payments."
            />
          </Card>
        ) : (
          periods.map((p) => (
            <PeriodCard
              key={p.id}
              period={p}
              canDelete={isAdmin}
              onEdit={() => openMonthModal(p)}
              onDelete={() => setConfirmDeletePeriod(p)}
            />
          ))
        )}

        <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface, marginTop: spacing.xl, marginBottom: spacing.md }}>
          Payment History
        </Text>
        {payments.length === 0 ? (
          <Card><EmptyState icon="receipt-outline" title="No salary paid yet" subtitle="Tap Pay Salary below." /></Card>
        ) : (
          payments.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', marginBottom: spacing.md }}>
              <View style={{ alignItems: 'center', marginRight: spacing.md }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: palette.success }} />
                <View style={{ flex: 1, width: 2, backgroundColor: palette.border, marginTop: 4 }} />
              </View>
              <Card style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: palette.onSurface, fontWeight: '700', fontSize: fontSize.lg }}>{formatINR(p.amount)}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ color: palette.muted, fontSize: fontSize.sm, textTransform: 'uppercase' }}>{p.mode}</Text>
                    {isAdmin ? (
                      <Pressable
                        onPress={() => setConfirmDeletePayment(p)}
                        testID={`delete-salary-payment-${p.id}`}
                        style={{ padding: 4, marginLeft: 8 }}
                      >
                        <Ionicons name="trash-outline" size={16} color={palette.error} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 4 }}>{isoToDisplay(p.payment_date)}</Text>
                {p.allocation_labels?.length ? (
                  <View style={{ marginTop: 6, gap: 2 }}>
                    {p.allocation_labels.map((a, i) => (
                      <Text key={i} style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm }}>
                        • {formatINR(a.amount)} → {a.label}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {p.note ? <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm, marginTop: 4 }}>{p.note}</Text> : null}
              </Card>
            </View>
          ))
        )}

        {isAdmin && (periods.length > 0 || payments.length > 0) ? (
          <View style={{ marginTop: spacing.xl, borderWidth: 1, borderColor: palette.error + '40', borderRadius: radii.md, padding: spacing.md }}>
            <Text style={{ color: palette.error, fontWeight: '700', fontSize: fontSize.base }}>Danger zone</Text>
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 4, marginBottom: spacing.md }}>
              These actions are permanent and affect only {worker.name}. Save the record first — it cannot be recovered afterwards.
            </Text>

            <Pressable
              testID="danger-download-pdf"
              onPress={downloadPdf}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                paddingVertical: 11, borderRadius: radii.md, marginBottom: spacing.md,
                backgroundColor: palette.brand,
              }}
            >
              <Ionicons name="download-outline" size={16} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: fontSize.sm, marginLeft: 6 }}>
                {downloading ? 'Opening PDF…' : 'Download record as PDF'}
              </Text>
            </Pressable>

            <Pressable
              testID="purge-payments"
              disabled={payments.length === 0}
              onPress={() => setPurgeScope('payments')}
              style={{
                paddingVertical: 11, borderRadius: radii.md, alignItems: 'center',
                borderWidth: 1, borderColor: palette.error + '66',
                opacity: payments.length === 0 ? 0.45 : 1, marginBottom: spacing.sm,
              }}
            >
              <Text style={{ color: palette.error, fontWeight: '700', fontSize: fontSize.sm }}>
                Delete payment history ({payments.length})
              </Text>
            </Pressable>

            <Pressable
              testID="purge-records"
              onPress={() => setPurgeScope('records')}
              style={{
                paddingVertical: 11, borderRadius: radii.md, alignItems: 'center',
                borderWidth: 1, borderColor: palette.error + '66',
              }}
            >
              <Text style={{ color: palette.error, fontWeight: '700', fontSize: fontSize.sm }}>
                Delete all months and payments
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: palette.surfaceSecondary, borderTopWidth: 1, borderTopColor: palette.border }}>
        <Button title="Pay Salary" icon="cash-outline" onPress={openPayModal} testID="pay-salary-btn" />
      </View>

      {/* ── Pay salary ────────────────────────────────────── */}
      <Modal visible={showPayModal} transparent animationType="slide" onRequestClose={() => setShowPayModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={() => setShowPayModal(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} />
          <View style={{ backgroundColor: palette.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%' }}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
              <View style={{ alignSelf: 'center', width: 40, height: 4, backgroundColor: palette.border, borderRadius: 2, marginBottom: spacing.md }} />
              <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: spacing.md }}>Pay Salary</Text>

              <TextField
                label="Amount (₹) *"
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ''))}
                keyboardType="numeric"
                testID="salary-amount"
              />

              <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: 6 }}>Apply to</Text>
              <View style={{ gap: 8, marginBottom: spacing.md }}>
                <Pressable
                  testID="salary-target-auto"
                  onPress={() => setTargetPeriod('')}
                  style={{
                    padding: 12,
                    borderRadius: radii.md,
                    backgroundColor: targetPeriod === '' ? palette.brand : palette.surfaceTertiary,
                    borderWidth: 1,
                    borderColor: targetPeriod === '' ? palette.brand : palette.border,
                  }}
                >
                  <Text style={{ color: targetPeriod === '' ? '#fff' : palette.onSurface, fontWeight: '700' }}>
                    Oldest pending month first
                  </Text>
                  <Text style={{ color: targetPeriod === '' ? '#ffffffcc' : palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>
                    One amount settles arrears, then spills into the newer month.
                  </Text>
                </Pressable>

                {pendingPeriods.map((p) => {
                  const on = targetPeriod === p.id;
                  return (
                    <Pressable
                      key={p.id}
                      testID={`salary-target-${p.id}`}
                      onPress={() => setTargetPeriod(p.id)}
                      style={{
                        padding: 12,
                        borderRadius: radii.md,
                        backgroundColor: on ? palette.brand : palette.surfaceTertiary,
                        borderWidth: 1,
                        borderColor: on ? palette.brand : palette.border,
                      }}
                    >
                      <Text style={{ color: on ? '#fff' : palette.onSurface, fontWeight: '700' }}>{p.label} only</Text>
                      <Text style={{ color: on ? '#ffffffcc' : palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>
                        {formatINR(p.pending_amount)} pending of {formatINR(p.total_salary)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <DateTimeField label="Payment Date & Time" value={payDate} onChange={setPayDate} required testID="salary-date" />

              <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: 6 }}>Mode</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md }}>
                {MODES.map((m) => {
                  const active = mode === m;
                  return (
                    <Pressable
                      key={m}
                      testID={`salary-mode-${m}`}
                      onPress={() => setMode(m)}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: radii.md, alignItems: 'center', backgroundColor: active ? palette.brand : palette.surfaceTertiary, borderWidth: 1, borderColor: active ? palette.brand : palette.border }}
                    >
                      <Text style={{ color: active ? '#fff' : palette.onSurface, fontWeight: '600', textTransform: 'capitalize' }}>{m}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <TextField label="Note (optional)" value={note} onChangeText={setNote} testID="salary-note" />
              <Button title="Save Payment" onPress={submitPayment} loading={submitting} testID="salary-save" />
              <View style={{ height: spacing.sm }} />
              <Button title="Cancel" variant="ghost" onPress={() => setShowPayModal(false)} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Add salary month ──────────────────────────────── */}
      <Modal visible={showMonthModal} transparent animationType="slide" onRequestClose={closeMonthModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={closeMonthModal} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} />
          <View style={{ backgroundColor: palette.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%' }}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
              <View style={{ alignSelf: 'center', width: 40, height: 4, backgroundColor: palette.border, borderRadius: 2, marginBottom: spacing.md }} />
              <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: 4 }}>
                {editingPeriod ? `Edit ${editingPeriod.label}` : 'Add Salary Month'}
              </Text>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: spacing.md }}>
                {editingPeriod
                  ? editingPeriod.paid_amount > 0
                    ? `${formatINR(editingPeriod.paid_amount)} is already paid for this month, so the total cannot go below that.`
                    : 'Nothing is paid against this month yet, so it can be changed freely.'
                  : 'The salary matures on the end date — only then does it show as pending.'}
              </Text>

              <DateTimeField label="Month Start Date" value={mStart} onChange={setMStart} required testID="month-start" />
              <DateTimeField label="Month End Date (salary matures)" value={mEnd} onChange={setMEnd} required testID="month-end" />
              <TextField
                label="Total Salary for this month (₹) *"
                value={mSalary}
                onChangeText={(t) => setMSalary(t.replace(/[^0-9.]/g, ''))}
                keyboardType="numeric"
                testID="month-salary"
              />
              <TextField label="Note (optional)" value={mNote} onChangeText={setMNote} testID="month-note" />
              <Button
                title={editingPeriod ? 'Save Changes' : 'Add Month'}
                onPress={submitMonth}
                loading={submitting}
                testID="month-save"
              />
              <View style={{ height: spacing.sm }} />
              <Button title="Cancel" variant="ghost" onPress={closeMonthModal} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <AlertModal visible={!!modalErr} title="Cannot Save" message={modalErr} onClose={() => setModalErr('')} testID="worker-detail-error" />
      <AlertModal visible={!!successMsg} variant="success" title="Success" message={successMsg} onClose={() => setSuccessMsg('')} testID="worker-detail-success" />

      <ConfirmModal
        visible={confirmDeleteWorker}
        title="Delete worker?"
        message="This will remove all salary months and payment history for this worker."
        confirmLabel="Delete"
        onCancel={() => setConfirmDeleteWorker(false)}
        onConfirm={() => { setConfirmDeleteWorker(false); removeWorker(); }}
        testID="worker-delete-confirm"
      />

      <ConfirmModal
        visible={!!confirmDeletePeriod}
        title="Delete salary month?"
        message={confirmDeletePeriod ? `Remove ${confirmDeletePeriod.label} from this worker's salary record?` : ''}
        confirmLabel="Delete"
        onCancel={() => setConfirmDeletePeriod(null)}
        onConfirm={() => { const p = confirmDeletePeriod; setConfirmDeletePeriod(null); if (p) removePeriod(p); }}
        testID="period-delete-confirm"
      />

      <DangerConfirmModal
        visible={!!purgeScope}
        title={purgeScope === 'payments' ? 'Delete payment history?' : 'Delete all records?'}
        message={
          purgeScope === 'payments'
            ? `Every salary payment recorded for ${worker.name} will be removed. The salary months stay, and each one goes back to fully pending.`
            : `Every salary month and every payment for ${worker.name} will be removed. The worker stays, with a clean slate.`
        }
        bullets={
          purgeScope === 'payments'
            ? [
                `${payments.length} payment${payments.length === 1 ? '' : 's'} totalling ${formatINR(worker.total_paid)}`,
                `${periods.length} salary month${periods.length === 1 ? '' : 's'} will show ${formatINR(worker.total_salary)} pending`,
              ]
            : [
                `${periods.length} salary month${periods.length === 1 ? '' : 's'} worth ${formatINR(worker.total_salary)}`,
                `${payments.length} payment${payments.length === 1 ? '' : 's'} totalling ${formatINR(worker.total_paid)}`,
              ]
        }
        busy={purging}
        note="Download the record first — this is the only copy, and it cannot be recovered afterwards."
        actionLabel={downloading ? 'Opening PDF…' : 'Download record as PDF'}
        onAction={downloadPdf}
        onCancel={() => setPurgeScope(null)}
        onConfirm={runPurge}
        testID="worker-purge-confirm"
      />

      <ConfirmModal
        visible={!!confirmDeletePayment}
        title="Delete this payment?"
        message={confirmDeletePayment ? `${formatINR(confirmDeletePayment.amount)} will be removed and those months will go back to pending.` : ''}
        confirmLabel="Delete"
        onCancel={() => setConfirmDeletePayment(null)}
        onConfirm={() => { const p = confirmDeletePayment; setConfirmDeletePayment(null); if (p) removePayment(p); }}
        testID="salary-payment-delete-confirm"
      />
    </SafeAreaView>
  );
}

function PeriodCard({ period, canDelete, onEdit, onDelete }: { period: Period; canDelete: boolean; onEdit: () => void; onDelete: () => void }) {
  const { palette } = useTheme();
  const meta =
    period.status === 'completed'
      ? { color: palette.success, label: 'Paid' }
      : !period.matured
      ? { color: palette.muted, label: 'In Progress' }
      : period.status === 'partial'
      ? { color: palette.warning, label: 'Partial' }
      : { color: palette.error, label: 'Pending' };

  const pct = period.total_salary > 0 ? Math.min(period.paid_amount / period.total_salary, 1) : 0;

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface }}>{period.label}</Text>
          <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>
            {calendarDateToDisplay(period.start_date)} → {calendarDateToDisplay(period.end_date)}
          </Text>
        </View>
        <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: radii.pill, backgroundColor: meta.color + '22' }}>
          <Text style={{ color: meta.color, fontWeight: '700', fontSize: fontSize.sm }}>{meta.label}</Text>
        </View>
        <Pressable onPress={onEdit} testID={`edit-period-${period.id}`} style={{ padding: 6, marginLeft: 4 }}>
          <Ionicons name="create-outline" size={16} color={palette.muted} />
        </Pressable>
        {canDelete ? (
          <Pressable onPress={onDelete} testID={`delete-period-${period.id}`} style={{ padding: 6 }}>
            <Ionicons name="trash-outline" size={16} color={palette.error} />
          </Pressable>
        ) : null}
      </View>

      <View style={{ height: 6, backgroundColor: palette.surfaceTertiary, borderRadius: 3, marginTop: spacing.md, overflow: 'hidden' }}>
        <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: pct >= 1 ? palette.success : palette.brand }} />
      </View>

      <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
        <Text style={{ flex: 1, color: palette.muted, fontSize: fontSize.sm }}>
          Total {formatINR(period.total_salary)}
        </Text>
        <Text style={{ color: palette.success, fontSize: fontSize.sm, marginRight: spacing.md }}>
          Paid {formatINR(period.paid_amount)}
        </Text>
        <Text style={{ color: period.pending_amount > 0 ? palette.error : palette.muted, fontSize: fontSize.sm, fontWeight: '600' }}>
          Due {formatINR(period.pending_amount)}
        </Text>
      </View>

      {period.overdue_days > 0 ? (
        <Text style={{ color: palette.error, fontSize: fontSize.sm, marginTop: 6 }}>
          Overdue by {period.overdue_days} day{period.overdue_days === 1 ? '' : 's'}
        </Text>
      ) : null}
      {period.note ? (
        <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm, marginTop: 6 }}>{period.note}</Text>
      ) : null}
    </Card>
  );
}

function InfoRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
      <Ionicons name={icon} size={16} color={palette.muted} />
      <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginLeft: 8, width: 80 }}>{label}</Text>
      <Text style={{ color: palette.onSurface, fontSize: fontSize.base, flex: 1 }} numberOfLines={2}>{value}</Text>
    </View>
  );
}
