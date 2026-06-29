import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
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
import { useTheme, spacing, radii, fontSize } from '@/src/theme';
import { Card, EmptyState, FAB, TextField } from '@/src/components/ui';

interface School {
  id: string;
  name: string;
  address?: string;
  contact_person?: string;
  contact_phone?: string;
  student_count?: number;
}

export default function Schools() {
  const { palette } = useTheme();
  const [items, setItems] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<School[]>('/schools');
      setItems(list);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = items.filter((s) =>
    !q || s.name.toLowerCase().includes(q.toLowerCase()) || (s.address || '').toLowerCase().includes(q.toLowerCase())
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: spacing.md }}>Schools</Text>
        <TextField placeholder="Search schools" value={q} onChangeText={setQ} leftIcon="search" testID="schools-search" />
      </View>

      {loading ? (
        <ActivityIndicator color={palette.brand} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <Card>
              <EmptyState icon="business-outline" title="No schools yet" subtitle="Tap + to add your first school." />
            </Card>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`school-row-${item.id}`}
              onPress={() => router.push(`/school/${item.id}`)}
              style={{ marginBottom: spacing.md }}
            >
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: palette.brandTertiary, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: palette.brand, fontWeight: '700' }}>{item.name.slice(0, 2).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface }}>{item.name}</Text>
                    <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>
                      {item.student_count ?? 0} students {item.address ? ` · ${item.address}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={palette.muted} />
                </View>
              </Card>
            </Pressable>
          )}
        />
      )}

      <FAB onPress={() => router.push('/school/add')} testID="add-school-fab" />
    </SafeAreaView>
  );
}
