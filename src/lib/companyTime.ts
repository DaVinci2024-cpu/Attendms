// Uganda (Africa/Kampala) is UTC+3 year-round — no daylight saving, so a
// fixed offset is exact with no seasonal edge cases to account for. This
// file is the one place that offset is defined; every "what day/time is
// it" and "build a Date for this wall-clock moment" computation in the
// app should route through here instead of the browser's own local
// timezone, so the dashboard, kiosk, and every report agree on "today"
// and shift windows regardless of which device or timezone is looking
// at them. Stored timestamps themselves stay real UTC instants
// (`new Date().toISOString()`) — only the *interpretation* of an instant
// (which calendar day, which hour) and the *construction* of a Date from
// wall-clock fields need this.
export const COMPANY_TIME_ZONE = "Africa/Kampala";
const COMPANY_UTC_OFFSET_MINUTES = 180;

export interface CompanyDateFields {
  year: number;
  month: number; // 0-11
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

// Calendar/clock fields for `date` as they read on a wall clock in
// Kampala. Use instead of date.getFullYear()/getDay()/getHours()/etc.,
// which read the browser's own timezone.
export function companyFields(date: Date): CompanyDateFields {
  const shifted = new Date(date.getTime() + COMPANY_UTC_OFFSET_MINUTES * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

// The real instant for the given Kampala wall-clock date+time — the
// inverse of companyFields. Use instead of `new Date(y, m, d, h, min)` /
// `date.setHours(...)`, which build/mutate in the browser's own
// timezone. Out-of-range fields (day 0, day 32, month 13, ...) normalize
// the same way native Date math does (rolling into the neighboring
// month/year), so callers can freely add/subtract days across a month
// or year boundary.
export function companyTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): Date {
  return new Date(
    Date.UTC(year, month, day, hour, minute, second) - COMPANY_UTC_OFFSET_MINUTES * 60000
  );
}

// "YYYY-MM-DD" for `date`'s calendar day in Kampala — the shared key
// format for week ids and day-grouping, so every part of the app that
// buckets something "by day" agrees on the exact same string.
export function companyDateKey(date: Date): string {
  const { year, month, day } = companyFields(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

// Parses a "YYYY-MM-DD" key (a week id, a <input type="date"> value) as
// midnight of that calendar day in Kampala.
export function companyDateKeyToUtc(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return companyTimeToUtc(y, m - 1, d);
}

// Parses a "YYYY-MM-DDTHH:mm" value (a <input type="datetime-local">
// value) as that wall-clock moment in Kampala — the write-side inverse
// of dateFormat.ts's toDatetimeLocalValue, which prefills those same
// inputs with a timestamp's Kampala time. Without this, an admin typing
// "08:00" from a browser set to a different timezone would record a
// different real instant than one typing "08:00" from Kampala.
export function companyDatetimeLocalToUtc(value: string): Date {
  const [datePart, timePart] = value.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = (timePart ?? "00:00").split(":").map(Number);
  return companyTimeToUtc(y, m - 1, d, hh, mm);
}

// End of `date`'s calendar day in Kampala (23:59:59.999), as a real
// instant — the other end of a "whole day" window alongside
// companyTimeToUtc(...) at 00:00:00 for the same fields.
export function companyEndOfDay(date: Date): Date {
  const { year, month, day } = companyFields(date);
  return new Date(companyTimeToUtc(year, month, day + 1).getTime() - 1);
}
