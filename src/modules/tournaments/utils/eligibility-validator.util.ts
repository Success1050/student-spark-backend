/**
 * Deterministic Eligibility & Anti-Cheat Profile Verification for Inter-School
 * Tournaments and Academic Olympiads.
 *
 * Ensures students cannot impersonate departments, classes, levels, or
 * institution types outside their verified DB StudentProfile.
 */

export interface StudentEligibilityContext {
  role: string;
  schoolId: string | null;
  schoolName?: string | null;
  institutionType?: string | null;
  academicStatus?: string | null;
  level?: string | null;
  className?: string | null;
  classLevelCode?: string | null;
  departmentName?: string | null;
  departmentCode?: string | null;
  matricOrAdmissionNo?: string | null;
}

export interface TournamentEligibilityRules {
  targetInstitutionTypes: string[];
  allowedDepartments: string[];
  allowedLevels: string[];
  allowIndependentLearners: boolean;
}

export interface EligibilityEvaluationResult {
  eligible: boolean;
  reasons: string[];
  verifiedSnapshot: {
    institutionType: string | null;
    departmentName: string | null;
    levelOrClass: string | null;
    matricOrAdmissionNo: string | null;
  };
}

/**
 * Normalizes Nigerian academic levels and class names into canonical tokens:
 * - "EEE 200 Level", "200 LVL", "200L" -> "200L"
 * - "ND 1", "ND1" -> "ND 1"
 * - "HND 2", "HND2" -> "HND 2"
 * - "JSS 2A", "JS 2B" -> "JSS 2"
 * - "SS 1 Science", "SSS 1" -> "SS 1"
 * - "Primary 4A", "Pry 4" -> "PRIMARY 4"
 */
export function normalizeLevelToken(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (!s) return null;

  const hndMatch = s.match(/\bHND\s*([1-2])\b/i);
  if (hndMatch) return `HND ${hndMatch[1]}`;

  const ndMatch = s.match(/\bND\s*([1-2])\b/i);
  if (ndMatch) return `ND ${ndMatch[1]}`;

  const nceMatch = s.match(/\bNCE\s*([1-3])\b/i);
  if (nceMatch) return `NCE ${nceMatch[1]}`;

  const uniLevelMatch = s.match(/\b([1-6]00)\s*(?:L|LVL|LEVEL)?(?![0-9])/i);
  if (uniLevelMatch) return `${uniLevelMatch[1]}L`;

  const jssMatch = s.match(/\b(?:JSS|JS)\s*([1-3])(?![0-9])/i);
  if (jssMatch) return `JSS ${jssMatch[1]}`;

  const sssMatch = s.match(/\b(?:SSS|SS)\s*([1-3])(?![0-9])/i);
  if (sssMatch) return `SS ${sssMatch[1]}`;

  const pryMatch = s.match(/\b(?:PRIMARY|PRY)\s*([1-6])(?![0-9])/i);
  if (pryMatch) return `PRIMARY ${pryMatch[1]}`;

  return s.replace(/\s+/g, ' ');
}

const DEPARTMENT_STOP_WORDS = new Set(['AND', 'OF', 'THE', 'IN', 'FOR', 'DEPARTMENT', 'DEPT']);

/**
 * Extracts normalized uppercase tokens from department names and codes.
 * e.g. "Electrical & Electronic Engineering" + "EEE" -> ["EEE", "ELECTRICAL", "ELECTRONIC", "ENGINEERING"]
 */
export function normalizeDepartmentTokens(
  deptName?: string | null,
  deptCode?: string | null,
): string[] {
  const tokens = new Set<string>();
  const addFromText = (txt?: string | null) => {
    if (!txt) return;
    const upper = txt.toUpperCase().trim();
    if (!upper) return;
    tokens.add(upper);
    for (const word of upper.split(/[^A-Z0-9]+/)) {
      if (word.length >= 2 && !DEPARTMENT_STOP_WORDS.has(word)) {
        tokens.add(word);
      }
    }
  };
  addFromText(deptCode);
  addFromText(deptName);
  return Array.from(tokens);
}

export function evaluateStudentEligibility(
  rules: TournamentEligibilityRules,
  ctx: StudentEligibilityContext,
): EligibilityEvaluationResult {
  const reasons: string[] = [];

  const rawLevelOrClass = ctx.className || ctx.level || ctx.classLevelCode || null;
  const verifiedSnapshot = {
    institutionType: ctx.schoolId ? ctx.institutionType || 'SCHOOL' : 'INDEPENDENT',
    departmentName: ctx.departmentName || ctx.departmentCode || null,
    levelOrClass: rawLevelOrClass,
    matricOrAdmissionNo: ctx.matricOrAdmissionNo || null,
  };

  if (ctx.role !== 'STUDENT') {
    reasons.push('Only Student accounts can compete in Olympiad rounds.');
  }

  if (ctx.academicStatus === 'GRADUATED' || ctx.academicStatus === 'WITHDRAWN') {
    reasons.push(`Account status (${ctx.academicStatus}) is ineligible for active Olympiads.`);
  }

  // Independent vs School tenant check
  if (!ctx.schoolId) {
    if (!rules.allowIndependentLearners) {
      reasons.push('This Inter-School Olympiad requires verified enrollment at a participating school.');
    }
  } else if (rules.targetInstitutionTypes.length > 0) {
    const allowedInst = new Set(rules.targetInstitutionTypes.map((t) => t.trim().toUpperCase()));
    const studentInst = String(ctx.institutionType || '').trim().toUpperCase();
    if (!studentInst || !allowedInst.has(studentInst)) {
      reasons.push(
        `Restricted to ${rules.targetInstitutionTypes.join(', ')} students (your school is ${studentInst || 'unverified'}).`,
      );
    }
  }

  // Strict Department validation (when tournament restricts departments)
  if (rules.allowedDepartments.length > 0) {
    const studentDeptTokens = normalizeDepartmentTokens(ctx.departmentName, ctx.departmentCode);
    const fullDeptLower = `${ctx.departmentName || ''} ${ctx.departmentCode || ''}`
      .trim()
      .toUpperCase();

    const matchedDept = rules.allowedDepartments.some((allowed) => {
      const target = allowed.trim().toUpperCase();
      if (!target) return false;
      if (studentDeptTokens.includes(target)) return true;
      if (fullDeptLower && fullDeptLower.includes(target)) return true;
      const targetTokens = normalizeDepartmentTokens(target, null);
      return (
        targetTokens.length > 0 &&
        targetTokens.every((t) => studentDeptTokens.includes(t))
      );
    });

    if (!matchedDept) {
      reasons.push(
        `Department mismatch: requires [${rules.allowedDepartments.join(', ')}], verified record shows "${verifiedSnapshot.departmentName || 'None'}".`,
      );
    }
  }

  // Strict Level / Class validation (when tournament restricts levels)
  if (rules.allowedLevels.length > 0) {
    const candidates = [
      normalizeLevelToken(ctx.level),
      normalizeLevelToken(ctx.className),
      normalizeLevelToken(ctx.classLevelCode),
    ].filter((x): x is string => Boolean(x));

    const allowedNormalized = rules.allowedLevels
      .map((l) => normalizeLevelToken(l))
      .filter((x): x is string => Boolean(x));

    const matchedLevel = candidates.some((c) => allowedNormalized.includes(c));
    if (!matchedLevel) {
      reasons.push(
        `Level/Class mismatch: requires [${rules.allowedLevels.join(', ')}], verified record shows "${rawLevelOrClass || 'Unassigned'}".`,
      );
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    verifiedSnapshot,
  };
}
