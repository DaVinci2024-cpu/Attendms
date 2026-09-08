import type { BadgeTone } from "@/components/StatusBadge";
import type { AttendanceLog } from "./types";

export interface AttendanceStatus {
  label: string;
  tone: BadgeTone;
}

// True once any edit on this log marks it voided (a mistaken/duplicate
// punch) — see AttendanceEdit.voided. Wherever "live" counts are
// computed (currently clocked in, hours, no-shows, sector summary), the
// log list should be pre-filtered with this so a voided punch behaves as
// if it never happened, while still being readable in raw history views.
export function isVoided(log: AttendanceLog): boolean {
  return log.edits?.some((e) => e.voided) ?? false;
}

// Single source of truth for "what kind of punch was this" — used
// anywhere a punch is displayed (dashboard rows, employee history cards)
// so the same log always reads the same way. Checked in order of how
// unusual the punch was: voided overrides everything else (it doesn't
// matter how the punch went through if it's since been voided), then an
// approved override, then an unscheduled walk-in, then a corrected
// record, then a plain on-time punch.
export function punchStatus(log: AttendanceLog): AttendanceStatus {
  if (isVoided(log)) {
    return { label: "Voided", tone: "danger" };
  }
  if (log.override) {
    return {
      label: log.type === "punch_in" ? "Late (approved)" : "Early leave (approved)",
      tone: "warning",
    };
  }
  if (log.scheduleExempt) {
    return { label: "Unscheduled", tone: "info" };
  }
  if (log.edits && log.edits.length > 0) {
    return { label: "Corrected", tone: "neutral" };
  }
  return { label: "On time", tone: "success" };
}
