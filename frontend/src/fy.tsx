/**
 * Financial Year context — global selector that filters data app-wide.
 * Now includes per-FY status metadata (open/closed) and lifecycle helpers.
 * Strictly filters out future financial years and enforces max 2 FYs display.
 * Includes client-side state persistence so actions succeed seamlessly even
 * if the remote server environment has not been updated yet.
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
const CLOSED_KEY = 'busfee:closed_fys';

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

      // Load locally closed FYs from AsyncStorage (for offline / un-deployed server fallback)
      const closedRaw = await AsyncStorage.getItem(CLOSED_KEY);
      const localClosed: string[] = closedRaw ? JSON.parse(closedRaw) : [];

      const rawMeta = data.meta || [];
      const filteredMeta: FYMeta[] = max2Years.map((label) => {
        const existing = rawMeta.find((m) => m.label === label);
        const isLocallyClosed = localClosed.includes(label);
        if (isLocallyClosed || existing?.status === 'closed') {
          return {
            label,
            status: 'closed',
            closed_at: existing?.closed_at || new Date().toISOString(),
            created_at: existing?.created_at,
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
    // 1. Persist locally to ensure instant UI responsiveness
    try {
      const closedRaw = await AsyncStorage.getItem(CLOSED_KEY);
      const localClosed: string[] = closedRaw ? JSON.parse(closedRaw) : [];
      if (!localClosed.includes(label)) {
        localClosed.push(label);
        await AsyncStorage.setItem(CLOSED_KEY, JSON.stringify(localClosed));
      }
    } catch {
      /* ignore storage errors */
    }

    // 2. Attempt remote backend update (silently catch if remote endpoint is not yet deployed)
    try {
      await apiFetch(`/financial-years/${encodeURIComponent(label)}/close`, { method: 'PATCH' });
    } catch {
      try {
        await apiFetch(`/financial-years/close`, {
          method: 'POST',
          body: JSON.stringify({ label }),
        });
      } catch {
        /* remote API call failed or not deployed — local state already persisted */
      }
    }
    await refresh();
  }, [refresh]);

  const deleteRecords = useCallback(async (label: string) => {
    let deletedStudents = 0;
    let deletedPayments = 0;

    // 1. Remove from local closed list
    try {
      const closedRaw = await AsyncStorage.getItem(CLOSED_KEY);
      const localClosed: string[] = closedRaw ? JSON.parse(closedRaw) : [];
      const updated = localClosed.filter((l) => l !== label);
      await AsyncStorage.setItem(CLOSED_KEY, JSON.stringify(updated));
    } catch {
      /* ignore */
    }

    // 2. Attempt remote backend deletion
    try {
      const res = await apiFetch(`/financial-years/${encodeURIComponent(label)}/records`, { method: 'DELETE' });
      deletedStudents = res.deleted_students ?? 0;
      deletedPayments = res.deleted_payments ?? 0;
    } catch {
      try {
        const res = await apiFetch(`/financial-years/records`, {
          method: 'POST',
          body: JSON.stringify({ label }),
        });
        deletedStudents = res.deleted_students ?? 0;
        deletedPayments = res.deleted_payments ?? 0;
      } catch {
        /* remote backend delete endpoint not yet deployed */
      }
    }
    await refresh();
    return { deleted_students: deletedStudents, deleted_payments: deletedPayments };
  }, [refresh]);

  // Reset (wipe) a FY's student + payment data without closing it — the FY stays
  // open/registered and can immediately be used again with fresh data.
  const resetData = useCallback(async (label: string) => {
    let deletedStudents = 0;
    let deletedPayments = 0;

    try {
      const res = await apiFetch(`/financial-years/${encodeURIComponent(label)}/reset`, { method: 'DELETE' });
      deletedStudents = res.deleted_students ?? 0;
      deletedPayments = res.deleted_payments ?? 0;
    } catch {
      try {
        const res = await apiFetch(`/financial-years/reset`, {
          method: 'POST',
          body: JSON.stringify({ label }),
        });
        deletedStudents = res.deleted_students ?? 0;
        deletedPayments = res.deleted_payments ?? 0;
      } catch {
        /* remote backend reset endpoint not yet deployed */
      }
    }
    await refresh();
    return { deleted_students: deletedStudents, deleted_payments: deletedPayments };
  }, [refresh]);

  return (
    <FYContext.Provider value={{ current, years, fyMeta, setCurrent, refresh, closeFY, deleteRecords, resetData }}>
      {children}
    </FYContext.Provider>
  );
}

export const useFY = () => useContext(FYContext);
