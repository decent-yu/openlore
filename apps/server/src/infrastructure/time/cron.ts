function values(pattern: string, min: number, max: number): number[] {
  return pattern.split(',').flatMap((piece) => {
    const [range, stepText, extra] = piece.split('/');
    if (
      extra !== undefined ||
      (stepText !== undefined && !/^\d+$/.test(stepText))
    )
      throw new Error('无效的调度表达式');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (step < 1) throw new Error('调度步长必须大于零');
    let start: number, end: number;
    if (range === '*') {
      start = min;
      end = max;
    } else if (/^\d+-\d+$/.test(range))
      [start, end] = range.split('-').map(Number);
    else if (/^\d+$/.test(range)) {
      start = Number(range);
      end = stepText ? max : start;
    } else throw new Error('无效的调度表达式');
    if (start < min || end > max || start > end)
      throw new Error('调度表达式超出范围');
    const result: number[] = [];
    for (let value = start; value <= end; value += step) result.push(value);
    return result;
  });
}

const bounds = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];
export function validateCron(cron: string): void {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('调度表达式需要五段：分 时 日 月 周');
  parts.forEach((part, index) =>
    values(part, bounds[index][0], bounds[index][1]),
  );
}
export function matchesCronPart(pattern: string, value: number): boolean {
  try {
    return values(pattern, 0, 59).includes(value);
  } catch {
    return false;
  }
}
export function matchesCron(
  cron: string,
  now: Date,
  timezone = 'Asia/Shanghai',
): boolean {
  try {
    validateCron(cron);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    }).formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)!.value;
    const current = [
      Number(part('minute')),
      Number(part('hour')),
      Number(part('day')),
      Number(part('month')),
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
        part('weekday'),
      ),
    ];
    return cron
      .trim()
      .split(/\s+/)
      .every((pattern, index) =>
        values(pattern, bounds[index][0], bounds[index][1]).includes(
          current[index],
        ),
      );
  } catch {
    return false;
  }
}
