/**
 * DateTime helper — DD/MM/YYYY HH:mm parsing / formatting.
 * Works on web + mobile without any native picker dependency.
 */

const pad = (n: number) => n.toString().padStart(2, '0');

/** Convert ISO datetime → "DD/MM/YYYY HH:mm" */
export function isoToDisplay(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert "DD/MM/YYYY HH:mm" or partial → ISO string (with Z). Returns null if invalid. */
export function displayToIso(s: string): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = '00', mi = '00'] = m;
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi)));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function nowDisplay(): string {
  return isoToDisplay(new Date().toISOString());
}

export function todayMidnightDisplay(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return isoToDisplay(d.toISOString());
}
