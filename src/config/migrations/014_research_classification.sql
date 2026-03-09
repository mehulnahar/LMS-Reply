-- Migration 014: Research Classification Gate
-- Pre-flight classification to skip research on non-BUILD jobs
-- Values: 'BUILD', 'SERVICE', 'TOO_NARROW' (NULL = not yet classified)

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS research_classification VARCHAR(20);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS research_tags JSONB;
-- Shape: { industry: "fashion", technologies: ["shopify", "react"], projectType: "ecommerce" }

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS research_classification_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_research_class
  ON jobs (research_classification)
  WHERE research_classification IS NOT NULL;
