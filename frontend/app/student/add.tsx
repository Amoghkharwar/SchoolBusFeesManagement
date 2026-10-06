import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch } from '@/src/auth';
import { useTheme, spacing, fontSize, radii } from '@/src/theme';
import { useFY } from '@/src/fy';
import { calendarDateToDisplay, calendarDateToLocalIso } from '@/src/utils/datetime';
import { formatINR, wholeRupeeError } from '@/src/utils/format';
import { AlertModal, Button, TextField, DateTimeField } from '@/src/components/ui';

interface School { id: string; name: string }

type FieldKey = 'name' | 'parent' | 'mobile' | 'school' | 'standard' | 'fee' | 'admission' | 'due';

/** Local midnight of the day an ISO instant falls on. */
const dayOf = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};
const todayLocal = () => dayOf(new Date().toISOString());

/** The same day next month, clamped to that month's length (31 Jan → 28 Feb). */
function monthAfter(day: Date): Date {
  const last = new Date(day.getFullYear(), day.getMonth() + 2, 0).getDate();
  return new Date(day.getFullYear(), day.getMonth() + 1, Math.min(day.getDate(), last));
}

/** Which field a server rejection is about, so it lands under that field. */
function fieldForServerError(msg: string): FieldKey | null {
  // "<name> (Class 5) is already added at this school with mobile …"
  if (/already added at this school/i.test(msg)) return 'name';
  if (/due date/i.test(msg)) return 'due';
  if (/fee|already paid/i.test(msg)) return 'fee';
  if (/mobile/i.test(msg)) return 'mobile';
  if (/financial year|admission/i.test(msg)) return 'admission';
  if (/school/i.test(msg)) return 'school';
  return null;
}

export default function StudentForm() {
  const { id, school_id: presetSchool } = useLocalSearchParams<{ id?: string; school_id?: string }>();
  const editing = !!id && id !== 'add';
  const { palette } = useTheme();
  const { meta: fyInfo } = useFY();
  const [schools, setSchools] = useState<School[]>([]);
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [mobile, setMobile] = useState('');
  const [schoolId, setSchoolId] = useState(presetSchool || '');
  const [standard, setStandard] = useState('');
  const [pickup, setPickup] = useState('');
  const [fee, setFee] = useState('');
  const [admission, setAdmission] = useState(todayLocal().toISOString());
  const [startDate, setStartDate] = useState('');
  const [due, setDue] = useState('');
  // Once the due date is picked by hand, changing the start stops moving it.
  const [dueTouched, setDueTouched] = useState(false);
  // What the parent has already paid — the fee can't be cut below it.
  const [paidSoFar, setPaidSoFar] = useState(0);
  // Where payments have since moved the due date to, when editing.
  const [nextDueNow, setNextDueNow] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [err, setErr] = useState('');
  const [fieldErr, setFieldErr] = useState<Partial<Record<FieldKey, string>>>({});
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(editing);

  const effectiveStart = startDate || admission;

  useEffect(() => {
    apiFetch<School[]>('/schools').then(setSchools).catch(() => {});
    if (editing) {
      apiFetch(`/students/${id}`).then((s: any) => {
        setName(s.name); setParent(s.parent_name); setMobile(s.parent_mobile);
        setSchoolId(s.school_id); setStandard(s.standard); setPickup(s.pickup_location || '');
        setFee(String(s.yearly_fee)); setAdmission(s.admission_date);
        setStartDate(s.start_date || s.admission_date); setDue(s.due_date);
        setDueTouched(true);
        setPaidSoFar(Number(s.paid_amount) || 0);
        setNextDueNow(s.next_due_date || null);
        setActive(s.active !== false);
      }).catch(() => {}).finally(() => setHydrating(false));
    } else {
      setAdmission(todayLocal().toISOString());
    }
  }, [editing, id]);

  /** A new student's first due date: the financial year's default (7 July,
   *  say) when that is still ahead of their start, otherwise a month after
   *  they start. The year's default alone made anyone admitted after it
   *  overdue the moment they were saved. */
  const fyDue = fyInfo?.student_due_date ? dayOf(calendarDateToLocalIso(fyInfo.student_due_date)) : null;
  const defaultDue = (startIso: string) => {
    const start = dayOf(startIso);
    return fyDue && fyDue >= start ? fyDue : monthAfter(start);
  };
  const usingFyDefault = !!fyDue && !!effectiveStart && fyDue >= dayOf(effectiveStart);

  useEffect(() => {
    if (editing || dueTouched || !effectiveStart) return;
    setDue(defaultDue(effectiveStart).toISOString());
    // defaultDue reads fyInfo, which is in the deps through student_due_date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, dueTouched, effectiveStart, fyInfo?.student_due_date]);

  const clearErr = (k: FieldKey) => setFieldErr((f) => (f[k] ? { ...f, [k]: undefined } : f));

  // What would still be owed with the fee as typed — a student can only be
  // marked inactive once this is nothing (same rule the server applies).
  const feeTyped = parseInt(fee, 10);
  const owedIfSaved = Number.isFinite(feeTyped) && feeTyped - paidSoFar >= 1 ? Math.floor(feeTyped - paidSoFar) : 0;

  const submit = async () => {
    setErr('');
    const feeNum = parseInt(fee, 10);
    const errs: Partial<Record<FieldKey, string>> = {};
    if (!name.trim()) errs.name = "Enter the student's name";
    if (!parent.trim()) errs.parent = "Enter the parent's name";
    if (!/^[6-9]\d{9}$/.test(mobile.trim())) errs.mobile = 'Enter a valid 10-digit mobile number';
    if (!schoolId) errs.school = 'Pick a school';
    if (!standard.trim()) errs.standard = 'Enter the class';
    if (!fee) errs.fee = 'Enter the yearly fee';
    else if (wholeRupeeError(fee)) errs.fee = wholeRupeeError(fee);
    else if (!Number.isFinite(feeNum) || feeNum < 0) errs.fee = 'Enter the fee, or 0 for a free / scholarship student';
    else if (feeNum < paidSoFar) errs.fee = `${formatINR(paidSoFar)} is already paid — the fee can't go below that`;
    if (!admission) errs.admission = 'Pick the admission date';
    if (!due) errs.due = 'Pick the due date';
    else if (effectiveStart && dayOf(due) < dayOf(effectiveStart)) {
      errs.due = `The due date can't be before the start date (${calendarDateToDisplay(effectiveStart)})`;
    }
    setFieldErr(errs);
    if (Object.keys(errs).length) return;
    if (!active && owedIfSaved > 0) {
      setErr(`${name.trim()} still owes ${formatINR(owedIfSaved)} — collect the full fee before marking them inactive.`);
      return;
    }
    setLoading(true);
    try {
      const body = JSON.stringify({
        name: name.trim(), parent_name: parent.trim(), parent_mobile: mobile.trim(),
        school_id: schoolId, standard: standard.trim(), pickup_location: pickup,
        yearly_fee: feeNum, admission_date: admission,
        start_date: effectiveStart, due_date: due, active,
      });
      if (editing) await apiFetch(`/students/${id}`, { method: 'PUT', body });
      else await apiFetch('/students', { method: 'POST', body });
      setSuccessMsg(editing ? 'Student updated successfully' : 'Student created successfully');
    } catch (e: any) {
      const msg = e.message || '';
      const field = fieldForServerError(msg);
      if (field) setFieldErr({ [field]: msg });
      else setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <Pressable onPress={() => router.back()} style={{ padding: 6 }}><Ionicons name="chevron-back" size={24} color={palette.onSurface} /></Pressable>
        <Text style={{ flex: 1, fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface, marginLeft: 8 }}>{editing ? 'Edit Student' : 'Add Student'}</Text>
      </View>
      {hydrating ? (
        <ActivityIndicator color={palette.brand} style={{ flex: 1 }} />
      ) : (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <TextField label="Student Name *" value={name} onChangeText={(t) => { setName(t); clearErr('name'); }} error={fieldErr.name} testID="student-name" />
          <TextField label="Parent Name *" value={parent} onChangeText={(t) => { setParent(t); clearErr('parent'); }} error={fieldErr.parent} testID="student-parent" />
          <TextField
            label="Parent Mobile (WhatsApp) *"
            value={mobile}
            onChangeText={(t) => { setMobile(t.replace(/[^0-9]/g, '').slice(0, 10)); clearErr('mobile'); }}
            keyboardType="phone-pad"
            error={fieldErr.mobile}
            testID="student-mobile"
          />

          <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: 6 }}>School *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }} style={{ marginBottom: fieldErr.school ? 4 : spacing.md }}>
            {schools.map((s) => {
              const active = schoolId === s.id;
              return (
                <Pressable
                  key={s.id}
                  testID={`student-school-${s.id}`}
                  onPress={() => { setSchoolId(s.id); clearErr('school'); }}
                  style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? palette.brand : palette.surfaceTertiary, borderWidth: 1, borderColor: active ? palette.brand : fieldErr.school ? palette.error : palette.border }}
                >
                  <Text style={{ color: active ? '#fff' : palette.onSurface, fontWeight: '600', fontSize: fontSize.sm }}>{s.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {fieldErr.school ? (
            <Text style={{ color: palette.error, fontSize: fontSize.sm, marginBottom: spacing.md }}>{fieldErr.school}</Text>
          ) : null}

          <TextField label="Standard / Class *" value={standard} onChangeText={(t) => { setStandard(t); clearErr('standard'); }} error={fieldErr.standard} testID="student-standard" />
          <TextField label="Pickup Location" value={pickup} onChangeText={setPickup} testID="student-pickup" />
          <TextField
            label="Yearly Bus Fee (₹) *"
            value={fee}
            // Whole rupees. The "." stays visible and gets flagged rather than
            // being stripped, which merged the paise into the rupees.
            onChangeText={(t) => { setFee(t.replace(/[^0-9.]/g, '')); clearErr('fee'); }}
            keyboardType="number-pad"
            error={fieldErr.fee || wholeRupeeError(fee)}
            testID="student-fee"
          />
          {!fieldErr.fee && !wholeRupeeError(fee) ? (
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: -6, marginBottom: spacing.md }}>
              {editing && paidSoFar > 0
                ? `${formatINR(paidSoFar)} is already paid, so the fee can't be set below that.`
                : 'Enter 0 for a free or scholarship student.'}
            </Text>
          ) : null}
          <DateTimeField
            label="Admission Date"
            mode="date"
            value={admission}
            onChange={(v) => { setAdmission(v); clearErr('admission'); }}
            error={fieldErr.admission}
            required
            testID="student-admission"
          />
          <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: -6, marginBottom: spacing.md }}>
            When this student first joined. Kept as-is every year — the yearly rollover moves the start and due dates instead.
          </Text>
          <DateTimeField
            label="Start Date"
            mode="date"
            value={effectiveStart}
            onChange={(v) => { setStartDate(v); clearErr('due'); }}
            testID="student-start"
          />
          <DateTimeField
            label={editing ? "This Year's First Due Date" : 'Due Date'}
            mode="date"
            value={due}
            onChange={(v) => { setDue(v); setDueTouched(true); clearErr('due'); }}
            minDate={effectiveStart ? dayOf(effectiveStart) : undefined}
            error={fieldErr.due}
            required
            testID="student-due"
          />
          {!editing && !dueTouched && fyInfo?.student_due_date && !fieldErr.due ? (
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: -6, marginBottom: spacing.md }}>
              {usingFyDefault
                ? `Default for FY ${fyInfo.label} is ${calendarDateToDisplay(fyInfo.student_due_date)}. Change it here if this student differs.`
                : `FY ${fyInfo.label}'s default due date (${calendarDateToDisplay(fyInfo.student_due_date)}) is before this student starts, so it's set a month after the start date. Change it if needed.`}
            </Text>
          ) : null}

          {editing && nextDueNow && dayOf(nextDueNow).getTime() !== (due ? dayOf(due).getTime() : 0) && !fieldErr.due ? (
            // The detail page shows the *current* due date, which payments move;
            // this field is the year's first one. Say so, or the two dates look
            // like they contradict each other.
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: -6, marginBottom: spacing.md }}>
              {`Payments have since moved the next due date to ${calendarDateToDisplay(nextDueNow)} — that is what the student page shows. To change it, record the next payment with a new due date.`}
            </Text>
          ) : null}

          {editing ? (
            <>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: 6 }}>Status</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
                {[
                  { key: true, label: 'Active' },
                  { key: false, label: 'Inactive (left)' },
                ].map((opt) => {
                  const isOn = active === opt.key;
                  // Leaving is only for a student whose fee is fully paid.
                  const blocked = !opt.key && !isOn && owedIfSaved > 0;
                  return (
                    <Pressable
                      key={String(opt.key)}
                      testID={`student-active-${opt.key}`}
                      onPress={() => setActive(opt.key)}
                      disabled={blocked}
                      style={{
                        flex: 1, paddingVertical: 10, borderRadius: radii.md, alignItems: 'center',
                        backgroundColor: isOn ? palette.brand : palette.surfaceTertiary,
                        borderWidth: 1, borderColor: isOn ? palette.brand : palette.border,
                        opacity: blocked ? 0.45 : 1,
                      }}
                    >
                      <Text style={{ color: isOn ? '#fff' : palette.onSurface, fontWeight: '600' }}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ color: owedIfSaved > 0 ? palette.warning : palette.muted, fontSize: fontSize.sm, marginBottom: spacing.lg }}>
                {owedIfSaved > 0
                  ? `${formatINR(owedIfSaved)} is still pending. A student can be marked inactive only after the full fee is paid.`
                  : 'An inactive student keeps their record and payment history, but drops off the overdue list and reminders. Only an admin can delete them for good.'}
              </Text>
            </>
          ) : null}

          <Button title={editing ? 'Save Changes' : 'Add Student'} onPress={submit} loading={loading} testID="student-submit" />
        </ScrollView>
      </KeyboardAvoidingView>
      )}

      <AlertModal
        visible={!!err}
        title="Cannot Save Student"
        message={err}
        onClose={() => setErr('')}
        testID="student-form-error"
      />

      <AlertModal
        visible={!!successMsg}
        variant="success"
        title="Success"
        message={successMsg}
        onClose={() => {
          setSuccessMsg('');
          // Added from a school's page → back to that school, where it now shows.
          if (editing || presetSchool) router.back();
          else router.replace('/(tabs)/students');
        }}
        testID="student-form-success"
      />
    </SafeAreaView>
  );
}
