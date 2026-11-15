export type InstitutionStage =
  | 'CRECHE'
  | 'NURSERY'
  | 'PRIMARY'
  | 'JUNIOR_SEC'
  | 'SENIOR_SEC'
  | 'POLYTECHNIC'
  | 'UNIVERSITY'
  | 'OTHER';

export interface ResolvedCohortGroup {
  /** School-wide combined level key, e.g. 'JSS_1', 'PRIMARY_4', 'CRECHE', 'LEVEL_200', 'ND_1' */
  combinedKey: string;
  /** Human-readable combined group name, e.g. 'JSS 1', 'Primary 4', '200 Level', 'ND 1' */
  combinedLabel: string;
  /** Normalized stage bucket for filtering across Creche / Nursery / Primary / JSS / SSS / Tertiary */
  stage: InstitutionStage;
  /** Tertiary department-scoped combined key when a department has multiple groups/arms */
  deptCombinedKey: string | null;
  deptCombinedLabel: string | null;
}

const ARM_WORD_SUFFIX_RE =
  /\s*[-–/]?\s*(?:ARM\s+[A-Z0-9]+|GROUP\s+[A-Z0-9]+|STREAM\s+[A-Z0-9]+|SECTION\s+[A-Z0-9]+|GOLD|SILVER|BRONZE|BLUE|RED|GREEN|YELLOW|WHITE|ROYAL|RUBY|EMERALD|DIAMOND|PEARL|ALPHA|BETA|GAMMA|SCIENCE|ARTS?|COMMERCIAL|HUMANITIES|TECH|TECHNICAL|FULL[\s-]?TIME|PART[\s-]?TIME)$/i;

const TRAILING_SINGLE_ARM_RE = /(?<=\d)\s*[-–]?\s*([A-Z])$/i;
const WORD_THEN_SINGLE_ARM_RE = /\s+([A-Z])$/;

function cleanArmTokens(raw: string): string {
  let out = raw.trim().replace(/\s+/g, ' ');
  for (let i = 0; i < 2; i++) {
    out = out.replace(ARM_WORD_SUFFIX_RE, '').trim();
  }
  out = out.replace(TRAILING_SINGLE_ARM_RE, '').trim();
  if (out.includes(' ')) {
    out = out.replace(WORD_THEN_SINGLE_ARM_RE, '').trim();
  }
  return out;
}

/**
 * Resolves subclasses/arms (e.g. "JSS 1A", "JSS1B", "JSS 1 Gold", "Primary 4 Blue",
 * "Creche A", "Nursery 2B", "100 Level Group A", "ND 1B") into one canonical base cohort.
 */
export function resolveCohortGroup(
  cls: {
    name?: string | null;
    levelCode?: string | null;
    departmentId?: string | null;
    departmentName?: string | null;
  },
  institutionType?: string | null,
): ResolvedCohortGroup {
  const rawName = (cls.name || '').trim();
  const rawCode = (cls.levelCode || '').trim();
  const probe = `${rawName} ${rawCode}`.trim();

  let combinedKey = '';
  let combinedLabel = '';
  let stage: InstitutionStage =
    institutionType === 'UNIVERSITY'
      ? 'UNIVERSITY'
      : institutionType === 'POLYTECHNIC'
      ? 'POLYTECHNIC'
      : 'OTHER';

  // 1. Creche & Playgroup
  if (/^(CRECHE|PLAY\s*GROUP|TODDLER)/i.test(rawName) || /^CRE\b|^CRE[A-Z0-9]?$/i.test(rawCode)) {
    const isPlaygroup = /PLAY\s*GROUP/i.test(rawName);
    combinedKey = isPlaygroup ? 'PLAYGROUP' : 'CRECHE';
    combinedLabel = isPlaygroup ? 'Playgroup' : 'Creche';
    stage = 'CRECHE';
  }
  // 2. Pre-Nursery / Reception / Kindergarten / Nursery 1..3
  else if (
    /^PRE[-\s]?NURSERY/i.test(rawName) ||
    /^PNUR/i.test(rawCode)
  ) {
    combinedKey = 'PRE_NURSERY';
    combinedLabel = 'Pre-Nursery';
    stage = 'NURSERY';
  } else if (/^RECEPTION/i.test(rawName)) {
    combinedKey = 'RECEPTION';
    combinedLabel = 'Reception';
    stage = 'NURSERY';
  } else if (
    /(?:NURSERY|KG|KINDERGARTEN)\s*(\d+)/i.test(rawName) ||
    /(?:NUR|KG)\s*(\d+)/i.test(rawCode)
  ) {
    const m =
      rawName.match(/(?:NURSERY|KG|KINDERGARTEN)\s*(\d+)/i) ||
      rawCode.match(/(?:NUR|KG)\s*(\d+)/i);
    const num = m?.[1] || '1';
    const isKg = /\bKG\b|KINDERGARTEN/i.test(rawName) && !/NURSERY/i.test(rawName);
    combinedKey = `${isKg ? 'KG' : 'NURSERY'}_${num}`;
    combinedLabel =
      num === '3' && /KG/i.test(rawName)
        ? 'Nursery 3 / KG'
        : `${isKg ? 'KG' : 'Nursery'} ${num}`;
    stage = 'NURSERY';
  } else if (/^NURSERY/i.test(rawName) || /^KG\b/i.test(rawName)) {
    combinedKey = 'NURSERY_1';
    combinedLabel = 'Nursery';
    stage = 'NURSERY';
  }
  // 3. Primary / Basic 1..6
  else if (
    /(?:PRIMARY|PRY|BASIC)\s*(\d+)/i.test(rawName) ||
    /(?:PRI|PRY|BAS)\s*(\d+)/i.test(rawCode)
  ) {
    const m =
      rawName.match(/(?:PRIMARY|PRY|BASIC)\s*(\d+)/i) ||
      rawCode.match(/(?:PRI|PRY|BAS)\s*(\d+)/i);
    const num = m?.[1] || '1';
    combinedKey = `PRIMARY_${num}`;
    combinedLabel = `Primary ${num}`;
    stage = 'PRIMARY';
  }
  // 4. Junior Secondary (JSS 1..3)
  else if (
    /\b(?:JSS|JS)\s*[-–]?\s*(\d+)/i.test(rawName) ||
    /(?:JSS|JS)\s*(\d+)/i.test(rawCode)
  ) {
    const m =
      rawName.match(/(?:JSS|JS)\s*[-–]?\s*(\d+)/i) ||
      rawCode.match(/(?:JSS|JS)\s*(\d+)/i);
    const num = m?.[1] || '1';
    combinedKey = `JSS_${num}`;
    combinedLabel = `JSS ${num}`;
    stage = 'JUNIOR_SEC';
  }
  // 5. Senior Secondary (SSS 1..3 / SS 1..3)
  else if (
    /\b(?:SSS|SS|SENIOR\s*SEC(?:ONDARY)?)\s*[-–]?\s*(\d+)/i.test(rawName) ||
    /(?:SSS|SS)\s*(\d+)/i.test(rawCode)
  ) {
    const m =
      rawName.match(/(?:SSS|SS|SENIOR\s*SEC(?:ONDARY)?)\s*[-–]?\s*(\d+)/i) ||
      rawCode.match(/(?:SSS|SS)\s*(\d+)/i);
    const num = m?.[1] || '1';
    combinedKey = `SSS_${num}`;
    combinedLabel = `SS ${num}`;
    stage = 'SENIOR_SEC';
  }
  // 6. Polytechnic ND / HND / OND (check BEFORE generic 100L rule)
  else if (
    /\b(HND|ND|OND)\s*[-–]?\s*([123])/i.test(rawName) ||
    /(HND|ND|OND)\s*([123])/i.test(rawCode)
  ) {
    const m =
      rawName.match(/\b(HND|ND|OND)\s*[-–]?\s*([123])/i) ||
      rawCode.match(/(HND|ND|OND)\s*([123])/i);
    const prog = (m?.[1] || 'ND').toUpperCase();
    const num = m?.[2] || '1';
    combinedKey = `${prog}_${num}`;
    combinedLabel = `${prog} ${num}`;
    stage = 'POLYTECHNIC';
  }
  // 7. University Levels (100L - 700L)
  else if (
    /\b([1-7]00)\s*(?:L|LVL|LEVEL)\b/i.test(probe) ||
    /^([1-7]00)L/i.test(rawCode)
  ) {
    const m =
      probe.match(/\b([1-7]00)\s*(?:L|LVL|LEVEL)\b/i) ||
      rawCode.match(/^([1-7]00)L/i);
    const lvl = m?.[1] || '100';
    combinedKey = `LEVEL_${lvl}`;
    combinedLabel = `${lvl} Level`;
    stage = institutionType === 'POLYTECHNIC' ? 'POLYTECHNIC' : 'UNIVERSITY';
  }
  // 8. Generic fallback (Year 7A -> Year 7, Grade 3B -> Grade 3, etc.)
  else {
    const cleaned = cleanArmTokens(rawName || rawCode || 'General Cohort');
    combinedLabel = cleaned || rawName || 'General Cohort';
    combinedKey = combinedLabel.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  }

  const isTertiary =
    institutionType === 'UNIVERSITY' ||
    institutionType === 'POLYTECHNIC' ||
    stage === 'UNIVERSITY' ||
    stage === 'POLYTECHNIC';

  const deptCombinedKey =
    isTertiary && cls.departmentId
      ? `DEPT::${cls.departmentId}::${combinedKey}`
      : null;
  const deptCombinedLabel =
    isTertiary && cls.departmentId && cls.departmentName
      ? `${cls.departmentName} • ${combinedLabel}`
      : null;

  return {
    combinedKey,
    combinedLabel,
    stage,
    deptCombinedKey,
    deptCombinedLabel,
  };
}
