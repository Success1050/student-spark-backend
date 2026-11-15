-- Add configurable Report Card Qualities / Affective & Psychomotor Traits + Term Meta fields
ALTER TABLE "assessment_configs"
  ADD COLUMN IF NOT EXISTS "traitsConfigJson" JSONB,
  ADD COLUMN IF NOT EXISTS "reportCardMetaJson" JSONB;

ALTER TABLE "terminal_report_cards"
  ADD COLUMN IF NOT EXISTS "traitRatingsJson" JSONB;
