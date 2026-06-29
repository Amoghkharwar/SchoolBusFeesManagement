import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch, API_BASE, TOKEN_STORAGE_KEY } from '@/src/auth';
import { useTheme, spacing, fontSize, radii } from '@/src/theme';
import { Button, Card, TextField } from '@/src/components/ui';

interface School {
  id: string;
  name: string;
}

export default function Reports() {
  const { palette } = useTheme();
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolId] = useState<string>('');
  const [status, setStatus] = useState<string>('all');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    apiFetch<School[]>('/schools').then(setSchools).catch(() => {});
  }, []);

  const buildUrl = async (format: 'csv' | 'html') => {
    const token = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
    const params = new URLSearchParams();
    if (schoolId) params.set('school_id', schoolId);
    if (status !== 'all') params.set('status', status);
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    if (token) params.set('token', token); // we'll fall back to Authorization, but token also handy for copy
    const url = `${API_BASE}/reports/${format}${[...params].length ? '?' + params.toString() : ''}`;
    return { url, token };
  };

  const openHtml = async () => {
    setMsg('');
    const { url, token } = await buildUrl('html');
    // Fetch HTML server-side then open via data URL (since we need Bearer auth)
    try {
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const html = await res.text();
      // open in browser using data URL (works on web; on mobile, share text)
      const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
      const ok = await Linking.canOpenURL(dataUrl);
      if (ok) await Linking.openURL(dataUrl);
      else setMsg('Report generated. Copy URL from below.');
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const copyCsv = async () => {
    setMsg('');
    const { url, token } = await buildUrl('csv');
    try {
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const txt = await res.text();
      await Clipboard.setStringAsync(txt);
      setMsg('CSV copied to clipboard. Paste into Excel or Google Sheets.');
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}>
        <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: spacing.lg }}>
          Reports
        </Text>

        <Card>
          <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: 6 }}>School</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginBottom: spacing.md }}>
            {[{ id: '', name: 'All' }, ...schools].map((s) => {
              const active = schoolId === s.id;
              return (
                <Pressable
                  key={s.id || 'all'}
                  testID={`report-school-${s.id || 'all'}`}
                  onPress={() => setSchoolId(s.id)}
                  style={{
                    height: 36, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: active ? palette.brand : palette.surfaceTertiary,
                    borderWidth: 1, borderColor: active ? palette.brand : palette.border,
                  }}
                >
                  <Text style={{ color: active ? '#fff' : palette.onSurface, fontSize: fontSize.sm, fontWeight: '600' }}>{s.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: 6 }}>Status</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginBottom: spacing.md }}>
            {['all', 'pending', 'partial', 'completed'].map((k) => {
              const active = status === k;
              return (
                <Pressable
                  key={k}
                  testID={`report-status-${k}`}
                  onPress={() => setStatus(k)}
                  style={{
                    height: 36, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: active ? palette.brand : palette.surfaceTertiary,
                    borderWidth: 1, borderColor: active ? palette.brand : palette.border,
                  }}
                >
                  <Text style={{ color: active ? '#fff' : palette.onSurface, fontSize: fontSize.sm, fontWeight: '600', textTransform: 'capitalize' }}>{k}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <TextField label="Start Date (YYYY-MM-DD)" placeholder="2026-04-01" value={start} onChangeText={setStart} testID="report-start" />
          <TextField label="End Date (YYYY-MM-DD)" placeholder="2026-12-31" value={end} onChangeText={setEnd} testID="report-end" />
        </Card>

        <View style={{ height: spacing.lg }} />
        <Button title="Generate PDF / View Report" icon="document-text" onPress={openHtml} testID="report-generate-pdf" />
        <View style={{ height: spacing.md }} />
        <Button title="Export Excel (CSV)" icon="grid" variant="secondary" onPress={copyCsv} testID="report-generate-csv" />

        {msg ? (
          <Text style={{ color: palette.success, marginTop: spacing.md, textAlign: 'center' }} testID="report-msg">{msg}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
