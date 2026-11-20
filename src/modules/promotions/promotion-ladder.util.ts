/**
 * Smart Nigerian Academic Progression Ladder Resolver (Basic, Secondary & Tertiary)
 *
 * Recognizes real-world Nigerian school class & level naming patterns:
 * - Creche / Playgroup -> Nursery 1 -> Nursery 2 -> KG 1 -> KG 2 -> Primary 1..6 -> JSS 1..3 -> SS 1..3 -> Graduated Alumni
 * - 100L -> 200L -> 300L -> 400L -> 500L -> 600L -> Graduated Alumni (preserving dept prefix like "EEE 200 Level -> EEE 300 Level")
 * - ND 1 -> ND 2 (-> HND 1 or Graduated), HND 1 -> HND 2 -> Graduated, NCE 1..3 -> Graduated
 *
 * Preserves arm suffixes (e.g. "Primary 2A" -> "Primary 3A", "JSS 1B" -> "JSS 2B", "SS 1 Science" -> "SS 2 Science").
 */

export interface ClassProgressionInfo {
  ladderRank: number; // Higher = more senior; used to sort Top-Down so senior classes move before juniors
  nextClassName: string | null;
  nextLevelCode: string | null;
  isGraduatingClass: boolean;
  armSuffix: string;
  stageLabel: string;
}

export interface SimpleSchoolClass {
  id: string;
  name: string;
  levelCode?: string | null;
  departmentId?: string | null;
}

function normalizeSpace(val: string): string {
  return val.trim().replace(/\s+/g, ' ');
}

/**
 * Inspects a single class name (plus context about whether the school has KG, JSS, SS, HND, 500L/600L)
 * and returns its ladder rank and natural next class name / graduation status.
 */
export function resolveClassProgression(
  className: string,
  allSchoolClassNames: string[],
  isTertiary: boolean,
): ClassProgressionInfo {
  const clean = normalizeSpace(className);
  const upperAll = allSchoolClassNames.map((n) => normalizeSpace(n).toUpperCase());

  const schoolHasKg = upperAll.some((n) => /\b(KG|KINDERGARTEN|RECEPTION)/.test(n));
  const schoolHasJss = upperAll.some((n) => /\b(JSS|JS)\s*1(?![0-9])/.test(n));
  const schoolHasSss = upperAll.some((n) => /\b(SSS|SS)\s*1(?![0-9])/.test(n));
  const schoolHasHnd = upperAll.some((n) => /\bHND\s*1(?![0-9])/.test(n));
  const schoolHas500L = upperAll.some((n) => /\b500\s*(L|LVL|LEVEL)\b/.test(n));
  const schoolHas600L = upperAll.some((n) => /\b600\s*(L|LVL|LEVEL)\b/.test(n));

  // 1. Tertiary: e.g. "EEE 200 Level", "CSC 300L", "200 LVL", "100L"
  const tertiaryLevelMatch = clean.match(/^(.*?)\b(100|200|300|400|500|600)\s*(L|LVL|LEVEL)\b(.*)$/i);
  if (tertiaryLevelMatch) {
    const prefix = tertiaryLevelMatch[1].trim();
    const num = parseInt(tertiaryLevelMatch[2], 10);
    const unitRaw = tertiaryLevelMatch[3];
    const suffix = tertiaryLevelMatch[4].trim();
    const maxLevel = schoolHas600L ? 600 : schoolHas500L ? 500 : 400;
    const rank = 30 + num / 100; // 31..36

    if (num >= maxLevel) {
      return {
        ladderRank: rank,
        nextClassName: null,
        nextLevelCode: 'ALUMNI',
        isGraduatingClass: true,
        armSuffix: suffix,
        stageLabel: 'Final Year (Graduating)',
      };
    }

    const nextNum = num + 100;
    const unitFormatted =
      unitRaw.toUpperCase() === 'L'
        ? 'L'
        : unitRaw.toUpperCase() === 'LVL'
          ? ' LVL'
          : ' Level';
    const nextCore = `${nextNum}${unitFormatted}`;
    const nextName = normalizeSpace([prefix, nextCore, suffix].filter(Boolean).join(' '));
    return {
      ladderRank: rank,
      nextClassName: nextName,
      nextLevelCode: `${nextNum}L`,
      isGraduatingClass: false,
      armSuffix: suffix,
      stageLabel: `${num} Level`,
    };
  }

  // 2. Polytechnic / College: ND 1/2, OND 1/2, HND 1/2, NCE 1/2/3
  const diplomaMatch = clean.match(/^(.*?)\b(OND|ND|HND|NCE)\s*([1-3])\b(.*)$/i);
  if (diplomaMatch) {
    const prefix = diplomaMatch[1].trim();
    const prog = diplomaMatch[2].toUpperCase();
    const num = parseInt(diplomaMatch[3], 10);
    const suffix = diplomaMatch[4].trim();

    if (prog === 'ND' || prog === 'OND') {
      if (num === 1) {
        return {
          ladderRank: 21,
          nextClassName: normalizeSpace([prefix, `${prog} 2`, suffix].filter(Boolean).join(' ')),
          nextLevelCode: `${prog} 2`,
          isGraduatingClass: false,
          armSuffix: suffix,
          stageLabel: `${prog} 1`,
        };
      }
      if (schoolHasHnd) {
        return {
          ladderRank: 22,
          nextClassName: normalizeSpace([prefix, 'HND 1', suffix].filter(Boolean).join(' ')),
          nextLevelCode: 'HND 1',
          isGraduatingClass: false,
          armSuffix: suffix,
          stageLabel: `${prog} 2`,
        };
      }
      return {
        ladderRank: 22,
        nextClassName: null,
        nextLevelCode: 'ALUMNI',
        isGraduatingClass: true,
        armSuffix: suffix,
        stageLabel: `${prog} 2 (Graduating)`,
      };
    }

    if (prog === 'HND') {
      if (num === 1) {
        return {
          ladderRank: 23,
          nextClassName: normalizeSpace([prefix, 'HND 2', suffix].filter(Boolean).join(' ')),
          nextLevelCode: 'HND 2',
          isGraduatingClass: false,
          armSuffix: suffix,
          stageLabel: 'HND 1',
        };
      }
      return {
        ladderRank: 24,
        nextClassName: null,
        nextLevelCode: 'ALUMNI',
        isGraduatingClass: true,
        armSuffix: suffix,
        stageLabel: 'HND 2 (Graduating)',
      };
    }

    if (prog === 'NCE') {
      if (num < 3) {
        return {
          ladderRank: 20 + num,
          nextClassName: normalizeSpace([prefix, `NCE ${num + 1}`, suffix].filter(Boolean).join(' ')),
          nextLevelCode: `NCE ${num + 1}`,
          isGraduatingClass: false,
          armSuffix: suffix,
          stageLabel: `NCE ${num}`,
        };
      }
      return {
        ladderRank: 23,
        nextClassName: null,
        nextLevelCode: 'ALUMNI',
        isGraduatingClass: true,
        armSuffix: suffix,
        stageLabel: 'NCE 3 (Graduating)',
      };
    }
  }

  // 3. Senior Secondary: SS 1..3 / SSS 1..3 (handles "SS 1A", "SS2B", "SSS 1 Science")
  const ssMatch = clean.match(/^(SSS|SS)\s*([1-3])(.*)$/i);
  if (ssMatch) {
    const label = ssMatch[1].toUpperCase();
    const num = parseInt(ssMatch[2], 10);
    const arm = ssMatch[3] || '';
    const rank = 15 + num; // 16..18
    if (num >= 3) {
      return {
        ladderRank: rank,
        nextClassName: null,
        nextLevelCode: 'ALUMNI',
        isGraduatingClass: true,
        armSuffix: arm.trim(),
        stageLabel: 'Senior Secondary (Graduating)',
      };
    }
    return {
      ladderRank: rank,
      nextClassName: normalizeSpace(`${label} ${num + 1}${arm}`),
      nextLevelCode: `${label} ${num + 1}`,
      isGraduatingClass: false,
      armSuffix: arm.trim(),
      stageLabel: 'Senior Secondary',
    };
  }

  // 4. Junior Secondary: JSS 1..3 / JS 1..3 (handles "JSS 1A", "JSS2A")
  const jssMatch = clean.match(/^(JSS|JS)\s*([1-3])(.*)$/i);
  if (jssMatch) {
    const label = jssMatch[1].toUpperCase();
    const num = parseInt(jssMatch[2], 10);
    const arm = jssMatch[3] || '';
    const rank = 12 + num; // 13..15
    if (num < 3) {
      return {
        ladderRank: rank,
        nextClassName: normalizeSpace(`${label} ${num + 1}${arm}`),
        nextLevelCode: `${label} ${num + 1}`,
        isGraduatingClass: false,
        armSuffix: arm.trim(),
        stageLabel: 'Junior Secondary',
      };
    }
    if (schoolHasSss) {
      return {
        ladderRank: rank,
        nextClassName: normalizeSpace(`SS 1${arm}`),
        nextLevelCode: 'SS 1',
        isGraduatingClass: false,
        armSuffix: arm.trim(),
        stageLabel: 'Junior Secondary → SSS',
      };
    }
    return {
      ladderRank: rank,
      nextClassName: null,
      nextLevelCode: 'ALUMNI',
      isGraduatingClass: true,
      armSuffix: arm.trim(),
      stageLabel: 'JSS 3 (Graduating)',
    };
  }

  // 5. Primary / Basic / Grade: Primary 1..6, Pry 1..6, Basic 1..6, Grade 1..6
  const pryMatch = clean.match(/^(Primary|Pry|Basic|Grade)\s*([1-6])(.*)$/i);
  if (pryMatch) {
    const labelRaw = pryMatch[1];
    const label = labelRaw.charAt(0).toUpperCase() + labelRaw.slice(1).toLowerCase();
    const num = parseInt(pryMatch[2], 10);
    const arm = pryMatch[3] || '';
    const rank = 6 + num; // 7..12
    if (num < 6) {
      return {
        ladderRank: rank,
        nextClassName: normalizeSpace(`${label} ${num + 1}${arm}`),
        nextLevelCode: `${label} ${num + 1}`,
        isGraduatingClass: false,
        armSuffix: arm.trim(),
        stageLabel: 'Primary',
      };
    }
    if (schoolHasJss) {
      return {
        ladderRank: rank,
        nextClassName: normalizeSpace(`JSS 1${arm}`),
        nextLevelCode: 'JSS 1',
        isGraduatingClass: false,
        armSuffix: arm.trim(),
        stageLabel: 'Primary → JSS',
      };
    }
    return {
      ladderRank: rank,
      nextClassName: null,
      nextLevelCode: 'ALUMNI',
      isGraduatingClass: true,
      armSuffix: arm.trim(),
      stageLabel: 'Primary 6 (Graduating)',
    };
  }

  // 6. Kindergarten / Reception
  const kgMatch = clean.match(/^(KG|Kindergarten|Reception)\s*([1-2])?(.*)$/i);
  if (kgMatch) {
    const label = kgMatch[1].toUpperCase() === 'KG' ? 'KG' : kgMatch[1];
    const num = kgMatch[2] ? parseInt(kgMatch[2], 10) : 1;
    const arm = kgMatch[3] || '';
    const hasKg2 = upperAll.some((n) => /\b(KG|KINDERGARTEN)\s*2(?![0-9])/.test(n));
    if (num === 1 && hasKg2) {
      return {
        ladderRank: 5,
        nextClassName: normalizeSpace(`${label} 2${arm}`),
        nextLevelCode: `${label} 2`,
        isGraduatingClass: false,
        armSuffix: arm.trim(),
        stageLabel: 'Kindergarten',
      };
    }
    return {
      ladderRank: 6,
      nextClassName: normalizeSpace(`Primary 1${arm}`),
      nextLevelCode: 'Primary 1',
      isGraduatingClass: false,
      armSuffix: arm.trim(),
      stageLabel: 'Kindergarten → Primary',
    };
  }

  // 7. Nursery 1..3
  const nurMatch = clean.match(/^(Nursery|Nur)\s*([1-3])(.*)$/i);
  if (nurMatch) {
    const label = nurMatch[1].toLowerCase().startsWith('nursery') ? 'Nursery' : 'Nur';
    const num = parseInt(nurMatch[2], 10);
    const arm = nurMatch[3] || '';
    const hasNur3 = upperAll.some((n) => /\b(NURSERY|NUR)\s*3(?![0-9])/.test(n));
    if (num === 1) {
      return {
        ladderRank: 2,
        nextClassName: normalizeSpace(`${label} 2${arm}`),
        nextLevelCode: `${label} 2`,
        isGraduatingClass: false,
        armSuffix: arm.trim(),
        stageLabel: 'Nursery',
      };
    }
    if (num === 2 && hasNur3) {
      return {
        ladderRank: 3,
        nextClassName: normalizeSpace(`${label} 3${arm}`),
        nextLevelCode: `${label} 3`,
        isGraduatingClass: false,
        armSuffix: arm.trim(),
        stageLabel: 'Nursery',
      };
    }
    const nextTarget = schoolHasKg ? `KG 1${arm}` : `Primary 1${arm}`;
    return {
      ladderRank: 4,
      nextClassName: normalizeSpace(nextTarget),
      nextLevelCode: schoolHasKg ? 'KG 1' : 'Primary 1',
      isGraduatingClass: false,
      armSuffix: arm.trim(),
      stageLabel: 'Nursery → Next Stage',
    };
  }

  // 8. Creche / Playgroup
  if (/^(Creche|Playgroup|Pre-?Nursery)/i.test(clean)) {
    return {
      ladderRank: 1,
      nextClassName: 'Nursery 1',
      nextLevelCode: 'Nursery 1',
      isGraduatingClass: false,
      armSuffix: '',
      stageLabel: 'Early Years',
    };
  }

  // Fallback for custom class naming
  return {
    ladderRank: isTertiary ? 30 : 10,
    nextClassName: null,
    nextLevelCode: null,
    isGraduatingClass: false,
    armSuffix: '',
    stageLabel: 'Custom Class',
  };
}

/**
 * Finds an existing destination class matching a suggested nextClassName (case/space-insensitive).
 * Falls back to matching the base level name if an exact arm doesn't exist yet (only when no arm-specific match).
 */
export function findMatchingTargetClass(
  classes: SimpleSchoolClass[],
  suggestedNextName: string | null,
  sourceDepartmentId?: string | null,
): SimpleSchoolClass | null {
  if (!suggestedNextName) return null;
  const compactTarget = suggestedNextName.replace(/\s+/g, '').toLowerCase();

  // Exact match (preferring same department when tertiary)
  const exactMatches = classes.filter(
    (c) => c.name.replace(/\s+/g, '').toLowerCase() === compactTarget,
  );
  if (exactMatches.length > 0) {
    if (sourceDepartmentId) {
      const sameDept = exactMatches.find((c) => c.departmentId === sourceDepartmentId);
      if (sameDept) return sameDept;
    }
    return exactMatches[0];
  }

  return null;
}

/**
 * Generates next academic session name from a current session string
 * e.g. "2025/2026" -> "2026/2027", "2025/2026 Academic Session" -> "2026/2027 Academic Session"
 */
export function suggestNextSessionName(currentSessionName?: string | null): string {
  const raw = (currentSessionName || '').trim();
  const match = raw.match(/(\d{4})\s*\/\s*(\d{4})/);
  if (match) {
    const startYear = parseInt(match[1], 10) + 1;
    const endYear = parseInt(match[2], 10) + 1;
    return raw.replace(match[0], `${startYear}/${endYear}`);
  }
  const yr = new Date().getFullYear();
  return `${yr}/${yr + 1}`;
}
