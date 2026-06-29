import React, { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiFetch, API_BASE, TOKEN_STORAGE_KEY, useAuth } from '@/src/auth';
import { useFY } from '@/src/fy';
import { useTheme, spacing, fontSize, radii } from '@/src/theme';
import { Button, Card, TextField } from '@/src/components/ui';

interface School { id: string; name: string }

export default function Reports() {
  const { palette } = useTheme();
  const { current: fy } = useFY();
  const { admin } = useAuth();
  const isAdmin = admin?.role === 'admin';
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolId] = useState<string>('');
  const [status, setStatus] = useState<string>('all');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<'pdf' | 'excel' | null>(null);
  const [archiveMsg, setArchiveMsg] = useState('');
  const [archiveBusy, setArchiveBusy] = useState<'backup' | 'restore' | null>(null);

  const doArchive = async (action: 'backup' | 'restore') => {
    if (!fy) { setArchiveMsg('Select a financial year on Dashboard first.'); return; }
    setArchiveBusy(action);
    setArchiveMsg('');
    try {
      const res: any = await apiFetch(`/archive/${action}?fy=${encodeURIComponent(fy)}`, { method: 'POST' });
      const where = res.stored_in === 'firebase' ? 'Firebase Storage' : 'local MongoDB';
      if (action === 'backup') {
        setArchiveMsg(`Backup saved to ${where}: ${res.counts.schools} schools, ${res.counts.students} students, ${res.counts.payments} payments.${res.warning ? ' (Firebase fallback — bucket not enabled)' : ''}`);
      } else {
        setArchiveMsg(`Restore complete: ${res.restored.schools} schools, ${res.restored.students} students, ${res.restored.payments} payments.`);
      }
    } catch (e: any) {
      setArchiveMsg(`Error: ${e.message}`);
    } finally {
      setArchiveBusy(null);
    }
  };

  useEffect(() => {
    apiFetch<School[]>('/schools').then(setSchools).catch(() => {});
  }, []);

  const open = async (format: 'pdf' | 'excel') => {
    setMsg('');
    setBusy(format);
    try {
      const token = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
      const params = new URLSearchParams();
      if (schoolId) params.set('school_id', schoolId);
      if (status !== 'all') params.set('status', status);
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      if (fy) params.set('fy', fy);
      if (token) params.set('token', token);
      const url = `${API_BASE}/reports/${format}?${params.toString()}`;
      const ok = await Linking.canOpenURL(url);
      if (!ok) throw new Error('Cannot open URL on this device');
      await Linking.openURL(url);
      setMsg(format === 'pdf'
        ? 'PDF opened in your browser — use Share → Save to keep it.'
        : 'Excel download started — check your Downloads folder.');
    } catch (e: any) {
      setMsg(`Error: ${e.message || 'failed'}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}>
        <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: 4 }}>Reports</Text>
        <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: spacing.lg }}>
          {fy ? `Financial Year ${fy}` : 'All financial years'}
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
                    flexShrink: 0,
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
                    flexShrink: 0,
                  }}
                >
                  <Text style={{ color: active ? '#fff' : palette.onSurface, fontSize: fontSize.sm, fontWeight: '600', textTransform: 'capitalize' }}>{k}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <TextField label="Start Date (DD/MM/YYYY HH:mm)" placeholder="01/04/2026 00:00" value={start} onChangeText={setStart} testID="report-start" />
          <TextField label="End Date (DD/MM/YYYY HH:mm)" placeholder="31/03/2027 23:59" value={end} onChangeText={setEnd} testID="report-end" />
        </Card>

        <View style={{ height: spacing.lg }} />
        <Button
          title={busy === 'pdf' ? 'Opening PDF…' : 'Download PDF Report'}
          icon="document-text"
          onPress={() => open('pdf')}
          loading={busy === 'pdf'}
          testID="report-generate-pdf"
        />
        <View style={{ height: spacing.md }} />
        <Button
          title={busy === 'excel' ? 'Opening Excel…' : 'Download Excel (.xlsx)'}
          icon="grid"
          variant="secondary"
          onPress={() => open('excel')}
          loading={busy === 'excel'}
          testID="report-generate-csv"
        />

        {msg ? (
          <Text style={{ color: msg.startsWith('Error') ? palette.error : palette.success, marginTop: spacing.md, textAlign: 'center' }} testID="report-msg">{msg}</Text>
        ) : null}

        {isAdmin && (
          <>
            <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface, marginTop: spacing.xxl, marginBottom: spacing.md }}>
              Yearly Archive
            </Text>
            <Card>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: spacing.md }}>
                Backup the selected financial year ({fy || 'pick one on Dashboard'}) to Firebase Storage (with MongoDB fallback). Restore re-imports records idempotently — no duplicates.
              </Text>
              <Button
                title={archiveBusy === 'backup' ? 'Backing up…' : `Backup ${fy || 'current FY'}`}
                icon="cloud-upload"
                onPress={() => doArchive('backup')}
                loading={archiveBusy === 'backup'}
                testID="archive-backup"
              />
              <View style={{ height: spacing.sm }} />
              <Button
                title={archiveBusy === 'restore' ? 'Restoring…' : `Restore ${fy || 'current FY'}`}
                icon="cloud-download"
                variant="secondary"
                onPress={() => doArchive('restore')}
                loading={archiveBusy === 'restore'}
                testID="archive-restore"
              />
              {archiveMsg ? (
                <Text style={{ color: archiveMsg.startsWith('Error') ? palette.error : palette.success, marginTop: spacing.md, fontSize: fontSize.sm }} testID="archive-msg">{archiveMsg}</Text>
              ) : null}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
