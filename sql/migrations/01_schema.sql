-- 01_schema.sql — 3HK realistic mock: schema additions
-- Spec: docs/specs/2026-04-30-3hk-realistic-mock-data-design.md

CREATE TABLE segments (
  code                       text PRIMARY KEY,
  display_name               text NOT NULL,
  description                text,
  target_cpa_hkd             numeric(10,2) NOT NULL,
  target_arpu_hkd            numeric(10,2),
  target_churn_monthly_pct   numeric(5,2),
  sort_order                 smallint NOT NULL DEFAULT 0
);

CREATE TABLE brands (
  code         text PRIMARY KEY,
  display_name text NOT NULL,
  parent_brand text REFERENCES brands(code)
);

CREATE TABLE ad_spend (
  ad_id        bigint PRIMARY KEY REFERENCES ads(id),
  spend_hkd    numeric(12,2) NOT NULL DEFAULT 0,
  impressions  bigint,
  clicks       bigint,
  conversions  integer
);

ALTER TABLE plan_types
  ADD COLUMN brand_code   text REFERENCES brands(code),
  ADD COLUMN segment_code text REFERENCES segments(code),
  ADD COLUMN service_type text NOT NULL DEFAULT 'mobile'
    CHECK (service_type IN ('mobile','broadband','entertainment','insurance','roaming'));

ALTER TABLE plan_types DROP CONSTRAINT plan_types_plan_category_check;
ALTER TABLE plan_types ADD CONSTRAINT plan_types_plan_category_check
  CHECK (plan_category IN ('subscription','prepaid','one-off'));
