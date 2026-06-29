import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch } from '@/src/auth';
import { useTheme, spacing, fontSize, radii } from '@/src/theme';
import { Button, Card, EmptyState, FAB, TextField } from '@/src/components/ui';
import { SkeletonCard } from '@/src/components/Skeleton';

interface User {
  id: string;
  email: string;
  full_name: string;
  mobile?: string;
  role: 'admin' | 'author' | 'guest';
  status: 'active' | 'inactive';
  page_permissions: string[];
  created_at: string;
  last_login?: string | null;
}

interface RoleInfo {
  roles: string[];
  default_permissions: Record<string, string[]>;
  all_pages: string[];
  max_authors: number;
}

const ROLE_COLORS: Record<string, string> = { admin: '#2B4C3E', author: '#D97706', guest: '#6B7280' };

export default function Users() {
  const { palette } = useTheme();
  const [users, setUsers] = useState<User[]>([]);
  const [info, setInfo] = useState<RoleInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, ri] = await Promise.all([apiFetch<User[]>('/users'), apiFetch<RoleInfo>('/users/roles')]);
      setUsers(list);
      setInfo(ri);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const remove = async (u: User) => {
    if (u.role === 'admin' && u.email.toLowerCase() === 'kharwaramog02@gmail.com') return;
    if (!confirm?.(`Delete user ${u.email}?`)) return;
    try { await apiFetch(`/users/${u.id}`, { method: 'DELETE' }); load(); } catch (e: any) { alert?.(e.message); }
  };

  const toggleActive = async (u: User) => {
    try {
      await apiFetch(`/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ status: u.status === 'active' ? 'inactive' : 'active' }) });
      load();
    } catch (e: any) { alert?.(e.message); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['top']}>
      <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface }} testID="users-title">User Management</Text>
        <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 4 }}>
          {users.length} total · {users.filter(u => u.role === 'author').length}/{info?.max_authors ?? 3} authors used
        </Text>
      </View>

      {loading ? (
        <View style={{ padding: spacing.lg }}>{Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}</View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Card><EmptyState icon="person-add-outline" title="No users yet" subtitle="Tap + to add an Author or Guest." /></Card>}
          renderItem={({ item }) => (
            <Card style={{ marginBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: palette.brandTertiary, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: palette.brand, fontWeight: '700' }}>
                    {(item.full_name || item.email).slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface }}>{item.full_name || item.email}</Text>
                  <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 2 }}>{item.email}</Text>
                </View>
                <View style={{ backgroundColor: ROLE_COLORS[item.role] + '22', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 }}>
                  <Text style={{ color: ROLE_COLORS[item.role], fontWeight: '700', fontSize: fontSize.sm, textTransform: 'capitalize' }}>{item.role}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: 6 }}>
                {item.page_permissions.map((p) => (
                  <View key={p} style={{ backgroundColor: palette.surfaceTertiary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
                    <Text style={{ color: palette.onSurface, fontSize: 11, textTransform: 'capitalize' }}>{p}</Text>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <Pressable testID={`user-edit-${item.id}`} onPress={() => { setEditing(item); setShowForm(true); }} style={{ flex: 1, backgroundColor: palette.brandSecondary, paddingVertical: 8, borderRadius: radii.md, alignItems: 'center' }}>
                  <Text style={{ color: palette.onBrandSecondary, fontWeight: '600' }}>Edit</Text>
                </Pressable>
                <Pressable onPress={() => toggleActive(item)} style={{ flex: 1, backgroundColor: item.status === 'active' ? palette.warning + '22' : palette.success + '22', paddingVertical: 8, borderRadius: radii.md, alignItems: 'center' }}>
                  <Text style={{ color: item.status === 'active' ? palette.warning : palette.success, fontWeight: '600' }}>
                    {item.status === 'active' ? 'Deactivate' : 'Activate'}
                  </Text>
                </Pressable>
                {item.email.toLowerCase() !== 'kharwaramog02@gmail.com' && (
                  <Pressable testID={`user-delete-${item.id}`} onPress={() => remove(item)} style={{ width: 44, backgroundColor: palette.error + '22', paddingVertical: 8, borderRadius: radii.md, alignItems: 'center' }}>
                    <Ionicons name="trash-outline" size={18} color={palette.error} />
                  </Pressable>
                )}
              </View>
            </Card>
          )}
        />
      )}

      <FAB testID="add-user-fab" onPress={() => { setEditing(null); setShowForm(true); }} />

      <UserFormModal
        visible={showForm}
        editing={editing}
        info={info}
        onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); load(); }}
      />
    </SafeAreaView>
  );
}

function UserFormModal({ visible, editing, info, onClose, onSaved }: {
  visible: boolean; editing: User | null; info: RoleInfo | null; onClose: () => void; onSaved: () => void;
}) {
  const { palette } = useTheme();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'author' | 'guest'>('guest');
  const [perms, setPerms] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (editing) {
      setFullName(editing.full_name); setEmail(editing.email); setMobile(editing.mobile || '');
      setPassword(''); setRole(editing.role); setPerms(editing.page_permissions);
    } else {
      setFullName(''); setEmail(''); setMobile(''); setPassword('');
      setRole('guest'); setPerms(info?.default_permissions?.guest || ['dashboard']);
    }
    setErr('');
  }, [visible, editing, info]);

  const togglePerm = (p: string) => setPerms((prev) => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const save = async () => {
    setErr('');
    if (!fullName.trim() || !email.trim()) { setErr('Name and email are required'); return; }
    if (!editing && password.length < 6) { setErr('Password must be at least 6 characters'); return; }
    setBusy(true);
    try {
      if (editing) {
        await apiFetch(`/users/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ full_name: fullName, mobile, role, page_permissions: perms }),
        });
        if (password) {
          await apiFetch(`/users/${editing.id}/reset-password`, { method: 'POST', body: JSON.stringify({ new_password: password }) });
        }
      } else {
        await apiFetch('/users', {
          method: 'POST',
          body: JSON.stringify({ full_name: fullName, email, mobile, password, role, page_permissions: perms }),
        });
      }
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} />
        <View style={{ backgroundColor: palette.surfaceSecondary, padding: spacing.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, backgroundColor: palette.border, borderRadius: 2, marginBottom: spacing.md }} />
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: palette.onSurface, marginBottom: spacing.md }}>{editing ? 'Edit user' : 'Add user'}</Text>
            <TextField label="Full Name *" value={fullName} onChangeText={setFullName} testID="user-fullname" />
            <TextField label="Email *" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" editable={!editing} testID="user-email" />
            <TextField label="Mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" testID="user-mobile" />
            <TextField label={editing ? 'New Password (leave empty to keep)' : 'Password *'} value={password} onChangeText={setPassword} secureTextEntry testID="user-password" />

            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: 6 }}>Role</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md }}>
              {(['admin', 'author', 'guest'] as const).map((r) => {
                const disabled = editing?.email.toLowerCase() === 'kharwaramog02@gmail.com' && r !== 'admin';
                const active = role === r;
                return (
                  <Pressable
                    key={r}
                    testID={`user-role-${r}`}
                    disabled={disabled}
                    onPress={() => {
                      setRole(r);
                      const def = info?.default_permissions?.[r];
                      if (def) setPerms(def);
                    }}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: radii.md, alignItems: 'center',
                      backgroundColor: active ? palette.brand : palette.surfaceTertiary,
                      borderWidth: 1, borderColor: active ? palette.brand : palette.border,
                      opacity: disabled ? 0.5 : 1 }}
                  >
                    <Text style={{ color: active ? '#fff' : palette.onSurface, fontWeight: '600', textTransform: 'capitalize' }}>{r}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginBottom: 6 }}>Page Permissions</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md }}>
              {(info?.all_pages || []).map((p) => {
                const on = perms.includes(p);
                return (
                  <Pressable
                    key={p}
                    testID={`user-perm-${p}`}
                    onPress={() => togglePerm(p)}
                    style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, flexDirection: 'row', alignItems: 'center',
                      backgroundColor: on ? palette.brand : palette.surfaceTertiary,
                      borderWidth: 1, borderColor: on ? palette.brand : palette.border }}
                  >
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={14} color={on ? '#fff' : palette.onSurface} />
                    <Text style={{ color: on ? '#fff' : palette.onSurface, fontWeight: '600', textTransform: 'capitalize', marginLeft: 6 }}>{p}</Text>
                  </Pressable>
                );
              })}
            </View>

            {err ? <Text style={{ color: palette.error, marginBottom: spacing.sm }} testID="user-form-error">{err}</Text> : null}
            <Button title={editing ? 'Save Changes' : 'Create User'} onPress={save} loading={busy} testID="user-save" />
            <View style={{ height: spacing.sm }} />
            <Button title="Cancel" variant="ghost" onPress={onClose} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
