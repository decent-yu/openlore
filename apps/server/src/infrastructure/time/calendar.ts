/** UTC bounds of the calendar day containing `now` in the workspace timezone. */
export function calendarDayBounds(now: Date, timezone: string): { start: string; end: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const dateKey = (timestamp: number): string => {
    const parts = formatter.formatToParts(timestamp);
    const part = (type: string) => parts.find((p) => p.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const today = dateKey(now.getTime());
  const nextDay = new Date(`${today}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  // Find each local date boundary independently: DST days need not be 24 hours.
  const boundary = (day: string): string => {
    const anchor = Date.parse(`${day}T00:00:00.000Z`);
    let low = anchor - 36 * 60 * 60 * 1000;
    let high = anchor + 36 * 60 * 60 * 1000;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (dateKey(mid) < day) low = mid + 1;
      else high = mid;
    }
    return new Date(low).toISOString();
  };
  return { start: boundary(today), end: boundary(nextDay.toISOString().slice(0, 10)) };
}
