"use client";

import type { LucideIcon } from "lucide-react";

// A compact KPI chip — icon, big value, small label — for a row of
// at-a-glance numbers above a detail list (dashboard, employee history).
// A plain readout unless `onClick` is given, in which case it renders as
// a button (e.g. to open a detail popup) without changing its look.
const TONE_CLASSES = {
  neutral: "bg-neutral-800 text-neutral-300",
  blue: "bg-blue-500/15 text-blue-300",
  emerald: "bg-emerald-500/15 text-emerald-300",
  amber: "bg-amber-500/15 text-amber-300",
  rose: "bg-rose-500/15 text-rose-300",
  purple: "bg-purple-500/15 text-purple-300",
} as const;

export type StatPillTone = keyof typeof TONE_CLASSES;

export function StatPill({
  icon: Icon,
  value,
  label,
  tone = "neutral",
  onClick,
}: {
  icon: LucideIcon;
  value: string | number;
  label: string;
  tone?: StatPillTone;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${TONE_CLASSES[tone]}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-lg font-semibold leading-tight">{value}</p>
        <p className="truncate text-xs text-neutral-400">{label}</p>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-3 rounded-xl bg-neutral-900 px-4 py-3 text-left transition hover:bg-neutral-800 active:scale-[0.98]"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-xl bg-neutral-900 px-4 py-3">
      {content}
    </div>
  );
}
