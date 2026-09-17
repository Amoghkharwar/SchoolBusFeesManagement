/**
 * Financial Year context.
 *
 * Exactly one financial year is registered at a time, and it carries its own
 * start and end dates — the label is derived from them, never typed. Fees are
 * scoped to that window; schools and students are not, so the roster carries
 * into the next year while the money starts fresh.
 *
 * The backend is the sole source of truth: actions here reflect what the server
 * confirms and throw on failure rather than faking success locally.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch } from './auth';

export interface FYMeta {
  label: string;
  status: 'open' | 'closed';
  start_date?: string | null;
  end_date?: string | null;
  /** Today is past end_date. A flag only — the server never acts on it. */
  expired?: boolean;
  days_left?: number;
  /** First due date every student inherits for this year. */
  student_due_date?: string | null;
  /** How many students the create step rolled into this year. */
  students_rolled?: number;
  closed_at?: string | null;
  created_at?: string | null;
}

export interface FYPreview {
  label: string | null;
  student_due_date?: string | null;
}

export interface DeleteYearResult {
  deleted_payments: number;
  kept_students: number;
  kept_schools: number;
}

interface FYCtx {
  current: string;
  years: string[];
  fyMeta: FYMeta[];
  /** No year registered yet — the app should prompt for the first one. */
  needsSetup: boolean;
  meta: FYMeta | null;
  setCurrent: (fy: string) => void;
  refresh: () => Promise<void>;
  previewLabel: (start: string, end: string) => Promise<FYPreview>;
  createFY: (start: string, end: string, due?: string) => Promise<FYMeta>;
  updateFY: (label: string, start: string, end: string, due?: string) => Promise<FYMeta & { renamed?: boolean }>;
  deleteYear: (label: string) => Promise<DeleteYearResult>;
  closeFY: (label: string) => Promise<void>;
  resetData: (label: string) => Promise<{ deleted_payments: number }>;
}

const FYContext = createContext<FYCtx>({
  current: '',
  years: [],
  fyMeta: [],
  needsSetup: false,
  meta: null,
  setCurrent: () => {},
  refresh: async () => {},
  previewLabel: async () => ({ label: null }),
  createFY: async () => ({ label: '', status: 'open' }),
  updateFY: async () => ({ label: '', status: 'open' }),
  deleteYear: async () => ({ deleted_payments: 0, kept_students: 0, kept_schools: 0 }),
  closeFY: async () => {},
  resetData: async () => ({ deleted_payments: 0 }),
});

export function FYProvider({ children }: { children: React.ReactNode }) {
  const [years, setYears] = useState<string[]>([]);
  const [fyMeta, setFyMeta] = useState<FYMeta[]>([]);
  const [current, setCurrentState] = useState<string>('');
  const [needsSetup, setNeedsSetup] = useState(false);

  // The server returns at most one year, so there is nothing to filter or
  // remember here — no saved selection, because there is nothing to select.
  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{
        current: string; years: string[]; meta: FYMeta[]; needs_setup: boolean;
      }>('/financial-years');
      setYears(data.years || []);
      setFyMeta(data.meta || []);
      setCurrentState(data.current || '');
      setNeedsSetup(!!data.needs_setup);
    } catch {
      /* ignore — only available after login */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const previewLabel = useCallback(async (start: string, end: string): Promise<FYPreview> => {
    if (!start || !end) return { label: null };
    try {
      return await apiFetch<FYPreview>(
        `/financial-years/preview?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`,
      );
    } catch {
      return { label: null };
    }
  }, []);

  const createFY = useCallback(async (start: string, end: string, due?: string) => {
    const created = await apiFetch<FYMeta>('/financial-years', {
      method: 'POST',
      body: JSON.stringify({ start_date: start, end_date: end, student_due_date: due || null }),
    });
    await refresh();
    return created;
  }, [refresh]);

  const updateFY = useCallback(async (label: string, start: string, end: string, due?: string) => {
    const updated = await apiFetch<FYMeta & { renamed?: boolean }>(
      `/financial-years/${encodeURIComponent(label)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ start_date: start, end_date: end, student_due_date: due || null }),
      },
    );
    await refresh();
    return updated;
  }, [refresh]);

  const deleteYear = useCallback(async (label: string) => {
    const res = await apiFetch<DeleteYearResult>(
      `/financial-years/${encodeURIComponent(label)}/records`,
      { method: 'DELETE' },
    );
    await refresh();
    return {
      deleted_payments: res?.deleted_payments ?? 0,
      kept_students: res?.kept_students ?? 0,
      kept_schools: res?.kept_schools ?? 0,
    };
  }, [refresh]);

  const closeFY = useCallback(async (label: string) => {
    await apiFetch(`/financial-years/${encodeURIComponent(label)}/close`, { method: 'PATCH' });
    await refresh();
  }, [refresh]);

  const resetData = useCallback(async (label: string) => {
    const res = await apiFetch<{ deleted_payments: number }>(
      `/financial-years/${encodeURIComponent(label)}/reset`,
      { method: 'DELETE' },
    );
    await refresh();
    return { deleted_payments: res?.deleted_payments ?? 0 };
  }, [refresh]);

  return (
    <FYContext.Provider
      value={{
        current,
        years,
        fyMeta,
        needsSetup,
        meta: fyMeta[0] || null,
        setCurrent: setCurrentState,
        refresh,
        previewLabel,
        createFY,
        updateFY,
        deleteYear,
        closeFY,
        resetData,
      }}
    >
      {children}
    </FYContext.Provider>
  );
}

export const useFY = () => useContext(FYContext);
