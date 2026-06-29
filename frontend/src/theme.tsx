/**
 * Theme tokens for School Bus Fee Manager.
 * Derived from /app/design_guidelines.json — light + dark variants.
 */
import { useColorScheme } from 'react-native';
import { useEffect, useState, createContext, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface Palette {
  surface: string;
  onSurface: string;
  surfaceSecondary: string;
  onSurfaceSecondary: string;
  surfaceTertiary: string;
  onSurfaceTertiary: string;
  brand: string;
  onBrand: string;
  brandSecondary: string;
  onBrandSecondary: string;
  brandTertiary: string;
  onBrandTertiary: string;
  success: string;
  warning: string;
  error: string;
  border: string;
  borderStrong: string;
  divider: string;
  muted: string;
}

export const lightPalette: Palette = {
  surface: '#F9FAFB',
  onSurface: '#111827',
  surfaceSecondary: '#FFFFFF',
  onSurfaceSecondary: '#1F2937',
  surfaceTertiary: '#F3F4F6',
  onSurfaceTertiary: '#374151',
  brand: '#2B4C3E',
  onBrand: '#FFFFFF',
  brandSecondary: '#E1E7E4',
  onBrandSecondary: '#2B4C3E',
  brandTertiary: '#F2F5F3',
  onBrandTertiary: '#2B4C3E',
  success: '#059669',
  warning: '#D97706',
  error: '#DC2626',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  divider: '#F3F4F6',
  muted: '#6B7280',
};

export const darkPalette: Palette = {
  surface: '#0B1110',
  onSurface: '#F3F4F6',
  surfaceSecondary: '#141B19',
  onSurfaceSecondary: '#F9FAFB',
  surfaceTertiary: '#1F2724',
  onSurfaceTertiary: '#D1D5DB',
  brand: '#5BA983',
  onBrand: '#0B1110',
  brandSecondary: '#1F3329',
  onBrandSecondary: '#A4D4B9',
  brandTertiary: '#15211C',
  onBrandTertiary: '#A4D4B9',
  success: '#34D399',
  warning: '#FBBF24',
  error: '#F87171',
  border: '#1F2724',
  borderStrong: '#2E3633',
  divider: '#1A2220',
  muted: '#9CA3AF',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radii = { sm: 6, md: 12, lg: 20, pill: 999 };
export const fontSize = { sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, xxxl: 32 };

interface ThemeCtx {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  palette: Palette;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeCtx>({
  mode: 'system',
  setMode: () => {},
  palette: lightPalette,
  isDark: false,
});

const KEY = 'busfee:theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const sys = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') setModeState(v);
    });
  }, []);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(KEY, m).catch(() => {});
  };

  const isDark = mode === 'dark' || (mode === 'system' && sys === 'dark');
  const palette = isDark ? darkPalette : lightPalette;

  return (
    <ThemeContext.Provider value={{ mode, setMode, palette, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
