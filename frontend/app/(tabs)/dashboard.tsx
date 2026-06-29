import React, { useCallback, useState } from 'react';
import {
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

import { apiFetch, useAuth } from '@/src/auth';
import { useFY } from '@/src/fy';
import { useTheme, spacing, radii, fontSize } from '@/src/theme';
import { formatINR } from '@/src/utils/format';
import { Card, EmptyState } from '@/src/components/ui';
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

export default function Dashboard() {
  const { palette, isDark, mode, setMode } = useTheme();
  const { admin, logout } = useAuth();
  const { current: fy, years, setCurrent, refresh: refreshFY } = useFY();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [schools, setSchools] = useState<SchoolStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  useFocusEffect(useCallback(() => { setLoading(true); if (years.length === 0) refreshFY(); load(); }, [load, years.length, refreshFY]));

  const cycleTheme = () => {
    setMode(mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <View style={[styles.header, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: fontSize.sm, color: palette.muted }}>Welcome back</Text>
          <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface }} numberOfLines={1} testID="dashboard-title">
            {admin?.email ?? 'Admin'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Pressable
            onPress={cycleTheme}
            testID="theme-toggle"
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: palette.surfaceTertiary, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name={isDark ? 'sunny' : 'moon'} size={18} color={palette.onSurface} />
          </Pressable>
          <Pressable
            onPress={logout}
            testID="logout-button"
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: palette.surfaceTertiary, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="log-out-outline" size={20} color={palette.onSurface} />
          </Pressable>
        </View>
      </View>

      {/* Financial Year chip row */}
      <View style={{ borderBottomWidth: 1, borderBottomColor: palette.border, paddingVertical: spacing.sm }}>
        <View style={{ paddingHorizontal: spacing.lg, marginBottom: 6, flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="calendar-outline" size={14} color={palette.muted} />
          <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginLeft: 6, fontWeight: '600' }}>Financial Year</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: spacing.lg }}
        >
          {years.length === 0 ? (
            <Skeleton width={140} height={36} radius={18} />
          ) : (
            years.map((y) => {
              const active = fy === y;
              return (
                <Pressable
                  key={y}
                  testID={`fy-chip-${y}`}
                  onPress={() => setCurrent(y)}
                  style={{
                    height: 36, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: active ? palette.brand : palette.surfaceTertiary,
                    borderWidth: 1, borderColor: active ? palette.brand : palette.border,
                    flexShrink: 0,
                  }}
                >
                  <Text style={{ color: active ? '#fff' : palette.onSurface, fontWeight: '600', fontSize: fontSize.sm }}>FY {y}</Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
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
                <EmptyState
                  icon="business-outline"
                  title="No schools yet"
                  subtitle="Add your first school from the Schools tab."
                />
              </Card>
            ) : (
              schools.map((s) => (
                <Pressable
                  key={s.school_id}
                  testID={`school-card-${s.school_id}`}
                  onPress={() => router.push(`/school/${s.school_id}`)}
                  style={{ marginBottom: spacing.md }}
                >
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
                        <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.success, marginTop: 2 }}>
                          {formatINR(s.collected)}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: palette.muted, fontSize: fontSize.sm }}>Pending</Text>
                        <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.warning, marginTop: 2 }}>
                          {formatINR(s.pending)}
                        </Text>
                      </View>
                    </View>
                  </Card>
                </Pressable>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function KPI({ icon, label, value, accent }: { icon: any; label: string; value: string; accent?: 'success' | 'warning' }) {
  const { palette } = useTheme();
  const color = accent === 'success' ? palette.success : accent === 'warning' ? palette.warning : palette.brand;
  return (
    <View
      testID={`kpi-${label.toLowerCase()}`}
      style={{
        flex: 1,
        minWidth: '46%',
        backgroundColor: palette.surfaceSecondary,
        padding: spacing.md,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: palette.border,
      }}
    >
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: '700', marginBottom: spacing.md },
});
