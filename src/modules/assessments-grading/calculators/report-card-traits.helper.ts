export type TraitRatingScaleMode = '1_TO_5' | 'A_TO_E';

export interface ReportCardTraitItem {
  key: string;
  label: string;
}

export interface ReportCardTraitCategory {
  key: string;
  title: string;
  items: ReportCardTraitItem[];
}

export interface ReportCardTraitsConfig {
  enabled: boolean;
  scaleMode: TraitRatingScaleMode;
  categories: ReportCardTraitCategory[];
}

export interface ReportCardMetaConfig {
  daysSchoolOpened?: number | null;
  vacationDate?: string | null;
  resumptionDate?: string | null;
  showPerformanceChart: boolean;
  showLogoWatermark: boolean;
}

export interface StudentTraitRatingsPayload {
  ratings: Record<string, string>;
  daysPresent?: number | null;
  daysLate?: number | null;
  daysAbsent?: number | null;
  daysExcused?: number | null;
  ratedByName?: string | null;
  updatedAt?: string | null;
}

export const DEFAULT_AFFECTIVE_PSYCHOMOTOR_CATEGORIES: ReportCardTraitCategory[] = [
  {
    key: 'affective',
    title: 'AFFECTIVE-TRAIT RATING',
    items: [
      { key: 'punctuality', label: 'Punctuality' },
      { key: 'attendance', label: 'Attendance' },
      { key: 'reliability', label: 'Reliability' },
      { key: 'neatness', label: 'Neatness' },
      { key: 'politeness', label: 'Politeness' },
      { key: 'honesty', label: 'Honesty' },
      { key: 'relationship', label: 'Relationship' },
      { key: 'self_control', label: 'Self-Control' },
    ],
  },
  {
    key: 'psychomotor',
    title: 'PSYCHOMOTOR-TRAIT RATING',
    items: [
      { key: 'handwriting', label: 'Handwriting' },
      { key: 'games', label: 'Games' },
      { key: 'sports', label: 'Sports' },
      { key: 'drawing', label: 'Drawing' },
      { key: 'craft', label: 'Craft' },
      { key: 'musical_skill', label: 'Musical Skill' },
    ],
  },
];

export function isTertiaryType(institutionType?: string | null): boolean {
  return (
    institutionType === 'UNIVERSITY' ||
    institutionType === 'POLYTECHNIC' ||
    institutionType === 'COLLEGE_OF_EDUCATION' ||
    institutionType === 'TECHNICAL'
  );
}

export function getDefaultTraitsConfig(
  institutionType?: string | null,
): ReportCardTraitsConfig {
  return {
    enabled: !isTertiaryType(institutionType),
    scaleMode: '1_TO_5',
    categories: DEFAULT_AFFECTIVE_PSYCHOMOTOR_CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.items.map((i) => ({ ...i })),
    })),
  };
}

export function getDefaultReportCardMeta(): ReportCardMetaConfig {
  return {
    daysSchoolOpened: null,
    vacationDate: null,
    resumptionDate: null,
    showPerformanceChart: true,
    showLogoWatermark: true,
  };
}

function slugifyKey(raw: string, fallback: string): string {
  const clean = (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return clean || fallback;
}

export function sanitizeTraitsConfig(
  raw: unknown,
  institutionType?: string | null,
): ReportCardTraitsConfig {
  const def = getDefaultTraitsConfig(institutionType);
  if (!raw || typeof raw !== 'object') {
    return def;
  }

  const obj = raw as Partial<ReportCardTraitsConfig>;
  const scaleMode: TraitRatingScaleMode =
    obj.scaleMode === 'A_TO_E' ? 'A_TO_E' : '1_TO_5';
  const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : def.enabled;

  const rawCategories = Array.isArray(obj.categories)
    ? obj.categories
    : def.categories;

  const usedCatKeys = new Set<string>();
  const categories: ReportCardTraitCategory[] = rawCategories
    .filter((c) => c && typeof c === 'object' && (c.title || '').trim().length > 0)
    .map((c, cIdx) => {
      let catKey = slugifyKey(c.key || c.title, `cat_${cIdx + 1}`);
      while (usedCatKeys.has(catKey)) catKey = `${catKey}_${cIdx + 1}`;
      usedCatKeys.add(catKey);

      const usedItemKeys = new Set<string>();
      const items: ReportCardTraitItem[] = (Array.isArray(c.items) ? c.items : [])
        .filter((it) => it && typeof it === 'object' && (it.label || '').trim().length > 0)
        .map((it, iIdx) => {
          let itemKey = slugifyKey(
            it.key || `${catKey}_${it.label}`,
            `${catKey}_trait_${iIdx + 1}`,
          );
          while (usedItemKeys.has(itemKey)) itemKey = `${itemKey}_${iIdx + 1}`;
          usedItemKeys.add(itemKey);
          return {
            key: itemKey,
            label: String(it.label).trim(),
          };
        });

      return {
        key: catKey,
        title: String(c.title).trim(),
        items,
      };
    });

  return {
    enabled,
    scaleMode,
    categories: categories.length > 0 ? categories : def.categories,
  };
}

export function sanitizeReportCardMeta(raw: unknown): ReportCardMetaConfig {
  const def = getDefaultReportCardMeta();
  if (!raw || typeof raw !== 'object') return def;
  const obj = raw as Partial<ReportCardMetaConfig>;
  const opened = Number(obj.daysSchoolOpened);
  return {
    daysSchoolOpened:
      Number.isFinite(opened) && opened > 0 ? Math.min(365, Math.round(opened)) : null,
    vacationDate: obj.vacationDate ? String(obj.vacationDate).trim() || null : null,
    resumptionDate: obj.resumptionDate ? String(obj.resumptionDate).trim() || null : null,
    showPerformanceChart:
      typeof obj.showPerformanceChart === 'boolean'
        ? obj.showPerformanceChart
        : true,
    showLogoWatermark:
      typeof obj.showLogoWatermark === 'boolean' ? obj.showLogoWatermark : true,
  };
}

function normalizeAttendanceDaysValue(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? Math.min(365, Math.round(n)) : null;
}

export function normalizeStudentTraitRatings(
  raw: unknown,
): StudentTraitRatingsPayload {
  if (!raw || typeof raw !== 'object') {
    return {
      ratings: {},
      daysPresent: null,
      daysLate: null,
      daysAbsent: null,
      daysExcused: null,
    };
  }
  const obj = raw as Partial<StudentTraitRatingsPayload>;
  const cleanRatings: Record<string, string> = {};
  if (obj.ratings && typeof obj.ratings === 'object') {
    for (const [k, v] of Object.entries(obj.ratings)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        cleanRatings[k] = String(v).trim();
      }
    }
  }
  return {
    ratings: cleanRatings,
    daysPresent: normalizeAttendanceDaysValue(obj.daysPresent),
    daysLate: normalizeAttendanceDaysValue(obj.daysLate),
    daysAbsent: normalizeAttendanceDaysValue(obj.daysAbsent),
    daysExcused: normalizeAttendanceDaysValue(obj.daysExcused),
    ratedByName: obj.ratedByName ? String(obj.ratedByName) : null,
    updatedAt: obj.updatedAt ? String(obj.updatedAt) : null,
  };
}
