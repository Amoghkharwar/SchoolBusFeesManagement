/**
 * Shared helpers: Indian currency formatter, WhatsApp link helper, status badge color.
 */
import { Linking } from 'react-native';

/** Format a number as INR with Indian grouping. e.g. 325000 -> ₹3,25,000 */
export function formatINR(n: number | string | undefined | null, withSymbol = true): string {
  if (n === undefined || n === null || n === '') return withSymbol ? '₹0' : '0';
  const num = Math.round(Number(n));
  if (Number.isNaN(num)) return withSymbol ? '₹0' : '0';
  const neg = num < 0;
  const abs = Math.abs(num).toString();
  let lastThree = abs.slice(-3);
  const rest = abs.slice(0, -3);
  let formatted = lastThree;
  if (rest) {
    formatted = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree;
  }
  return (withSymbol ? '₹' : '') + (neg ? '-' : '') + formatted;
}

/** Build a wa.me URL with a sanitized phone number + text. */
export function buildWhatsAppUrl(phone: string, text: string): string {
  const digits = (phone || '').replace(/\D+/g, '');
  // Default to India country code if 10 digits
  const withCC = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCC}?text=${encodeURIComponent(text)}`;
}

export async function openWhatsApp(phone: string, text: string) {
  const url = buildWhatsAppUrl(phone, text);
  const ok = await Linking.canOpenURL(url);
  if (ok) await Linking.openURL(url);
}

export function reminderMessage(opts: {
  studentName: string;
  school: string;
  pending: number;
  dueDate: string;
}) {
  return `Dear Parent,

This is a reminder that your child's school bus fee is still pending.

Student Name: ${opts.studentName}
School: ${opts.school}
Pending Amount: ${formatINR(opts.pending)}

Kindly complete the payment before ${formatDate(opts.dueDate)}.

Thank you.`;
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function statusMeta(status: string) {
  switch (status) {
    case 'completed':
      return { label: 'Paid', bg: '#D1FAE5', fg: '#065F46', dark_bg: '#064E3B', dark_fg: '#A7F3D0' };
    case 'partial':
      return { label: 'Partial', bg: '#FEF3C7', fg: '#92400E', dark_bg: '#78350F', dark_fg: '#FDE68A' };
    default:
      return { label: 'Pending', bg: '#FEE2E2', fg: '#991B1B', dark_bg: '#7F1D1D', dark_fg: '#FECACA' };
  }
}
