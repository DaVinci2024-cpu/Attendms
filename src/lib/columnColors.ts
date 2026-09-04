// Gives each schedule column (shift block — "Morning", "Night", ...) a
// consistent color, purely presentational: derived from the column's
// position, not stored anywhere, so it needs no schema change and never
// goes stale if columns are renamed/reordered/added. Cycles through a
// fixed palette chosen to stay legible on the app's dark background.
// Every class string here is written out in full (not built by string
// concatenation) on purpose — Tailwind's build-time scanner only picks up
// classes it can find as literal text in source files, so a class
// assembled at runtime (e.g. `bg-${color}-500`) would silently be missing
// from the compiled CSS.
const PALETTE = [
  {
    bar: "bg-blue-500",
    topBorder: "border-t-blue-500",
    text: "text-blue-300",
    chipBg: "bg-blue-500/15",
    chipBorder: "border-blue-500/20",
  },
  {
    bar: "bg-purple-500",
    topBorder: "border-t-purple-500",
    text: "text-purple-300",
    chipBg: "bg-purple-500/15",
    chipBorder: "border-purple-500/20",
  },
  {
    bar: "bg-emerald-500",
    topBorder: "border-t-emerald-500",
    text: "text-emerald-300",
    chipBg: "bg-emerald-500/15",
    chipBorder: "border-emerald-500/20",
  },
  {
    bar: "bg-amber-500",
    topBorder: "border-t-amber-500",
    text: "text-amber-300",
    chipBg: "bg-amber-500/15",
    chipBorder: "border-amber-500/20",
  },
  {
    bar: "bg-pink-500",
    topBorder: "border-t-pink-500",
    text: "text-pink-300",
    chipBg: "bg-pink-500/15",
    chipBorder: "border-pink-500/20",
  },
  {
    bar: "bg-cyan-500",
    topBorder: "border-t-cyan-500",
    text: "text-cyan-300",
    chipBg: "bg-cyan-500/15",
    chipBorder: "border-cyan-500/20",
  },
  {
    bar: "bg-indigo-500",
    topBorder: "border-t-indigo-500",
    text: "text-indigo-300",
    chipBg: "bg-indigo-500/15",
    chipBorder: "border-indigo-500/20",
  },
  {
    bar: "bg-rose-500",
    topBorder: "border-t-rose-500",
    text: "text-rose-300",
    chipBg: "bg-rose-500/15",
    chipBorder: "border-rose-500/20",
  },
] as const;

export type ColumnColor = (typeof PALETTE)[number];

export function columnColor(index: number): ColumnColor {
  return PALETTE[index % PALETTE.length];
}
