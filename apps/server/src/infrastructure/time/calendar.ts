function dateKeyFormatter(timezone: string): (timestamp: number) => string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (timestamp) => {
    const parts = formatter.formatToParts(timestamp);
    const part = (type: string) =>
      parts.find((item) => item.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
}

/** UTC bounds of the calendar day containing `now` in the workspace timezone. */
export function calendarDayBounds(
  now: Date,
  timezone: string,
): { start: string; end: string } {
  return calendarDateBounds(
    dateKeyFormatter(timezone)(now.getTime()),
    timezone,
  );
}

/** UTC bounds of a selected local date. Each boundary is resolved independently for DST. */
export function calendarDateBounds(
  day: string,
  timezone: string,
): { start: string; end: string } {
  const dateKey = dateKeyFormatter(timezone);
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const boundary = (date: string): string => {
    const anchor = Date.parse(`${date}T00:00:00.000Z`);
    let low = anchor - 36 * 60 * 60 * 1000;
    let high = anchor + 36 * 60 * 60 * 1000;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (dateKey(mid) < date) low = mid + 1;
      else high = mid;
    }
    return new Date(low).toISOString();
  };
  return {
    start: boundary(day),
    end: boundary(next.toISOString().slice(0, 10)),
  };
}
