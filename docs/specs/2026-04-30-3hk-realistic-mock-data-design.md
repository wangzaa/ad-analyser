# 3HK realistic mock data — schema + seed redesign

**Date:** 2026-04-30
**Project:** `hk_dash` (Supabase ref `mlsjehglsotapwvalbor`)
**Predecessor spec:** [`2026-04-29-hk-dash-supabase-schema-design.md`](./2026-04-29-hk-dash-supabase-schema-design.md)

## Purpose

The current 679-row CRM mock is too premium-skewed for a 3HK telco scenario, has no acquisition-cost grounding (so LTV:CPA reads ~∞ in the dashboard), and lacks the segments and cohort spread needed to demonstrate retention / FMC / SoSIM stories. This spec extends the schema and regenerates the seed to reflect 3HK economics: lower blended ARPU, four real customer segments, 12-month cohort spread, deterministic acquisition-cost attribution, and a clean separation between *campaign efficiency* and *segment LTV economics*.

The implementation must be psql-driven and idempotent — last cycle's per-row MCP INSERT path consumed 7 hours and required manual recovery. This spec mandates literal-FK bulk INSERTs applied via `psql -f`.

## The two-metric model

The dashboard surfaces two distinct CPA concepts. They are intentionally not blended.

| | (a) Campaign Efficiency | (b) Segment LTV:CPA |
|---|---|---|
| **CPA source** | `ad_spend.spend_hkd / customers_acquired_from_that_ad` | Stored target CPA on `segments` table |
| **Scope** | `acquisition_channel = 'paid_social'` only | All customers in segment |
| **Question answered** | Which Meta/TikTok campaign acquires this segment most efficiently? | Are segment economics viable when brand + digital + retail are blended? |
| **Updated** | Each campaign run | Quarterly benchmark refresh |
| **Dashboard surface** | `v_campaign_efficiency` rendered as a leaderboard | `v_segment_ltv` rendered as a small reference card |

(a) is *measured*. (b) is *agreed*. Different rigour, different audience.

## Customer base composition

3,000 segmented customers spread across 12 monthly cohorts (Jan – Dec 2025).

| Segment code | Brands | Customer count | Plan types | Target CPA (HKD) | Target ARPU (HKD) | Target monthly churn |
|---|---|---|---|---|---|---|
| `postpaid_premium` | 3HK | ~750 | 5G_Family_4Line, 5G_Family_2Line, 5G_Single_Premium | 2,500 | 250 | 1.0% |
| `postpaid_value` | 3HK, SoSIM | ~1,200 | 5G_Single_Standard, 5G_Single_Basic, 5G_Gamer_Unlimited, SoSIM_5G_30GB, SoSIM_5G_100GB | 250 | 120 | 2.0% |
| `prepaid_engaged` | 3HK_Tourist | ~600 | Prepaid_CrossBorder_30d, Prepaid_CrossBorder_90d | 50 | 80 | 4.0% |
| `prepaid_tourist` | 3HK_Tourist | ~450 | Prepaid_Tourist_8d, Prepaid_Tourist_15d | 30 | 45 | 22% |

Plus add-on customer-rows on top of the 3000 base:
- ~25% of `postpaid_premium` accounts and ~15% of `postpaid_value` accounts also hold an FBB line → ~250 broadband customer-rows
- ~50 roaming-pass customer-rows (purchased by existing postpaid customers)

**Total customer-rows: ~3,300.** ~3,000 of those count toward segment metrics; FBB and roaming customer-rows attach to existing accounts and are excluded from segment-level CPA math (they're cross-sell motions, not paid acquisitions).

## Schema additions

### New tables

```sql
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
```

### Extensions to existing tables

```sql
-- plan_types: add brand, segment, service_type
ALTER TABLE plan_types
  ADD COLUMN brand_code   text REFERENCES brands(code),
  ADD COLUMN segment_code text REFERENCES segments(code),
  ADD COLUMN service_type text NOT NULL DEFAULT 'mobile'
    CHECK (service_type IN ('mobile','broadband','entertainment','insurance','roaming'));

-- plan_category: allow 'prepaid'
ALTER TABLE plan_types DROP CONSTRAINT plan_types_plan_category_check;
ALTER TABLE plan_types ADD CONSTRAINT plan_types_plan_category_check
  CHECK (plan_category IN ('subscription','prepaid','one-off'));
```

### Seed data

```sql
INSERT INTO segments (code, display_name, target_cpa_hkd, target_arpu_hkd, target_churn_monthly_pct, sort_order, description) VALUES
  ('postpaid_premium', 'Postpaid Premium',  2500, 250, 1.0,  1, 'Handset bundle, family lines, low churn.'),
  ('postpaid_value',   'Postpaid Value',     250, 120, 2.0,  2, 'SIM-only & digital sub-brand, mid churn.'),
  ('prepaid_engaged',  'Prepaid Engaged',     50,  80, 4.0,  3, 'Cross-border long-life prepaid.'),
  ('prepaid_tourist',  'Prepaid Tourist',     30,  45, 22.0, 4, 'Short-stay tourist SIMs.');

INSERT INTO brands (code, display_name, parent_brand) VALUES
  ('3HK',         '3HK',                   NULL),
  ('SoSIM',       'SoSIM',                 '3HK'),
  ('3HK_Tourist', '3 Tourist SIM',         '3HK');

-- Plus new plan_types for SoSIM, prepaid, and broadband (FBB) lines.
-- Existing plan_types backfilled with brand_code='3HK' and segment_code per their economics.
```

## New / replaced views

### `v_segment_ltv` — segment economics with current customer rollup

```sql
CREATE VIEW v_segment_ltv AS
SELECT
  s.code              AS segment_code,
  s.display_name,
  s.target_cpa_hkd,
  s.target_arpu_hkd,
  s.target_churn_monthly_pct,
  COUNT(c.id)                                AS customers,
  AVG(c.monthly_arpu_hkd)                    AS avg_arpu,
  AVG(c.realized_revenue_hkd)                AS avg_realized_revenue,
  AVG(c.projected_ltv_24mo_hkd)              AS avg_projected_ltv,
  CASE WHEN s.target_cpa_hkd > 0
       THEN ROUND(AVG(c.projected_ltv_24mo_hkd) / s.target_cpa_hkd, 2)
       ELSE NULL END                         AS segment_ltv_cpa_ratio
FROM segments s
LEFT JOIN plan_types pt ON pt.segment_code = s.code
LEFT JOIN customers c   ON c.plan_type_id = pt.id
GROUP BY s.code, s.display_name, s.target_cpa_hkd, s.target_arpu_hkd, s.target_churn_monthly_pct, s.sort_order
ORDER BY s.sort_order;
```

### `v_campaign_efficiency` — actual digital CPA per campaign × segment

```sql
CREATE VIEW v_campaign_efficiency AS
SELECT
  pl.code           AS platform,
  camp.name         AS campaign_name,
  pt.segment_code,
  COUNT(c.id)                                                           AS customers_acquired,
  COALESCE(SUM(spend.spend_hkd), 0)                                     AS total_spend_hkd,
  CASE WHEN COUNT(c.id) > 0
       THEN ROUND(COALESCE(SUM(spend.spend_hkd), 0) / COUNT(c.id), 2)
       ELSE NULL END                                                    AS digital_cpa_hkd,
  AVG(c.realized_revenue_hkd)                                           AS avg_realized_revenue,
  AVG(c.projected_ltv_24mo_hkd)                                         AS avg_projected_ltv
FROM customers c
JOIN ads ad           ON ad.id = c.ad_id
JOIN ad_sets ads2     ON ads2.id = ad.ad_set_id
JOIN campaigns camp   ON camp.id = ads2.campaign_id
JOIN platforms pl     ON pl.id = camp.platform_id
JOIN plan_types pt    ON pt.id = c.plan_type_id
LEFT JOIN ad_spend spend ON spend.ad_id = ad.id
WHERE c.acquisition_channel = 'paid_social'
GROUP BY pl.code, camp.name, pt.segment_code;
```

### `v_customer_360` extension

Add columns: `segment_code`, `brand_code`, `service_type`, `digital_cpa_hkd` (left-joined from a per-customer derivation of ad_spend).

The derived per-customer `digital_cpa_hkd`:
- For paid-social customers: `ad_spend.spend_hkd / (count of customers attributed to same ad)`
- For organic customers: `NULL`

This becomes the `acquisition_cost` value the dashboard's existing `r.acquisition_cost` reference picks up — no dashboard code change for this column.

## Data regeneration approach

A new Python script `etl/generate_3hk_mock.py` produces a single deterministic SQL file that inserts the entire dataset. Approach:

1. **Reference data** (segments, brands, plan_types extensions, campaigns with start/end dates) are seeded as static SQL in `sql/migrations/02_seed_lookups.sql` — hand-curated.
2. **Python script** (run once locally, deterministic via fixed RNG seed):
   - Loads the static reference data definitions
   - For each segment, picks the right number of customers, distributes them across 12 monthly cohorts with realistic mix (heavier in some months for some segments)
   - For each customer, picks a plan_type from the segment, picks a campaign that ran in the customer's cohort month, picks an `acquisition_date` within the campaign window, generates demographics
   - For paid-social customers: assigns to a campaign with the right segment match. `acquisition_cost` is drawn from a noise distribution around the segment's target CPA. The sum of all customer-level acquisition_costs per ad is the `ad_spend.spend_hkd` for that ad — internally consistent.
   - For organic customers (most prepaid + cross-sell FBB): point at the organic sentinel ad, no campaign attribution, `digital_cpa_hkd = NULL`
   - Applies realistic monthly churn per segment to compute `status`, `churn_date`, `months_active`, `realized_revenue_hkd`
   - Generates `customer_events` (activation, plan_changed for 4G→5G, churned, product_added) with realistic timestamps
   - Generates `ad_spend` rows by aggregating per-customer attributions per ad
   - Generates `account_products` rows for device_financing only (FBB / entertainment / insurance now live as customer lines)
   - **All FK IDs are literal integers** assigned deterministically from sorted distinct values (no subquery FK lookups)
3. **Output**: one large multi-statement SQL file at `sql/generated/04_data.sql`

The script reuses the deterministic-ID approach from the existing `etl/build_bulk_inserts.py`.

## Dashboard updates (Tab 2 only)

| Element | Change |
|---|---|
| New: Segment Economics card | Top of Tab 2 (above filters). One row per segment from `v_segment_ltv`. Columns: Segment · Customers · Target CPA · Avg LTV · LTV:CPA ratio. ~5 rows total. |
| Existing: LTV:CPA Leaderboard | Renamed to "Campaign Efficiency". Reads from `v_campaign_efficiency`. Columns: Campaign · Platform · Segment · Customers · Spend · Digital CPA · Avg LTV · Campaign LTV:CPA. The existing per-ad-set leaderboard is replaced with a per-campaign × segment one. |
| Existing: Plan Mix donut | Unchanged. |
| Existing: CRM Data table | Adds 4 columns: `segment_code`, `brand`, `service_type`, `acquisition_cost` (from `digital_cpa_hkd`). All sortable / filterable consistent with current behavior. |
| Existing: filter row | Add `segment` and `brand` dropdowns. |

Tabs 1 (Campaign Performance) and 3 (Detected Fields) are untouched.

## Implementation efficiency commitments

These are blocking constraints, not aspirations.

1. **All bulk INSERTs use literal FK integer IDs.** No `(SELECT id FROM accounts WHERE external_account_id = '...')` in any data SQL. The Python regen script computes IDs deterministically from sorted distinct values.

2. **Pipeline is exactly five SQL files**, applied in order:

   ```
   sql/migrations/01_schema.sql        — DDL: ALTER plan_types, CREATE segments / brands / ad_spend
   sql/migrations/02_seed_lookups.sql  — static reference data (segments, brands, new plan_types, campaign start/end dates)
   sql/migrations/03_truncate.sql      — TRUNCATE customer_events, customers, account_products, ad_spend, accounts CASCADE
   sql/generated/04_data.sql           — bulk INSERTs for accounts → customers → account_products → customer_events → ad_spend
   sql/migrations/05_views.sql         — DROP and recreate all five views
   ```

3. **Apply via single bash loop in user terminal**, not via MCP per-statement:

   ```bash
   for f in 01_schema 02_seed_lookups 03_truncate; do
     psql "$DB_URL" -f sql/migrations/$f.sql -v ON_ERROR_STOP=1 || break
   done
   psql "$DB_URL" -f sql/generated/04_data.sql -v ON_ERROR_STOP=1
   psql "$DB_URL" -f sql/migrations/05_views.sql -v ON_ERROR_STOP=1
   ```

4. **Verification = one Supabase MCP `execute_sql` call** returning all numeric checks (row counts, FK integrity, segment distribution, ad_spend total, segment economics card preview).

5. **Regen is idempotent.** Fixed Python RNG seed → identical output every run. User can rerun any time without surprises.

6. **No subagent dispatching for data load.** Schema DDL goes via MCP `apply_migration` (small, fits in one call). Data ETL is psql-only.

## Out of scope (deliberate)

- Campaign spend with daily granularity. Per-ad totals only (matches user's "(a) not split by days" decision).
- Brand-overhead allocation for organic customers. They get `digital_cpa_hkd = NULL`.
- Materialised views. Plain views remain — at this scale (3,300 rows) recompute on read is sub-millisecond.
- Tab 1 (Campaign Performance) integration with Supabase ad_spend. The existing CSV-upload flow on Tab 1 stays. Linking it to Supabase ad_spend is a future migration.
- Updates to RLS or TypeScript types regeneration. Will follow once the schema settles.
- Production-quality data pipeline (Airflow / dbt). This is mock data generation, run once.

## Decisions deferred to implementation plan

- Exact monthly cohort distribution (uniform vs seasonal — e.g., bigger family-plan campaigns in Q4 around Christmas).
- Realistic noise distribution for per-customer acquisition_cost (uniform ± 30% around target? log-normal?). Will pick whichever gives credible histograms.
- Number of campaigns per segment per year (likely 4 quarterly per segment; SoSIM may run 6+ shorter flights).
- Whether to keep historical pre-2025 cohorts (for showing 24-month projected LTV trajectories) — current spec is Jan–Dec 2025 only.
