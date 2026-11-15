import { Injectable } from '@nestjs/common';
import { GpaCgpaCalculator, GradeScaleBand } from './gpa-cgpa.calculator.js';

export type ComponentRole = 'CA' | 'EXAM';
export type CaCalculationMode = 'DIRECT_SUM' | 'CA_POOL_SCALED';

export interface AssessmentComponentConfig {
  key: string;
  label: string;
  maxScore: number;
  role?: ComponentRole;
  isOptional?: boolean;
}

export interface AssessmentSchemeConfig {
  caMode: CaCalculationMode;
  caWeightTotal: number;
  examWeightTotal: number;
  components: AssessmentComponentConfig[];
}

export interface RankedStudentScore {
  studentId: string;
  totalScore: number;
  positionNumber: number;
  positionOrdinal: string; // e.g. '1st', '2nd', '3rd'
  letterGrade: string;
  gradePoint: number;
  remark: string;
}

export const DEFAULT_SECONDARY_COMPONENTS: AssessmentComponentConfig[] = [
  { key: 'ca1', label: '1st CA Test', maxScore: 20, role: 'CA', isOptional: false },
  { key: 'ca2', label: '2nd CA Test', maxScore: 10, role: 'CA', isOptional: true },
  { key: 'assignment', label: 'Homework / Notes', maxScore: 10, role: 'CA', isOptional: true },
  { key: 'exam', label: 'Terminal Exam', maxScore: 60, role: 'EXAM', isOptional: false },
];

export const DEFAULT_PRIMARY_COMPONENTS: AssessmentComponentConfig[] = [
  { key: 'ca1', label: '1st CA / Classwork', maxScore: 20, role: 'CA', isOptional: false },
  { key: 'ca2', label: '2nd CA / Mid-Term', maxScore: 20, role: 'CA', isOptional: true },
  { key: 'exam', label: 'Terminal Exam', maxScore: 60, role: 'EXAM', isOptional: false },
];

export const DEFAULT_TERTIARY_COMPONENTS: AssessmentComponentConfig[] = [
  { key: 'ca1', label: 'Quiz 1', maxScore: 15, role: 'CA', isOptional: false },
  { key: 'ca2', label: 'Take-Home / Quiz 2', maxScore: 15, role: 'CA', isOptional: true },
  { key: 'exam', label: 'Semester Exam', maxScore: 70, role: 'EXAM', isOptional: false },
];

/**
 * Automated Score & Position Ranking Engine with Granular CA Slots & Custom Boundaries
 * Handles:
 * - Unlimited configurable CA test slots + optional CA slots (unused slots don't penalize!)
 * - Two modes:
 *   1) CA_POOL_SCALED: Any number of CA test slots (e.g. CA1/20, CA2/20, CA3/10) scale into CA Weight (e.g. 40%) + Exam Weight (e.g. 60%)
 *   2) DIRECT_SUM: Fixed additive column weights adding up to 100%
 * - Custom Grade Boundaries (WAEC A1-F9, Standard A-F, University 5.0 / Polytechnic 4.0)
 * - Automatic Subject & Overall Class Position ranking (1st, 2nd, 3rd...) with tie handling
 */
@Injectable()
export class PositionRankingCalculator {
  constructor(private readonly gpaCalculator: GpaCgpaCalculator) {}

  inferComponentRole(comp: AssessmentComponentConfig): ComponentRole {
    if (comp.role === 'CA' || comp.role === 'EXAM') return comp.role;
    const text = `${comp.key} ${comp.label}`.toLowerCase();
    return text.includes('exam') ? 'EXAM' : 'CA';
  }

  getDefaultScheme(schoolType?: string | null): AssessmentSchemeConfig {
    if (schoolType === 'NURSERY' || schoolType === 'PRIMARY') {
      return {
        caMode: 'CA_POOL_SCALED',
        caWeightTotal: 40,
        examWeightTotal: 60,
        components: DEFAULT_PRIMARY_COMPONENTS.map((c) => ({ ...c })),
      };
    }
    if (schoolType === 'SECONDARY' || schoolType === 'OTHER') {
      return {
        caMode: 'CA_POOL_SCALED',
        caWeightTotal: 40,
        examWeightTotal: 60,
        components: DEFAULT_SECONDARY_COMPONENTS.map((c) => ({ ...c })),
      };
    }
    return {
      caMode: 'CA_POOL_SCALED',
      caWeightTotal: 30,
      examWeightTotal: 70,
      components: DEFAULT_TERTIARY_COMPONENTS.map((c) => ({ ...c })),
    };
  }

  getDefaultComponents(schoolType?: string | null): AssessmentComponentConfig[] {
    return this.getDefaultScheme(schoolType).components;
  }

  normalizeStoredComponents(
    rawJson: any,
    schoolType?: string | null,
  ): AssessmentSchemeConfig {
    const fallback = this.getDefaultScheme(schoolType);
    if (!rawJson) return fallback;

    if (Array.isArray(rawJson)) {
      const comps = rawJson.map((c) => ({
        key: String(c.key),
        label: String(c.label),
        maxScore: Number(c.maxScore) || 0,
        role: this.inferComponentRole(c),
        isOptional: Boolean(c.isOptional),
      }));
      const sum = comps.reduce((acc, c) => acc + c.maxScore, 0);
      const examSum = comps
        .filter((c) => c.role === 'EXAM')
        .reduce((acc, c) => acc + c.maxScore, 0);
      const examWeightTotal =
        examSum > 0 && examSum < 100 ? examSum : fallback.examWeightTotal;
      return {
        caMode: sum === 100 ? 'DIRECT_SUM' : 'CA_POOL_SCALED',
        caWeightTotal: Math.max(0, 100 - examWeightTotal),
        examWeightTotal,
        components: comps,
      };
    }

    if (typeof rawJson === 'object' && Array.isArray(rawJson.components)) {
      const comps = rawJson.components.map((c: any) => ({
        key: String(c.key),
        label: String(c.label),
        maxScore: Number(c.maxScore) || 0,
        role: this.inferComponentRole(c),
        isOptional: Boolean(c.isOptional),
      }));
      const examWeightTotal =
        typeof rawJson.examWeightTotal === 'number'
          ? rawJson.examWeightTotal
          : fallback.examWeightTotal;
      const caWeightTotal =
        typeof rawJson.caWeightTotal === 'number'
          ? rawJson.caWeightTotal
          : Math.max(0, 100 - examWeightTotal);
      return {
        caMode:
          rawJson.caMode === 'DIRECT_SUM' ? 'DIRECT_SUM' : 'CA_POOL_SCALED',
        caWeightTotal,
        examWeightTotal,
        components: comps,
      };
    }

    return fallback;
  }

  formatOrdinal(rank: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = rank % 100;
    return rank + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  computeComponentTotal(
    scoresJson: Record<string, any> | null | undefined,
    components?: AssessmentComponentConfig[] | null,
    options?: {
      caMode?: CaCalculationMode;
      caWeightTotal?: number;
      examWeightTotal?: number;
      activeSlotKeys?: Set<string>;
    },
  ): {
    sanitizedScores: Record<string, number | null>;
    caScaledScore: number;
    examScaledScore: number;
    totalScore: number;
  } {
    const input = scoresJson && typeof scoresJson === 'object' ? scoresJson : {};
    const sanitizedScores: Record<string, number | null> = {};

    if (!Array.isArray(components) || components.length === 0) {
      let sum = 0;
      for (const [k, v] of Object.entries(input)) {
        if (v === null || v === undefined || v === '') continue;
        const raw = Number(v);
        const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
        const rounded = Math.round(clamped * 100) / 100;
        sanitizedScores[k] = rounded;
        sum += rounded;
      }
      const totalScore = Math.round(Math.max(0, Math.min(100, sum)) * 100) / 100;
      return { sanitizedScores, caScaledScore: 0, examScaledScore: totalScore, totalScore };
    }

    const caMode = options?.caMode ?? 'DIRECT_SUM';
    const caWeightTotal = options?.caWeightTotal ?? 40;
    const examWeightTotal = options?.examWeightTotal ?? 60;

    let rawCaEarned = 0;
    let rawCaMax = 0;
    let rawExamEarned = 0;
    let rawExamMax = 0;
    let directSum = 0;

    for (const comp of components) {
      const maxVal = Math.max(1, Number(comp.maxScore) || 100);
      const rawVal = input[comp.key];
      const hasEntry =
        rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '';

      const role = this.inferComponentRole(comp);

      if (!hasEntry) {
        sanitizedScores[comp.key] = null;
        if (role === 'CA') {
          const unusedGlobally =
            options?.activeSlotKeys && !options.activeSlotKeys.has(comp.key);
          // Optional CA slots or slots unused by the entire class are skipped from denominator
          if (comp.isOptional || unusedGlobally) {
            continue;
          }
          rawCaMax += maxVal;
        } else {
          rawExamMax += maxVal;
        }
        continue;
      }

      const num = Number(rawVal);
      const clamped = Number.isFinite(num)
        ? Math.max(0, Math.min(maxVal, num))
        : 0;
      const rounded = Math.round(clamped * 100) / 100;
      sanitizedScores[comp.key] = rounded;
      directSum += rounded;

      if (role === 'CA') {
        rawCaEarned += rounded;
        rawCaMax += maxVal;
      } else {
        rawExamEarned += rounded;
        rawExamMax += maxVal;
      }
    }

    if (caMode === 'CA_POOL_SCALED') {
      const caScaledScore =
        rawCaMax > 0
          ? Math.round((rawCaEarned / rawCaMax) * caWeightTotal * 100) / 100
          : 0;
      const examScaledScore =
        rawExamMax > 0
          ? Math.round((rawExamEarned / rawExamMax) * examWeightTotal * 100) / 100
          : 0;
      const totalScore =
        Math.round(
          Math.max(0, Math.min(100, caScaledScore + examScaledScore)) * 100,
        ) / 100;
      return { sanitizedScores, caScaledScore, examScaledScore, totalScore };
    }

    const totalScore =
      Math.round(Math.max(0, Math.min(100, directSum)) * 100) / 100;
    return {
      sanitizedScores,
      caScaledScore: Math.round(rawCaEarned * 100) / 100,
      examScaledScore: Math.round(rawExamEarned * 100) / 100,
      totalScore,
    };
  }

  rankStudentsWithTies(
    scores: Array<{ studentId: string; totalScore: number }>,
    options?: {
      customScale?: GradeScaleBand[] | null;
      scaleMax?: number;
      schoolType?: string | null;
    },
  ): RankedStudentScore[] {
    const normalized = scores.map((s) => ({
      studentId: s.studentId,
      totalScore: Math.round((Number(s.totalScore) || 0) * 100) / 100,
    }));

    const sorted = [...normalized].sort((a, b) => b.totalScore - a.totalScore);
    let currentRank = 1;

    return sorted.map((entry, idx) => {
      if (idx > 0 && entry.totalScore < sorted[idx - 1].totalScore) {
        currentRank = idx + 1;
      }
      const band = this.gpaCalculator.resolveGradeBand(
        entry.totalScore,
        options?.customScale,
        options?.scaleMax ?? 5.0,
        options?.schoolType,
      );
      return {
        studentId: entry.studentId,
        totalScore: entry.totalScore,
        positionNumber: currentRank,
        positionOrdinal: this.formatOrdinal(currentRank),
        letterGrade: band.grade,
        gradePoint: band.point,
        remark: band.remark ?? '',
      };
    });
  }
}
