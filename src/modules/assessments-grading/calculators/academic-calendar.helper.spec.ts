import {
  computeTermCalendarMetrics,
  formatReadableDateFromKey,
} from './academic-calendar.helper';

describe('academic-calendar.helper', () => {
  it('defaults term start to createdAt, counts Mon-Fri, and subtracts holidays & mid-term breaks without double counting overlaps or weekends', () => {
    // Term created Monday 2026-09-07; asOf Wednesday 2026-09-23
    // Mon-Fri days between Sep 7 and Sep 23 inclusive = 13 weekdays (5 + 5 + 3)
    // Events:
    // - Mid-term: Thu 2026-09-10 to Mon 2026-09-14 (Thu, Fri, Mon = 3 weekdays)
    // - Public holiday: Tue 2026-09-22 (1 weekday)
    // Overlapping holiday on Fri 2026-09-11 must not double subtract.
    const result = computeTermCalendarMetrics({
      createdAt: new Date('2026-09-07T09:15:00.000Z'),
      startDate: null,
      endDate: new Date('2026-12-18T00:00:00.000Z'),
      nextTermResumesDate: new Date('2027-01-11T00:00:00.000Z'),
      asOfDate: new Date('2026-09-23T14:00:00.000Z'),
      events: [
        {
          title: 'Mid-Term Break',
          type: 'MID_TERM',
          startDate: '2026-09-10',
          endDate: '2026-09-14',
        },
        {
          title: 'Special Assembly Holiday (Overlap)',
          type: 'HOLIDAY',
          startDate: '2026-09-11',
          endDate: '2026-09-11',
        },
        {
          title: 'Founders Day',
          type: 'HOLIDAY',
          startDate: '2026-09-22',
          endDate: '2026-09-22',
        },
      ],
    });

    expect(result.effectiveStartDate).toBe('2026-09-07');
    expect(result.customStartDate).toBeNull();
    expect(result.totalWeekdaysElapsed).toBe(13);
    expect(result.midTermDaysSubtracted).toBe(3);
    expect(result.holidayDaysSubtracted).toBe(1);
    expect(result.breakDaysSubtracted).toBe(4);
    expect(result.daysSchoolOpened).toBe(9);
    expect(result.formattedVacationDate).toBe(
      formatReadableDateFromKey('2026-12-18'),
    );
    expect(result.formattedResumptionDate).toBe(
      formatReadableDateFromKey('2027-01-11'),
    );
  });

  it('uses custom startDate when set and stops elapsed counting at vacationDate once passed', () => {
    const result = computeTermCalendarMetrics({
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
      startDate: new Date('2026-09-14T00:00:00.000Z'),
      endDate: new Date('2026-09-18T00:00:00.000Z'),
      asOfDate: new Date('2026-10-05T10:00:00.000Z'),
      events: [
        {
          title: 'Independence Holiday',
          type: 'HOLIDAY',
          startDate: '2026-09-16',
          endDate: '2026-09-16',
        },
      ],
    });

    expect(result.effectiveStartDate).toBe('2026-09-14');
    expect(result.countingThroughDate).toBe('2026-09-18');
    expect(result.totalWeekdaysElapsed).toBe(5);
    expect(result.breakDaysSubtracted).toBe(1);
    expect(result.daysSchoolOpened).toBe(4);
    expect(result.projectedTotalSchoolDays).toBe(4);
  });
});
