export function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function toWeekId(monday: Date): string {
  return monday.toLocaleDateString("en-CA"); // YYYY-MM-DD
}

// This week's Monday, then each Monday before it — e.g. weeksBack(4)
// gives this week plus the 3 before it.
export function weekIdsBack(weeksBack: number): string[] {
  const thisMonday = mondayOf(new Date());
  return Array.from({ length: weeksBack }, (_, i) => {
    const d = new Date(thisMonday);
    d.setDate(d.getDate() - i * 7);
    return toWeekId(d);
  });
}
