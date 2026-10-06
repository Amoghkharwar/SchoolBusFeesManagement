import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch, useAuth } from '@/src/auth';
import { useTheme, spacing, fontSize, radii } from '@/src/theme';
import { AlertModal, Button, Card, ConfirmModal, DangerConfirmModal, EmptyState, StatusBadge, TextField, DateTimeField } from '@/src/components/ui';
import { formatINR, formatINRExact, openWhatsApp, plural, reminderMessage, wholeRupeeError } from '@/src/utils/format';
import { calendarDateToDisplay, isoToDisplay } from '@/src/utils/datetime';

interface Payment {
  id: string;
  amount: number;
  payment_date: string;
  mode: string;
  note?: string;
  next_due_date?: string;
  created_at: string;
}

const MODES = ['cash', 'upi', 'bank'];

const dayLabel = (n: number) => plural(n, 'day');

/** Local midnight of the day an ISO instant falls on. */
const dayOf = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

// Spells out what the payment did to an overdue record, so clearing an overdue
// reads differently from merely denting it.
function paymentSummary(paidLabel: string, overdueBefore: number, s: any): string {
  if (!s) return `${paidLabel} recorded successfully.`;

  const stillOverdue = (s.overdue_days ?? 0) > 0;

  if (s.status === 'completed') {
    return overdueBefore > 0
      ? `${paidLabel} recorded. Overdue of ${dayLabel(overdueBefore)} is cleared and the yearly fee is now fully paid.`
      : `${paidLabel} recorded. The yearly fee is now fully paid.`;
  }

  const pending = `${formatINR(s.pending_amount)} still pending`;

  if (overdueBefore > 0 && !stillOverdue) {
    const nextDue = isoToDisplay(s.next_due_date || s.due_date);
    return `${paidLabel} recorded. Overdue of ${dayLabel(overdueBefore)} is cleared — ${pending}${nextDue ? `, next due ${nextDue}` : ''}.`;
  }

  if (stillOverdue) {
    const dueOn = calendarDateToDisplay(s.next_due_date || s.due_date);
    return `${paidLabel} recorded, but this record is still overdue by ${dayLabel(s.overdue_days)}${dueOn ? ` (due ${dueOn})` : ''} — ${pending}. Set a next due date when recording a payment to move it.`;
  }

  return `${paidLabel} recorded. ${pending}.`;
}

export default function StudentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { palette } = useTheme();
  const [student, setStudent] = useState<any>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // payment form
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString());
  const [nextDue, setNextDue] = useState('');
  const [mode, setMode] = useState('cash');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalErr, setModalErr] = useState('');
  const [fieldErr, setFieldErr] = useState<{ amount?: string; nextDue?: string }>({});
  const [loadError, setLoadError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeletePayment, setConfirmDeletePayment] = useState<Payment | null>(null);
  // Deleting a student or a payment needs the "delete" permission (admins);
  // the server refuses it for everyone else, so don't offer the button.
  const { admin } = useAuth();
  const canDelete = !!(admin?.capabilities?.delete ?? admin?.role === 'admin');

  const load = useCallback(async () => {
    if (!id) return null;
    try {
      setLoadError('');
      const [s, p] = await Promise.all([
        apiFetch<any>(`/students/${id}`),
        apiFetch<Payment[]>(`/students/${id}/payments`),
      ]);
      setStudent(s);
      setPayments(p);
      return s;
    } catch (e: any) {
      // Without this a failed request left the page on its spinner for good.
      setLoadError(e?.message || 'Could not load this student.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pendingNow: number = student?.pending_amount ?? 0;
  const amtNum = parseInt(amount, 10);
  // A payment that clears the fee has no "next" due date — the field is hidden.
  const clearsFee = !wholeRupeeError(amount) && amtNum > 0 && amtNum >= pendingNow;

  const openPayment = () => {
    setFieldErr({});
    setModalErr('');
    setShowModal(true);
  };

  const submitPayment = async () => {
    setModalErr('');
    const amt = parseInt(amount, 10);
    const errs: { amount?: string; nextDue?: string } = {};
    if (wholeRupeeError(amount)) errs.amount = wholeRupeeError(amount);
    else if (!amt || amt <= 0) errs.amount = 'Enter the amount paid';
    else if (amt > pendingNow) errs.amount = `That is more than the ${formatINR(pendingNow)} pending`;
    if (!clearsFee && nextDue && date && dayOf(nextDue) < dayOf(date)) {
      errs.nextDue = "The next due date can't be before the payment date";
    }
    if (date && dayOf(date) > dayOf(new Date().toISOString())) {
      setModalErr('The payment date is in the future — pick today or an earlier day');
      setFieldErr(errs);
      return;
    }
    setFieldErr(errs);
    if (errs.amount || errs.nextDue) return;
    if (!date) { setModalErr('Please select a payment date'); return; }
    const nextIso: string | null = !clearsFee && nextDue ? nextDue : null;
    const overdueBefore = student?.overdue_days ?? 0;
    setSubmitting(true);
    try {
      await apiFetch(`/students/${id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: amt, payment_date: date, mode, note, next_due_date: nextIso }),
      });
      setShowModal(false);
      setAmount(''); setNote(''); setMode('cash'); setNextDue(''); setDate(new Date().toISOString());
      const fresh = await load();
      setSuccessMsg(paymentSummary(formatINR(amt), overdueBefore, fresh));
    } catch (e: any) {
      const msg = e.message || '';
      if (/pending|amount|fully paid/i.test(msg)) setFieldErr({ amount: msg });
      else if (/next due/i.test(msg)) setFieldErr({ nextDue: msg });
      else setModalErr(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await apiFetch(`/students/${id}`, { method: 'DELETE' });
      setShowDeleteConfirm(false);
      router.back();
    } catch (e: any) {
      setShowDeleteConfirm(false);
      setModalErr(e.message);
    } finally {
      setDeleting(false);
    }
  };

  /** Keeps the record and its payments, and takes the student off the overdue
   *  list — what "they left" usually means, offered right in the delete dialog. */
  const markInactive = async () => {
    setDeleting(true);
    try {
      await apiFetch(`/students/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: student.name, parent_name: student.parent_name, parent_mobile: student.parent_mobile,
          school_id: student.school_id, standard: student.standard, pickup_location: student.pickup_location || '',
          yearly_fee: student.yearly_fee, admission_date: student.admission_date,
          start_date: student.start_date, due_date: student.due_date, active: false,
        }),
      });
      setShowDeleteConfirm(false);
      await load();
      setSuccessMsg(`${student.name} is marked inactive. The record and payment history are kept.`);
    } catch (e: any) {
      setShowDeleteConfirm(false);
      setModalErr(e.message);
    } finally {
      setDeleting(false);
    }
  };

  /** A wrong payment is corrected by deleting it and recording it again. */
  const removePayment = async (p: Payment) => {
    try {
      await apiFetch(`/payments/${p.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setModalErr(e.message);
    }
  };

  if (loading) {
    return <ActivityIndicator color={palette.brand} style={{ flex: 1, marginTop: 80 }} />;
  }

  if (!student) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border }}>
          <Pressable onPress={() => router.back()} style={{ padding: 6 }} testID="student-back">
            <Ionicons name="chevron-back" size={24} color={palette.onSurface} />
          </Pressable>
          <Text style={{ flex: 1, fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface, marginLeft: 8 }}>Student</Text>
        </View>
        <View style={{ padding: spacing.lg }}>
          <Card>
            <EmptyState icon="cloud-offline-outline" title="Could not load this student" subtitle={loadError || 'Please try again.'} />
            <Button title="Retry" onPress={() => { setLoading(true); load(); }} testID="student-retry" />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  const fullyPaid = student.status === 'completed' || pendingNow <= 0;
  const free = Number(student.yearly_fee) <= 0;
  const inactive = student.active === false;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <Pressable onPress={() => router.back()} style={{ padding: 6 }} testID="student-back">
          <Ionicons name="chevron-back" size={24} color={palette.onSurface} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface, marginLeft: 8 }}>Student</Text>
        <Pressable onPress={() => router.push(`/student/edit/${id}` as any)} testID="student-edit" style={{ padding: 6 }}>
          <Ionicons name="create-outline" size={22} color={palette.onSurface} />
        </Pressable>
        {canDelete ? (
          <Pressable onPress={() => setShowDeleteConfirm(true)} testID="student-delete" style={{ padding: 6, marginLeft: 4 }}>
            <Ionicons name="trash-outline" size={22} color={palette.error} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: palette.brandTertiary, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: palette.brand, fontWeight: '700', fontSize: 20 }}>
                {student.name.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface }}>{student.name}</Text>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>{student.school_name} · Class {student.standard}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              {free ? (
                <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: palette.success + '22' }}>
                  <Text style={{ color: palette.success, fontWeight: '700', fontSize: fontSize.sm }}>Free</Text>
                </View>
              ) : (
                <StatusBadge status={student.status} />
              )}
              {inactive ? (
                <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: palette.muted + '22' }}>
                  <Text style={{ color: palette.muted, fontWeight: '700', fontSize: fontSize.sm }}>Inactive</Text>
                </View>
              ) : null}
            </View>
          </View>
          {inactive ? (
            <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm, marginTop: spacing.md }}>
              {`${student.name} is marked inactive — off the overdue list and reminders. Edit the student to make them active again.`}
            </Text>
          ) : null}

          <View style={{ marginTop: spacing.lg, gap: 6 }}>
            <InfoRow icon="call" label="Parent" value={`${student.parent_name} · ${student.parent_mobile}`} />
            <InfoRow icon="location" label="Pickup" value={student.pickup_location || 'Not set'} />
            <InfoRow icon="calendar" label="Admission" value={calendarDateToDisplay(student.admission_date) || '—'} />
            <InfoRow
              icon="time"
              label="Next Due"
              value={
                free
                  ? 'No fee — free / scholarship'
                  : fullyPaid
                  ? 'Nothing due — fee fully paid'
                  : calendarDateToDisplay(student.next_due_date || student.due_date) || '—'
              }
            />
            {student.overdue_days > 0 ? (
              <InfoRow icon="warning" label="Overdue" value={dayLabel(student.overdue_days)} />
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', marginTop: spacing.lg, gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>Yearly</Text>
              <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface }}>{formatINRExact(student.yearly_fee)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>Paid</Text>
              <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.success }}>{formatINRExact(student.paid_amount)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>Pending</Text>
              <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.warning }}>{formatINR(student.pending_amount)}</Text>
            </View>
          </View>

          {student.status !== 'completed' && !inactive && (
            <Pressable
              testID="student-whatsapp"
              onPress={() => openWhatsApp(student.parent_mobile, reminderMessage({ studentName: student.name, school: student.school_name, pending: student.pending_amount, dueDate: student.next_due_date || student.due_date }))}
              style={{ marginTop: spacing.md, backgroundColor: palette.success, borderRadius: radii.md, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="logo-whatsapp" size={20} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '600', marginLeft: 8 }}>Send WhatsApp Reminder</Text>
            </Pressable>
          )}
        </Card>

        <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface, marginTop: spacing.xl, marginBottom: spacing.md }}>Payment History</Text>
        {payments.length === 0 ? (
          <Card><EmptyState icon="receipt-outline" title="No payments yet" subtitle="Tap Record Payment below." /></Card>
        ) : (
          payments.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', marginBottom: spacing.md }}>
              <View style={{ alignItems: 'center', marginRight: spacing.md }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: palette.success }} />
                <View style={{ flex: 1, width: 2, backgroundColor: palette.border, marginTop: 4 }} />
              </View>
              <Card style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: palette.onSurface, fontWeight: '700', fontSize: fontSize.lg }}>{formatINRExact(p.amount)}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ color: palette.muted, fontSize: fontSize.sm, textTransform: 'uppercase' }}>{p.mode}</Text>
                    {canDelete && !inactive ? (
                      <Pressable onPress={() => setConfirmDeletePayment(p)} testID={`delete-payment-${p.id}`} style={{ padding: 4, marginLeft: 8 }}>
                        <Ionicons name="trash-outline" size={16} color={palette.error} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 4 }}>{isoToDisplay(p.payment_date)}</Text>
                {p.next_due_date ? (
                  <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>
                    Next due: {calendarDateToDisplay(p.next_due_date)}
                  </Text>
                ) : null}
                {p.note ? <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm, marginTop: 4 }}>{p.note}</Text> : null}
              </Card>
            </View>
          ))
        )}
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: palette.surfaceSecondary, borderTopWidth: 1, borderTopColor: palette.border }}>
        <Button
          title={free ? 'No fee to collect' : fullyPaid ? 'Fee fully paid' : 'Record Payment'}
          icon={fullyPaid ? 'checkmark-circle' : 'add-circle'}
          onPress={openPayment}
          disabled={fullyPaid}
          testID="record-payment-btn"
        />
      </View>

      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={() => setShowModal(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} />
          <View style={{ backgroundColor: palette.surfaceSecondary, padding: spacing.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
            <View style={{ alignSelf: 'center', width: 40, height: 4, backgroundColor: palette.border, borderRadius: 2, marginBottom: spacing.md }} />
            <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: spacing.md }}>Record Payment</Text>
            <TextField
              label="Amount (₹) *"
              value={amount}
              onChangeText={(t) => { setAmount(t.replace(/[^0-9.]/g, '')); setFieldErr((f) => ({ ...f, amount: undefined })); }}
              keyboardType="number-pad"
              error={fieldErr.amount || wholeRupeeError(amount)}
              testID="payment-amount"
            />
            {!fieldErr.amount && !wholeRupeeError(amount) ? (
              <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: -8, marginBottom: spacing.md }}>
                {formatINR(pendingNow)} pending
              </Text>
            ) : null}
            <DateTimeField
              label="Payment Date & Time"
              value={date}
              onChange={setDate}
              maxDate={dayOf(new Date().toISOString())}
              required
              testID="payment-date"
            />
            {clearsFee ? (
              <Text style={{ color: palette.success, fontSize: fontSize.sm, marginBottom: spacing.md }}>
                This clears the fee — no next due date is needed.
              </Text>
            ) : (
              <>
                <DateTimeField
                  label="Next Fee Due Date"
                  mode="date"
                  value={nextDue}
                  onChange={(v) => { setNextDue(v); setFieldErr((f) => ({ ...f, nextDue: undefined })); }}
                  minDate={date ? dayOf(date) : undefined}
                  error={fieldErr.nextDue}
                  testID="payment-next-due"
                />
                {!fieldErr.nextDue ? (
                  <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: -6, marginBottom: spacing.md }}>
                    When the rest is due. Leave it blank to keep the current due date
                    {student.next_due_date || student.due_date ? ` (${calendarDateToDisplay(student.next_due_date || student.due_date)})` : ''}.
                  </Text>
                ) : null}
              </>
            )}
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: 6 }}>Mode</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md }}>
              {MODES.map((m) => {
                const active = mode === m;
                return (
                  <Pressable
                    key={m}
                    testID={`payment-mode-${m}`}
                    onPress={() => setMode(m)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: radii.md, alignItems: 'center', backgroundColor: active ? palette.brand : palette.surfaceTertiary, borderWidth: 1, borderColor: active ? palette.brand : palette.border }}
                  >
                    <Text style={{ color: active ? '#fff' : palette.onSurface, fontWeight: '600', textTransform: 'capitalize' }}>{m}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextField label="Note (optional)" value={note} onChangeText={setNote} testID="payment-note" />
            <Button title="Save Payment" onPress={submitPayment} loading={submitting} testID="payment-save" />
            <View style={{ height: spacing.sm }} />
            <Button title="Cancel" variant="ghost" onPress={() => setShowModal(false)} />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <AlertModal
        visible={!!modalErr}
        title="Cannot Save Payment"
        message={modalErr}
        onClose={() => setModalErr('')}
        testID="payment-form-error"
      />

      <AlertModal
        visible={!!successMsg}
        variant="success"
        title="Success"
        message={successMsg}
        onClose={() => setSuccessMsg('')}
        testID="payment-form-success"
      />

      <DangerConfirmModal
        visible={showDeleteConfirm}
        title={`Delete ${student.name}?`}
        message={`The student and every payment recorded for them are removed for good. If ${student.name} has only left, mark them inactive instead — the record stays.`}
        bullets={[
          `${payments.length} payment${payments.length === 1 ? '' : 's'} totalling ${formatINRExact(student.paid_amount)}`,
        ]}
        confirmWord={student.name}
        busy={deleting}
        // Leaving (inactive) is only for a fully paid student.
        actionLabel={inactive || !fullyPaid ? undefined : 'Mark inactive instead'}
        onAction={inactive || !fullyPaid ? undefined : markInactive}
        note={
          !inactive && !fullyPaid
            ? `${formatINR(pendingNow)} is still pending, so ${student.name} can't be marked inactive until the full fee is paid.`
            : undefined
        }
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={remove}
        testID="student-delete-confirm"
      />

      <ConfirmModal
        visible={!!confirmDeletePayment}
        title="Delete this payment?"
        message={
          confirmDeletePayment
            ? `${formatINRExact(confirmDeletePayment.amount)} paid on ${isoToDisplay(confirmDeletePayment.payment_date)} will be removed and go back to pending. Record it again with the right details if it was entered wrongly.`
            : ''
        }
        confirmLabel="Delete"
        onCancel={() => setConfirmDeletePayment(null)}
        onConfirm={() => { const p = confirmDeletePayment; setConfirmDeletePayment(null); if (p) removePayment(p); }}
        testID="payment-delete-confirm"
      />
    </SafeAreaView>
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
