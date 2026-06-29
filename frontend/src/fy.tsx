/**
 * Financial Year context — global selector that filters data app-wide.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './auth';

interface FYCtx {
  current: string; // selected FY, e.g. '2026-2027'
  years: string[];
  setCurrent: (fy: string) => void;
  refresh: () => Promise<void>;
}

const FYContext = createContext<FYCtx>({
  current: '',
  years: [],
  setCurrent: () => {},
  refresh: async () => {},
});

const KEY = 'busfee:fy';

export function FYProvider({ children }: { children: React.ReactNode }) {
  const [years, setYears] = useState<string[]>([]);
  const [current, setCurrentState] = useState<string>('');

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ current: string; years: string[] }>('/financial-years');
      setYears(data.years);
      const saved = await AsyncStorage.getItem(KEY);
      const picked = saved && data.years.includes(saved) ? saved : data.current;
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

  return (
    <FYContext.Provider value={{ current, years, setCurrent, refresh }}>
      {children}
    </FYContext.Provider>
  );
}

export const useFY = () => useContext(FYContext);
