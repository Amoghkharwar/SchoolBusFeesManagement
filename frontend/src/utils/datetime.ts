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

/**
 * Calendar date ("YYYY-MM-DD") of an instant, read in the viewer's own timezone.
 *
 * The date picker builds a local Date and serialises it with toISOString(), so
 * midnight on 1 Sep in IST leaves as "2026-08-31T18:30:00Z". Anything that means
 * a *day* rather than a moment — a salary month, for instance — has to be pinned
 * to the calendar date the user actually saw, or it lands a day early on the server.
 */
export function isoToCalendarDate(iso?: string | null): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM-DD" or an ISO instant → "DD/MM/YYYY", with no timezone shift. */
export function calendarDateToDisplay(value?: string | null): string {
  const cd = isoToCalendarDate(value);
  if (!cd) return '';
  const [y, m, d] = cd.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * "YYYY-MM-DD" → an ISO instant at local midnight on that day, so the date
 * picker opens on the day the user stored. Round-trips with isoToCalendarDate
 * in any timezone.
 */
export function calendarDateToLocalIso(value?: string | null): string {
  const cd = isoToCalendarDate(value);
  if (!cd) return '';
  const [y, m, d] = cd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}
