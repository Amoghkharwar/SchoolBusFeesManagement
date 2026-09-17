import React, { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  Modal,
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
import { AlertModal, Card, EmptyState } from '@/src/components/ui';
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
  const { current: fy, years, fyMeta, setCurrent, refresh: refreshFY, closeFY, deleteRecords, resetData } = useFY();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [schools, setSchools] = useState<SchoolStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Create FY modal
  const [showFyModal, setShowFyModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [fyError, setFyError] = useState('');

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
  const unclosedOlderFY = fyMeta.find((m) => {
    if (m.status !== 'open') return false;
    const startYear = parseInt(m.label.split('-')[0], 10);
    const now = new Date();
    const currentStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return !isNaN(startYear) && startYear < currentStartYear;
  });

  const handleCreateFY = async (label: string) => {
    const targetStartYear = parseInt(label.split('-')[0], 10);
    if (unclosedOlderFY) {
      const oldStartYear = parseInt(unclosedOlderFY.label.split('-')[0], 10);
      if (targetStartYear > oldStartYear) {
        setFyError(
          `⚠️ Cannot create FY ${label}. Older Financial Year FY ${unclosedOlderFY.label} is still OPEN. Please close FY ${unclosedOlderFY.label} and download its records first.`
        );
        return;
      }
    }

    try {
      setCreating(true);
      setFyError('');
      await apiFetch('/financial-years', {
        method: 'POST',
        body: JSON.stringify({ label }),
      });
      await refreshFY();
      setCurrent(label);
      setShowFyModal(false);
    } catch (e: any) {
      setFyError(e.message || 'Failed to create financial year');
    } finally {
      setCreating(false);
    }
  };

  /**
   * Computes options for Add FY modal.
   * Checks fyMeta (explicitly registered FYs in DB) — NOT the auto-derived `years` list —
   * so the current year and previous year can always be registered if not yet done.
   */
  const getAddFYOptions = (): string[] => {
    const cur = new Date();
    const currentStartYear = cur.getMonth() >= 3 ? cur.getFullYear() : cur.getFullYear() - 1;
    const registeredLabels = fyMeta.map((m) => m.label);
    const options: string[] = [];
    for (let i = 0; i <= 1; i++) {
      const start = currentStartYear - i;
      const label = `${start}-${start + 1}`;
      if (!registeredLabels.includes(label)) options.push(label);
    }
    return options;
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
      const res = await deleteRecords(label);
      setActionMsg(`✓ Deleted ${res.deleted_students} students & ${res.deleted_payments} payments for FY ${label}.`);
      await load();
      setTimeout(() => closeActionSheet(), 2500);
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
      setActionMsg(`✓ Reset FY ${label}: removed ${res.deleted_students} students & ${res.deleted_payments} payments. FY remains open.`);
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
    if (years.length === 0) refreshFY();
    load();
  }, [load, years.length, refreshFY]));

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

      {/* ── Financial Year chip row ── */}
      <View style={{ borderBottomWidth: 1, borderBottomColor: palette.border, paddingVertical: spacing.sm }}>
        <View style={{ paddingHorizontal: spacing.lg, marginBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="calendar-outline" size={14} color={palette.muted} />
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginLeft: 6, fontWeight: '600' }}>Financial Year</Text>
          </View>
          <Pressable testID="create-fy-btn" onPress={() => setShowFyModal(true)}
            style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.sm, backgroundColor: palette.brandSecondary, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="add" size={14} color={palette.brand} />
            <Text style={{ color: palette.brand, fontWeight: '600', fontSize: fontSize.sm }}>Add FY</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: spacing.lg }}>
          {years.length === 0 ? (
            <Skeleton width={140} height={36} radius={18} />
          ) : (
            years.map((y) => {
              const active = fy === y;
              const meta = fyMeta.find((m) => m.label === y);
              const isClosed = meta?.status === 'closed';
              return (
                <View key={y} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Pressable testID={`fy-chip-${y}`} onPress={() => setCurrent(y)}
                    style={{
                      height: 36, paddingHorizontal: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexShrink: 0, gap: 6,
                      backgroundColor: active ? palette.brand : palette.surfaceTertiary,
                      borderWidth: 1, borderColor: active ? palette.brand : isClosed ? palette.warning : palette.border,
                    }}>
                    {isClosed && <Ionicons name="lock-closed" size={11} color={active ? '#fff' : palette.warning} />}
                    <Text style={{ color: active ? '#fff' : palette.onSurface, fontWeight: '600', fontSize: fontSize.sm }}>FY {y}</Text>
                  </Pressable>
                  {/* ⋯ options — only for admin */}
                  {isAdmin && (
                    <Pressable testID={`fy-options-${y}`} onPress={() => openActionSheet(y)}
                      style={{
                        width: 28, height: 28, borderRadius: 14,
                        backgroundColor: active ? palette.brand : palette.surfaceTertiary,
                        borderWidth: 1, borderColor: active ? palette.brand : palette.border,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                      <Ionicons name="ellipsis-horizontal" size={14} color={active ? '#fff' : palette.muted} />
                    </Pressable>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
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
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: palette.surfaceSecondary, borderRadius: radii.lg, padding: spacing.lg, width: '100%', maxWidth: 400 }}>
            <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: spacing.sm }}>
              Add Financial Year
            </Text>
            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: spacing.md }}>
              Register a financial year to track, close, and export its records.
            </Text>

            {/* Warning notification banner if an older FY is still open */}
            {unclosedOlderFY && (
              <View style={{
                backgroundColor: `${palette.warning}18`,
                borderWidth: 1.5,
                borderColor: palette.warning,
                borderRadius: radii.md,
                padding: spacing.md,
                marginBottom: spacing.md,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Ionicons name="warning-outline" size={20} color={palette.warning} />
                  <Text style={{ fontWeight: '700', color: palette.warning, fontSize: fontSize.base }}>
                    Action Required: FY {unclosedOlderFY.label} is Open
                  </Text>
                </View>
                <Text style={{ color: palette.onSurface, fontSize: fontSize.sm, lineHeight: 18, marginBottom: spacing.md }}>
                  Financial Year <Text style={{ fontWeight: '700' }}>FY {unclosedOlderFY.label}</Text> has not been closed yet. Before creating a new financial year, you must close FY {unclosedOlderFY.label} and download its financial records (PDF / Excel).
                </Text>
                <Pressable
                  onPress={() => {
                    setShowFyModal(false);
                    openActionSheet(unclosedOlderFY.label);
                  }}
                  style={{
                    backgroundColor: palette.warning,
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    borderRadius: radii.md,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <Ionicons name="lock-closed-outline" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: fontSize.sm }}>
                    Close & Download FY {unclosedOlderFY.label} Records →
                  </Text>
                </Pressable>
              </View>
            )}

            {getAddFYOptions().length === 0 ? (
              <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
                <Ionicons name="checkmark-circle" size={32} color={palette.success} />
                <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: spacing.sm, textAlign: 'center' }}>
                  Both financial years are already registered.{'\n'}Use the ⋯ button on each chip to manage them.
                </Text>
              </View>
            ) : (
              <View style={{ gap: 8, marginVertical: spacing.md }}>
                {getAddFYOptions().map((y) => {
                  const cur = new Date();
                  const currentStartYear = cur.getMonth() >= 3 ? cur.getFullYear() : cur.getFullYear() - 1;
                  const isCurrent = y === `${currentStartYear}-${currentStartYear + 1}`;
                  const isBlocked = !!unclosedOlderFY && parseInt(y.split('-')[0], 10) > parseInt(unclosedOlderFY.label.split('-')[0], 10);
                  return (
                    <Pressable key={y} onPress={() => handleCreateFY(y)} disabled={creating || isBlocked}
                      style={{
                        paddingVertical: 14, paddingHorizontal: spacing.md, borderRadius: radii.md,
                        backgroundColor: isBlocked ? `${palette.warning}10` : palette.surfaceTertiary,
                        borderWidth: 1.5, borderColor: isBlocked ? palette.border : isCurrent ? palette.brand : palette.border,
                        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                        opacity: creating || isBlocked ? 0.55 : 1,
                      }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Ionicons name={isBlocked ? "lock-closed" : "calendar"} size={18} color={isBlocked ? palette.warning : isCurrent ? palette.brand : palette.muted} />
                        <Text style={{ color: isBlocked ? palette.muted : palette.onSurface, fontWeight: '700', fontSize: fontSize.lg }}>FY {y}</Text>
                        {isCurrent && !isBlocked && (
                          <View style={{ backgroundColor: palette.brandSecondary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
                            <Text style={{ color: palette.brand, fontSize: 10, fontWeight: '700' }}>CURRENT</Text>
                          </View>
                        )}
                        {isBlocked && (
                          <View style={{ backgroundColor: `${palette.warning}20`, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
                            <Text style={{ color: palette.warning, fontSize: 10, fontWeight: '700' }}>BLOCKED</Text>
                          </View>
                        )}
                      </View>
                      <Ionicons name={creating ? 'hourglass-outline' : isBlocked ? 'lock-closed-outline' : 'add-circle-outline'} size={20} color={isBlocked ? palette.warning : palette.brand} />
                    </Pressable>
                  );
                })}
              </View>
            )}

            {fyError ? (
              <View style={{ backgroundColor: `${palette.error}15`, padding: spacing.md, borderRadius: radii.md, marginBottom: spacing.md }}>
                <Text style={{ color: palette.error, fontSize: fontSize.sm, textAlign: 'center' }}>{fyError}</Text>
              </View>
            ) : null}

            <Pressable onPress={() => { setShowFyModal(false); setFyError(''); }}
              style={{ marginTop: spacing.sm, paddingVertical: 13, borderRadius: radii.md, borderWidth: 1, borderColor: palette.border, alignItems: 'center' }}>
              <Text style={{ color: palette.onSurface, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
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
                title={`Delete all records for FY ${actionFY?.label}?`}
                body="This will permanently delete ALL students and their payment history for this financial year. This CANNOT be undone."
                confirmLabel="Delete Everything"
                confirmColor={palette.error}
                onConfirm={doDeleteRecords}
                onCancel={() => setConfirmStep(null)}
                palette={palette}
              />
            )}

            {/* ─── Confirm: Reset ─── */}
            {confirmStep === 'reset' && (
              <ConfirmPanel
                title={`Reset student data for FY ${actionFY?.label}?`}
                body="This will permanently delete ALL students and their payment history for this financial year, but the FY stays OPEN so you can start entering fresh data right away. This CANNOT be undone."
                confirmLabel="Reset Data"
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

                {/* RESET DATA — available anytime, independent of open/closed status */}
                <View style={{ height: 1, backgroundColor: palette.border, marginVertical: spacing.sm }} />
                <ActionRow
                  icon="refresh-outline"
                  label="Reset Student Data"
                  description="Wipe all students & payments for this FY without closing it."
                  color={palette.error}
                  busy={actionBusy === 'reset'}
                  onPress={() => setConfirmStep('reset')}
                  palette={palette}
                  destructive
                />

                {/* DELETE — only for closed FYs */}
                {actionFY?.status === 'closed' && (
                  <>
                    <View style={{ height: 1, backgroundColor: palette.border, marginVertical: spacing.sm }} />
                    <ActionRow
                      icon="trash-outline"
                      label="Delete All Records"
                      description="Permanently delete all students & payments for this FY."
                      color={palette.error}
                      busy={actionBusy === 'delete'}
                      onPress={() => setConfirmStep('delete')}
                      palette={palette}
                      destructive
                    />
                  </>
                )}
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
