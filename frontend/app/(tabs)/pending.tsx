import React, { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch } from '@/src/auth';
import { useFY } from '@/src/fy';
import { useTheme, spacing, radii, fontSize } from '@/src/theme';
import { Card, EmptyState } from '@/src/components/ui';
import { SkeletonCard } from '@/src/components/Skeleton';
import { formatINR, openWhatsApp, reminderMessage } from '@/src/utils/format';
import { isoToDisplay } from '@/src/utils/datetime';

interface Pending {
  id: string;
  name: string;
  school_name: string;
  parent_name: string;
  parent_mobile: string;
  pickup_location?: string;
  standard: string;
  yearly_fee: number;
  paid_amount: number;
  pending_amount: number;
  last_payment_date?: string;
  next_due_date?: string;
  due_date?: string;
  overdue_days: number;
}

export default function PendingFees() {
  const { palette } = useTheme();
  const { current: fy } = useFY();
  const [items, setItems] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<Pending[]>(`/pending-fees${fy ? `?fy=${fy}` : ''}`);
      setItems(list);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fy]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface }} testID="pending-title">Pending Fees</Text>
        <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 4 }}>
          {fy ? `Financial Year ${fy} · ` : ''}{items.length} student{items.length === 1 ? '' : 's'} overdue
        </Text>
      </View>

      {loading ? (
        <View style={{ padding: spacing.lg }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <Card>
              <EmptyState icon="checkmark-done" title="All clear" subtitle="No overdue students in this financial year." />
            </Card>
          }
          renderItem={({ item }) => (
            <Pressable testID={`pending-row-${item.id}`} onPress={() => router.push(`/student/${item.id}`)} style={{ marginBottom: spacing.md }}>
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface, flex: 1 }}>{item.name}</Text>
                      <View style={{ backgroundColor: palette.error + '22', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 }}>
                        <Text style={{ color: palette.error, fontWeight: '700', fontSize: fontSize.sm }}>
                          {item.overdue_days}d overdue
                        </Text>
                      </View>
                    </View>
                    <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 4 }}>
                      {item.school_name} · Class {item.standard}
                    </Text>
                    {item.pickup_location ? (
                      <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>
                        <Ionicons name="location-outline" size={12} /> {item.pickup_location}
                      </Text>
                    ) : null}
                    <View style={{ marginTop: spacing.sm, gap: 2 }}>
                      <Row label="Last Payment" value={item.last_payment_date ? isoToDisplay(item.last_payment_date) : '—'} />
                      <Row label="Next Due" value={isoToDisplay(item.next_due_date || item.due_date) || '—'} />
                      <Row label="Pending" value={formatINR(item.pending_amount)} accent={palette.warning} />
                    </View>
                  </View>
                </View>
                <Pressable
                  testID={`pending-whatsapp-${item.id}`}
                  onPress={() => openWhatsApp(item.parent_mobile, reminderMessage({
                    studentName: item.name, school: item.school_name,
                    pending: item.pending_amount,
                    dueDate: item.next_due_date || item.due_date || '',
                  }))}
                  style={{ marginTop: spacing.md, backgroundColor: palette.success, borderRadius: radii.md, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons name="logo-whatsapp" size={18} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '600', marginLeft: 6 }}>Send Reminder to {item.parent_name}</Text>
                </Pressable>
              </Card>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ color: palette.muted, fontSize: fontSize.sm, width: 110 }}>{label}</Text>
      <Text style={{ color: accent || palette.onSurface, fontSize: fontSize.sm, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}
