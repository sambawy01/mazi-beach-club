// Pure date/time helpers for the admin reservation calendar.
// Extracted from CalendarTab.tsx so they can be unit-tested in isolation.

// Format a Date into a *local* 'YYYY-MM-DD' string. Using local getters (not
// toISOString) avoids the UTC off-by-one that would shift days across the
// midnight boundary for non-UTC timezones.
export function localKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Short time label. Handles both '4:00 PM' (already 12h) and '16:00' (24h).
export function prettyTime(raw: string): string {
  if (!raw) return '';
  const s = raw.trim();
  // Already has an AM/PM meridiem — normalise spacing/casing and return.
  const meridiem = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (meridiem) {
    const h = parseInt(meridiem[1], 10);
    return `${h}:${meridiem[2]} ${meridiem[3].toUpperCase()}`;
  }
  // 24-hour 'HH:MM' → 12-hour with meridiem.
  const h24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    let h = parseInt(h24[1], 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${h24[2]} ${ampm}`;
  }
  return s; // Unknown format — show as-is.
}

// Minutes-since-midnight for sorting, tolerant of both formats.
export function timeToMinutes(raw: string): number {
  if (!raw) return 0;
  const s = raw.trim();
  const meridiem = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (meridiem) {
    let h = parseInt(meridiem[1], 10) % 12;
    if (/[Pp][Mm]/.test(meridiem[3])) h += 12;
    return h * 60 + parseInt(meridiem[2], 10);
  }
  const h24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) return parseInt(h24[1], 10) * 60 + parseInt(h24[2], 10);
  return 0;
}
