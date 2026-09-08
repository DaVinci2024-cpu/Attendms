import { COMPANY_TIME_ZONE, companyDateKey, companyFields } from "./companyTime";

// Shared formatting for attendance timestamps — used anywhere a punch or
// a day grouping shows up (the dashboard's today view, the full history
// page, employee summaries) so a given ISO timestamp always reads the
// same way. Always in the company's own timezone (Africa/Kampala), not
// the viewing device's — see lib/companyTime.ts.

export function localDate(iso: string): string {
  return companyDateKey(new Date(iso)); // YYYY-MM-DD, sorts naturally
}

export function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: COMPANY_TIME_ZONE,
  });
}

// Value for an <input type="datetime-local"> that represents this ISO
// timestamp's wall-clock time in Kampala — pair with
// companyDatetimeLocalToUtc for the write-side inverse.
export function toDatetimeLocalValue(iso: string): string {
  const { year, month, day, hour, minute } = companyFields(new Date(iso));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}
