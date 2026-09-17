import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiFetch, useAuth, API_BASE, TOKEN_STORAGE_KEY } from '@/src/auth';
import type { FYMeta } from '@/src/fy';
import { useFY } from '@/src/fy';
import { useTheme, spacing, radii, fontSize } from '@/src/theme';
import { formatINR } from '@/src/utils/format';
import { calendarDateToDisplay, calendarDateToLocalIso, isoToCalendarDate } from '@/src/utils/datetime';
import { AlertModal, Card, DateTimeField, EmptyState } from '@/src/components/ui';
import type { PushState } from '@/src/push';
import { enablePush, pushPermission, showLocalTest, syncPush } from '@/src/push';
import { Skeleton, SkeletonCard, SkeletonKPI } from '@/src/components/Skeleton';

interface Summary {
  total_schools: number;
  total_students: number;
  total_yearly: number;
  total_collected: number;
  total_pending: number;
  total_completed: number;
}
interface SchoolStat {
  school_id: string;
  school_name: string;
  student_count: number;
  yearly_total: number;
  collected: number;
  pending: number;
}

// Confirm step shown inline inside the action sheet (no Alert.alert — works on web + mobile)
type ConfirmStep = 'close' | 'delete' | 'reset' | null;

export default function Dashboard() {
  const { palette, isDark, mode, setMode } = useTheme();
  const { admin, logout } = useAuth();
  const { current: fy, years, fyMeta, meta: fyInfo, needsSetup, refresh: refreshFY, closeFY, deleteYear, resetData, createFY, updateFY, previewLabel } = useFY();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [schools, setSchools] = useState<SchoolStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Create FY modal
  const [showFyModal, setShowFyModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [fyError, setFyError] = useState('');
  // The year is defined by its window; the label is derived from it, not typed.
  const [fyStart, setFyStart] = useState('');
  const [fyEnd, setFyEnd] = useState('');
  const [fyPreview, setFyPreview] = useState<string | null>(null);
  const [fyDue, setFyDue] = useState('');
  // Non-null puts the same form into edit mode against an existing year.
  const [editingFY, setEditingFY] = useState<FYMeta | null>(null);

  // FY action bottom-sheet
  const [actionFY, setActionFY] = useState<FYMeta | null>(null);
  const [actionBusy, setActionBusy] = useState<'close' | 'delete' | 'reset' | 'pdf' | 'excel' | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  // Inline confirm step (replaces Alert.alert so it works on web too)
  const [confirmStep, setConfirmStep] = useState<ConfirmStep>(null);

  const [pushState, setPushState] = useState<PushState>('unsupported');
  const [pushMsg, setPushMsg] = useState('');

  useEffect(() => {
    setPushState(pushPermission());
    syncPush();
  }, []);

  // Already on: run the two tests instead of switching off. A local notification
  // tells us whether this device can display at all, and the server round-trip
  // tells us whether delivery works — which is the pair that actually diagnoses
  // "nothing appeared".
  const runPushTests = async () => {
    try {
      await showLocalTest();
    } catch (e: any) {
      setPushMsg(`Local test failed: ${e?.message || e}. Notifications are blocked on this device.`);
      return;
    }
    try {
      const r = await apiFetch<{ sent: number; total: number; errors?: string[] }>(
        '/push/test',
        { method: 'POST' },
      );
      setPushMsg(
        `Local test shown. Server sent to ${r.sent} of ${r.total} device(s).` +
          (r.errors?.length ? ` Errors: ${r.errors.join('; ')}` : '') +
          ' If you saw the first but not the second, delivery is the problem.',
      );
    } catch (e: any) {
      setPushMsg(`Local test shown, but the server test failed: ${e?.message || e}`);
    }
  };

  const togglePush = async () => {
    if (pushState === 'granted') {
      await runPushTests();
      return;
    }
    try {
      const next = await enablePush();
      setPushState(next);
      setPushMsg(
        next === 'granted'
          ? 'Notifications are on. You will be alerted when a student or school is added.'
          : next === 'denied'
            ? 'Notifications are blocked. Enable them for this site in your browser settings.'
            : 'Notification permission was dismissed.',
      );
    } catch (e: any) {
      setPushMsg(e?.message || 'Could not enable notifications.');
    }
  };

  const isAdmin = admin?.role === 'admin';

  // Find any older financial year that is still open (e.g. 2025-2026 when active year is 2026-2027)
  // A year expires when today passes its end date. That is a prompt to export
  // and roll over — nothing closes or deletes itself.
  const expiredFY = fyInfo?.expired ? fyInfo : null;

  const openFyModal = (edit?: FYMeta) => {
    setFyError('');
    setEditingFY(edit || null);
    setFyStart(edit?.start_date ? calendarDateToLocalIso(edit.start_date) : '');
    setFyEnd(edit?.end_date ? calendarDateToLocalIso(edit.end_date) : '');
    setFyPreview(edit?.label || null);
    setFyDue(edit?.student_due_date ? calendarDateToLocalIso(edit.student_due_date) : '');
    setShowFyModal(true);
  };

  // Ask the server what the window would be called, so the preview and the
  // eventual label can never disagree.
  useEffect(() => {
    let cancelled = false;
    if (!fyStart || !fyEnd) {
      setFyPreview(null);
      return;
    }
    previewLabel(isoToCalendarDate(fyStart), isoToCalendarDate(fyEnd)).then((res) => {
      if (cancelled) return;
      setFyPreview(res.label);
      // Only ever prefill an empty picker — never overwrite a date already chosen.
      if (res.student_due_date && !fyDue) setFyDue(calendarDateToLocalIso(res.student_due_date));
    });
    return () => { cancelled = true; };
  }, [fyStart, fyEnd, previewLabel]);

  const handleCreateFY = async () => {
    setFyError('');
    if (!fyStart || !fyEnd) {
      setFyError('Select both the start date and the end date of the financial year');
      return;
    }
    try {
      setCreating(true);
      if (editingFY) {
        const updated = await updateFY(
          editingFY.label, isoToCalendarDate(fyStart), isoToCalendarDate(fyEnd),
          fyDue ? isoToCalendarDate(fyDue) : undefined,
        );
        setShowFyModal(false);
        setEditingFY(null);
        await load();
        setActionMsg(
          updated.renamed
            ? `✓ Financial Year updated — now FY ${updated.label}.`
            : `✓ FY ${updated.label} dates updated.`,
        );
      } else {
        const created = await createFY(
          isoToCalendarDate(fyStart), isoToCalendarDate(fyEnd),
          fyDue ? isoToCalendarDate(fyDue) : undefined,
        );
        setShowFyModal(false);
        await load();
        setActionMsg(
          created.students_rolled
            ? `✓ FY ${created.label} created. ${created.students_rolled} student(s) carried over, due ${calendarDateToDisplay(created.student_due_date)}.`
            : `✓ Financial Year ${created.label} created.`,
        );
      }
    } catch (e: any) {
      setFyError(e.message || 'Failed to create financial year');
    } finally {
      setCreating(false);
    }
  };

  const openActionSheet = (y: string) => {
    const meta = fyMeta.find((m) => m.label === y);
    const selected: FYMeta = meta ?? { label: y, status: 'open' };
    setActionFY(selected);
    setActionMsg('');
    setActionBusy(null);
    setConfirmStep(null);
  };

  const closeActionSheet = () => {
    setActionFY(null);
    setActionMsg('');
    setActionBusy(null);
    setConfirmStep(null);
  };

  // ── FY close (inline confirm) ─────────────────────────────
  const doCloseFY = async () => {
    if (!actionFY) return;
    const label = actionFY.label;
    setActionBusy('close');
    setActionMsg('');
    setConfirmStep(null);
    try {
      await closeFY(label);
      setActionFY({ ...actionFY, status: 'closed', closed_at: new Date().toISOString() });
      setActionMsg(`✓ FY ${label} is now closed.`);
    } catch (e: any) {
      setActionMsg(`Error: ${e.message || 'Failed to close FY'}`);
    } finally {
      setActionBusy(null);
    }
  };

  // ── Download ──────────────────────────────────────────────
  const handleDownloadReport = async (format: 'pdf' | 'excel') => {
    if (!actionFY) return;
    setActionBusy(format);
    setActionMsg('');
    try {
      const token = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
      const params = new URLSearchParams();
      params.set('fy', actionFY.label);
      if (token) params.set('token', token);
      const url = `${API_BASE}/reports/${format}?${params.toString()}`;
      await Linking.openURL(url);
      setActionMsg(
        format === 'pdf'
          ? '✓ PDF opened — use Share → Save to keep it.'
          : '✓ Excel download started — check your Downloads folder.',
      );
    } catch (e: any) {
      setActionMsg(`Error: ${e.message || 'Failed to open report'}`);
    } finally {
      setActionBusy(null);
    }
  };

  // ── Delete records (inline confirm) ──────────────────────
  const doDeleteRecords = async () => {
    if (!actionFY) return;
    const label = actionFY.label;
    setActionBusy('delete');
    setActionMsg('');
    setConfirmStep(null);
    try {
      const res = await deleteYear(label);
      setActionMsg(
        `✓ FY ${label} deleted — ${res.deleted_payments} fee payment(s) removed. ` +
        `${res.kept_students} student(s) and ${res.kept_schools} school(s) carried over. ` +
        `You can now create the next financial year.`,
      );
      await load();
      setTimeout(() => closeActionSheet(), 4000);
    } catch (e: any) {
      setActionMsg(`Error: ${e.message || 'Failed to delete records'}`);
    } finally {
      setActionBusy(null);
    }
  };

  // ── Reset FY data — wipes students/payments but keeps the FY open ──
  const doResetData = async () => {
    if (!actionFY) return;
    const label = actionFY.label;
    setActionBusy('reset');
    setActionMsg('');
    setConfirmStep(null);
    try {
      const res = await resetData(label);
      setActionMsg(`✓ Reset FY ${label}: removed ${res.deleted_payments} fee payment(s). Students and the FY itself are kept.`);
      await load();
    } catch (e: any) {
      setActionMsg(`Error: ${e.message || 'Failed to reset FY data'}`);
    } finally {
      setActionBusy(null);
    }
  };

  // ── Dashboard data load ───────────────────────────────────
  const load = useCallback(async () => {
    try {
      const q = fy ? `?fy=${fy}` : '';
      const [s, by] = await Promise.all([
        apiFetch<Summary>(`/dashboard/summary${q}`),
        apiFetch<SchoolStat[]>(`/dashboard/by-school${q}`),
      ]);
      setSummary(s);
      setSchools(by);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fy]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    refreshFY();
    load();
  }, [load, refreshFY]));

  const cycleTheme = () => {
    setMode(mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light');
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fontSize.sm, color: palette.muted }}>Welcome back</Text>
          <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface }} numberOfLines={1} testID="dashboard-title">
            {admin?.email ?? 'Admin'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {pushState !== 'unsupported' && (
            <Pressable onPress={togglePush} testID="push-toggle"
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: palette.surfaceTertiary, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons
                name={pushState === 'granted' ? 'notifications' : 'notifications-off-outline'}
                size={18}
                color={pushState === 'granted' ? palette.brand : palette.onSurface}
              />
            </Pressable>
          )}
          <Pressable onPress={cycleTheme} testID="theme-toggle"
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: palette.surfaceTertiary, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={isDark ? 'sunny' : 'moon'} size={18} color={palette.onSurface} />
          </Pressable>
          <Pressable onPress={logout} testID="logout-button"
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: palette.surfaceTertiary, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="log-out-outline" size={20} color={palette.onSurface} />
          </Pressable>
        </View>
      </View>

      {/* ── Financial Year bar — one year at a time ── */}
      <View style={{ borderBottomWidth: 1, borderBottomColor: palette.border, paddingVertical: spacing.sm }}>
        <View style={{ paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="calendar-outline" size={14} color={palette.muted} />
          <Text style={{ color: palette.muted, fontSize: fontSize.sm, fontWeight: '600', flex: 1 }}>
            Financial Year
          </Text>
          {needsSetup && isAdmin ? (
            <Pressable
              testID="create-fy-btn"
              onPress={() => openFyModal()}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.sm, backgroundColor: palette.brand, flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Ionicons name="add" size={14} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: fontSize.sm }}>Set up</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={{ paddingHorizontal: spacing.lg, marginTop: 8 }}>
          {years.length === 0 && !needsSetup ? (
            <Skeleton width={180} height={36} radius={18} />
          ) : needsSetup ? (
            <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>
              No financial year yet. Set one up to start recording fees.
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View
                testID={`fy-chip-${fy}`}
                style={{
                  height: 36, paddingHorizontal: 14, borderRadius: 18, flexDirection: 'row',
                  alignItems: 'center', gap: 6, backgroundColor: palette.brand,
                  borderWidth: 1, borderColor: palette.brand,
                }}
              >
                {fyInfo?.status === 'closed' ? <Ionicons name="lock-closed" size={11} color="#fff" /> : null}
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: fontSize.sm }}>FY {fy}</Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={{ color: palette.muted, fontSize: fontSize.sm }} numberOfLines={1}>
                  {calendarDateToDisplay(fyInfo?.start_date) || '—'} → {calendarDateToDisplay(fyInfo?.end_date) || '—'}
                </Text>
                {expiredFY ? (
                  <Text style={{ color: palette.error, fontSize: fontSize.sm, fontWeight: '700' }}>
                    Expired — download and delete to start the next year
                  </Text>
                ) : fyInfo?.days_left != null && fyInfo.days_left <= 30 ? (
                  <Text style={{ color: palette.warning, fontSize: fontSize.sm }}>
                    {fyInfo.days_left} day{fyInfo.days_left === 1 ? '' : 's'} left
                  </Text>
                ) : null}
              </View>

              {isAdmin ? (
                <Pressable
                  testID={`fy-options-${fy}`}
                  onPress={() => openActionSheet(fy)}
                  style={{
                    width: 28, height: 28, borderRadius: 14, backgroundColor: palette.surfaceTertiary,
                    borderWidth: 1, borderColor: expiredFY ? palette.error : palette.border,
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Ionicons name="ellipsis-horizontal" size={14} color={expiredFY ? palette.error : palette.muted} />
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      </View>

      {/* ── Dashboard body ── */}
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        {loading ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg }}>
              <SkeletonKPI /><SkeletonKPI /><SkeletonKPI /><SkeletonKPI />
            </View>
            <Skeleton width="40%" height={18} style={{ marginBottom: spacing.md }} />
            <SkeletonCard /><SkeletonCard />
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg }}>
              <KPI icon="business" label="Schools" value={String(summary?.total_schools ?? 0)} />
              <KPI icon="people" label="Students" value={String(summary?.total_students ?? 0)} />
              <KPI icon="cash" label="Collected" value={formatINR(summary?.total_collected)} accent="success" />
              <KPI icon="alert-circle" label="Pending" value={formatINR(summary?.total_pending)} accent="warning" />
            </View>
            <Text style={[styles.sectionTitle, { color: palette.onSurface }]}>School-wise summary</Text>
            {schools.length === 0 ? (
              <Card>
                <EmptyState icon="business-outline" title="No schools yet" subtitle="Add your first school from the Schools tab." />
              </Card>
            ) : (
              schools.map((s) => (
                <Pressable key={s.school_id} testID={`school-card-${s.school_id}`}
                  onPress={() => router.push(`/school/${s.school_id}`)} style={{ marginBottom: spacing.md }}>
                  <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: palette.brandTertiary, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="school" size={22} color={palette.brand} />
                      </View>
                      <View style={{ flex: 1, marginLeft: spacing.md }}>
                        <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface }}>{s.school_name}</Text>
                        <Text style={{ color: palette.muted, marginTop: 2, fontSize: fontSize.sm }}>{s.student_count} students</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={palette.muted} />
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
                      <View>
                        <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>Collected</Text>
                        <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.success, marginTop: 2 }}>{formatINR(s.collected)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>Pending</Text>
                        <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.warning, marginTop: 2 }}>{formatINR(s.pending)}</Text>
                      </View>
                    </View>
                  </Card>
                </Pressable>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* ══════════ Add FY Modal ══════════ */}
      <Modal visible={showFyModal} transparent animationType="slide" onRequestClose={() => setShowFyModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg }}>
            <View style={{ backgroundColor: palette.surfaceSecondary, borderRadius: radii.lg, padding: spacing.lg, width: '100%', maxWidth: 420 }}>
              <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: spacing.sm }}>
                {editingFY ? `Edit FY ${editingFY.label}` : needsSetup ? 'Set Up Financial Year' : 'Add Financial Year'}
              </Text>

              {!needsSetup && !editingFY ? (
                // One year exists at a time, so the way forward is to export and
                // delete the running one — said plainly rather than just refused.
                <>
                  <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: spacing.md }}>
                    FY {fy} is still active. Download its records and delete it, then the next
                    year can be created.
                  </Text>
                  <View style={{ backgroundColor: `${palette.warning}18`, borderWidth: 1, borderColor: palette.warning, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md }}>
                    <Text style={{ color: palette.onSurface, fontSize: fontSize.sm, lineHeight: 18 }}>
                      Deleting FY {fy} removes that year&apos;s fee payments only. Schools and students
                      are kept and carry into the new year with their fees starting fresh.
                    </Text>
                  </View>
                  <Pressable
                    testID="fy-modal-manage"
                    onPress={() => { setShowFyModal(false); openActionSheet(fy); }}
                    style={{ backgroundColor: palette.brand, paddingVertical: 13, borderRadius: radii.md, alignItems: 'center', marginBottom: spacing.sm }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Download & Delete FY {fy} →</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: spacing.md }}>
                    {editingFY
                      ? 'Move the window this year covers. The name follows the dates, so changing the years renames it.'
                      : 'Pick the window this financial year covers. The name is worked out from the dates, so the two can never disagree.'}
                  </Text>

                  <DateTimeField label="Start Date" value={fyStart} onChange={setFyStart} required testID="fy-start" />
                  <DateTimeField label="End Date" value={fyEnd} onChange={setFyEnd} required testID="fy-end" />
                  <DateTimeField label="Student Due Date" value={fyDue} onChange={setFyDue} testID="fy-due" />
                  <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: -6, marginBottom: spacing.md }}>
                    The first due date every student inherits this year. Defaults to 7 July. Later
                    due dates shift as part-payments come in.
                  </Text>

                  <View style={{ backgroundColor: palette.surfaceTertiary, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md, alignItems: 'center' }}>
                    <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>
                      {editingFY ? 'Will be named' : 'Will be created as'}
                    </Text>
                    <Text style={{ color: fyPreview ? palette.brand : palette.muted, fontSize: fontSize.xl, fontWeight: '700', marginTop: 2 }}>
                      {fyPreview ? `FY ${fyPreview}` : '—'}
                    </Text>
                  </View>

                  <Pressable
                    testID="fy-create-submit"
                    onPress={handleCreateFY}
                    disabled={creating || !fyStart || !fyEnd}
                    style={{
                      backgroundColor: !fyStart || !fyEnd ? palette.surfaceTertiary : palette.brand,
                      paddingVertical: 13, borderRadius: radii.md, alignItems: 'center',
                      marginBottom: spacing.sm, opacity: creating ? 0.7 : 1,
                    }}
                  >
                    <Text style={{ color: !fyStart || !fyEnd ? palette.muted : '#fff', fontWeight: '700' }}>
                      {creating ? 'Saving…' : editingFY ? 'Save Dates' : 'Create Financial Year'}
                    </Text>
                  </Pressable>
                </>
              )}

              {fyError ? (
                <View style={{ backgroundColor: `${palette.error}15`, padding: spacing.md, borderRadius: radii.md, marginBottom: spacing.md }}>
                  <Text style={{ color: palette.error, fontSize: fontSize.sm, textAlign: 'center' }}>{fyError}</Text>
                </View>
              ) : null}

              <Pressable
                onPress={() => { setShowFyModal(false); setFyError(''); setEditingFY(null); }}
                style={{ paddingVertical: 13, borderRadius: radii.md, borderWidth: 1, borderColor: palette.border, alignItems: 'center' }}
              >
                <Text style={{ color: palette.onSurface, fontWeight: '600' }}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══════════ FY Action Bottom Sheet ══════════ */}
      <Modal visible={!!actionFY} transparent animationType="slide" onRequestClose={closeActionSheet}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={closeActionSheet}>
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => {/* prevent close on inner tap */}} style={{
            backgroundColor: palette.surfaceSecondary,
            borderTopLeftRadius: radii.lg,
            borderTopRightRadius: radii.lg,
            padding: spacing.lg,
            paddingBottom: 40,
          }}>
            {/* Drag handle */}
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: palette.border, alignSelf: 'center', marginBottom: spacing.md }} />

            {/* FY header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg }}>
              <View style={{
                width: 48, height: 48, borderRadius: 14,
                backgroundColor: actionFY?.status === 'closed' ? `${palette.warning}18` : palette.brandTertiary,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons
                  name={actionFY?.status === 'closed' ? 'lock-closed' : 'calendar'}
                  size={22}
                  color={actionFY?.status === 'closed' ? palette.warning : palette.brand}
                />
              </View>
              <View style={{ marginLeft: spacing.md, flex: 1 }}>
                <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface }}>
                  FY {actionFY?.label}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                  <View style={{
                    width: 7, height: 7, borderRadius: 4,
                    backgroundColor: actionFY?.status === 'closed' ? palette.warning : palette.success,
                  }} />
                  <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>
                    {actionFY?.status === 'closed' ? 'Closed' : 'Open'}
                    {actionFY?.status === 'closed' && actionFY?.closed_at
                      ? `  ·  ${new Date(actionFY.closed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                      : ''}
                  </Text>
                </View>
              </View>
            </View>

            {/* ─── Confirm: Close ─── */}
            {confirmStep === 'close' && (
              <ConfirmPanel
                title={`Close FY ${actionFY?.label}?`}
                body="Once closed, no new records should be added. You can then download or delete its data."
                confirmLabel="Yes, Close FY"
                confirmColor={palette.warning}
                onConfirm={doCloseFY}
                onCancel={() => setConfirmStep(null)}
                palette={palette}
              />
            )}

            {/* ─── Confirm: Delete ─── */}
            {confirmStep === 'delete' && (
              <ConfirmPanel
                title={`Delete FY ${actionFY?.label}?`}
                body="This removes this financial year and every fee payment recorded in it. Schools and students are kept and carry into the next year with their fees starting fresh. Download the records first — this CANNOT be undone."
                confirmLabel="Delete Financial Year"
                confirmColor={palette.error}
                onConfirm={doDeleteRecords}
                onCancel={() => setConfirmStep(null)}
                palette={palette}
              />
            )}

            {/* ─── Confirm: Reset ─── */}
            {confirmStep === 'reset' && (
              <ConfirmPanel
                title={`Reset fee data for FY ${actionFY?.label}?`}
                body="This clears every fee payment recorded in this financial year. The year stays open and the student roster is untouched, so you can start collecting again from zero. This CANNOT be undone."
                confirmLabel="Reset Fee Data"
                confirmColor={palette.error}
                onConfirm={doResetData}
                onCancel={() => setConfirmStep(null)}
                palette={palette}
              />
            )}

            {/* ─── Normal action rows ─── */}
            {confirmStep === null && (
              <>
                {/* CLOSE — only for open FYs */}
                {actionFY?.status !== 'closed' && (
                  <ActionRow
                    icon="lock-closed-outline"
                    label="Close Financial Year"
                    description="Lock this FY to enable download & delete."
                    color={palette.warning}
                    busy={actionBusy === 'close'}
                    onPress={() => setConfirmStep('close')}
                    palette={palette}
                  />
                )}

                {/* DOWNLOAD PDF — always available */}
                <ActionRow
                  icon="document-text-outline"
                  label="Download PDF Report"
                  description="Full payment report for this financial year."
                  color={palette.brand}
                  busy={actionBusy === 'pdf'}
                  onPress={() => handleDownloadReport('pdf')}
                  palette={palette}
                />

                {/* DOWNLOAD EXCEL — always available */}
                <ActionRow
                  icon="grid-outline"
                  label="Download Excel (.xlsx)"
                  description="Spreadsheet export — opens in Excel or Sheets."
                  color={palette.success}
                  busy={actionBusy === 'excel'}
                  onPress={() => handleDownloadReport('excel')}
                  palette={palette}
                />

                <ActionRow
                  icon="calendar-outline"
                  label="Edit Dates"
                  description={`Currently ${calendarDateToDisplay(actionFY?.start_date) || '—'} to ${calendarDateToDisplay(actionFY?.end_date) || '—'}.`}
                  color={palette.brand}
                  busy={false}
                  onPress={() => { const f = actionFY; closeActionSheet(); if (f) openFyModal(f); }}
                  palette={palette}
                />

                {/* RESET DATA — available anytime, independent of open/closed status */}
                <View style={{ height: 1, backgroundColor: palette.border, marginVertical: spacing.sm }} />
                <ActionRow
                  icon="refresh-outline"
                  label="Reset Fee Data"
                  description="Clear this year's payments. Students are kept and the year stays open."
                  color={palette.error}
                  busy={actionBusy === 'reset'}
                  onPress={() => setConfirmStep('reset')}
                  palette={palette}
                  destructive
                />

                {/* DELETE — closing first is not required; the export is the safeguard */}
                <View style={{ height: 1, backgroundColor: palette.border, marginVertical: spacing.sm }} />
                <ActionRow
                  icon="trash-outline"
                  label="Delete Financial Year"
                  description="Removes this year and its fee payments. Students carry over. Download first."
                  color={palette.error}
                  busy={actionBusy === 'delete'}
                  onPress={() => setConfirmStep('delete')}
                  palette={palette}
                  destructive
                />
              </>
            )}

            {/* Feedback */}
            {actionMsg ? (
              <View style={{
                marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md,
                backgroundColor: actionMsg.startsWith('Error') ? `${palette.error}15` : `${palette.success}15`,
              }}>
                <Text style={{ color: actionMsg.startsWith('Error') ? palette.error : palette.success, fontSize: fontSize.sm, textAlign: 'center' }}>
                  {actionMsg}
                </Text>
              </View>
            ) : null}

            {/* Done */}
            <Pressable onPress={closeActionSheet}
              style={{ marginTop: spacing.md, paddingVertical: 14, borderRadius: radii.md, borderWidth: 1, borderColor: palette.border, alignItems: 'center' }}>
              <Text style={{ color: palette.onSurface, fontWeight: '600' }}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <AlertModal
        visible={!!pushMsg}
        variant={pushState === 'granted' ? 'success' : 'error'}
        title="Notifications"
        message={pushMsg}
        onClose={() => setPushMsg('')}
        testID="push-status"
      />
    </SafeAreaView>
  );
}

// ── Inline confirmation panel (works on web + mobile, no Alert.alert needed) ──
function ConfirmPanel({
  title, body, confirmLabel, confirmColor, onConfirm, onCancel, palette,
}: {
  title: string; body: string; confirmLabel: string; confirmColor: string;
  onConfirm: () => void; onCancel: () => void; palette: any;
}) {
  return (
    <View style={{
      borderRadius: radii.md, borderWidth: 1.5, borderColor: `${confirmColor}50`,
      backgroundColor: `${confirmColor}0A`, padding: spacing.md, marginBottom: spacing.md,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: 8 }}>
        <Ionicons name="warning-outline" size={18} color={confirmColor} />
        <Text style={{ color: confirmColor, fontWeight: '700', fontSize: fontSize.base, flex: 1 }}>{title}</Text>
      </View>
      <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: spacing.md, lineHeight: 18 }}>{body}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={onCancel} style={{
          flex: 1, paddingVertical: 10, borderRadius: radii.md,
          borderWidth: 1, borderColor: palette.border, alignItems: 'center',
        }}>
          <Text style={{ color: palette.onSurface, fontWeight: '600', fontSize: fontSize.sm }}>Cancel</Text>
        </Pressable>
        <Pressable onPress={onConfirm} style={{
          flex: 1, paddingVertical: 10, borderRadius: radii.md,
          backgroundColor: confirmColor, alignItems: 'center',
        }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: fontSize.sm }}>{confirmLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Action row ──
function ActionRow({
  icon, label, description, color, busy, onPress, palette, destructive,
}: {
  icon: any; label: string; description: string; color: string;
  busy: boolean; onPress: () => void; palette: any; destructive?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={busy}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: spacing.md, paddingHorizontal: spacing.md,
        borderRadius: radii.md, marginBottom: 8,
        backgroundColor: pressed ? `${color}15` : destructive ? `${color}08` : palette.surfaceTertiary,
        borderWidth: 1, borderColor: destructive ? `${color}40` : palette.border,
        opacity: busy ? 0.55 : 1,
      })}>
      <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: `${color}18`, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={busy ? 'hourglass-outline' : icon} size={20} color={color} />
      </View>
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text style={{ color: destructive ? color : palette.onSurface, fontWeight: '600', fontSize: fontSize.base }}>{label}</Text>
        <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 1 }}>{description}</Text>
      </View>
      {!busy && <Ionicons name="chevron-forward" size={16} color={palette.muted} />}
    </Pressable>
  );
}

// ── KPI card ──
function KPI({ icon, label, value, accent }: { icon: any; label: string; value: string; accent?: 'success' | 'warning' }) {
  const { palette } = useTheme();
  const color = accent === 'success' ? palette.success : accent === 'warning' ? palette.warning : palette.brand;
  return (
    <View testID={`kpi-${label.toLowerCase()}`} style={{
      flex: 1, minWidth: '46%',
      backgroundColor: palette.surfaceSecondary,
      padding: spacing.md, borderRadius: radii.lg,
      borderWidth: 1, borderColor: palette.border,
    }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: palette.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm }}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>{label}</Text>
      <Text style={{ color: palette.onSurface, fontSize: fontSize.xl, fontWeight: '700', marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1,
  },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: '700', marginBottom: spacing.md },
});
