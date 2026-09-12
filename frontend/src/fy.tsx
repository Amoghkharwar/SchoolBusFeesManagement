/**
 * Financial Year context — global selector that filters data app-wide.
 * Includes per-FY status metadata (open/closed) and lifecycle helpers.
 * Strictly filters out future financial years and enforces max 2 FYs display.
 * The backend is the sole source of truth for FY status — actions here
 * reflect exactly what the server confirms, and throw on failure instead of
 * faking success locally, so the UI can never disagree with the database.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './auth';

export interface FYMeta {
  label: string;
  status: 'open' | 'closed';
  closed_at?: string | null;
  created_at?: string | null;
}

interface FYCtx {
  current: string;            // selected FY, e.g. '2026-2027'
  years: string[];            // just the labels (max 2)
  fyMeta: FYMeta[];           // enriched meta per FY
  setCurrent: (fy: string) => void;
  refresh: () => Promise<void>;
  closeFY: (label: string) => Promise<void>;
  deleteRecords: (label: string) => Promise<{ deleted_students: number; deleted_payments: number }>;
  resetData: (label: string) => Promise<{ deleted_students: number; deleted_payments: number }>;
}

const FYContext = createContext<FYCtx>({
  current: '',
  years: [],
  fyMeta: [],
  setCurrent: () => {},
  refresh: async () => {},
  closeFY: async () => {},
  deleteRecords: async () => ({ deleted_students: 0, deleted_payments: 0 }),
  resetData: async () => ({ deleted_students: 0, deleted_payments: 0 }),
});

const KEY = 'busfee:fy';

export function FYProvider({ children }: { children: React.ReactNode }) {
  const [years, setYears] = useState<string[]>([]);
  const [fyMeta, setFyMeta] = useState<FYMeta[]>([]);
  const [current, setCurrentState] = useState<string>('');

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ current: string; years: string[]; meta: FYMeta[] }>('/financial-years');
      
      // Calculate current Indian FY start year (April -> March)
      const now = new Date();
      const currentStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

      // Filter out any future year (start_year > currentStartYear)
      const filteredYears = (data.years || []).filter((y) => {
        const startYear = parseInt(y.split('-')[0], 10);
        return !isNaN(startYear) && startYear <= currentStartYear;
      });

      // Keep at most 2 years (current + 1 past year)
      const max2Years = filteredYears.slice(0, 2);

      const rawMeta = data.meta || [];
      const filteredMeta: FYMeta[] = max2Years.map((label) => {
        const existing = rawMeta.find((m) => m.label === label);
        if (existing?.status === 'closed') {
          return {
            label,
            status: 'closed',
            closed_at: existing.closed_at,
            created_at: existing.created_at,
          };
        }
        return {
          label,
          status: 'open',
          created_at: existing?.created_at,
        };
      });

      setYears(max2Years);
      setFyMeta(filteredMeta);

      const saved = await AsyncStorage.getItem(KEY);
      const picked = saved && max2Years.includes(saved) ? saved : (max2Years[0] || data.current);
      setCurrentState(picked);
    } catch {
      /* ignore — only available after login */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setCurrent = (fy: string) => {
    setCurrentState(fy);
    AsyncStorage.setItem(KEY, fy).catch(() => {});
  };

  const closeFY = useCallback(async (label: string) => {
    // No local fallback: if the server doesn't confirm the close, this throws
    // and the FY stays open — the UI must never show "closed" unless the
    // database actually says so.
    try {
      await apiFetch(`/financial-years/${encodeURIComponent(label)}/close`, { method: 'PATCH' });
    } catch {
      await apiFetch(`/financial-years/close`, {
        method: 'POST',
        body: JSON.stringify({ label }),
      });
    }
    await refresh();
  }, [refresh]);

  const deleteRecords = useCallback(async (label: string) => {
    let res: any;
    try {
      res = await apiFetch(`/financial-years/${encodeURIComponent(label)}/records`, { method: 'DELETE' });
    } catch {
      res = await apiFetch(`/financial-years/records`, {
        method: 'POST',
        body: JSON.stringify({ label }),
      });
    }
    await refresh();
    return { deleted_students: res?.deleted_students ?? 0, deleted_payments: res?.deleted_payments ?? 0 };
  }, [refresh]);

  // Reset (wipe) a FY's student + payment data without closing it — the FY stays
  // open/registered and can immediately be used again with fresh data.
  const resetData = useCallback(async (label: string) => {
    let res: any;
    try {
      res = await apiFetch(`/financial-years/${encodeURIComponent(label)}/reset`, { method: 'DELETE' });
    } catch {
      res = await apiFetch(`/financial-years/reset`, {
        method: 'POST',
        body: JSON.stringify({ label }),
      });
    }
    await refresh();
    return { deleted_students: res?.deleted_students ?? 0, deleted_payments: res?.deleted_payments ?? 0 };
  }, [refresh]);

  return (
    <FYContext.Provider value={{ current, years, fyMeta, setCurrent, refresh, closeFY, deleteRecords, resetData }}>
      {children}
    </FYContext.Provider>
  );
}

export const useFY = () => useContext(FYContext);
