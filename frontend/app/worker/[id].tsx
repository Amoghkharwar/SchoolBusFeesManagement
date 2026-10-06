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
import { formatINR, plural, wholeRupeeError } from '@/src/utils/format';
import { calendarDateToDisplay, calendarDateToLocalIso, isoToCalendarDate, isoToDisplay } from '@/src/utils/datetime';
import { owed, workerBadge } from '@/src/utils/workerStatus';

interface Period {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  /** What the month is worth before absences are taken off. */
  total_salary: number;
  /** Calendar days the month covers — the divisor behind per_day_wage. */
  days_in_period: number;
  per_day_wage: number;
  absent_days: number;
  /** Only the absences flagged to deduct — the rest are attendance history. */
  deducted_days: number;
  deduction: number;
  /** total_salary − deduction. This, not total_salary, is what a payment settles. */
  payable_salary: number;
  absence_count: number;
  paid_amount: number;
  pending_amount: number;
  status: 'pending' | 'partial' | 'completed';
  matured: boolean;
  overdue_days: number;
  note?: string;
}

interface Absence {
  id: string;
  /** Calendar date ("YYYY-MM-DD") of the first day off. */
  date: string;
  /** Last day the absence covers — the server derives it from date + days. */
  end_date?: string | null;
  days: number;
  reason?: string;
  /** Off means the day is recorded but the salary is left alone (paid leave). */
  deduct: boolean;
  period_id?: string | null;
  period_label?: string | null;
  per_day_wage: number;
  deduction_amount: number;
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

/** Must match _MAX_PERIOD_DAYS in backend/server.py. */
const MAX_PERIOD_DAYS = 31;
const DAY_MS = 24 * 3600 * 1000;

/** Local midnight of a day. */
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const todayLocal = () => midnight(new Date());
/** Last day of the calendar month a day falls in. */
const monthEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const daysInMonth = (d: Date) => monthEnd(d).getDate();
/** Calendar days from a to b, both ends included — the server's divisor. */
const spanDays = (a: Date, b: Date) => Math.round((midnight(b).getTime() - midnight(a).getTime()) / DAY_MS) + 1;
const dmy = (d: Date) => calendarDateToDisplay(midnight(d).toISOString());

/** What `days` off a month of `span` days costs — whole rupees, capped at the
 *  month. Mirrors _days_cost in backend/server.py. */
const daysCost = (total: number, span: number, days: number) =>
  span > 0 && days > 0 ? Math.round(Math.min((total * days) / span, total)) : 0;

/** The salary a stretch of days earns at a monthly rate: the full rate for a
 *  whole month, prorated by the calendar month's length for a part one (the
 *  first month after joining mid-month, say). */
function proratedSalary(monthly: number, start: Date, end: Date): number {
  const span = spanDays(start, end);
  const full = daysInMonth(start);
  if (span >= full) return monthly;
  return Math.round((monthly * span) / full);
}

/** Spells out which months a part-payment actually settled, and what is left —
 *  telling an overdue balance apart from a month that simply hasn't ended.
 *  Expects a worker that has been through settle(), so paise read as nothing. */
function settlementSummary(paidLabel: string, allocs: AllocationLabel[], worker: any): string {
  const parts = allocs && allocs.length
    ? ` — ${allocs.map((a) => `${formatINR(a.amount)} to ${a.label}`).join(', ')}`
    : '';
  let tail: string;
  if (worker && worker.matured_pending > 0) {
    tail = ` ${formatINR(worker.matured_pending)} is still due${worker.oldest_pending_month ? ` from ${worker.oldest_pending_month}` : ''}.`;
  } else if (worker && worker.upcoming_pending > 0) {
    const when = worker.upcoming_matures_on ? ` on ${calendarDateToDisplay(worker.upcoming_matures_on)}` : '';
    tail = ` Nothing is overdue. ${formatINR(worker.upcoming_pending)} is left for ${worker.upcoming_month || 'the current month'}, which falls due${when}.`;
  } else {
    tail = ' Every salary month is now fully paid.';
  }
  return `${paidLabel} recorded${parts}.${tail}`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Local mirror of the server's salary roll-up (`_period_deduction` and
 *  `worker_to_out` in backend/server.py) so toggling a deduction can repaint
 *  the figures on the spot instead of waiting out a round trip. The reload that
 *  follows overwrites all of it with the server's own numbers, so this only
 *  ever has to be right for the moment between the tap and the response.
 *
 *  Absences are attributed to the month they start in, and the server already
 *  resolved that into `period_id` — so there is no date maths to repeat here. */
/** Reads less than a rupee left on a month as paid, then rebuilds the
 *  worker's owed totals from the months. Everything on this screen goes
 *  through here, so no banner, message or button can quote "₹0 due". The
 *  server does the same (_SETTLED_BELOW); this also covers a server that
 *  predates it, and data paid to the paisa before deductions were rounded. */
function settle(periods: Period[], worker: any) {
  const nextPeriods: Period[] = periods.map((p) =>
    owed(p.pending_amount)
      ? p
      : { ...p, pending_amount: 0, overdue_days: 0, status: 'completed' },
  );
  const byStart = (a: Period, b: Period) => a.start_date.localeCompare(b.start_date);
  // Only a matured month can be owed — an in-progress one isn't late yet.
  const overdue = nextPeriods.filter((p) => p.matured && p.pending_amount > 0).sort(byStart);
  const running = nextPeriods.filter((p) => !p.matured && p.pending_amount > 0).sort(byStart)[0];
  const totalPending = r2(nextPeriods.reduce((s, p) => s + p.pending_amount, 0));
  const maturedPending = r2(overdue.reduce((s, p) => s + p.pending_amount, 0));

  return {
    periods: nextPeriods,
    worker: worker && {
      ...worker,
      total_pending: totalPending,
      matured_pending: maturedPending,
      upcoming_pending: r2(Math.max(totalPending - maturedPending, 0)),
      upcoming_month: running ? running.label : null,
      upcoming_matures_on: running ? running.end_date : null,
      status: !nextPeriods.length || !overdue.length
        ? (nextPeriods.length ? 'completed' : 'pending')
        : overdue.some((p) => p.paid_amount > 0) ? 'partial' : 'pending',
      pending_months: overdue.map((p) => p.label),
      oldest_pending_month: overdue.length ? overdue[0].label : null,
      max_overdue_days: overdue.reduce((m, p) => Math.max(m, p.overdue_days), 0),
    },
  };
}

function rollUpSalary(periods: Period[], absences: Absence[], worker: any) {
  const nextPeriods = periods.map((p) => {
    const mine = absences.filter((a) => a.period_id === p.id);
    const deductedDays = r2(mine.reduce((s, a) => s + (a.deduct ? a.days : 0), 0));
    // Capped at the month's total, exactly as the server does, so payable can
    // never read negative while the request is in flight.
    const deduction = daysCost(p.total_salary, p.days_in_period, deductedDays);
    const payable = r2(p.total_salary - deduction);
    return {
      ...p,
      absent_days: r2(mine.reduce((s, a) => s + a.days, 0)),
      deducted_days: deductedDays,
      deduction,
      payable_salary: payable,
      pending_amount: r2(Math.max(payable - p.paid_amount, 0)),
    };
  });

  const sum = (pick: (p: Period) => number) => r2(nextPeriods.reduce((s, p) => s + pick(p), 0));
  const totalDeduction = sum((p) => p.deduction);
  const settled = settle(nextPeriods, worker);
  return {
    periods: settled.periods,
    worker: settled.worker && {
      ...settled.worker,
      total_deduction: totalDeduction,
      total_payable: r2(worker.total_salary - totalDeduction),
      deducted_days: sum((p) => p.deducted_days),
    },
  };
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
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);

  const [showPayModal, setShowPayModal] = useState(false);
  const [showMonthModal, setShowMonthModal] = useState(false);
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);

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
  // Once the salary is typed by hand, changing the dates stops re-prorating it.
  const [mSalaryTouched, setMSalaryTouched] = useState(false);
  const [mNote, setMNote] = useState('');

  // add/edit-absence form — a non-null editingAbsence switches it to edit mode
  const [editingAbsence, setEditingAbsence] = useState<Absence | null>(null);
  const [aDate, setADate] = useState('');
  const [aDays, setADays] = useState('1');
  const [aReason, setAReason] = useState('');
  const [aDeduct, setADeduct] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  // The absence whose deduction is mid-flight, so its button can't be tapped twice.
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [modalErr, setModalErr] = useState('');
  // Per-field complaints for whichever sheet is open — only one is at a time.
  const [fieldErr, setFieldErr] = useState<Record<string, string | undefined>>({});
  const clearField = (k: string) => setFieldErr((f) => (f[k] ? { ...f, [k]: undefined } : f));
  const [successMsg, setSuccessMsg] = useState('');
  const [confirmDeleteWorker, setConfirmDeleteWorker] = useState(false);
  const [confirmDeletePeriod, setConfirmDeletePeriod] = useState<Period | null>(null);
  const [confirmDeletePayment, setConfirmDeletePayment] = useState<SalaryPayment | null>(null);
  const [confirmDeleteAbsence, setConfirmDeleteAbsence] = useState<Absence | null>(null);
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
      const [w, p, pay, abs] = await Promise.all([
        apiFetch<any>(`/workers/${id}`),
        apiFetch<Period[]>(`/workers/${id}/periods`),
        apiFetch<SalaryPayment[]>(`/workers/${id}/salary-payments`),
        apiFetch<Absence[]>(`/workers/${id}/absences`),
      ]);
      const settled = settle(p, w);
      setWorker(settled.worker);
      setPeriods(settled.periods);
      setPayments(pay);
      setAbsences(abs);
      return settled.worker;
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

  /** What "oldest first" would settle right now: the overdue balance if there
   *  is one, otherwise whatever is left on the month still running. */
  const defaultPayAmount = () => {
    if (!worker) return '';
    const due = worker.matured_pending > 0 ? worker.matured_pending : worker.total_pending;
    // Whole rupees, rounded down so the pre-fill never exceeds what is pending;
    // the paise this leaves on an old month count as paid.
    return due >= 1 ? String(Math.floor(due)) : '';
  };

  const openPayModal = () => {
    setModalErr('');
    setFieldErr({});
    setAmount(defaultPayAmount());
    setNote('');
    setMode('cash');
    setTargetPeriod('');
    setPayDate(new Date().toISOString());
    setShowPayModal(true);
  };

  const pickPayTarget = (periodId: string) => {
    setTargetPeriod(periodId);
    const p = periods.find((x) => x.id === periodId);
    setAmount(p ? String(Math.floor(p.pending_amount)) : defaultPayAmount());
    clearField('amount');
  };

  const closeMonthModal = () => {
    setShowMonthModal(false);
    setEditingPeriod(null);
  };

  const joinDay = useMemo(
    () => (worker?.join_date ? midnight(new Date(worker.join_date)) : null),
    [worker?.join_date],
  );

  const openMonthModal = (period?: Period) => {
    setModalErr('');
    setFieldErr({});
    if (period) {
      setEditingPeriod(period);
      setMStart(calendarDateToLocalIso(period.start_date));
      setMEnd(calendarDateToLocalIso(period.end_date));
      setMSalary(String(period.total_salary));
      setMSalaryTouched(true); // an existing month keeps its stored amount
      setMNote(period.note || '');
      setShowMonthModal(true);
      return;
    }
    setEditingPeriod(null);
    setMSalaryTouched(false);
    // The day after the latest recorded month; with none yet, the joining day
    // if they joined this month, else the 1st of this month.
    const latest = periods[0];
    const today = todayLocal();
    let start: Date;
    if (latest) {
      start = midnight(new Date(new Date(calendarDateToLocalIso(latest.end_date)).getTime() + DAY_MS));
    } else {
      const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      start = joinDay && joinDay > firstOfMonth ? joinDay : firstOfMonth;
    }
    const end = monthEnd(start);
    setMStart(start.toISOString());
    setMEnd(end.toISOString());
    setMSalary(worker?.monthly_salary ? String(proratedSalary(worker.monthly_salary, start, end)) : '');
    setMNote('');
    setShowMonthModal(true);
  };

  /** A new start drags the end along to the end of that calendar month, so a
   *  month can't silently stretch across four. When editing, the end only
   *  moves if the old one no longer makes sense with the new start. */
  const changeMonthStart = (iso: string) => {
    setMStart(iso);
    clearField('mStart');
    clearField('mEnd');
    const start = midnight(new Date(iso));
    let end = mEnd ? midnight(new Date(mEnd)) : monthEnd(start);
    if (!editingPeriod || end < start || spanDays(start, end) > MAX_PERIOD_DAYS) {
      end = monthEnd(start);
      setMEnd(end.toISOString());
    }
    if (!mSalaryTouched && worker?.monthly_salary) {
      setMSalary(String(proratedSalary(worker.monthly_salary, start, end)));
    }
  };

  const changeMonthEnd = (iso: string) => {
    setMEnd(iso);
    clearField('mEnd');
    if (!mSalaryTouched && worker?.monthly_salary && mStart) {
      setMSalary(String(proratedSalary(worker.monthly_salary, midnight(new Date(mStart)), midnight(new Date(iso)))));
    }
  };

  /** The month form's problems, keyed by field. Same rules the server applies. */
  const monthErrors = () => {
    const errs: Record<string, string> = {};
    const total = parseInt(mSalary, 10);
    if (!mStart) errs.mStart = 'Pick the first day of the month';
    if (!mEnd) errs.mEnd = 'Pick the last day of the month';
    if (mStart && mEnd) {
      const start = midnight(new Date(mStart));
      const end = midnight(new Date(mEnd));
      if (end < start) errs.mEnd = 'The end date is before the start date';
      else if (spanDays(start, end) > MAX_PERIOD_DAYS) {
        errs.mEnd = `That is ${spanDays(start, end)} days — a salary month can be at most ${MAX_PERIOD_DAYS}. Add each month separately.`;
      }
      if (joinDay && start < joinDay) {
        errs.mStart = `${worker.name} joined on ${dmy(joinDay)} — start on or after that`;
      } else if (start > todayLocal()) {
        errs.mStart = 'This month has not started yet — add it once it begins';
      }
    }
    if (!mSalary) errs.mSalary = 'Enter the salary for this month';
    else if (wholeRupeeError(mSalary)) errs.mSalary = wholeRupeeError(mSalary)!;
    else if (!total || total <= 0) errs.mSalary = 'Enter a salary above ₹0';
    return errs;
  };

  /** The month's length and day rate, shown live under the dates. */
  const monthPreview = useMemo(() => {
    if (!mStart || !mEnd) return null;
    const start = midnight(new Date(mStart));
    const end = midnight(new Date(mEnd));
    if (end < start) return null;
    const span = spanDays(start, end);
    const total = parseInt(mSalary, 10) || 0;
    return { span, perDay: span > 0 ? total / span : 0, full: daysInMonth(start) };
  }, [mStart, mEnd, mSalary]);

  const submitPayment = async () => {
    setModalErr('');
    const amt = parseInt(amount, 10);
    const target = periods.find((p) => p.id === targetPeriod);
    // Whole rupees can only ever settle the rupee part of what is pending.
    const capacity = Math.floor((target ? target.pending_amount : worker.total_pending) + 0.0001);
    const errs: Record<string, string> = {};
    const rupeeErr = wholeRupeeError(amount);
    if (rupeeErr) errs.amount = rupeeErr;
    else if (!amt || amt <= 0) errs.amount = 'Enter the amount paid';
    else if (amt > capacity) {
      errs.amount = `That is more than the ${formatINR(capacity)} pending${target ? ` for ${target.label}` : ''}`;
    }
    if (!payDate) errs.payDate = 'Pick the payment date';
    else if (new Date(payDate) > new Date()) errs.payDate = 'Payment date cannot be in the future';
    setFieldErr(errs);
    if (Object.keys(errs).length) return;
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
      // The reloaded worker, not res.worker: it has been through settle(), so
      // paise left on an old month don't come back as "₹0 is still due".
      const fresh = await load();
      setSuccessMsg(settlementSummary(formatINR(amt), res.allocation_labels, fresh || res.worker));
    } catch (e: any) {
      const msg = e.message || '';
      if (/pending|amount/i.test(msg)) setFieldErr({ amount: msg });
      else if (/payment date/i.test(msg)) setFieldErr({ payDate: msg });
      else setModalErr(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const submitMonth = async () => {
    setModalErr('');
    const total = parseInt(mSalary, 10);
    const errs = monthErrors();
    setFieldErr(errs);
    if (Object.keys(errs).length) return;
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
      const msg = e.message || '';
      if (/joined|start in the future/i.test(msg)) setFieldErr({ mStart: msg });
      else if (/at most|end date|overlaps/i.test(msg)) setFieldErr({ mEnd: msg });
      else if (/salary|paid/i.test(msg)) setFieldErr({ mSalary: msg });
      else setModalErr(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const closeAbsenceModal = () => {
    setShowAbsenceModal(false);
    setEditingAbsence(null);
  };

  const openAbsenceModal = (absence?: Absence) => {
    setModalErr('');
    setFieldErr({});
    if (absence) {
      setEditingAbsence(absence);
      setADate(calendarDateToLocalIso(absence.date));
      setADays(String(absence.days));
      setAReason(absence.reason || '');
      setADeduct(!!absence.deduct);
      setShowAbsenceModal(true);
      return;
    }
    setEditingAbsence(null);
    setADate(todayLocal().toISOString());
    setADays('1');
    setAReason('');
    setADeduct(true);
    setShowAbsenceModal(true);
  };

  /** The month the absence being edited falls in — the source of the rate the
   *  form quotes, so the user sees the cost before committing to the deduction. */
  const absenceHostPeriod = useMemo(() => {
    const day = isoToCalendarDate(aDate);
    if (!day) return null;
    return periods.find((p) => {
      const start = isoToCalendarDate(p.start_date);
      const end = isoToCalendarDate(p.end_date);
      return !!start && !!end && start <= day && day <= end;
    }) || null;
  }, [aDate, periods]);

  /** Problems with the date and day count, live — the same rules the server
   *  applies, so the preview never quotes an amount for an entry that won't save. */
  const absenceFieldErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    const d = parseFloat(aDays);
    if (!aDays) errs.aDays = 'Enter how many days were missed';
    else if (!d || d <= 0) errs.aDays = 'Days must be more than zero';
    else if (d > 31) errs.aDays = 'One entry can cover at most 31 days — split a longer absence';
    else if (Math.round(d * 2) !== d * 2) errs.aDays = 'Use a whole number or a half — for example 1 or 1.5';
    if (!aDate) errs.aDate = 'Pick the first day absent';
    else {
      const start = midnight(new Date(aDate));
      const today = todayLocal();
      if (joinDay && start < joinDay) errs.aDate = `${worker?.name} joined on ${dmy(joinDay)}`;
      else if (start > today) errs.aDate = 'Absences can only be recorded for days already gone';
      else if (!errs.aDays) {
        const last = new Date(start.getTime() + (Math.ceil(d) - 1) * DAY_MS);
        if (midnight(last) > today) {
          errs.aDays = `${Math.ceil(d)} days from ${dmy(start)} runs to ${dmy(last)}, past today`;
        }
      }
    }
    return errs;
  }, [aDate, aDays, joinDay, worker?.name]);

  /** What saving would do to the host month: this entry's own cost, and
   *  whether the month would drop below what has already been paid for it. */
  const absencePreview = useMemo(() => {
    const host = absenceHostPeriod;
    const d = parseFloat(aDays);
    if (!host || absenceFieldErrors.aDays || absenceFieldErrors.aDate || !d) return null;
    const otherDays = absences
      .filter((x) => x.period_id === host.id && x.deduct && x.id !== editingAbsence?.id)
      .reduce((sum, x) => sum + x.days, 0);
    const before = daysCost(host.total_salary, host.days_in_period, otherDays);
    const after = daysCost(host.total_salary, host.days_in_period, otherDays + (aDeduct ? d : 0));
    const payable = host.total_salary - after;
    return {
      cost: after - before,
      payable,
      // Once the month is used up, further days cost nothing more.
      capped: aDeduct && after >= host.total_salary,
      overpaid: payable + 0.0001 < host.paid_amount,
    };
  }, [absenceHostPeriod, aDays, aDeduct, absences, editingAbsence, absenceFieldErrors]);

  const submitAbsence = async () => {
    setModalErr('');
    const days = parseFloat(aDays);
    const errs: Record<string, string> = { ...absenceFieldErrors };
    if (!aReason.trim()) errs.aReason = 'Enter why the worker was absent';
    setFieldErr(errs);
    if (Object.keys(errs).length) return;
    if (absencePreview?.overpaid) return; // the preview already says why
    setSubmitting(true);
    try {
      // A calendar date, not an instant, for the same reason salary months are:
      // an instant picked in IST is stored as the previous day in UTC.
      const body = JSON.stringify({
        date: isoToCalendarDate(aDate),
        days,
        reason: aReason,
        deduct: aDeduct,
      });
      const saved = editingAbsence
        ? await apiFetch<Absence>(`/absences/${editingAbsence.id}`, { method: 'PUT', body })
        : await apiFetch<Absence>(`/workers/${id}/absences`, { method: 'POST', body });
      setShowAbsenceModal(false);
      setEditingAbsence(null);
      await load();
      const dayWord = `${days} day${days === 1 ? '' : 's'}`;
      setSuccessMsg(
        saved.deduct
          ? saved.period_label
            ? `${dayWord} absent from ${calendarDateToDisplay(saved.date)} — ${formatINR(saved.deduction_amount)} deducted from ${saved.period_label}.`
            : `${dayWord} absent from ${calendarDateToDisplay(saved.date)} recorded. No salary month covers that date yet, so nothing is deducted until you add one.`
          : `${dayWord} absent from ${calendarDateToDisplay(saved.date)} recorded as paid leave — the salary is unchanged.`,
      );
    } catch (e: any) {
      const msg = e.message || '';
      if (/joined|already recorded|days already gone/i.test(msg)) setFieldErr({ aDate: msg });
      else if (/31 days|whole number|half|days must/i.test(msg)) setFieldErr({ aDays: msg });
      else setModalErr(msg);
    } finally {
      setSubmitting(false);
    }
  };

  /** Flip one absence between "deduct" and "paid leave" straight from the list.
   *
   *  The row and every salary figure are recomputed locally and painted before
   *  the request goes out, so the tap lands immediately rather than after a PUT
   *  plus a four-call reload. The server stays authoritative: load() replaces
   *  the optimistic numbers, and a rejected toggle — the server refuses one
   *  that would drop a month below what is already paid — puts the whole screen
   *  back the way it was. */
  const toggleDeduct = async (a: Absence) => {
    if (togglingId) return; // one in flight is enough; ignore repeat taps
    const next = !a.deduct;
    const previous = { worker, periods, absences };

    const host = periods.find((p) => p.id === a.period_id);
    const nextAbsences = absences.map((x) =>
      x.id === a.id
        ? { ...x, deduct: next, deduction_amount: next && host ? daysCost(host.total_salary, host.days_in_period, x.days) : 0 }
        : x,
    );
    const rolled = rollUpSalary(periods, nextAbsences, worker);

    setTogglingId(a.id);
    setAbsences(nextAbsences);
    setPeriods(rolled.periods);
    setWorker(rolled.worker);

    try {
      await apiFetch<Absence>(`/absences/${a.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          date: a.date,
          days: a.days,
          reason: a.reason || '',
          deduct: next,
        }),
      });
      await load();
    } catch (e: any) {
      setWorker(previous.worker);
      setPeriods(previous.periods);
      setAbsences(previous.absences);
      setModalErr(e.message);
    } finally {
      setTogglingId(null);
    }
  };

  const removeAbsence = async (a: Absence) => {
    try {
      await apiFetch(`/absences/${a.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setModalErr(e.message);
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

  const badge = workerBadge(worker, palette);
  const inactive = worker.active === false;
  // Nothing to settle means nothing to pay — the server would only refuse it.
  // settle() has already zeroed paise, so anything left here is at least ₹1.
  const canPay = worker.total_pending > 0;

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
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: badge.color + '22' }}>
                <Text style={{ color: badge.color, fontWeight: '700', fontSize: fontSize.sm }}>{badge.label}</Text>
              </View>
              {inactive ? (
                <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: palette.muted + '22' }}>
                  <Text style={{ color: palette.muted, fontWeight: '700', fontSize: fontSize.sm }}>Inactive</Text>
                </View>
              ) : null}
            </View>
          </View>

          {inactive ? (
            <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm, marginTop: spacing.md }}>
              {`${worker.name} is marked inactive, so new salary months and absences can't be added.`}
              {canPay ? ' Pending salary can still be paid to settle up.' : ''}
            </Text>
          ) : null}

          <View style={{ marginTop: spacing.lg, gap: 6 }}>
            <InfoRow icon="call" label="Mobile" value={worker.mobile || '—'} />
            <InfoRow icon="calendar" label="Joined" value={worker.join_date ? dmy(new Date(worker.join_date)) : '—'} />
            <InfoRow icon="time" label="Last Paid" value={isoToDisplay(worker.last_payment_date) || 'Never'} />
            <InfoRow icon="layers" label="Months" value={`${worker.period_count} salary month${worker.period_count === 1 ? '' : 's'} recorded`} />
            <InfoRow
              icon="cash"
              label="Per day"
              value={`${formatINR(worker.per_day_wage)} a day${periods.length ? ` (${periods[0].label}: ${formatINR(periods[0].total_salary)} ÷ ${periods[0].days_in_period} days)` : ' — from the monthly salary over 30 days'}`}
            />
            <InfoRow
              icon="calendar-clear"
              label="Absent"
              value={
                worker.total_absent_days > 0
                  ? `${worker.total_absent_days} day${worker.total_absent_days === 1 ? '' : 's'}` +
                    (worker.total_deduction > 0
                      ? ` · ${formatINR(worker.total_deduction)} deducted`
                      : ' · nothing deducted')
                  : 'No absences recorded'
              }
            />
          </View>

          <View style={{ flexDirection: 'row', marginTop: spacing.lg, gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>Gross Salary</Text>
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

          {worker.upcoming_pending > 0 ? (
            <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm, marginTop: spacing.sm }}>
              {worker.matured_pending > 0 ? `${formatINR(worker.matured_pending)} due now · ` : 'Nothing due now · '}
              {formatINR(worker.upcoming_pending)} for {worker.upcoming_month || 'the current month'}
              {worker.upcoming_matures_on ? `, due ${calendarDateToDisplay(worker.upcoming_matures_on)}` : ''}
            </Text>
          ) : null}

          {worker.total_deduction > 0 ? (
            <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm, marginTop: spacing.sm }}>
              Less {formatINR(worker.total_deduction)} for {worker.deducted_days} unpaid day
              {worker.deducted_days === 1 ? '' : 's'} — {formatINR(worker.total_payable)} payable in all.
            </Text>
          ) : null}
        </Card>

        {worker.pending_months?.length > 0 ? (
          <View style={{ marginTop: spacing.md, backgroundColor: palette.error + '15', borderRadius: radii.md, borderWidth: 1, borderColor: palette.error + '40', padding: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="alert-circle" size={18} color={palette.error} />
              <Text style={{ color: palette.error, fontWeight: '700', marginLeft: 6, flex: 1 }}>
                {formatINR(worker.matured_pending)} pending
              </Text>
              {worker.max_overdue_days > 0 ? (
                <Text style={{ color: palette.error, fontSize: fontSize.sm }}>{plural(worker.max_overdue_days, 'day')} late</Text>
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
          <Pressable
            onPress={() => openMonthModal()}
            disabled={inactive}
            testID="add-salary-month"
            style={{ flexDirection: 'row', alignItems: 'center', opacity: inactive ? 0.4 : 1 }}
          >
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

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface }}>Absences</Text>
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>
              {worker.total_absent_days > 0
                ? `${worker.total_absent_days} day${worker.total_absent_days === 1 ? '' : 's'} missed · ${formatINR(worker.total_deduction)} deducted`
                : 'Days the worker did not come to work'}
            </Text>
          </View>
          <Pressable
            onPress={() => openAbsenceModal()}
            disabled={inactive}
            testID="add-absence"
            style={{ flexDirection: 'row', alignItems: 'center', opacity: inactive ? 0.4 : 1 }}
          >
            <Ionicons name="add-circle" size={18} color={palette.brand} />
            <Text style={{ color: palette.brand, fontWeight: '700', marginLeft: 4 }}>Add Absence</Text>
          </Pressable>
        </View>

        {absences.length === 0 ? (
          <Card>
            <EmptyState
              icon="calendar-clear-outline"
              title="No absences recorded"
              subtitle="Add the date, how many days were missed and the reason. Each one only cuts the salary if you switch the deduction on."
            />
          </Card>
        ) : (
          absences.map((a) => (
            <AbsenceCard
              key={a.id}
              absence={a}
              canDelete={isAdmin}
              onEdit={() => openAbsenceModal(a)}
              onToggle={() => toggleDeduct(a)}
              toggling={togglingId === a.id}
              onDelete={() => setConfirmDeleteAbsence(a)}
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

        {isAdmin && (periods.length > 0 || payments.length > 0 || absences.length > 0) ? (
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
        <Button
          title={canPay ? 'Pay Salary' : periods.length ? 'Nothing pending to pay' : 'Add a salary month to pay'}
          icon="cash-outline"
          onPress={openPayModal}
          disabled={!canPay}
          testID="pay-salary-btn"
        />
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
                onChangeText={(t) => { setAmount(t.replace(/[^0-9.]/g, '')); clearField('amount'); }}
                keyboardType="number-pad"
                error={fieldErr.amount || wholeRupeeError(amount)}
                testID="salary-amount"
              />

              <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: 6 }}>Apply to</Text>
              <View style={{ gap: 8, marginBottom: spacing.md }}>
                <Pressable
                  testID="salary-target-auto"
                  onPress={() => pickPayTarget('')}
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
                      onPress={() => pickPayTarget(p.id)}
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
                        {formatINR(p.pending_amount)} pending of {formatINR(p.payable_salary)} payable
                        {p.matured ? '' : ' · month in progress'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <DateTimeField
                label="Payment Date & Time"
                value={payDate}
                onChange={(v) => { setPayDate(v); clearField('payDate'); }}
                maxDate={todayLocal()}
                error={fieldErr.payDate}
                required
                testID="salary-date"
              />

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

              <DateTimeField
                label="Month Start Date"
                mode="date"
                value={mStart}
                onChange={changeMonthStart}
                minDate={joinDay || undefined}
                maxDate={todayLocal()}
                error={fieldErr.mStart}
                required
                testID="month-start"
              />
              <DateTimeField
                label="Month End Date (salary matures)"
                mode="date"
                value={mEnd}
                onChange={changeMonthEnd}
                minDate={mStart ? midnight(new Date(mStart)) : undefined}
                maxDate={mStart ? new Date(midnight(new Date(mStart)).getTime() + (MAX_PERIOD_DAYS - 1) * DAY_MS) : undefined}
                error={fieldErr.mEnd}
                required
                testID="month-end"
              />
              <TextField
                label="Total Salary for this month (₹) *"
                value={mSalary}
                onChangeText={(t) => { setMSalary(t.replace(/[^0-9.]/g, '')); setMSalaryTouched(true); clearField('mSalary'); }}
                keyboardType="number-pad"
                error={fieldErr.mSalary || wholeRupeeError(mSalary)}
                testID="month-salary"
              />
              {monthPreview && !fieldErr.mSalary && !wholeRupeeError(mSalary) ? (
                <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: -8, marginBottom: spacing.md }}>
                  {monthPreview.span} day{monthPreview.span === 1 ? '' : 's'} · {formatINR(monthPreview.perDay)} a day
                  {!editingPeriod && !mSalaryTouched && monthPreview.span < monthPreview.full && worker.monthly_salary
                    ? ` · prorated from ${formatINR(worker.monthly_salary)} for ${monthPreview.span} of ${monthPreview.full} days`
                    : ''}
                </Text>
              ) : null}
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

      {/* ── Add / edit absence ──────────────────── */}
      <Modal visible={showAbsenceModal} transparent animationType="slide" onRequestClose={closeAbsenceModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={closeAbsenceModal} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} />
          <View style={{ backgroundColor: palette.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%' }}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
              <View style={{ alignSelf: 'center', width: 40, height: 4, backgroundColor: palette.border, borderRadius: 2, marginBottom: spacing.md }} />
              <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: 4 }}>
                {editingAbsence ? 'Edit Absence' : 'Add Absence'}
              </Text>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: spacing.md }}>
                Record the days {worker.name} did not come to work. The salary only changes if you switch the deduction on below.
              </Text>

              <DateTimeField
                label="First day absent"
                mode="date"
                value={aDate}
                onChange={(v) => { setADate(v); clearField('aDate'); }}
                minDate={joinDay || undefined}
                maxDate={todayLocal()}
                error={fieldErr.aDate || absenceFieldErrors.aDate}
                required
                testID="absence-date"
              />

              <TextField
                label="How many days? *"
                value={aDays}
                onChangeText={(t) => { setADays(t.replace(/[^0-9.]/g, '')); clearField('aDays'); }}
                keyboardType="numeric"
                error={fieldErr.aDays || absenceFieldErrors.aDays}
                testID="absence-days"
              />
              <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: -8, marginBottom: spacing.md }}>
                Use 0.5 for a half day. Consecutive days go in as one entry.
              </Text>

              <TextField
                label="Reason *"
                value={aReason}
                onChangeText={(t) => { setAReason(t); clearField('aReason'); }}
                error={fieldErr.aReason}
                testID="absence-reason"
              />

              <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: 6 }}>Deduct from salary?</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md }}>
                {[
                  { on: true, title: 'Deduct', sub: 'Unpaid leave' },
                  { on: false, title: "Don't deduct", sub: 'Paid / approved leave' },
                ].map((opt) => {
                  const active = aDeduct === opt.on;
                  return (
                    <Pressable
                      key={String(opt.on)}
                      testID={`absence-deduct-${opt.on ? 'yes' : 'no'}`}
                      onPress={() => setADeduct(opt.on)}
                      style={{
                        flex: 1,
                        paddingVertical: 12,
                        paddingHorizontal: 10,
                        borderRadius: radii.md,
                        backgroundColor: active ? palette.brand : palette.surfaceTertiary,
                        borderWidth: 1,
                        borderColor: active ? palette.brand : palette.border,
                      }}
                    >
                      <Text style={{ color: active ? '#fff' : palette.onSurface, fontWeight: '700' }}>{opt.title}</Text>
                      <Text style={{ color: active ? '#ffffffcc' : palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>{opt.sub}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* What this actually costs, quoted before it is saved. */}
              <View style={{ backgroundColor: palette.surfaceTertiary, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md }}>
                {absenceFieldErrors.aDate || absenceFieldErrors.aDays ? (
                  <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm }}>
                    Fix the date and days above to see what this costs.
                  </Text>
                ) : absenceHostPeriod && absencePreview ? (
                  <>
                    <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm }}>
                      {absenceHostPeriod.label} · {formatINR(absenceHostPeriod.total_salary)} over {absenceHostPeriod.days_in_period} days
                      {' = '}{formatINR(absenceHostPeriod.per_day_wage)} a day
                    </Text>
                    <Text style={{ color: absencePreview.overpaid ? palette.error : aDeduct ? palette.error : palette.success, fontWeight: '700', marginTop: 4 }}>
                      {aDeduct
                        ? `${formatINR(absencePreview.cost)} will come off ${absenceHostPeriod.label}, leaving ${formatINR(absencePreview.payable)} payable`
                        : `Nothing comes off — ${absenceHostPeriod.label} stays at ${formatINR(absencePreview.payable)}`}
                    </Text>
                    {absencePreview.capped && !absencePreview.overpaid ? (
                      <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm, marginTop: 4 }}>
                        That uses up the whole month — the deduction stops at its full salary.
                      </Text>
                    ) : null}
                    {absencePreview.overpaid ? (
                      <Text style={{ color: palette.error, fontSize: fontSize.sm, marginTop: 4 }}>
                        {formatINR(absenceHostPeriod.paid_amount)} is already paid for {absenceHostPeriod.label}, more than it would be worth.
                        {` Choose "Don't deduct", or remove a payment first.`}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm }}>
                    No salary month covers this date yet. The absence is still recorded — it starts deducting on its own once you add that month.
                  </Text>
                )}
              </View>

              <Button
                title={editingAbsence ? 'Save Changes' : 'Add Absence'}
                onPress={submitAbsence}
                loading={submitting}
                disabled={!!absencePreview?.overpaid}
                testID="absence-save"
              />
              <View style={{ height: spacing.sm }} />
              <Button title="Cancel" variant="ghost" onPress={closeAbsenceModal} />
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
            : `Every salary month, absence and payment for ${worker.name} will be removed. The worker stays, with a clean slate.`
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
                `${absences.length} absence${absences.length === 1 ? '' : 's'} covering ${worker.total_absent_days} day${worker.total_absent_days === 1 ? '' : 's'}`,
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
        visible={!!confirmDeleteAbsence}
        title="Delete this absence?"
        message={
          confirmDeleteAbsence
            ? `${confirmDeleteAbsence.days} day${confirmDeleteAbsence.days === 1 ? '' : 's'} from ${calendarDateToDisplay(confirmDeleteAbsence.date)} will be removed` +
              (confirmDeleteAbsence.deduct && confirmDeleteAbsence.period_label
                ? `, and ${formatINR(confirmDeleteAbsence.deduction_amount)} goes back onto ${confirmDeleteAbsence.period_label}.`
                : '.')
            : ''
        }
        confirmLabel="Delete"
        onCancel={() => setConfirmDeleteAbsence(null)}
        onConfirm={() => { const a = confirmDeleteAbsence; setConfirmDeleteAbsence(null); if (a) removeAbsence(a); }}
        testID="absence-delete-confirm"
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

  // Progress is against what is actually owed — a deducted month is cleared by
  // a smaller payment, and the bar has to say so.
  const pct = period.payable_salary > 0 ? Math.min(period.paid_amount / period.payable_salary, 1) : 1;

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
          Payable {formatINR(period.payable_salary)}
        </Text>
        <Text style={{ color: palette.success, fontSize: fontSize.sm, marginRight: spacing.md }}>
          Paid {formatINR(period.paid_amount)}
        </Text>
        <Text style={{ color: period.pending_amount > 0 ? palette.error : palette.muted, fontSize: fontSize.sm, fontWeight: '600' }}>
          Due {formatINR(period.pending_amount)}
        </Text>
      </View>

      <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 6 }}>
        {formatINR(period.total_salary)} over {period.days_in_period} days = {formatINR(period.per_day_wage)} a day
      </Text>

      {period.absent_days > 0 ? (
        <Text style={{ color: period.deduction > 0 ? palette.error : palette.onSurfaceSecondary, fontSize: fontSize.sm, marginTop: 4 }}>
          {period.absent_days} day{period.absent_days === 1 ? '' : 's'} absent
          {period.deduction > 0
            ? ` · ${formatINR(period.deduction)} deducted for ${period.deducted_days} unpaid day${period.deducted_days === 1 ? '' : 's'}`
            : ' · not deducted'}
        </Text>
      ) : null}

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

function AbsenceCard({
  absence, canDelete, onEdit, onToggle, onDelete, toggling = false,
}: {
  absence: Absence;
  canDelete: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  /** The new state is already on screen; this only blocks a second tap. */
  toggling?: boolean;
}) {
  const { palette } = useTheme();
  const multiDay = absence.end_date && absence.end_date !== absence.date;
  const when = multiDay
    ? `${calendarDateToDisplay(absence.date)} → ${calendarDateToDisplay(absence.end_date)}`
    : calendarDateToDisplay(absence.date);
  // Three states, not two: deducting, deliberately not deducting, and waiting
  // for a salary month to exist before it can deduct anything.
  const meta = !absence.deduct
    ? { color: palette.success, label: 'Paid leave' }
    : absence.period_id
    ? { color: palette.error, label: `−${formatINR(absence.deduction_amount)}` }
    : { color: palette.warning, label: 'No month yet' };

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fontSize.base, fontWeight: '700', color: palette.onSurface }}>
            {absence.days} day{absence.days === 1 ? '' : 's'} · {when}
          </Text>
          <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>
            {absence.reason || 'No reason given'}
          </Text>
        </View>
        <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: radii.pill, backgroundColor: meta.color + '22' }}>
          <Text style={{ color: meta.color, fontWeight: '700', fontSize: fontSize.sm }}>{meta.label}</Text>
        </View>
        <Pressable onPress={onEdit} testID={`edit-absence-${absence.id}`} style={{ padding: 6, marginLeft: 4 }}>
          <Ionicons name="create-outline" size={16} color={palette.muted} />
        </Pressable>
        {canDelete ? (
          <Pressable onPress={onDelete} testID={`delete-absence-${absence.id}`} style={{ padding: 6 }}>
            <Ionicons name="trash-outline" size={16} color={palette.error} />
          </Pressable>
        ) : null}
      </View>

      <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm, marginTop: spacing.sm }}>
        {absence.period_label
          ? absence.deduct
            ? `${formatINR(absence.per_day_wage)} a day × ${absence.days} off ${absence.period_label}`
            : `Falls in ${absence.period_label} — salary left untouched`
          : 'No salary month covers this date yet, so nothing is deducted.'}
      </Text>

      <Pressable
        onPress={onToggle}
        disabled={toggling}
        testID={`toggle-absence-${absence.id}`}
        style={{
          marginTop: spacing.sm,
          paddingVertical: 8,
          borderRadius: radii.md,
          alignItems: 'center',
          borderWidth: 1,
          opacity: toggling ? 0.6 : 1,
          borderColor: absence.deduct ? palette.border : palette.error + '66',
        }}
      >
        <Text style={{ color: absence.deduct ? palette.onSurfaceSecondary : palette.error, fontWeight: '600', fontSize: fontSize.sm }}>
          {absence.deduct ? 'Stop deducting this' : 'Deduct this from the salary'}
        </Text>
      </Pressable>
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
