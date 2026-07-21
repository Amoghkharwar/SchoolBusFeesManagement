import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch } from '@/src/auth';
import { useTheme, spacing, fontSize, radii } from '@/src/theme';
import { Button, Card, EmptyState, StatusBadge, TextField, DateTimeField } from '@/src/components/ui';
import { formatINR, openWhatsApp, reminderMessage } from '@/src/utils/format';
import { isoToDisplay } from '@/src/utils/datetime';

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

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [s, p] = await Promise.all([
        apiFetch(`/students/${id}`),
        apiFetch<Payment[]>(`/students/${id}/payments`),
      ]);
      setStudent(s);
      setPayments(p);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submitPayment = async () => {
    setModalErr('');
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setModalErr('Enter a valid amount'); return; }
    if (!date) { setModalErr('Please select a payment date'); return; }
    let nextIso: string | null = null;
    if (nextDue.trim()) {
      nextIso = nextDue || null;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/students/${id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: amt, payment_date: date, mode, note, next_due_date: nextIso }),
      });
      setShowModal(false);
      setAmount(''); setNote(''); setMode('cash'); setNextDue(''); setDate(new Date().toISOString());
      await load();
    } catch (e: any) {
      setModalErr(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    Alert.alert?.('Delete student?', 'This will remove all payment history.', [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          await apiFetch(`/students/${id}`, { method: 'DELETE' });
          router.back();
        } },
    ]);
  };

  if (loading || !student) {
    return <ActivityIndicator color={palette.brand} style={{ flex: 1, marginTop: 80 }} />;
  }

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
        <Pressable onPress={remove} testID="student-delete" style={{ padding: 6, marginLeft: 4 }}>
          <Ionicons name="trash-outline" size={22} color={palette.error} />
        </Pressable>
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
            <StatusBadge status={student.status} />
          </View>

          <View style={{ marginTop: spacing.lg, gap: 6 }}>
            <InfoRow icon="call" label="Parent" value={`${student.parent_name} · ${student.parent_mobile}`} />
            <InfoRow icon="location" label="Pickup" value={student.pickup_location || '—'} />
            <InfoRow icon="calendar" label="Admission" value={isoToDisplay(student.admission_date) || '—'} />
            <InfoRow icon="time" label="Next Due" value={isoToDisplay(student.next_due_date || student.due_date) || '—'} />
            {student.overdue_days > 0 ? (
              <InfoRow icon="warning" label="Overdue" value={`${student.overdue_days} days`} />
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', marginTop: spacing.lg, gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>Yearly</Text>
              <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface }}>{formatINR(student.yearly_fee)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>Paid</Text>
              <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.success }}>{formatINR(student.paid_amount)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>Pending</Text>
              <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.warning }}>{formatINR(student.pending_amount)}</Text>
            </View>
          </View>

          {student.status !== 'completed' && (
            <Pressable
              testID="student-whatsapp"
              onPress={() => openWhatsApp(student.parent_mobile, reminderMessage({ studentName: student.name, school: student.school_name, pending: student.pending_amount, dueDate: student.due_date }))}
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
                  <Text style={{ color: palette.onSurface, fontWeight: '700', fontSize: fontSize.lg }}>{formatINR(p.amount)}</Text>
                  <Text style={{ color: palette.muted, fontSize: fontSize.sm, textTransform: 'uppercase' }}>{p.mode}</Text>
                </View>
                <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 4 }}>{isoToDisplay(p.payment_date)}</Text>
                {p.next_due_date ? (
                  <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>
                    Next due: {isoToDisplay(p.next_due_date)}
                  </Text>
                ) : null}
                {p.note ? <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm, marginTop: 4 }}>{p.note}</Text> : null}
              </Card>
            </View>
          ))
        )}
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: palette.surfaceSecondary, borderTopWidth: 1, borderTopColor: palette.border }}>
        <Button title="Record Payment" icon="add-circle" onPress={() => setShowModal(true)} testID="record-payment-btn" />
      </View>

      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={() => setShowModal(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} />
          <View style={{ backgroundColor: palette.surfaceSecondary, padding: spacing.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
            <View style={{ alignSelf: 'center', width: 40, height: 4, backgroundColor: palette.border, borderRadius: 2, marginBottom: spacing.md }} />
            <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: spacing.md }}>Record Payment</Text>
            <TextField label="Amount (₹) *" value={amount} onChangeText={setAmount} keyboardType="numeric" testID="payment-amount" />
            <DateTimeField label="Payment Date & Time" value={date} onChange={setDate} required testID="payment-date" />
            <DateTimeField label="Next Fee Due Date" value={nextDue} onChange={setNextDue} testID="payment-next-due" />
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
            {modalErr ? <Text style={{ color: palette.error, marginBottom: 8 }}>{modalErr}</Text> : null}
            <Button title="Save Payment" onPress={submitPayment} loading={submitting} testID="payment-save" />
            <View style={{ height: spacing.sm }} />
            <Button title="Cancel" variant="ghost" onPress={() => setShowModal(false)} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
