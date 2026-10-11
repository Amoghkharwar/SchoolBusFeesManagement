import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { apiFetch, useAuth } from '@/src/auth';
import { useFY } from '@/src/fy';
import { useTheme, spacing, fontSize, radii } from '@/src/theme';
import { Button, Card, DateTimeField } from '@/src/components/ui';
import { plural } from '@/src/utils/format';
import { calendarDateToDisplay, calendarDateToLocalIso, isoToCalendarDate } from '@/src/utils/datetime';
import { downloadFile } from '@/src/utils/download';

interface School { id: string; name: string }

/** "YYYY-MM-DD" → the Date the picker bounds take, or undefined. */
const pickerDay = (cd?: string | null) => (cd ? new Date(calendarDateToLocalIso(cd)) : undefined);

export default function Reports() {
  const { palette } = useTheme();
  const { current: fy, meta: fyInfo } = useFY();
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
        setArchiveMsg(`Backup saved to ${where}: ${plural(res.counts.schools, 'school')}, ${plural(res.counts.students, 'student')}, ${plural(res.counts.payments, 'payment')}.${res.warning ? ' (Firebase fallback — bucket not enabled)' : ''}`);
      } else {
        setArchiveMsg(`Restore complete: ${plural(res.restored.schools, 'school')}, ${plural(res.restored.students, 'student')}, ${plural(res.restored.payments, 'payment')}.`);
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

  // The pickers hold local-midnight instants; the server takes calendar days.
  const startDay = isoToCalendarDate(start);
  const endDay = isoToCalendarDate(end);
  const rangeError = startDay && endDay && startDay > endDay
    ? 'The "to" date is before the "from" date.'
    : '';
  const fyRange = fyInfo?.start_date && fyInfo?.end_date
    ? `${calendarDateToDisplay(fyInfo.start_date)} – ${calendarDateToDisplay(fyInfo.end_date)}`
    : '';

  const open = async (format: 'pdf' | 'excel') => {
    if (busy) return;
    if (rangeError) { setMsg(`Error: ${rangeError}`); return; }
    setMsg('');
    setBusy(format);
    try {
      const params = new URLSearchParams();
      if (schoolId) params.set('school_id', schoolId);
      if (status !== 'all') params.set('status', status);
      if (startDay) params.set('start', startDay);
      if (endDay) params.set('end', endDay);
      if (fy) params.set('fy', fy);
      const ext = format === 'pdf' ? 'pdf' : 'xlsx';
      const name = await downloadFile(`/reports/${format}?${params.toString()}`, `bus-fee-report.${ext}`);
      setMsg(`✓ Downloaded ${name}`);
    } catch (e: any) {
      setMsg(`Error: ${e.message || 'Download failed'}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: 4 }}>Reports</Text>
        <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: spacing.lg }}>
          {fy ? `Financial Year ${fy}` : 'All financial years'}
        </Text>

        <Card>
          <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: 6 }}>School</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }} style={{ marginBottom: spacing.md }}>
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }} style={{ marginBottom: spacing.md }}>
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

          <DateTimeField
            label="Payments from"
            mode="date"
            value={start}
            onChange={setStart}
            minDate={pickerDay(fyInfo?.start_date)}
            maxDate={pickerDay(fyInfo?.end_date)}
            testID="report-start"
          />
          <DateTimeField
            label="Payments to"
            mode="date"
            value={end}
            onChange={setEnd}
            minDate={pickerDay(fyInfo?.start_date)}
            maxDate={pickerDay(fyInfo?.end_date)}
            error={rangeError || undefined}
            testID="report-end"
          />
          <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: -6 }}>
            {`These dates only limit the payment list. Leave them empty for the whole year${fyRange ? ` (${fyRange})` : ''}. The fee summary always covers the full year.`}
          </Text>
          {start || end ? (
            <Pressable
              onPress={() => { setStart(''); setEnd(''); }}
              testID="report-clear-dates"
              style={{ alignSelf: 'flex-start', paddingVertical: 6, marginTop: 4 }}
            >
              <Text style={{ color: palette.brand, fontSize: fontSize.sm, fontWeight: '600' }}>Clear dates</Text>
            </Pressable>
          ) : null}
        </Card>

        <View style={{ height: spacing.lg }} />
        <Button
          title={busy === 'pdf' ? 'Preparing PDF…' : 'Download PDF Report'}
          icon="document-text"
          onPress={() => open('pdf')}
          loading={busy === 'pdf'}
          disabled={!!busy}
          testID="report-generate-pdf"
        />
        <View style={{ height: spacing.md }} />
        <Button
          title={busy === 'excel' ? 'Preparing Excel…' : 'Download Excel (.xlsx)'}
          icon="grid"
          variant="secondary"
          onPress={() => open('excel')}
          loading={busy === 'excel'}
          disabled={!!busy}
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
