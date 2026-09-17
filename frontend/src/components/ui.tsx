/**
 * Small UI primitives — Button, TextField, DateTimeField, Card, Badge, FAB, EmptyState.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, spacing, radii, fontSize } from '@/src/theme';
import { isoToDisplay } from '@/src/utils/datetime';

interface BtnProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'success' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  testID?: string;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  testID,
  fullWidth = true,
  style,
}: BtnProps) {
  const { palette } = useTheme();
  const bg =
    variant === 'primary'
      ? palette.brand
      : variant === 'secondary'
      ? palette.brandSecondary
      : variant === 'success'
      ? palette.success
      : variant === 'danger'
      ? palette.error
      : 'transparent';
  const fg =
    variant === 'primary' || variant === 'success' || variant === 'danger'
      ? '#fff'
      : palette.onBrandSecondary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radii.md,
          paddingVertical: 14,
          paddingHorizontal: spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed || disabled ? 0.7 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        variant === 'ghost' && { borderWidth: 1, borderColor: palette.border },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 8 }} />}
          <Text style={{ color: fg, fontSize: fontSize.lg, fontWeight: '600' }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

interface FieldProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
}

export function TextField({ label, error, leftIcon, style, onFocus, onBlur, ...rest }: FieldProps) {
  const { palette } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label && (
        <Text
          style={{
            color: palette.onSurfaceSecondary,
            fontSize: fontSize.base,
            fontWeight: '500',
            marginBottom: 6,
          }}
        >
          {label}
        </Text>
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: error ? palette.error : isFocused ? palette.brand : palette.border,
          backgroundColor: palette.surfaceSecondary,
          borderRadius: radii.md,
          paddingHorizontal: spacing.md,
        }}
      >
        {leftIcon && (
          <Ionicons name={leftIcon} size={18} color={isFocused ? palette.brand : palette.muted} style={{ marginRight: 8 }} />
        )}
        <TextInput
          placeholderTextColor={palette.muted}
          onFocus={(e) => {
            setIsFocused(true);
            if (onFocus) onFocus(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            if (onBlur) onBlur(e);
          }}
          style={[
            {
              flex: 1,
              paddingVertical: 12,
              color: palette.onSurface,
              fontSize: fontSize.lg,
              ...Platform.select({
                web: {
                  outlineStyle: 'none',
                  outlineWidth: 0,
                  boxShadow: 'none',
                } as any,
                default: {},
              }),
            },
            style as any,
          ]}
          {...rest}
        />
      </View>
      {error ? (
        <Text style={{ color: palette.error, fontSize: fontSize.sm, marginTop: 4 }}>{error}</Text>
      ) : null}
    </View>
  );
}

// ─── DateTimeField ────────────────────────────────────────────────────────────

const CAL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

interface DTProps {
  label?: string;
  /** ISO date-time string (or empty string) */
  value: string;
  onChange: (iso: string) => void;
  required?: boolean;
  testID?: string;
  error?: string;
}

export function DateTimeField({ label, value, onChange, required, testID, error }: DTProps) {
  const { palette } = useTheme();
  const { width } = useWindowDimensions();
  const isLargeScreen = width > 680;

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'date' | 'time'>('date');
  const [yearPickerOpen, setYearPickerOpen] = useState(false);

  // Local state for navigation (month & year)
  const initialDate = value ? new Date(value) : new Date();
  const isValidDate = !isNaN(initialDate.getTime());
  const activeDate = isValidDate ? initialDate : new Date();

  const [navYear, setNavYear] = useState(activeDate.getFullYear());
  const [navMonth, setNavMonth] = useState(activeDate.getMonth()); // 0-11

  // Temp selected values for hour, minute, am/pm, and selected date
  const [selDay, setSelDay] = useState(activeDate.getDate());
  const [selMonth, setSelMonth] = useState(activeDate.getMonth());
  const [selYear, setSelYear] = useState(activeDate.getFullYear());

  const getAmPm = (h: number) => h >= 12 ? 'PM' : 'AM';
  const get12Hour = (h: number) => {
    const hr = h % 12;
    return hr === 0 ? 12 : hr;
  };

  const [selHour12, setSelHour12] = useState(get12Hour(activeDate.getHours()));
  const [selMin, setSelMin] = useState(activeDate.getMinutes());
  const [selAmPm, setSelAmPm] = useState(getAmPm(activeDate.getHours()));

  const handleOpen = () => {
    const d = value ? new Date(value) : new Date();
    const curr = isNaN(d.getTime()) ? new Date() : d;
    setNavYear(curr.getFullYear());
    setNavMonth(curr.getMonth());
    setSelDay(curr.getDate());
    setSelMonth(curr.getMonth());
    setSelYear(curr.getFullYear());
    setSelHour12(get12Hour(curr.getHours()));
    setSelMin(curr.getMinutes());
    setSelAmPm(getAmPm(curr.getHours()));
    setActiveTab('date');
    setYearPickerOpen(false);
    setOpen(true);
  };

  const handleConfirm = () => {
    let hr24 = selHour12 % 12;
    if (selAmPm === 'PM') {
      hr24 += 12;
    }
    const finalDate = new Date(selYear, selMonth, selDay, hr24, selMin, 0, 0);
    onChange(finalDate.toISOString());
    setOpen(false);
  };

  // Compute selected datetime display string for header preview
  const formatPreview = () => {
    const dayStr = selDay.toString().padStart(2, '0');
    const monthStr = CAL_MONTHS[selMonth];
    const yearStr = selYear;
    const hourStr = selHour12.toString().padStart(2, '0');
    const minStr = selMin.toString().padStart(2, '0');
    return `${dayStr} ${monthStr} ${yearStr}, ${hourStr}:${minStr} ${selAmPm}`;
  };

  // Generate calendar grid dates
  const startDayOfWeek = new Date(navYear, navMonth, 1).getDay();
  const daysInMonth = new Date(navYear, navMonth + 1, 0).getDate();
  const prevDaysInMonth = new Date(navYear, navMonth, 0).getDate();

  const calendarCells = [];
  // previous month's trailing days
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    calendarCells.push({
      day: prevDaysInMonth - i,
      month: navMonth === 0 ? 11 : navMonth - 1,
      year: navMonth === 0 ? navYear - 1 : navYear,
      isCurrentMonth: false,
    });
  }
  // current month's days
  for (let i = 1; i <= daysInMonth; i++) {
    calendarCells.push({
      day: i,
      month: navMonth,
      year: navYear,
      isCurrentMonth: true,
    });
  }
  // next month's leading days to complete grid (multiples of 7)
  const gridRows = Math.ceil(calendarCells.length / 7);
  const totalCells = gridRows * 7;
  const nextDaysNeeded = totalCells - calendarCells.length;
  for (let i = 1; i <= nextDaysNeeded; i++) {
    calendarCells.push({
      day: i,
      month: navMonth === 11 ? 0 : navMonth + 1,
      year: navMonth === 11 ? navYear + 1 : navYear,
      isCurrentMonth: false,
    });
  }

  // Wide-but-bounded range so the year can be jumped to directly instead of
  // clicking the month arrow up to a hundred times.
  const realCurrentYear = new Date().getFullYear();
  const yearOptions: number[] = [];
  for (let y = realCurrentYear + 5; y >= realCurrentYear - 50; y--) yearOptions.push(y);

  const handleMonthPrev = () => {
    if (navMonth === 0) {
      setNavMonth(11);
      setNavYear(navYear - 1);
    } else {
      setNavMonth(navMonth - 1);
    }
  };

  const handleMonthNext = () => {
    if (navMonth === 11) {
      setNavMonth(0);
      setNavYear(navYear + 1);
    } else {
      setNavMonth(navMonth + 1);
    }
  };

  // Hours options 01 - 12
  const hoursOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  // Minutes options in 5-min increments
  const minutesOptions = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  // Selected date value string displayed in trigger text box
  const displayVal = value ? isoToDisplay(value) : '';

  return (
    <View style={{ marginBottom: spacing.md }}>
      {label && (
        <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.base, fontWeight: '500', marginBottom: 6 }}>
          {label}{required ? ' *' : ''}
        </Text>
      )}
      <Pressable
        testID={testID}
        onPress={handleOpen}
        style={{
          flexDirection: 'row', alignItems: 'center',
          borderWidth: 1, borderColor: error ? palette.error : open ? palette.brand : palette.border,
          backgroundColor: palette.surfaceSecondary, borderRadius: radii.md,
          paddingHorizontal: spacing.md, paddingVertical: 12,
        }}
      >
        <Ionicons name="calendar-outline" size={18} color={open ? palette.brand : palette.muted} style={{ marginRight: 8 }} />
        <Text style={{ flex: 1, color: displayVal ? palette.onSurface : palette.muted, fontSize: fontSize.lg }}>
          {displayVal || 'Select Date & Time'}
        </Text>
        <Ionicons name="chevron-down" size={16} color={palette.muted} />
      </Pressable>
      {error ? <Text style={{ color: palette.error, fontSize: fontSize.sm, marginTop: 4 }}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0, 0, 0, 0.45)',
          justifyContent: isLargeScreen ? 'center' : 'flex-end',
          alignItems: 'center',
          padding: isLargeScreen ? spacing.xl : 0,
        }}>
          {/* Overlay click to dismiss */}
          <Pressable style={{ ...StyleSheet.absoluteFillObject }} onPress={() => setOpen(false)} />

          <View style={{
            backgroundColor: palette.surfaceSecondary,
            borderRadius: isLargeScreen ? 24 : 0,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            width: isLargeScreen ? 600 : '100%',
            maxWidth: '100%',
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 15,
            elevation: 10,
          }}>
            {/* Header: Gradient exactly matching the image style but using brand colors */}
            <LinearGradient
              colors={[palette.brand, '#4d7c66']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: spacing.lg, alignItems: 'flex-start' }}
            >
              <Text style={{ color: '#E1E7E4', fontSize: fontSize.xs ?? 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>
                {label || 'Select Date & Time'}
              </Text>
              <Text style={{ color: '#FFFFFF', fontSize: 26, fontWeight: '800' }}>
                {formatPreview()}
              </Text>
            </LinearGradient>

            {/* Mobile Tab switchers (only if narrow screen) */}
            {!isLargeScreen && (
              <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: palette.border }}>
                <Pressable
                  onPress={() => setActiveTab('date')}
                  style={{
                    flex: 1,
                    paddingVertical: 14,
                    alignItems: 'center',
                    borderBottomWidth: 2,
                    borderBottomColor: activeTab === 'date' ? palette.brand : 'transparent',
                  }}
                >
                  <Text style={{ color: activeTab === 'date' ? palette.brand : palette.muted, fontWeight: '700' }}>
                    Select Date
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setActiveTab('time')}
                  style={{
                    flex: 1,
                    paddingVertical: 14,
                    alignItems: 'center',
                    borderBottomWidth: 2,
                    borderBottomColor: activeTab === 'time' ? palette.brand : 'transparent',
                  }}
                >
                  <Text style={{ color: activeTab === 'time' ? palette.brand : palette.muted, fontWeight: '700' }}>
                    Select Time
                  </Text>
                </Pressable>
              </View>
            )}

            {/* Main selection content */}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                flexDirection: isLargeScreen ? 'row' : 'column',
                padding: spacing.md,
                gap: spacing.lg,
              }}
              style={{ maxHeight: 420 }}
            >
              {/* Date Column: visible on large screens or when active tab is 'date' on mobile */}
              {(isLargeScreen || activeTab === 'date') && (
                <View style={{ flex: 1, minWidth: 260 }}>
                  {/* Calendar Navigation */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: yearPickerOpen ? spacing.sm : spacing.md }}>
                    <Pressable
                      onPress={() => setYearPickerOpen((o) => !o)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                    >
                      <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface }}>
                        {CAL_MONTHS[navMonth]} {navYear}
                      </Text>
                      <Ionicons name={yearPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={palette.muted} />
                    </Pressable>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Pressable onPress={handleMonthPrev} style={{ padding: 6, borderRadius: radii.pill, backgroundColor: palette.surfaceTertiary }}>
                        <Ionicons name="chevron-back" size={18} color={palette.onSurface} />
                      </Pressable>
                      <Pressable onPress={handleMonthNext} style={{ padding: 6, borderRadius: radii.pill, backgroundColor: palette.surfaceTertiary }}>
                        <Ionicons name="chevron-forward" size={18} color={palette.onSurface} />
                      </Pressable>
                    </View>
                  </View>

                  {/* Year picker — tap a year to jump straight to it */}
                  {yearPickerOpen && (
                    <ScrollView
                      keyboardShouldPersistTaps="handled"
                      style={{ maxHeight: 160, marginBottom: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: radii.md }}
                      contentContainerStyle={{ padding: 6 }}
                    >
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {yearOptions.map((y) => {
                          const isSel = y === navYear;
                          return (
                            <Pressable
                              key={y}
                              onPress={() => { setNavYear(y); setYearPickerOpen(false); }}
                              style={{
                                paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.sm,
                                backgroundColor: isSel ? palette.brand : palette.surfaceTertiary,
                                minWidth: 64, alignItems: 'center',
                              }}
                            >
                              <Text style={{ color: isSel ? '#fff' : palette.onSurface, fontWeight: '600', fontSize: fontSize.sm }}>
                                {y}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </ScrollView>
                  )}

                  {/* Weekday headers */}
                  <View style={{ flexDirection: 'row', marginBottom: spacing.xs }}>
                    {WEEKDAYS.map((day) => (
                      <Text key={day} style={{ flex: 1, textAlign: 'center', color: palette.muted, fontWeight: '600', fontSize: fontSize.sm }}>
                        {day}
                      </Text>
                    ))}
                  </View>

                  {/* Calendar Grid */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {calendarCells.map((cell, idx) => {
                      const isSelected = cell.day === selDay && cell.month === selMonth && cell.year === selYear;
                      return (
                        <Pressable
                          key={idx}
                          onPress={() => {
                            setSelDay(cell.day);
                            setSelMonth(cell.month);
                            setSelYear(cell.year);
                            if (cell.month !== navMonth) {
                              setNavMonth(cell.month);
                              setNavYear(cell.year);
                            }
                          }}
                          style={{
                            width: '14.28%',
                            aspectRatio: 1,
                            justifyContent: 'center',
                            alignItems: 'center',
                            marginVertical: 2,
                          }}
                        >
                          <View style={{
                            width: 30,
                            height: 30,
                            borderRadius: radii.sm,
                            backgroundColor: isSelected ? palette.brand : 'transparent',
                            justifyContent: 'center',
                            alignItems: 'center',
                          }}>
                            <Text style={{
                              color: isSelected ? '#FFFFFF' : cell.isCurrentMonth ? palette.onSurface : palette.muted,
                              fontWeight: isSelected ? '700' : '400',
                              fontSize: fontSize.base,
                            }}>
                              {cell.day}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Vertical divider on Desktop */}
              {isLargeScreen && (
                <View style={{ width: 1, backgroundColor: palette.border, marginVertical: spacing.md }} />
              )}

              {/* Time Column: visible on large screens or when active tab is 'time' on mobile */}
              {(isLargeScreen || activeTab === 'time') && (
                <View style={{ flex: 1, minWidth: 260 }}>
                  {/* Segmented AM/PM Toggle exactly like the image */}
                  <View style={{
                    flexDirection: 'row',
                    backgroundColor: palette.surfaceTertiary,
                    borderRadius: radii.md,
                    padding: 4,
                    marginBottom: spacing.lg,
                  }}>
                    <Pressable
                      onPress={() => setSelAmPm('AM')}
                      style={{
                        flex: 1,
                        paddingVertical: 10,
                        borderRadius: radii.sm,
                        alignItems: 'center',
                        backgroundColor: selAmPm === 'AM' ? palette.brand : 'transparent',
                      }}
                    >
                      <Text style={{
                        color: selAmPm === 'AM' ? '#FFFFFF' : palette.onSurface,
                        fontWeight: '700',
                        fontSize: fontSize.base,
                      }}>
                        AM
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setSelAmPm('PM')}
                      style={{
                        flex: 1,
                        paddingVertical: 10,
                        borderRadius: radii.sm,
                        alignItems: 'center',
                        backgroundColor: selAmPm === 'PM' ? palette.brand : 'transparent',
                      }}
                    >
                      <Text style={{
                        color: selAmPm === 'PM' ? '#FFFFFF' : palette.onSurface,
                        fontWeight: '700',
                        fontSize: fontSize.base,
                      }}>
                        PM
                      </Text>
                    </Pressable>
                  </View>

                  {/* Grid / Layout for Hour and Minute */}
                  <View style={{ flexDirection: 'row', gap: spacing.md }}>
                    {/* Hour picker (left side) */}
                    <View style={{ flex: 3 }}>
                      <Text style={{ color: palette.muted, fontSize: fontSize.xs ?? 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: spacing.sm, textAlign: 'center' }}>
                        Hour
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                        {hoursOptions.map((h) => {
                          const isActive = selHour12 === h;
                          return (
                            <Pressable
                              key={h}
                              onPress={() => setSelHour12(h)}
                              style={{
                                width: '30%',
                                aspectRatio: 1.1,
                                borderRadius: radii.sm,
                                backgroundColor: isActive ? palette.brand : palette.surfaceTertiary,
                                justifyContent: 'center',
                                alignItems: 'center',
                              }}
                            >
                              <Text style={{
                                color: isActive ? '#FFFFFF' : palette.onSurface,
                                fontWeight: '700',
                                fontSize: fontSize.base,
                              }}>
                                {h.toString().padStart(2, '0')}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>

                    {/* Minute picker (right side) */}
                    <View style={{ flex: 2 }}>
                      <Text style={{ color: palette.muted, fontSize: fontSize.xs ?? 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: spacing.sm, textAlign: 'center' }}>
                        Minute
                      </Text>
                      <ScrollView
                        showsVerticalScrollIndicator={true}
                        keyboardShouldPersistTaps="handled"
                        style={{ height: 160 }}
                        contentContainerStyle={{ gap: 6 }}
                      >
                        {minutesOptions.map((m) => {
                          const isActive = selMin === m;
                          return (
                            <Pressable
                              key={m}
                              onPress={() => setSelMin(m)}
                              style={{
                                paddingVertical: 8,
                                borderRadius: radii.sm,
                                backgroundColor: isActive ? palette.brand : palette.surfaceTertiary,
                                alignItems: 'center',
                              }}
                            >
                              <Text style={{
                                color: isActive ? '#FFFFFF' : palette.onSurface,
                                fontWeight: '700',
                                fontSize: fontSize.base,
                              }}>
                                :{m.toString().padStart(2, '0')}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    </View>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Bottom Actions exactly matching style of the confirm bar */}
            <View style={{
              flexDirection: 'row',
              padding: spacing.md,
              gap: spacing.md,
              borderTopWidth: 1,
              borderTopColor: palette.border,
              backgroundColor: palette.surfaceSecondary,
            }}>
              <Pressable
                onPress={() => setOpen(false)}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: radii.md,
                  borderWidth: 1,
                  borderColor: palette.border,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: palette.onSurface, fontWeight: '700' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirm}
                style={{
                  flex: 2,
                  paddingVertical: 14,
                  borderRadius: radii.md,
                  backgroundColor: palette.brand,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>
                  Confirm — {selHour12.toString().padStart(2, '0')}:{selMin.toString().padStart(2, '0')} {selAmPm}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { palette, isDark } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: palette.surfaceSecondary,
          borderRadius: radii.lg,
          padding: spacing.lg,
          borderWidth: isDark ? 1 : 0,
          borderColor: palette.border,
          shadowColor: '#000',
          shadowOpacity: isDark ? 0 : 0.05,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: isDark ? 0 : 1,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { isDark } = useTheme();
  const meta =
    status === 'completed'
      ? { label: 'Paid', bg: '#D1FAE5', fg: '#065F46', dbg: '#064E3B', dfg: '#A7F3D0' }
      : status === 'partial'
      ? { label: 'Partial', bg: '#FEF3C7', fg: '#92400E', dbg: '#78350F', dfg: '#FDE68A' }
      : { label: 'Pending', bg: '#FEE2E2', fg: '#991B1B', dbg: '#7F1D1D', dfg: '#FECACA' };
  return (
    <View
      style={{
        backgroundColor: isDark ? meta.dbg : meta.bg,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: radii.pill,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: isDark ? meta.dfg : meta.fg, fontSize: fontSize.sm, fontWeight: '600' }}>
        {meta.label}
      </Text>
    </View>
  );
}

export function EmptyState({
  icon = 'document-text-outline',
  title,
  subtitle,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: spacing.xxl }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 999,
          backgroundColor: palette.brandTertiary,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.md,
        }}
      >
        <Ionicons name={icon} size={32} color={palette.brand} />
      </View>
      <Text style={{ fontSize: fontSize.lg, fontWeight: '600', color: palette.onSurface }}>
        {title}
      </Text>
      {subtitle && (
        <Text
          style={{
            marginTop: 4,
            fontSize: fontSize.base,
            color: palette.muted,
            textAlign: 'center',
          }}
        >
          {subtitle}
        </Text>
      )}
    </View>
  );
}

export function FAB({
  onPress,
  icon = 'add',
  testID,
}: {
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  testID?: string;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => ({
        position: 'absolute',
        right: spacing.lg,
        bottom: spacing.xl,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: palette.brand,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={icon} size={28} color="#fff" />
    </Pressable>
  );
}

// ── Alert popup — for surfacing a single error/success message as a modal ──
// (native Alert.alert doesn't render on web, so this is the app's dialog for
// anything more attention-grabbing than inline field text.)
export function AlertModal({
  visible,
  title,
  message,
  variant = 'error',
  onClose,
  testID,
}: {
  visible: boolean;
  title?: string;
  message: string;
  variant?: 'error' | 'success';
  onClose: () => void;
  testID?: string;
}) {
  const { palette } = useTheme();
  const { width } = useWindowDimensions();
  const isLargeScreen = width >= 700;
  const color = variant === 'success' ? palette.success : palette.error;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.lg,
      }}>
        <Pressable style={{ ...StyleSheet.absoluteFillObject }} onPress={onClose} />
        <View
          testID={testID}
          style={{
            width: isLargeScreen ? 420 : '100%',
            maxWidth: '100%',
            backgroundColor: palette.surfaceSecondary,
            borderRadius: radii.lg,
            padding: spacing.lg,
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 15,
            elevation: 10,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: spacing.md }}>
            <View style={{
              width: 34, height: 34, borderRadius: 17, backgroundColor: `${color}18`,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Ionicons name={variant === 'success' ? 'checkmark-circle' : 'alert-circle'} size={20} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.onSurface, fontWeight: '700', fontSize: fontSize.lg }}>
                {title || (variant === 'success' ? 'Success' : 'Something went wrong')}
              </Text>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 4, lineHeight: 19 }}>
                {message}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={onClose}
            testID={testID ? `${testID}-ok` : undefined}
            style={{
              paddingVertical: 12, borderRadius: radii.md,
              backgroundColor: color, alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: fontSize.sm }}>OK</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── Confirm popup — Cancel/Confirm dialog (native Alert.alert doesn't render
// on web, so this is used anywhere a destructive action needs confirmation) ──
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
  testID,
}: {
  visible: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}) {
  const { palette } = useTheme();
  const { width } = useWindowDimensions();
  const isLargeScreen = width >= 700;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.lg,
      }}>
        <Pressable style={{ ...StyleSheet.absoluteFillObject }} onPress={onCancel} />
        <View
          testID={testID}
          style={{
            width: isLargeScreen ? 420 : '100%',
            maxWidth: '100%',
            backgroundColor: palette.surfaceSecondary,
            borderRadius: radii.lg,
            padding: spacing.lg,
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 15,
            elevation: 10,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: spacing.md }}>
            <View style={{
              width: 34, height: 34, borderRadius: 17, backgroundColor: `${palette.error}18`,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Ionicons name="warning-outline" size={20} color={palette.error} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.onSurface, fontWeight: '700', fontSize: fontSize.lg }}>
                {title || 'Are you sure?'}
              </Text>
              <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: 4, lineHeight: 19 }}>
                {message}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={onCancel}
              testID={testID ? `${testID}-cancel` : undefined}
              style={{
                flex: 1, paddingVertical: 12, borderRadius: radii.md,
                borderWidth: 1, borderColor: palette.border, alignItems: 'center',
              }}
            >
              <Text style={{ color: palette.onSurface, fontWeight: '600', fontSize: fontSize.sm }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              testID={testID ? `${testID}-confirm` : undefined}
              style={{
                flex: 1, paddingVertical: 12, borderRadius: radii.md,
                backgroundColor: palette.error, alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: fontSize.sm }}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Confirmation for a destructive action that cannot be undone. Spells out what
 * is about to be lost, then makes the user type the word — a mistap can't reach
 * the button, which a plain yes/no dialog cannot promise.
 */
export function DangerConfirmModal({
  visible,
  title,
  message,
  bullets = [],
  confirmWord = 'DELETE',
  confirmLabel = 'Delete forever',
  busy,
  note,
  onConfirm,
  onCancel,
  testID,
}: {
  visible: boolean;
  title: string;
  message: string;
  bullets?: string[];
  confirmWord?: string;
  confirmLabel?: string;
  busy?: boolean;
  note?: string;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}) {
  const { palette } = useTheme();
  const { width } = useWindowDimensions();
  const isLargeScreen = width >= 700;
  const [typed, setTyped] = useState('');

  // Never carry a previous confirmation into the next open.
  useEffect(() => {
    if (visible) setTyped('');
  }, [visible]);

  const armed = typed.trim().toUpperCase() === confirmWord.toUpperCase() && !busy;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg }}>
        <View
          testID={testID}
          style={{
            width: '100%', maxWidth: isLargeScreen ? 460 : 400,
            backgroundColor: palette.surfaceSecondary, borderRadius: radii.lg,
            padding: spacing.lg, borderWidth: 1, borderColor: palette.error + '55',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
            <Ionicons name="warning" size={22} color={palette.error} />
            <Text style={{ flex: 1, fontSize: fontSize.lg, fontWeight: '700', color: palette.onSurface, marginLeft: 8 }}>
              {title}
            </Text>
          </View>

          <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.base, lineHeight: 20 }}>{message}</Text>

          {bullets.length > 0 ? (
            <View style={{ marginTop: spacing.md, backgroundColor: palette.error + '15', borderRadius: radii.md, padding: spacing.md, gap: 4 }}>
              {bullets.map((b, i) => (
                <Text key={i} style={{ color: palette.error, fontSize: fontSize.sm, fontWeight: '600' }}>• {b}</Text>
              ))}
            </View>
          ) : null}

          {note ? (
            <Text style={{ color: palette.onSurfaceSecondary, fontSize: fontSize.sm, marginTop: spacing.md }}>
              {note}
            </Text>
          ) : null}

          <Text style={{ color: palette.muted, fontSize: fontSize.sm, marginTop: spacing.md, marginBottom: 6 }}>
            This cannot be undone. Type {confirmWord} to confirm.
          </Text>
          <TextField
            value={typed}
            onChangeText={setTyped}
            placeholder={confirmWord}
            autoCapitalize="characters"
            autoCorrect={false}
            testID={testID ? `${testID}-input` : undefined}
          />

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable
              onPress={onCancel}
              testID={testID ? `${testID}-cancel` : undefined}
              style={{
                flex: 1, paddingVertical: 12, borderRadius: radii.md,
                backgroundColor: palette.surfaceTertiary, alignItems: 'center',
                borderWidth: 1, borderColor: palette.border,
              }}
            >
              <Text style={{ color: palette.onSurface, fontWeight: '600', fontSize: fontSize.sm }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={armed ? onConfirm : undefined}
              disabled={!armed}
              testID={testID ? `${testID}-confirm` : undefined}
              style={{
                flex: 1, paddingVertical: 12, borderRadius: radii.md,
                backgroundColor: armed ? palette.error : palette.surfaceTertiary,
                alignItems: 'center', opacity: armed ? 1 : 0.6,
                borderWidth: 1, borderColor: armed ? palette.error : palette.border,
              }}
            >
              <Text style={{ color: armed ? '#fff' : palette.muted, fontWeight: '700', fontSize: fontSize.sm }}>
                {busy ? 'Deleting…' : confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export const styles = StyleSheet.create({});
