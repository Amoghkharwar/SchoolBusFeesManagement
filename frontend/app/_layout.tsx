import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { LogBox, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useIconFonts } from '@/src/hooks/use-icon-fonts';
import { ThemeProvider, useTheme } from '@/src/theme';
import { AuthProvider, useAuth } from '@/src/auth';
import { FYProvider } from '@/src/fy';

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

// app/+html.tsx is ignored while app.json sets web.output to "single", so the
// web-only resets have to be injected at runtime instead. `contain` on every
// element stops a ScrollView/FlatList overscroll from chaining to the viewport
// and firing the mobile browser's pull-to-refresh.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const STYLE_ID = 'app-web-resets';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html, body { overscroll-behavior: none; height: 100%; }
      * { overscroll-behavior-y: contain; }
      input:focus, textarea:focus, select:focus,
      button:focus, [role="button"]:focus { outline: none; box-shadow: none; }
    `;
    document.head.appendChild(style);
  }

  // Same reason: the manifest and theme-color tags that make the site
  // installable have to be added here rather than in +html.tsx.
  const head = (rel: string, attrs: Record<string, string>) => {
    if (document.querySelector(`link[rel="${rel}"]`)) return;
    const el = document.createElement('link');
    el.rel = rel;
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    document.head.appendChild(el);
  };

  head('manifest', { href: '/manifest.json' });
  head('apple-touch-icon', { href: '/icon-192.png' });

  if (!document.querySelector('meta[name="theme-color"]')) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#0f172a';
    document.head.appendChild(meta);
  }

  if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
    const meta = document.createElement('meta');
    meta.name = 'apple-mobile-web-app-capable';
    meta.content = 'yes';
    document.head.appendChild(meta);
  }

  // Registered up front, not on first notification opt-in: the browser only
  // offers "Install app" once a service worker is active.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === '(auth)';
    if (!token && !inAuth) router.replace('/(auth)/login');
    else if (token && inAuth) router.replace('/(tabs)/dashboard');
  }, [token, loading, segments, router]);

  return <>{children}</>;
}

function RootInner() {
  const { palette } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: palette.surface }}>
      <AuthProvider>
        <FYProvider>
          <AuthGuard>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.surface } }} />
          </AuthGuard>
        </FYProvider>
      </AuthProvider>
    </View>
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <RootInner />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
