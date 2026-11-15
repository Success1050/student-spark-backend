export type CalendarBreakKind = 'HOLIDAY' | 'MID_TERM' | 'OTHER';

export interface CalendarBreakInput {
  id?: string;
  title: string;
  type: CalendarBreakKind;
  startDate: Date | string;
  endDate: Date | string;
  description?: string | null;
}

export interface TermCalendarComputation {
  effectiveStartDate: string;
  termCreatedDate: string;
  customStartDate: string | null;
  vacationDate: string | null;
  nextTermResumesDate: string | null;
  formattedVacationDate: string | null;
  formattedResumptionDate: string | null;
  countingThroughDate: string;
  totalWeekdaysElapsed: number;
  holidayDaysSubtracted: number;
  midTermDaysSubtracted: number;
  otherDaysSubtracted: number;
  breakDaysSubtracted: number;
  daysSchoolOpened: number;
  projectedTotalSchoolDays: number | null;
}

export function toUtcDateKey(input: Date | string): string {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}/.test(input.trim())) {
    return input.trim().slice(0, 10);
  }
  const d = input instanceof Date ? input : new Date(input);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseUtcDateFromKey(key: string): Date {
  const [y, m, d] = key.slice(0, 10).split('-').map((n) => Number(n));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0, 0));
}

export function formatReadableDateFromKey(key?: string | null): string | null {
  if (!key) return null;
  const d = parseUtcDateFromKey(key);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function isWeekday(d: Date): boolean {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

function buildExcludedDayMap(
  events: CalendarBreakInput[],
): Map<string, CalendarBreakKind> {
  const excluded = new Map<string, CalendarBreakKind>();
  for (const ev of events) {
    const startKey = toUtcDateKey(ev.startDate);
    const endKey = toUtcDateKey(ev.endDate);
    const s = parseUtcDateFromKey(startKey);
    const e = parseUtcDateFromKey(endKey);
    if (s.getTime() > e.getTime()) continue;

    const cursor = new Date(s.getTime());
    let guard = 0;
    while (cursor.getTime() <= e.getTime() && guard < 400) {
      guard += 1;
      if (isWeekday(cursor)) {
        const key = toUtcDateKey(cursor);
        // Prefer MID_TERM > HOLIDAY > OTHER if overlapping
        const existing = excluded.get(key);
        if (
          !existing ||
          (existing === 'OTHER' && ev.type !== 'OTHER') ||
          (existing === 'HOLIDAY' && ev.type === 'MID_TERM')
        ) {
          excluded.set(key, ev.type);
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return excluded;
}

function countRange(
  startKey: string,
  endKey: string,
  excludedMap: Map<string, CalendarBreakKind>,
) {
  const s = parseUtcDateFromKey(startKey);
  const e = parseUtcDateFromKey(endKey);
  if (s.getTime() > e.getTime()) {
    return {
      totalWeekdays: 0,
      holidayDays: 0,
      midTermDays: 0,
      otherDays: 0,
      breakDays: 0,
      openedDays: 0,
    };
  }

  let totalWeekdays = 0;
  let holidayDays = 0;
  let midTermDays = 0;
  let otherDays = 0;

  const cursor = new Date(s.getTime());
  let guard = 0;
  while (cursor.getTime() <= e.getTime() && guard < 400) {
    guard += 1;
    if (isWeekday(cursor)) {
      totalWeekdays += 1;
      const key = toUtcDateKey(cursor);
      const breakKind = excludedMap.get(key);
      if (breakKind === 'HOLIDAY') holidayDays += 1;
      else if (breakKind === 'MID_TERM') midTermDays += 1;
      else if (breakKind === 'OTHER') otherDays += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const breakDays = holidayDays + midTermDays + otherDays;
  return {
    totalWeekdays,
    holidayDays,
    midTermDays,
    otherDays,
    breakDays,
    openedDays: Math.max(0, totalWeekdays - breakDays),
  };
}

export function computeTermCalendarMetrics(params: {
  createdAt: Date | string;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  nextTermResumesDate?: Date | string | null;
  events: CalendarBreakInput[];
  asOfDate?: Date;
}): TermCalendarComputation {
  const termCreatedDate = toUtcDateKey(params.createdAt);
  const customStartDate = params.startDate
    ? toUtcDateKey(params.startDate)
    : null;
  const effectiveStartDate = customStartDate ?? termCreatedDate;

  const vacationDate = params.endDate ? toUtcDateKey(params.endDate) : null;
  const nextTermResumesDate = params.nextTermResumesDate
    ? toUtcDateKey(params.nextTermResumesDate)
    : null;

  const todayKey = toUtcDateKey(params.asOfDate ?? new Date());
  const countingThroughDate =
    vacationDate && vacationDate < todayKey ? vacationDate : todayKey;

  const excludedMap = buildExcludedDayMap(params.events || []);
  const elapsed = countRange(
    effectiveStartDate,
    countingThroughDate,
    excludedMap,
  );

  const projected = vacationDate
    ? countRange(effectiveStartDate, vacationDate, excludedMap)
    : null;

  return {
    effectiveStartDate,
    termCreatedDate,
    customStartDate,
    vacationDate,
    nextTermResumesDate,
    formattedVacationDate: formatReadableDateFromKey(vacationDate),
    formattedResumptionDate: formatReadableDateFromKey(nextTermResumesDate),
    countingThroughDate,
    totalWeekdaysElapsed: elapsed.totalWeekdays,
    holidayDaysSubtracted: elapsed.holidayDays,
    midTermDaysSubtracted: elapsed.midTermDays,
    otherDaysSubtracted: elapsed.otherDays,
    breakDaysSubtracted: elapsed.breakDays,
    daysSchoolOpened: elapsed.openedDays,
    projectedTotalSchoolDays: projected ? projected.openedDays : null,
  };
}
