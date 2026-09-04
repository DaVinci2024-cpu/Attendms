"use client";

import type { LucideIcon } from "lucide-react";

// One consistent color language for "what kind of punch was this" across
// the dashboard, employee history, and anywhere else a punch shows up —
// see src/lib/attendanceStatus.ts for how a log maps to a tone/label.
const TONE_CLASSES = {
  success: "bg-emerald-500/15 text-emerald-300",
  warning: "bg-amber-500/15 text-amber-300",
  info: "bg-blue-500/15 text-blue-300",
  neutral: "bg-neutral-700/60 text-neutral-300",
  danger: "bg-red-500/15 text-red-300",
} as const;

export type BadgeTone = keyof typeof TONE_CLASSES;

export function StatusBadge({
  label,
  tone,
  icon: Icon,
}: {
  label: string;
  tone: BadgeTone;
  icon?: LucideIcon;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </span>
  );
}
