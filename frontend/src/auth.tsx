/**
 * API client + Auth context for Bus Fee Manager.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const API = `${BACKEND}/api`;
const TOKEN_KEY = 'busfee:token';
console.log('[DEBUG] EXPO_PUBLIC_BACKEND_URL =', process.env.EXPO_PUBLIC_BACKEND_URL);
console.log('[DEBUG] BACKEND =', BACKEND);
console.log('[DEBUG] API =', API);

export interface AdminMe {
  id?: string;
  email: string;
  full_name?: string;
  mobile?: string;
  role?: 'admin' | 'author' | 'guest';
  status?: string;
  page_permissions?: string[];
  capabilities?: Record<string, boolean>;
  created_at?: string;
  last_login?: string;
}

interface AuthCtx {
  token: string | null;
  admin: AdminMe | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  token: null,
  admin: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const t = await AsyncStorage.getItem(TOKEN_KEY);
      if (t) {
        setToken(t);
        try {
          const me = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
          if (me.ok) setAdmin(await me.json());
          else {
            await AsyncStorage.removeItem(TOKEN_KEY);
            setToken(null);
          }
        } catch {
          /* offline ok */
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.detail || 'Login failed');
    }
    const j = await res.json();
    await AsyncStorage.setItem(TOKEN_KEY, j.token);
    setToken(j.token);
    // fetch full me right after login so role/permissions are available
    try {
      const meRes = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${j.token}` } });
      if (meRes.ok) setAdmin(await meRes.json());
      else setAdmin({ email: j.email });
    } catch {
      setAdmin({ email: j.email });
    }
  }, []);

  const logout = useCallback(async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setAdmin(null);
    router.replace('/(auth)/login');
  }, []);

  return (
    <AuthContext.Provider value={{ token, admin, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export async function apiFetch<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const t = await AsyncStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    await AsyncStorage.removeItem(TOKEN_KEY);
    router.replace('/(auth)/login');
    throw new Error('Unauthorized');
  }
  const text = await res.text();
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson && text ? JSON.parse(text) : (text as any);
  if (!res.ok) {
    throw new Error((data && (data as any).detail) || 'Request failed');
  }
  return data as T;
}

export const API_BASE = API;
export const TOKEN_STORAGE_KEY = TOKEN_KEY;
