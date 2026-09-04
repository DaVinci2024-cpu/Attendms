import type { BadgeTone } from "@/components/StatusBadge";
import type { AttendanceLog } from "./types";

export interface AttendanceStatus {
  label: string;
  tone: BadgeTone;
}

// Single source of truth for "what kind of punch was this" — used
// anywhere a punch is displayed (dashboard rows, employee history cards)
// so the same log always reads the same way. Checked in order of how
// unusual the punch was: an approved override is the most notable thing
// that can be true of a punch, then an unscheduled walk-in, then a
// corrected record, then a plain on-time punch.
export function punchStatus(log: AttendanceLog): AttendanceStatus {
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
