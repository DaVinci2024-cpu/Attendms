"use client";

// A consistent page-title treatment for every admin/enroll page — a
// colored accent bar plus title/subtitle, replacing a bare <h1>. The
// accent color is chosen per page to match that section's icon color on
// the admin hub (src/app/admin/page.tsx), so the same page reads as the
// same color everywhere it appears.
const ACCENT_CLASSES = {
  amber: "bg-amber-500",
  pink: "bg-pink-500",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  cyan: "bg-cyan-500",
  rose: "bg-rose-500",
  orange: "bg-orange-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
} as const;

export type PageAccent = keyof typeof ACCENT_CLASSES;

export function PageHeader({
  title,
  subtitle,
  accent = "violet",
  actions,
}: {
  title: string;
  subtitle?: string;
  accent?: PageAccent;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span
          className={`mt-1 h-7 w-1.5 shrink-0 rounded-full ${ACCENT_CLASSES[accent]}`}
        />
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="text-sm text-neutral-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
