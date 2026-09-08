import { companyDateKey, companyFields, companyTimeToUtc } from "./companyTime";

// Monday of the calendar week (in Kampala) containing `date`.
export function mondayOf(date: Date): Date {
  const { year, month, day, weekday } = companyFields(date);
  const diff = weekday === 0 ? -6 : 1 - weekday; // 0 = Sunday
  return companyTimeToUtc(year, month, day + diff);
}

export function toWeekId(monday: Date): string {
  return companyDateKey(monday); // YYYY-MM-DD
}

// This week's Monday, then each Monday before it — e.g. weeksBack(4)
// gives this week plus the 3 before it.
export function weekIdsBack(weeksBack: number): string[] {
  const thisMonday = mondayOf(new Date());
  const { year, month, day } = companyFields(thisMonday);
  return Array.from({ length: weeksBack }, (_, i) =>
    companyDateKey(companyTimeToUtc(year, month, day - i * 7))
  );
}
