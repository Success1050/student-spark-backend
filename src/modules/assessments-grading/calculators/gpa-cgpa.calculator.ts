import { Injectable } from '@nestjs/common';

export interface GradeScaleBand {
  min: number;
  max: number;
  grade: string;
  point: number;
  remark?: string;
}

export interface GpaCourseItem {
  creditUnits: number;
  totalScore: number;
  letterGrade?: string;
  gradePoint?: number;
}

export interface GpaSummaryResult {
  gpa: number;
  totalUnits: number;
  totalQualityPoints: number;
  scaleMax: number;
  standing: string;
}

export const DEFAULT_5_POINT_SCALE: GradeScaleBand[] = [
  { min: 70, max: 100, grade: 'A', point: 5.0, remark: 'Excellent' },
  { min: 60, max: 69.99, grade: 'B', point: 4.0, remark: 'Very Good' },
  { min: 50, max: 59.99, grade: 'C', point: 3.0, remark: 'Good' },
  { min: 45, max: 49.99, grade: 'D', point: 2.0, remark: 'Pass' },
  { min: 40, max: 44.99, grade: 'E', point: 1.0, remark: 'Weak Pass' },
  { min: 0, max: 39.99, grade: 'F', point: 0.0, remark: 'Fail' },
];

export const DEFAULT_4_POINT_SCALE: GradeScaleBand[] = [
  { min: 75, max: 100, grade: 'A', point: 4.0, remark: 'Distinction' },
  { min: 70, max: 74.99, grade: 'AB', point: 3.5, remark: 'Very Good' },
  { min: 65, max: 69.99, grade: 'B', point: 3.25, remark: 'Good' },
  { min: 60, max: 64.99, grade: 'BC', point: 3.0, remark: 'Upper Credit' },
  { min: 55, max: 59.99, grade: 'C', point: 2.75, remark: 'Credit' },
  { min: 50, max: 54.99, grade: 'CD', point: 2.5, remark: 'Lower Credit' },
  { min: 45, max: 49.99, grade: 'D', point: 2.25, remark: 'Pass' },
  { min: 40, max: 44.99, grade: 'E', point: 2.0, remark: 'Weak Pass' },
  { min: 0, max: 39.99, grade: 'F', point: 0.0, remark: 'Fail' },
];

export const DEFAULT_WAEC_SECONDARY_SCALE: GradeScaleBand[] = [
  { min: 75, max: 100, grade: 'A1', point: 5.0, remark: 'Distinction' },
  { min: 70, max: 74.99, grade: 'B2', point: 4.5, remark: 'Very Good' },
  { min: 65, max: 69.99, grade: 'B3', point: 4.0, remark: 'Good' },
  { min: 60, max: 64.99, grade: 'C4', point: 3.5, remark: 'Credit' },
  { min: 55, max: 59.99, grade: 'C5', point: 3.0, remark: 'Credit' },
  { min: 50, max: 54.99, grade: 'C6', point: 2.5, remark: 'Credit' },
  { min: 45, max: 49.99, grade: 'D7', point: 2.0, remark: 'Pass' },
  { min: 40, max: 44.99, grade: 'E8', point: 1.0, remark: 'Pass' },
  { min: 0, max: 39.99, grade: 'F9', point: 0.0, remark: 'Fail' },
];

export const DEFAULT_PRIMARY_NURSERY_SCALE: GradeScaleBand[] = [
  { min: 75, max: 100, grade: 'A', point: 5.0, remark: 'Excellent' },
  { min: 65, max: 74.99, grade: 'B', point: 4.0, remark: 'Very Good' },
  { min: 55, max: 64.99, grade: 'C', point: 3.0, remark: 'Good' },
  { min: 45, max: 54.99, grade: 'D', point: 2.0, remark: 'Pass' },
  { min: 40, max: 44.99, grade: 'E', point: 1.0, remark: 'Fair' },
  { min: 0, max: 39.99, grade: 'F', point: 0.0, remark: 'Needs Effort' },
];

@Injectable()
export class GpaCgpaCalculator {
  getDefaultScale(schoolType?: string | null, scaleMax = 5.0): GradeScaleBand[] {
    if (schoolType === 'NURSERY' || schoolType === 'PRIMARY') {
      return DEFAULT_PRIMARY_NURSERY_SCALE;
    }
    if (schoolType === 'SECONDARY' || schoolType === 'OTHER') {
      return DEFAULT_WAEC_SECONDARY_SCALE;
    }
    return scaleMax <= 4.0 ? DEFAULT_4_POINT_SCALE : DEFAULT_5_POINT_SCALE;
  }

  resolveGradeBand(
    totalScore: number,
    customScale?: GradeScaleBand[] | null,
    scaleMax = 5.0,
    schoolType?: string | null,
  ): GradeScaleBand {
    const score = Math.max(0, Math.min(100, Number(totalScore) || 0));
    const scale =
      Array.isArray(customScale) && customScale.length > 0
        ? [...customScale].sort((a, b) => Number(b.min) - Number(a.min))
        : this.getDefaultScale(schoolType, scaleMax);

    const matched = scale.find((band) => score >= Number(band.min));
    if (matched) {
      return matched;
    }
    return scale[scale.length - 1] ?? { min: 0, max: 39.99, grade: 'F', point: 0, remark: 'Fail' };
  }

  calculateTermGpa(courses: GpaCourseItem[], scaleMax = 5.0): GpaSummaryResult {
    let totalUnits = 0;
    let totalQualityPoints = 0;

    for (const c of courses) {
      const units = Math.max(0, Number(c.creditUnits) || 0);
      if (units <= 0) continue;

      const gp =
        typeof c.gradePoint === 'number'
          ? c.gradePoint
          : this.resolveGradeBand(c.totalScore, undefined, scaleMax).point;

      totalUnits += units;
      totalQualityPoints += units * gp;
    }

    const rawGpa = totalUnits > 0 ? totalQualityPoints / totalUnits : 0;
    const gpa = Math.round(rawGpa * 100) / 100;

    return {
      gpa,
      totalUnits,
      totalQualityPoints: Math.round(totalQualityPoints * 100) / 100,
      scaleMax,
      standing: this.resolveStanding(gpa, scaleMax),
    };
  }

  calculateCumulativeCgpa(allCoursesAcrossTerms: GpaCourseItem[], scaleMax = 5.0): GpaSummaryResult {
    return this.calculateTermGpa(allCoursesAcrossTerms, scaleMax);
  }

  resolveStanding(gpa: number, scaleMax = 5.0): string {
    if (scaleMax <= 4.0) {
      if (gpa >= 3.5) return 'Distinction (First Class)';
      if (gpa >= 3.0) return 'Upper Credit (2:1)';
      if (gpa >= 2.5) return 'Lower Credit (2:2)';
      if (gpa >= 2.0) return 'Pass (Third Class)';
      return gpa > 0 ? 'Academic Probation' : 'No Result';
    }
    if (gpa >= 4.5) return 'First Class Honours';
    if (gpa >= 3.5) return 'Second Class Upper (2:1)';
    if (gpa >= 2.4) return 'Second Class Lower (2:2)';
    if (gpa >= 1.5) return 'Third Class';
    if (gpa >= 1.0) return 'Pass';
    return gpa > 0 ? 'Academic Probation' : 'No Result';
  }
}
