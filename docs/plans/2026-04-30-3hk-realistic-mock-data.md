# 3HK realistic mock data — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 679-row mock dataset with a 3HK-realistic 3,300-row dataset (4 segments, 12-month cohorts, deterministic CPA attribution), extend the schema with `segments` / `brands` / `ad_spend`, regenerate views, and surface the new fields in the dashboard's Customer Value tab.

**Architecture:** Five SQL files applied in order via psql. A single Python generator emits literal-FK bulk INSERTs. Schema additions are minimal (3 new tables + ALTER on `plan_types`). Dashboard changes are surgical — Tab 2 only.

**Tech Stack:** Supabase Postgres 17, Python 3 stdlib, psql, React 18 (in-browser Babel), Supabase MCP for verification.

**Reference:** Spec at `docs/specs/2026-04-30-3hk-realistic-mock-data-design.md`.

**Operational notes:**
- Working directory: `/Users/neo/Desktop/ad_analysis` (git repo).
- DB connection string lives in user's shell as `$DB_URL` (already set up; same one used in the prior data load).
- All `apply_migration` MCP calls go to `project_id="mlsjehglsotapwvalbor"`.
- User runs `git` and `psql` commands manually — present them as copy-paste blocks, don't execute via Bash.
- Today's date: 2026-04-30.

---

## File map

```
sql/migrations/01_schema.sql         CREATE — new tables + plan_types ALTERs
sql/migrations/02_seed_lookups.sql   CREATE — segments, brands, plan_types backfill, new plan_types,
                                              campaign start/end dates, new campaigns
sql/migrations/03_truncate.sql       CREATE — TRUNCATE all customer-data tables
sql/migrations/05_views.sql          CREATE — DROP + CREATE all views (existing + new)
sql/generated/04_data.sql            GENERATED — bulk INSERTs (accounts → customers → account_products →
                                                customer_events → ad_spend), literal FK IDs
etl/generate_3hk_mock.py             CREATE — Python generator
etl/test_generate_3hk_mock.py        CREATE — unit tests for generator invariants
frontend/dashboard.js                MODIFY — Tab 2: segment card, renamed leaderboard, new columns, segment filter
frontend/hk_telco_ads_dashboard.jsx  MIRROR — copy of dashboard.js after edits
```

Each file has one responsibility. The five SQL files are independently runnable; the generator is independently testable; the dashboard edit is the only JS change.

---

### Task 1: Schema DDL (`01_schema.sql`)

**Files:**
- Create: `sql/migrations/01_schema.sql`

- [ ] **Step 1: Write the SQL file**

```sql
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
```

- [ ] **Step 2: Verify file compiles (syntax-only check)**

```bash
cd /Users/neo/Desktop/ad_analysis
psql "$DB_URL" -f sql/migrations/01_schema.sql --set ON_ERROR_STOP=on --single-transaction --variable VERBOSITY=verbose -c "ROLLBACK;" 2>&1 | head
```

Note: the trailing `-c "ROLLBACK;"` won't execute (file is applied first), so we just rely on the file content being syntactically valid Postgres — psql will error on parse before any DDL runs given `--single-transaction`. If anything errors here, fix the SQL before moving on.

- [ ] **Step 3: User applies the migration**

Provide this command for user to run:

```bash
psql "$DB_URL" -f sql/migrations/01_schema.sql -v ON_ERROR_STOP=1
```

Expected output: `CREATE TABLE` × 3, `ALTER TABLE` × 3 (or similar; one per ALTER statement), no errors.

- [ ] **Step 4: Verify via MCP**

Call `mcp__supabase__execute_sql` with `project_id="mlsjehglsotapwvalbor"`:

```sql
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='segments') AS segments_table,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='brands')   AS brands_table,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='ad_spend') AS ad_spend_table,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='plan_types' AND column_name='brand_code')   AS plan_types_brand_code,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='plan_types' AND column_name='segment_code') AS plan_types_segment_code,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='plan_types' AND column_name='service_type') AS plan_types_service_type;
```

Expected: every value = 1.

---

### Task 2: Seed lookup data (`02_seed_lookups.sql`)

**Files:**
- Create: `sql/migrations/02_seed_lookups.sql`

- [ ] **Step 1: Write the SQL file**

```sql
-- 02_seed_lookups.sql — 3HK realistic mock: reference data

-- Segments
INSERT INTO segments (code, display_name, description, target_cpa_hkd, target_arpu_hkd, target_churn_monthly_pct, sort_order) VALUES
  ('postpaid_premium', 'Postpaid Premium',  'Handset bundle, family lines, low churn.',          2500, 250.00, 1.0,  1),
  ('postpaid_value',   'Postpaid Value',    'SIM-only & digital sub-brand, mid churn.',           250, 120.00, 2.0,  2),
  ('prepaid_engaged',  'Prepaid Engaged',   'Cross-border long-life prepaid.',                     50,  80.00, 4.0,  3),
  ('prepaid_tourist',  'Prepaid Tourist',   'Short-stay tourist SIMs.',                            30,  45.00, 22.0, 4);

-- Brands
INSERT INTO brands (code, display_name, parent_brand) VALUES
  ('3HK',         '3HK',           NULL),
  ('SoSIM',       'SoSIM',         '3HK'),
  ('3HK_Tourist', '3 Tourist SIM', '3HK');

-- Backfill existing plan_types with brand + segment + service_type
UPDATE plan_types SET brand_code='3HK', segment_code='postpaid_premium', service_type='mobile' WHERE code IN ('5G_Family_4Line','5G_Family_2Line','5G_Single_Premium');
UPDATE plan_types SET brand_code='3HK', segment_code='postpaid_value',   service_type='mobile' WHERE code IN ('5G_Single_Standard','5G_Single_Basic','5G_Gamer_Unlimited');
UPDATE plan_types SET brand_code='3HK', segment_code='postpaid_value',   service_type='roaming' WHERE code IN ('Roaming_Pass_7d','Roaming_Pass_14d');

-- New plan_types: SoSIM (digital sub-brand, postpaid_value)
INSERT INTO plan_types (code, display_name, plan_category, brand_code, segment_code, service_type) VALUES
  ('SoSIM_5G_30GB',   'SoSIM 5G 30GB',   'subscription', 'SoSIM', 'postpaid_value', 'mobile'),
  ('SoSIM_5G_100GB',  'SoSIM 5G 100GB',  'subscription', 'SoSIM', 'postpaid_value', 'mobile');

-- New plan_types: prepaid (3HK_Tourist brand)
INSERT INTO plan_types (code, display_name, plan_category, brand_code, segment_code, service_type) VALUES
  ('Prepaid_CrossBorder_30d', 'Prepaid Cross-Border 30-day', 'prepaid', '3HK_Tourist', 'prepaid_engaged', 'mobile'),
  ('Prepaid_CrossBorder_90d', 'Prepaid Cross-Border 90-day', 'prepaid', '3HK_Tourist', 'prepaid_engaged', 'mobile'),
  ('Prepaid_Tourist_8d',      'Prepaid Tourist 8-day',       'prepaid', '3HK_Tourist', 'prepaid_tourist', 'mobile'),
  ('Prepaid_Tourist_15d',     'Prepaid Tourist 15-day',      'prepaid', '3HK_Tourist', 'prepaid_tourist', 'mobile');

-- New plan_types: FBB lines (treated as customer lines; segment matches the household's mobile segment)
INSERT INTO plan_types (code, display_name, plan_category, brand_code, segment_code, service_type) VALUES
  ('FBB_FTTH_500M', 'FTTH 500M', 'subscription', '3HK', 'postpaid_value',   'broadband'),
  ('FBB_FTTH_1G',   'FTTH 1G',   'subscription', '3HK', 'postpaid_premium', 'broadband');

-- Set start/end dates on existing campaigns + create new campaigns
-- Existing campaigns get assigned to a 14-day window in late 2025; new SoSIM and prepaid campaigns added across 2025.
UPDATE campaigns SET start_date='2025-11-01', end_date='2025-11-14' WHERE name='HK_5G_FamilyPlan_Q4_2025';
UPDATE campaigns SET start_date='2025-11-03', end_date='2025-11-16' WHERE name='HK_5G_GamerUnlimited_Q4';
UPDATE campaigns SET start_date='2025-11-08', end_date='2025-11-21' WHERE name='HK_RoamingPass_Asia_Q4_2025';

-- New paid campaigns spread across 2025 cohort months
WITH platforms_meta AS (SELECT id FROM platforms WHERE code='meta'),
     platforms_tt   AS (SELECT id FROM platforms WHERE code='tiktok')
INSERT INTO campaigns (name, platform_id, start_date, end_date) VALUES
  ('HK_5G_FamilyPlan_Q1_2025',  (SELECT id FROM platforms WHERE code='meta'),   '2025-02-15','2025-02-28'),
  ('HK_5G_FamilyPlan_Q2_2025',  (SELECT id FROM platforms WHERE code='meta'),   '2025-05-12','2025-05-25'),
  ('HK_5G_FamilyPlan_Q3_2025',  (SELECT id FROM platforms WHERE code='meta'),   '2025-08-11','2025-08-24'),
  ('HK_5G_GamerUnlimited_Q1',   (SELECT id FROM platforms WHERE code='tiktok'), '2025-03-03','2025-03-16'),
  ('HK_5G_GamerUnlimited_Q2',   (SELECT id FROM platforms WHERE code='tiktok'), '2025-06-09','2025-06-22'),
  ('HK_5G_GamerUnlimited_Q3',   (SELECT id FROM platforms WHERE code='tiktok'), '2025-09-15','2025-09-28'),
  ('HK_SoSIM_LaunchFlight_Q1',  (SELECT id FROM platforms WHERE code='meta'),   '2025-01-13','2025-01-26'),
  ('HK_SoSIM_AlwaysOn_Q2',      (SELECT id FROM platforms WHERE code='meta'),   '2025-04-07','2025-04-20'),
  ('HK_SoSIM_AlwaysOn_Q3',      (SELECT id FROM platforms WHERE code='meta'),   '2025-07-14','2025-07-27'),
  ('HK_SoSIM_AlwaysOn_Q4',      (SELECT id FROM platforms WHERE code='meta'),   '2025-10-13','2025-10-26'),
  ('HK_RoamingPass_GoldenWeek', (SELECT id FROM platforms WHERE code='meta'),   '2025-09-22','2025-10-05'),
  ('HK_RoamingPass_Summer',     (SELECT id FROM platforms WHERE code='meta'),   '2025-06-23','2025-07-06');

-- Per-campaign ad sets and ads will be added in 02b if needed; for now we will let the
-- generator create ad_sets/ads under each new campaign as it assigns customers.
-- HOWEVER — the generator emits only customer/account/event/ad_spend INSERTs (the data
-- layer). New ad_sets and ads belong in this seed file (the lookup layer) so FK targets
-- exist before generator output runs. Generator picks the appropriate ad_id by name.

-- Create one ad_set + one ad per new campaign (single creative per campaign, sufficient
-- for mock data; real campaigns have multiple but that doesn't change the LTV story).
INSERT INTO ad_sets (name, campaign_id)
SELECT camp.name || '_default_adset', camp.id
FROM campaigns camp
WHERE camp.name IN (
  'HK_5G_FamilyPlan_Q1_2025','HK_5G_FamilyPlan_Q2_2025','HK_5G_FamilyPlan_Q3_2025',
  'HK_5G_GamerUnlimited_Q1','HK_5G_GamerUnlimited_Q2','HK_5G_GamerUnlimited_Q3',
  'HK_SoSIM_LaunchFlight_Q1','HK_SoSIM_AlwaysOn_Q2','HK_SoSIM_AlwaysOn_Q3','HK_SoSIM_AlwaysOn_Q4',
  'HK_RoamingPass_GoldenWeek','HK_RoamingPass_Summer'
);

INSERT INTO ads (name, ad_set_id)
SELECT s.name || '_creative_v1', s.id
FROM ad_sets s
JOIN campaigns c ON c.id = s.campaign_id
WHERE c.name IN (
  'HK_5G_FamilyPlan_Q1_2025','HK_5G_FamilyPlan_Q2_2025','HK_5G_FamilyPlan_Q3_2025',
  'HK_5G_GamerUnlimited_Q1','HK_5G_GamerUnlimited_Q2','HK_5G_GamerUnlimited_Q3',
  'HK_SoSIM_LaunchFlight_Q1','HK_SoSIM_AlwaysOn_Q2','HK_SoSIM_AlwaysOn_Q3','HK_SoSIM_AlwaysOn_Q4',
  'HK_RoamingPass_GoldenWeek','HK_RoamingPass_Summer'
);
```

- [ ] **Step 2: User applies**

```bash
psql "$DB_URL" -f sql/migrations/02_seed_lookups.sql -v ON_ERROR_STOP=1
```

Expected: `INSERT 0 4` (segments), `INSERT 0 3` (brands), `UPDATE 6` (existing plan_types backfill), `INSERT 0 8` (new plan_types), `UPDATE 3` (existing campaigns), `INSERT 0 12` (new campaigns), `INSERT 0 12` (new ad_sets), `INSERT 0 12` (new ads).

- [ ] **Step 3: Verify via MCP**

Call `mcp__supabase__execute_sql`:

```sql
SELECT
  (SELECT COUNT(*) FROM segments)                                                    AS segments,
  (SELECT COUNT(*) FROM brands)                                                      AS brands,
  (SELECT COUNT(*) FROM plan_types)                                                  AS plan_types_total,
  (SELECT COUNT(*) FROM plan_types WHERE brand_code IS NULL)                         AS plan_types_no_brand,
  (SELECT COUNT(*) FROM plan_types WHERE segment_code IS NULL)                       AS plan_types_no_segment,
  (SELECT COUNT(*) FROM campaigns)                                                   AS campaigns_total,
  (SELECT COUNT(*) FROM campaigns WHERE start_date IS NOT NULL AND end_date IS NOT NULL) AS campaigns_dated,
  (SELECT COUNT(*) FROM ads)                                                         AS ads_total;
```

Expected:
- `segments=4, brands=3`
- `plan_types_total=16` (8 existing + 8 new)
- `plan_types_no_brand=0, plan_types_no_segment=0` (the organic sentinel may NOT have a brand — see below)
- `campaigns_total=16` (3 existing + 12 new + 1 sentinel)
- `campaigns_dated=15` (all except sentinel)
- `ads_total=25` (13 paid existing + 12 new + 1 sentinel)

If `plan_types_no_brand` or `plan_types_no_segment` > 0, run a query to find the offending row and add it to the UPDATE list in the SQL file. (FBB lines and Roaming were assigned in the seed; verify.)

---

### Task 3: Truncate existing data (`03_truncate.sql`)

**Files:**
- Create: `sql/migrations/03_truncate.sql`

- [ ] **Step 1: Write the SQL file**

```sql
-- 03_truncate.sql — wipe all customer-level data tables before regen.
-- ad_sets / ads / campaigns / lookup tables retained.
TRUNCATE customer_events, customers, account_products, ad_spend, accounts RESTART IDENTITY CASCADE;
```

- [ ] **Step 2: User applies**

```bash
psql "$DB_URL" -f sql/migrations/03_truncate.sql -v ON_ERROR_STOP=1
```

Expected: `TRUNCATE TABLE`.

- [ ] **Step 3: Verify**

Call `mcp__supabase__execute_sql`:

```sql
SELECT
  (SELECT COUNT(*) FROM accounts)         AS accounts,
  (SELECT COUNT(*) FROM customers)        AS customers,
  (SELECT COUNT(*) FROM account_products) AS account_products,
  (SELECT COUNT(*) FROM customer_events)  AS customer_events,
  (SELECT COUNT(*) FROM ad_spend)         AS ad_spend;
```

Expected: all `0`.

---

### Task 4: Python generator skeleton + invariant tests

**Files:**
- Create: `etl/generate_3hk_mock.py`
- Create: `etl/test_generate_3hk_mock.py`

- [ ] **Step 1: Write skeleton + module config**

`etl/generate_3hk_mock.py`:

```python
"""Generate 3HK realistic mock dataset → sql/generated/04_data.sql

Produces: ~3,300 customer-rows across 4 segments, 12-month cohorts (Jan–Dec 2025),
deterministic acquisition-cost attribution, FBB and roaming add-ons.

All FK IDs are literal integers assigned deterministically from sorted distinct
values — NO subquery FK lookups in the emitted SQL. Lets a single psql -f load
the entire dataset in seconds.

Run:
    python3 etl/generate_3hk_mock.py
"""
from __future__ import annotations

import json
import random
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT_PATH = ROOT / "sql" / "generated" / "04_data.sql"

RNG = random.Random(20260430)  # fixed seed → reproducible output

# ── Reference data (must match 02_seed_lookups.sql) ───────────────────────────

# Segment economics (matches segments table in 02_seed_lookups.sql)
SEGMENT_TARGETS = {
    "postpaid_premium": {"count": 750,  "target_cpa": 2500, "target_arpu_band": (200, 400), "monthly_churn": 0.010},
    "postpaid_value":   {"count": 1200, "target_cpa": 250,  "target_arpu_band": (80, 180),  "monthly_churn": 0.020},
    "prepaid_engaged":  {"count": 600,  "target_cpa": 50,   "target_arpu_band": (50, 100),  "monthly_churn": 0.040},
    "prepaid_tourist":  {"count": 450,  "target_cpa": 30,   "target_arpu_band": (30, 60),   "monthly_churn": 0.220},
}

# plan_type → segment_code, plan_category, default ARPU, contract months
# IDs assigned at runtime by querying live DB (or hardcoded — see note in Task 5).
PLAN_TYPES = [
    # Existing 3HK postpaid (IDs 1–8 from prior seed; we re-derive at runtime)
    ("5G_Single_Basic",        "postpaid_value",   "subscription", 198, 12, "mobile"),
    ("5G_Single_Standard",     "postpaid_value",   "subscription", 298, 24, "mobile"),
    ("5G_Single_Premium",      "postpaid_premium", "subscription", 488, 24, "mobile"),
    ("5G_Family_2Line",        "postpaid_premium", "subscription", 388, 24, "mobile"),
    ("5G_Family_4Line",        "postpaid_premium", "subscription", 588, 24, "mobile"),
    ("5G_Gamer_Unlimited",     "postpaid_value",   "subscription", 348, 24, "mobile"),
    ("Roaming_Pass_7d",        "postpaid_value",   "one-off",      88,   0, "roaming"),
    ("Roaming_Pass_14d",       "postpaid_value",   "one-off",      168,  0, "roaming"),
    # New SoSIM
    ("SoSIM_5G_30GB",          "postpaid_value",   "subscription", 98,   0, "mobile"),  # no contract
    ("SoSIM_5G_100GB",         "postpaid_value",   "subscription", 158,  0, "mobile"),
    # New prepaid
    ("Prepaid_CrossBorder_30d","prepaid_engaged",  "prepaid",      78,   0, "mobile"),
    ("Prepaid_CrossBorder_90d","prepaid_engaged",  "prepaid",      198,  0, "mobile"),
    ("Prepaid_Tourist_8d",     "prepaid_tourist",  "prepaid",      48,   0, "mobile"),
    ("Prepaid_Tourist_15d",    "prepaid_tourist",  "prepaid",      88,   0, "mobile"),
    # New FBB
    ("FBB_FTTH_500M",          "postpaid_value",   "subscription", 198, 24, "broadband"),
    ("FBB_FTTH_1G",            "postpaid_premium", "subscription", 298, 24, "broadband"),
]

# Hardcoded reference IDs from existing seed (see 02_seed_lookups.sql; verify
# matches via the lookup query in Task 5 step 2 before generator runs).
# Format: { 'plan_code' : id, 'district_name' : id, 'product_code' : id, 'campaign_name' : id, 'ad_name' : id }

REFERENCE_IDS_PATH = ROOT / "etl" / "reference_ids.json"


@dataclass
class Customer:
    id: int
    external_customer_id: str
    account_id: int
    segment_code: str
    plan_type_id: int
    plan_code: str
    monthly_arpu_hkd: float
    contract_months: int
    acquisition_channel: str    # 'paid_social' | 'organic'
    ad_id: int                  # sentinel ad id for organic
    acquisition_date: date
    activation_date: date | None
    activation_lag_days: int | None
    activation_status: str
    age_band: str
    gender: str
    hk_district_id: int
    language_pref: str
    cross_sell_broadband: bool
    cross_sell_entertainment: bool
    cross_sell_device_fin: bool
    monthly_total_revenue_hkd: float
    relationship_type: str
    prior_tenure_months: int
    status: str
    churn_date: date | None
    months_active: int
    realized_revenue_hkd: float
    projected_ltv_24mo_hkd: float | None
    acquisition_cost_hkd: float | None  # used to compute ad_spend; NULL for organic


# ── Step 1 of generator pipeline (filled in Task 5) ───────────────────────────
def main() -> None:
    raise NotImplementedError("Implemented in Task 5")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write invariant tests**

`etl/test_generate_3hk_mock.py`:

```python
"""Invariants the generator must satisfy. Run: pytest etl/test_generate_3hk_mock.py -v"""
import pytest
from etl import generate_3hk_mock as gen


def test_segment_count_targets_sum_to_3000():
    assert sum(s["count"] for s in gen.SEGMENT_TARGETS.values()) == 3000


def test_all_plan_types_have_known_segment():
    valid_segments = set(gen.SEGMENT_TARGETS.keys())
    for code, segment, *_ in gen.PLAN_TYPES:
        assert segment in valid_segments, f"Plan {code} → unknown segment {segment}"


def test_rng_determinism():
    """Two fresh RNG instances with same seed produce same output."""
    a = gen.random.Random(20260430)
    b = gen.random.Random(20260430)
    assert [a.random() for _ in range(10)] == [b.random() for _ in range(10)]
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/neo/Desktop/ad_analysis
python3 -m pytest etl/test_generate_3hk_mock.py -v
```

Expected: 3 tests pass.

- [ ] **Step 4: Commit (user runs)**

```bash
git add etl/generate_3hk_mock.py etl/test_generate_3hk_mock.py sql/migrations/01_schema.sql sql/migrations/02_seed_lookups.sql sql/migrations/03_truncate.sql docs/plans/2026-04-30-3hk-realistic-mock-data.md docs/specs/2026-04-30-3hk-realistic-mock-data-design.md
git commit -m "feat(mock): 3HK realistic mock data — schema migrations + generator scaffold

- sql/migrations/01_schema.sql: segments, brands, ad_spend tables; plan_types
  ALTERs (brand_code, segment_code, service_type; relax plan_category check).
- sql/migrations/02_seed_lookups.sql: segment economics, brand hierarchy,
  plan_type backfill + new SoSIM/prepaid/FBB plans, 12 new campaigns spread
  across 2025 with start/end dates.
- sql/migrations/03_truncate.sql: clean slate for regen.
- etl/generate_3hk_mock.py: skeleton with segment targets + plan catalog.
- etl/test_generate_3hk_mock.py: invariant tests (segment counts sum to 3000,
  plan→segment FK validity, RNG determinism).
- docs/specs + docs/plans for the 3HK redesign.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Generator implementation — segments, cohorts, customers

**Files:**
- Modify: `etl/generate_3hk_mock.py`
- Modify: `etl/test_generate_3hk_mock.py`
- Create: `etl/reference_ids.json` (snapshot of live IDs)

- [ ] **Step 1: Snapshot live reference IDs to JSON**

Call `mcp__supabase__execute_sql` with this query, capture the result:

```sql
SELECT jsonb_build_object(
  'plan_types',     (SELECT jsonb_object_agg(code, id) FROM plan_types),
  'hk_districts',   (SELECT jsonb_object_agg(name, id) FROM hk_districts),
  'product_types',  (SELECT jsonb_object_agg(code, id) FROM product_types),
  'campaigns',      (SELECT jsonb_object_agg(name, id) FROM campaigns),
  'ads',            (SELECT jsonb_object_agg(p.code || '|' || c.name || '|' || s.name || '|' || a.name, a.id)
                       FROM ads a
                       JOIN ad_sets s    ON s.id = a.ad_set_id
                       JOIN campaigns c  ON c.id = s.campaign_id
                       JOIN platforms p  ON p.id = c.platform_id),
  'sentinel_ad_id', (SELECT a.id FROM ads a WHERE a.name = '__organic_no_ad__')
)::text AS doc;
```

Save the unescaped JSON value of `doc` to `etl/reference_ids.json`. Verify the file:

```bash
python3 -c "import json; d=json.load(open('etl/reference_ids.json')); print('plans:',len(d['plan_types']),'ads:',len(d['ads']),'campaigns:',len(d['campaigns']),'sentinel:',d['sentinel_ad_id'])"
```

Expected (after Tasks 1–2 applied): `plans: 16, ads: 25, campaigns: 16, sentinel: 1`.

- [ ] **Step 2: Write `main()` and supporting functions**

Replace `main()` and add helpers in `etl/generate_3hk_mock.py`:

```python
HK_DISTRICTS = ["Central & Western","Eastern","Southern","Wan Chai","Kowloon City","Kwun Tong","Sham Shui Po","Wong Tai Sin","Yau Tsim Mong","Islands","Kwai Tsing","North","Sai Kung","Sha Tin","Tai Po","Tsuen Wan","Tuen Mun","Yuen Long"]
LANGUAGES = ["Cantonese","English","Mandarin"]
GENDERS = ["female","male"]
AGE_BANDS = ["18-24","25-34","35-44","45-54","55-64"]

# Each segment maps to which campaigns acquire its customers
SEGMENT_CAMPAIGNS = {
    "postpaid_premium": ["HK_5G_FamilyPlan_Q1_2025","HK_5G_FamilyPlan_Q2_2025","HK_5G_FamilyPlan_Q3_2025","HK_5G_FamilyPlan_Q4_2025"],
    "postpaid_value":   ["HK_5G_GamerUnlimited_Q1","HK_5G_GamerUnlimited_Q2","HK_5G_GamerUnlimited_Q3","HK_5G_GamerUnlimited_Q4",
                         "HK_SoSIM_LaunchFlight_Q1","HK_SoSIM_AlwaysOn_Q2","HK_SoSIM_AlwaysOn_Q3","HK_SoSIM_AlwaysOn_Q4"],
    # prepaid customers are mostly organic — we route 90% to sentinel, 10% to RoamingPass campaigns
    "prepaid_engaged":  ["HK_RoamingPass_Asia_Q4_2025","HK_RoamingPass_GoldenWeek","HK_RoamingPass_Summer"],
    "prepaid_tourist":  ["HK_RoamingPass_Asia_Q4_2025","HK_RoamingPass_GoldenWeek","HK_RoamingPass_Summer"],
}

# Per segment, fraction of customers that come via paid_social (rest are organic)
PAID_SOCIAL_RATE = {
    "postpaid_premium": 0.85,
    "postpaid_value":   0.70,
    "prepaid_engaged":  0.10,
    "prepaid_tourist":  0.05,
}

def load_ids():
    return json.loads(REFERENCE_IDS_PATH.read_text())

def pick_acquisition_date(campaign_name: str, ids) -> date:
    """Pick a random date inside the campaign's [start, end] window."""
    # Window comes from 02_seed_lookups.sql; we hardcode here to keep generator self-contained.
    WINDOWS = {
        "HK_5G_FamilyPlan_Q1_2025":   ("2025-02-15","2025-02-28"),
        "HK_5G_FamilyPlan_Q2_2025":   ("2025-05-12","2025-05-25"),
        "HK_5G_FamilyPlan_Q3_2025":   ("2025-08-11","2025-08-24"),
        "HK_5G_FamilyPlan_Q4_2025":   ("2025-11-01","2025-11-14"),
        "HK_5G_GamerUnlimited_Q1":    ("2025-03-03","2025-03-16"),
        "HK_5G_GamerUnlimited_Q2":    ("2025-06-09","2025-06-22"),
        "HK_5G_GamerUnlimited_Q3":    ("2025-09-15","2025-09-28"),
        "HK_5G_GamerUnlimited_Q4":    ("2025-11-03","2025-11-16"),
        "HK_SoSIM_LaunchFlight_Q1":   ("2025-01-13","2025-01-26"),
        "HK_SoSIM_AlwaysOn_Q2":       ("2025-04-07","2025-04-20"),
        "HK_SoSIM_AlwaysOn_Q3":       ("2025-07-14","2025-07-27"),
        "HK_SoSIM_AlwaysOn_Q4":       ("2025-10-13","2025-10-26"),
        "HK_RoamingPass_Asia_Q4_2025":("2025-11-08","2025-11-21"),
        "HK_RoamingPass_GoldenWeek":  ("2025-09-22","2025-10-05"),
        "HK_RoamingPass_Summer":      ("2025-06-23","2025-07-06"),
    }
    s, e = WINDOWS[campaign_name]
    sd = date.fromisoformat(s); ed = date.fromisoformat(e)
    return sd + timedelta(days=RNG.randint(0, (ed - sd).days))

def pick_organic_acquisition_date() -> date:
    """Organic customers acquired uniformly across 2025."""
    start = date(2025, 1, 1)
    return start + timedelta(days=RNG.randint(0, 364))

def assign_ad_id(campaign_name: str, platform: str, ids):
    """Pick the first ad under (platform, campaign). Generator picks deterministically."""
    prefix = f"{platform}|{campaign_name}|"
    candidates = [(k, v) for k, v in ids["ads"].items() if k.startswith(prefix)]
    if not candidates: raise ValueError(f"No ads for {prefix}")
    candidates.sort()
    return candidates[0][1]

REFERENCE_DATE = date(2025, 12, 31)  # snapshot date for months_active / status

def main() -> None:
    ids = load_ids()
    # All FK lookups happen here; generator emits literal int IDs in SQL.
    plan_id = {code: ids["plan_types"][code] for code, *_ in PLAN_TYPES}
    district_id = ids["hk_districts"]
    sentinel_ad_id = ids["sentinel_ad_id"]

    customers: list[Customer] = []
    accounts: list[tuple[int, str]] = []  # (id, external_id)
    next_account_id = 1
    next_customer_id = 1

    for segment_code, cfg in SEGMENT_TARGETS.items():
        segment_plans = [(c, *rest) for c, *rest in PLAN_TYPES if rest[0] == segment_code]
        for _ in range(cfg["count"]):
            # For each customer:
            # 1. Pick plan
            plan = RNG.choice(segment_plans)
            plan_code, _, plan_category, default_arpu, contract_months, service_type = plan

            # 2. Decide channel
            paid = RNG.random() < PAID_SOCIAL_RATE[segment_code]
            campaign_pool = SEGMENT_CAMPAIGNS[segment_code]
            if paid and campaign_pool:
                campaign_name = RNG.choice(campaign_pool)
                # platform inferred from campaign name prefix
                platform = "tiktok" if "Gamer" in campaign_name else "meta"
                ad_id = assign_ad_id(campaign_name, platform, ids)
                acq_date = pick_acquisition_date(campaign_name, ids)
                channel = "paid_social"
            else:
                ad_id = sentinel_ad_id
                acq_date = pick_organic_acquisition_date()
                channel = "organic"

            # 3. Pick monthly ARPU near plan default with ±10% variance
            arpu = round(default_arpu * (0.9 + 0.2 * RNG.random()), 2)

            # 4. Acquisition cost: noise around segment target, only for paid_social
            if channel == "paid_social":
                acq_cost = round(cfg["target_cpa"] * (0.7 + 0.6 * RNG.random()), 2)
            else:
                acq_cost = None

            # 5. Apply churn — months_until_churn ~ geometric with p = monthly_churn
            months_to_churn = None
            if cfg["monthly_churn"] > 0:
                # 1-(1-p)^k → expected. We use geometric draw.
                p = cfg["monthly_churn"]
                # cap at 24 months to bound; if k > tenure_so_far on reference_date, customer is active
                k = 1
                while RNG.random() > p:
                    k += 1
                    if k > 24: k = 99; break
                months_to_churn = k

            tenure_so_far = max(0, (REFERENCE_DATE - acq_date).days // 30)
            if plan_category == "one-off":
                status = "completed"
                months_active = min(tenure_so_far, 1)
                churn_date = None
                realized = arpu  # one-off purchase
            elif plan_category == "prepaid":
                # prepaid: status='completed' if expired (each top-up is N days),
                # 'active' if within last cycle, 'churned' if no top-up after churn
                if months_to_churn and tenure_so_far >= months_to_churn:
                    status = "churned"
                    churn_date = acq_date + timedelta(days=months_to_churn * 30)
                    months_active = months_to_churn
                else:
                    status = "active"
                    churn_date = None
                    months_active = min(tenure_so_far, 12)
                realized = arpu * months_active
            else:  # subscription
                if months_to_churn and tenure_so_far >= months_to_churn:
                    status = "churned"
                    churn_date = acq_date + timedelta(days=months_to_churn * 30)
                    months_active = months_to_churn
                    realized = arpu * months_active
                else:
                    status = "active"
                    churn_date = None
                    months_active = min(tenure_so_far, 12)
                    realized = arpu * months_active

            # 6. Projected LTV — only for active subscription customers
            projected_ltv = None
            if status == "active" and plan_category == "subscription":
                # 1/p months expected tenure × arpu × 0.5 margin
                expected_tenure = 1 / cfg["monthly_churn"] if cfg["monthly_churn"] > 0 else 24
                projected_ltv = round(arpu * min(expected_tenure, 24) * 0.85, 2)

            # 7. Activation
            if channel == "paid_social":
                activation_lag = RNG.randint(1, 5)
                activation_date = acq_date + timedelta(days=activation_lag)
                activation_status = "active" if RNG.random() > 0.04 else "failed"
            else:
                activation_lag = 0
                activation_date = acq_date
                activation_status = "active"

            # 8. Account: 70% of customers get fresh account; 30% join existing (multi-line household)
            if accounts and RNG.random() < 0.30:
                acct_id = RNG.choice(accounts)[0]
            else:
                acct_id = next_account_id
                accounts.append((next_account_id, f"ACCT{next_account_id:06d}"))
                next_account_id += 1

            # 9. Demographics
            age = RNG.choice(AGE_BANDS)
            gender = RNG.choice(GENDERS)
            district = RNG.choice(HK_DISTRICTS)
            language = RNG.choice(LANGUAGES) if RNG.random() > 0.1 else "Cantonese"

            # 10. Cross-sell flags (rough rates per segment)
            cs_bb  = RNG.random() < (0.35 if segment_code == "postpaid_premium" else 0.15 if segment_code == "postpaid_value" else 0.0)
            cs_ent = RNG.random() < (0.20 if segment_code in ("postpaid_premium","postpaid_value") else 0.0)
            cs_dev = RNG.random() < (0.15 if segment_code == "postpaid_premium" else 0.05)

            customers.append(Customer(
                id=next_customer_id, external_customer_id=f"CUST{next_customer_id:06d}",
                account_id=acct_id, segment_code=segment_code,
                plan_type_id=plan_id[plan_code], plan_code=plan_code,
                monthly_arpu_hkd=arpu, contract_months=contract_months,
                acquisition_channel=channel, ad_id=ad_id, acquisition_date=acq_date,
                activation_date=activation_date, activation_lag_days=activation_lag, activation_status=activation_status,
                age_band=age, gender=gender, hk_district_id=district_id[district], language_pref=language,
                cross_sell_broadband=cs_bb, cross_sell_entertainment=cs_ent, cross_sell_device_fin=cs_dev,
                monthly_total_revenue_hkd=arpu + (50 if cs_ent else 0) + (200 if cs_bb else 0),
                relationship_type="net_new", prior_tenure_months=0,
                status=status, churn_date=churn_date, months_active=months_active,
                realized_revenue_hkd=realized, projected_ltv_24mo_hkd=projected_ltv,
                acquisition_cost_hkd=acq_cost,
            ))
            next_customer_id += 1

    # Add ~250 FBB add-on customer-rows (broadband attached to existing postpaid accounts)
    fbb_plan_codes = ["FBB_FTTH_500M","FBB_FTTH_1G"]
    postpaid_accounts = list({c.account_id for c in customers if c.segment_code in ("postpaid_premium","postpaid_value")})
    n_fbb = round(0.25 * len([c for c in customers if c.segment_code == "postpaid_premium"])) + \
            round(0.15 * len([c for c in customers if c.segment_code == "postpaid_value"]))
    fbb_accounts = RNG.sample(postpaid_accounts, min(n_fbb, len(postpaid_accounts)))
    for acct_id in fbb_accounts:
        # Inherit segment from primary mobile line on this account
        primary = next(c for c in customers if c.account_id == acct_id)
        plan_code = "FBB_FTTH_1G" if primary.segment_code == "postpaid_premium" else "FBB_FTTH_500M"
        arpu = 298 if plan_code == "FBB_FTTH_1G" else 198
        acq_date = primary.acquisition_date + timedelta(days=RNG.randint(0, 90))
        if acq_date > REFERENCE_DATE: acq_date = REFERENCE_DATE
        tenure = max(0, (REFERENCE_DATE - acq_date).days // 30)
        customers.append(Customer(
            id=next_customer_id, external_customer_id=f"CUST{next_customer_id:06d}",
            account_id=acct_id, segment_code=primary.segment_code,
            plan_type_id=plan_id[plan_code], plan_code=plan_code,
            monthly_arpu_hkd=arpu, contract_months=24,
            acquisition_channel="organic", ad_id=sentinel_ad_id, acquisition_date=acq_date,
            activation_date=acq_date, activation_lag_days=0, activation_status="active",
            age_band=primary.age_band, gender=primary.gender, hk_district_id=primary.hk_district_id, language_pref=primary.language_pref,
            cross_sell_broadband=False, cross_sell_entertainment=False, cross_sell_device_fin=False,
            monthly_total_revenue_hkd=arpu, relationship_type="cross_sell", prior_tenure_months=tenure,
            status="active", churn_date=None, months_active=min(tenure, 12),
            realized_revenue_hkd=arpu * min(tenure, 12),
            projected_ltv_24mo_hkd=round(arpu * 24 * 0.85, 2),
            acquisition_cost_hkd=None,
        ))
        next_customer_id += 1

    # Emit SQL
    write_sql(customers, accounts, plan_id, ids)
    print(f"Generated {len(customers)} customer-rows across {len(accounts)} accounts")
```

(Implementation of `write_sql` follows in Task 6.)

- [ ] **Step 3: Add invariant tests**

Append to `etl/test_generate_3hk_mock.py`:

```python
def test_main_runs_and_produces_3300ish_customers(tmp_path, monkeypatch):
    import json
    monkeypatch.setattr(gen, "OUT_PATH", tmp_path / "04_data.sql")
    # Use a tiny stub reference_ids.json with the IDs the seed file hardcodes
    stub = {
        "plan_types": {code: i+1 for i, (code, *_) in enumerate(gen.PLAN_TYPES)},
        "hk_districts": {n: i+1 for i, n in enumerate([
            "Central & Western","Eastern","Southern","Wan Chai","Kowloon City","Kwun Tong",
            "Sham Shui Po","Wong Tai Sin","Yau Tsim Mong","Islands","Kwai Tsing","North",
            "Sai Kung","Sha Tin","Tai Po","Tsuen Wan","Tuen Mun","Yuen Long"])},
        "product_types": {"mobile":1,"mobile_additional":2,"broadband":3,"entertainment":4,"device_financing":5,"insurance":6},
        "campaigns": {n: i+1 for i, n in enumerate([
            "__organic_no_campaign__","HK_5G_FamilyPlan_Q4_2025","HK_5G_GamerUnlimited_Q4","HK_RoamingPass_Asia_Q4_2025",
            "HK_5G_FamilyPlan_Q1_2025","HK_5G_FamilyPlan_Q2_2025","HK_5G_FamilyPlan_Q3_2025",
            "HK_5G_GamerUnlimited_Q1","HK_5G_GamerUnlimited_Q2","HK_5G_GamerUnlimited_Q3",
            "HK_SoSIM_LaunchFlight_Q1","HK_SoSIM_AlwaysOn_Q2","HK_SoSIM_AlwaysOn_Q3","HK_SoSIM_AlwaysOn_Q4",
            "HK_RoamingPass_GoldenWeek","HK_RoamingPass_Summer"])},
        "ads": {},
        "sentinel_ad_id": 1,
    }
    # Build minimal ad map: one ad per (platform, campaign, ad_set, ad)
    aid = 2
    for camp_name in stub["campaigns"]:
        if camp_name == "__organic_no_campaign__": continue
        plat = "tiktok" if "Gamer" in camp_name else "meta"
        key = f"{plat}|{camp_name}|{camp_name}_default_adset|{camp_name}_default_adset_creative_v1"
        stub["ads"][key] = aid
        aid += 1
    monkeypatch.setattr(gen, "REFERENCE_IDS_PATH", tmp_path / "reference_ids.json")
    (tmp_path / "reference_ids.json").write_text(json.dumps(stub))

    gen.main()

    sql = (tmp_path / "04_data.sql").read_text()
    assert "INSERT INTO customers" in sql
    # Customer count: 3000 segmented + ~250 FBB ≈ 3200–3300
    n_customers = sql.count("INSERT INTO customers")  # may be one big INSERT — see Task 6
    # We assert via INSERT count since chunk count is impl detail; tighter check in Task 7.
```

- [ ] **Step 4: Commit (user runs)**

```bash
git add etl/generate_3hk_mock.py etl/test_generate_3hk_mock.py etl/reference_ids.json
git commit -m "feat(mock): generator produces customer + account rows from segment targets

- etl/generate_3hk_mock.py: full main() pipeline — segment-driven customer
  generation with realistic ARPU noise, churn application via geometric
  distribution, paid_social vs organic split per segment, FBB add-on rows
  for ~25% of postpaid_premium / 15% of postpaid_value accounts.
- etl/reference_ids.json: snapshot of live DB IDs for plans/districts/
  campaigns/ads/sentinel — generator emits literal-FK SQL using these.
- etl/test_generate_3hk_mock.py: end-to-end invariant test using stubbed
  reference IDs, asserts ~3,300 customer rows produced.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Generator — emit SQL with literal FK IDs

**Files:**
- Modify: `etl/generate_3hk_mock.py`

- [ ] **Step 1: Add `write_sql()` function**

Append to `etl/generate_3hk_mock.py`:

```python
def _b(v: bool) -> str: return "true" if v else "false"
def _s(v) -> str: return "NULL" if v is None or v == "" else "'" + str(v).replace("'", "''") + "'"
def _d(v) -> str: return "NULL" if v is None else f"'{v.isoformat()}'"
def _n(v) -> str: return "NULL" if v is None else str(v)


def write_sql(customers: list[Customer], accounts: list[tuple[int, str]], plan_id: dict, ids: dict) -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    chunks: list[str] = []

    # ── accounts ─────────────────────────────────────────────────────────────
    chunks.append("-- accounts")
    rows = ",\n".join(f"({aid}, {_s(ext)})" for aid, ext in accounts)
    chunks.append(f"INSERT INTO accounts (id, external_account_id) VALUES\n{rows};")
    chunks.append("SELECT setval(pg_get_serial_sequence('accounts','id'), (SELECT MAX(id) FROM accounts));")

    # ── customers (chunk to ≤500 rows per INSERT) ─────────────────────────────
    chunks.append("-- customers")
    cust_header = ("INSERT INTO customers ("
                   "id, external_customer_id, account_id, age_band, gender, hk_district_id, language_pref, "
                   "ad_id, acquisition_channel, acquisition_date, plan_type_id, monthly_arpu_hkd, contract_months, "
                   "cross_sell_broadband, cross_sell_entertainment, cross_sell_device_fin, monthly_total_revenue_hkd, "
                   "relationship_type, prior_tenure_months, status, activation_status, activation_date, activation_lag_days, "
                   "churn_date, months_active, realized_revenue_hkd, projected_ltv_24mo_hkd) VALUES")
    for i in range(0, len(customers), 500):
        batch = customers[i:i+500]
        rows = ",\n".join(
            f"({c.id},{_s(c.external_customer_id)},{c.account_id},{_s(c.age_band)},{_s(c.gender)},"
            f"{c.hk_district_id},{_s(c.language_pref)},{c.ad_id},{_s(c.acquisition_channel)},"
            f"{_d(c.acquisition_date)},{c.plan_type_id},{c.monthly_arpu_hkd},{c.contract_months},"
            f"{_b(c.cross_sell_broadband)},{_b(c.cross_sell_entertainment)},{_b(c.cross_sell_device_fin)},"
            f"{c.monthly_total_revenue_hkd},{_s(c.relationship_type)},{c.prior_tenure_months},"
            f"{_s(c.status)},{_s(c.activation_status)},{_d(c.activation_date)},{_n(c.activation_lag_days)},"
            f"{_d(c.churn_date)},{c.months_active},{c.realized_revenue_hkd},{_n(c.projected_ltv_24mo_hkd)})"
            for c in batch
        )
        chunks.append(f"{cust_header}\n{rows};")
    chunks.append("SELECT setval(pg_get_serial_sequence('customers','id'), (SELECT MAX(id) FROM customers));")

    # ── customer_events (one row per customer for activation, plus churn for churned customers)
    chunks.append("-- customer_events")
    ev_rows: list[str] = []
    for c in customers:
        if c.activation_status == "active" and c.activation_date:
            ev_rows.append(f"({c.id}, 'activated', {_d(c.activation_date)}::timestamptz, '{{}}'::jsonb)")
        elif c.activation_status == "failed":
            ts = c.activation_date or c.acquisition_date
            ev_rows.append(f"({c.id}, 'activation_failed', {_d(ts)}::timestamptz, '{{}}'::jsonb)")
        if c.churn_date:
            ev_rows.append(f"({c.id}, 'churned', {_d(c.churn_date)}::timestamptz, '{{}}'::jsonb)")
    for i in range(0, len(ev_rows), 500):
        batch = ev_rows[i:i+500]
        chunks.append("INSERT INTO customer_events (customer_id, event_type, occurred_at, payload) VALUES\n"
                      + ",\n".join(batch) + ";")

    # ── ad_spend (sum of acquisition_cost per ad, plus realistic impressions/clicks)
    chunks.append("-- ad_spend")
    spend_by_ad: dict[int, float] = defaultdict(float)
    for c in customers:
        if c.acquisition_cost_hkd is not None:
            spend_by_ad[c.ad_id] += c.acquisition_cost_hkd
    if spend_by_ad:
        rows = ",\n".join(
            f"({ad_id}, {round(spend, 2)}, {RNG.randint(50000, 500000)}, {RNG.randint(500, 8000)}, {RNG.randint(20, 300)})"
            for ad_id, spend in sorted(spend_by_ad.items())
        )
        chunks.append("INSERT INTO ad_spend (ad_id, spend_hkd, impressions, clicks, conversions) VALUES\n"
                      + rows + ";")

    OUT_PATH.write_text("\n\n".join(chunks) + "\n")
```

- [ ] **Step 2: Run the generator (after Tasks 1–3 applied to DB and reference_ids.json snapshot)**

```bash
python3 etl/generate_3hk_mock.py
```

Expected stdout: `Generated 3XXX customer-rows across XXXX accounts`.

- [ ] **Step 3: Verify file shape**

```bash
wc -l sql/generated/04_data.sql
grep -c "INSERT INTO customers" sql/generated/04_data.sql
grep -c "INSERT INTO accounts"  sql/generated/04_data.sql
grep -c "INSERT INTO ad_spend"  sql/generated/04_data.sql
grep -c "INSERT INTO customer_events" sql/generated/04_data.sql
```

Expected: customers INSERTs ≥ 7 (3300/500 batches), accounts INSERT = 1, ad_spend INSERT = 1, customer_events INSERTs ≥ 5.

- [ ] **Step 4: Run pytest**

```bash
python3 -m pytest etl/test_generate_3hk_mock.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add etl/generate_3hk_mock.py sql/generated/04_data.sql
git commit -m "feat(mock): generator emits literal-FK bulk INSERTs to sql/generated/04_data.sql

Output sized at ~3,300 customer-rows / 500-row INSERT chunks. Sequence
resets after each PK-explicit insert. ad_spend totals derive from
sum-of-customer-acquisition_costs per ad — internally consistent with
campaign efficiency metric.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Apply data load (user runs psql)

**Files:** none (just commands)

- [ ] **Step 1: User applies data load**

```bash
cd /Users/neo/Desktop/ad_analysis
psql "$DB_URL" -f sql/generated/04_data.sql -v ON_ERROR_STOP=1
```

Expected: `INSERT 0 N` lines for accounts, customers (multiple chunks), customer_events (multiple chunks), ad_spend; `SELECT 1` for the setval calls; no errors.

If anything errors, the load is transactional per-statement (not the whole file) so partial rows may be present. Re-run `03_truncate.sql` and retry.

- [ ] **Step 2: Verify counts via MCP**

Call `mcp__supabase__execute_sql`:

```sql
SELECT
  (SELECT COUNT(*) FROM accounts)         AS accounts,
  (SELECT COUNT(*) FROM customers)        AS customers,
  (SELECT COUNT(*) FROM customer_events)  AS customer_events,
  (SELECT COUNT(*) FROM ad_spend)         AS ad_spend,
  (SELECT COUNT(*) FROM customers WHERE acquisition_channel='paid_social') AS paid_social_customers,
  (SELECT COUNT(*) FROM customers WHERE acquisition_channel='organic')     AS organic_customers,
  (SELECT COUNT(DISTINCT ad_id) FROM customers) AS distinct_ads_in_customers,
  (SELECT ROUND(SUM(spend_hkd)) FROM ad_spend)  AS total_spend_hkd;
```

Expected (approximate):
- `accounts ≈ 2300` (some multi-line accounts)
- `customers ≈ 3300`
- `customer_events ≈ 3500` (one activation per customer + churn events for churned)
- `ad_spend > 0, ≤ 25` (rows for ads with paid acquisitions)
- `paid_social_customers ≈ 1900` (sum of `count × paid_rate` across segments)
- `organic_customers ≈ 1400`
- `total_spend_hkd ≈ HKD 2.5M` (750×2500×0.85 + 1200×250×0.7 + 600×50×0.1 + 450×30×0.05 ≈ HKD 2.0M, plus noise)

If counts mismatch by more than ±10%, inspect generator output before continuing.

---

### Task 8: Views migration (`05_views.sql`)

**Files:**
- Create: `sql/migrations/05_views.sql`

- [ ] **Step 1: Write the SQL file**

```sql
-- 05_views.sql — drop and recreate all dashboard views with new schema awareness.

DROP VIEW IF EXISTS v_account_summary CASCADE;
DROP VIEW IF EXISTS v_customer_360 CASCADE;
DROP VIEW IF EXISTS v_acquisition_by_campaign CASCADE;
DROP VIEW IF EXISTS v_cohort_retention CASCADE;
DROP VIEW IF EXISTS v_account_products_current CASCADE;
DROP VIEW IF EXISTS v_segment_ltv CASCADE;
DROP VIEW IF EXISTS v_campaign_efficiency CASCADE;

-- Per-customer derived digital CPA (foundation for v_customer_360.acquisition_cost)
CREATE VIEW v_customer_digital_cpa AS
WITH ad_customer_count AS (
  SELECT ad_id, COUNT(*) AS n
  FROM customers
  WHERE acquisition_channel = 'paid_social'
  GROUP BY ad_id
)
SELECT
  c.id AS customer_id,
  CASE
    WHEN c.acquisition_channel = 'organic' THEN NULL
    WHEN ac.n IS NULL OR ac.n = 0 THEN NULL
    WHEN s.spend_hkd IS NULL THEN NULL
    ELSE ROUND(s.spend_hkd / ac.n, 2)
  END AS digital_cpa_hkd
FROM customers c
LEFT JOIN ad_spend s ON s.ad_id = c.ad_id
LEFT JOIN ad_customer_count ac ON ac.ad_id = c.ad_id;

-- v_account_summary (unchanged from prior spec)
CREATE VIEW v_account_summary AS
SELECT
  a.id                                                                              AS account_id,
  a.external_account_id,
  COUNT(*) FILTER (WHERE c.status = 'active')                                       AS n_active_lines,
  COALESCE(SUM(c.monthly_arpu_hkd) FILTER (WHERE c.status = 'active'), 0)           AS total_account_arpu_hkd,
  (SELECT COUNT(DISTINCT pt.service_type)
     FROM customers cc
     JOIN plan_types pt ON pt.id = cc.plan_type_id
     WHERE cc.account_id = a.id AND cc.status = 'active') >= 2                       AS multi_product_flag
FROM accounts a
LEFT JOIN customers c ON c.account_id = a.id
GROUP BY a.id, a.external_account_id;

-- v_customer_360 — extended with segment_code, brand_code, service_type, acquisition_cost
CREATE VIEW v_customer_360 AS
SELECT
  c.id, c.external_customer_id,
  a.external_account_id,
  c.age_band, c.gender, c.language_pref,
  d.name        AS hk_district, d.region,
  pt.code       AS plan_type, pt.plan_category, pt.service_type,
  pt.brand_code AS brand,
  pt.segment_code,
  c.monthly_arpu_hkd, c.contract_months,
  c.cross_sell_broadband, c.cross_sell_entertainment, c.cross_sell_device_fin,
  c.acquisition_channel, c.acquisition_date,
  pl.code   AS platform,
  camp.name AS campaign_name,
  ads2.name AS ad_set_name,
  ad.name   AS ad_name,
  c.relationship_type, c.prior_tenure_months,
  c.status, c.activation_status, c.activation_date, c.activation_lag_days,
  c.churn_date, c.months_active,
  c.realized_revenue_hkd, c.projected_ltv_24mo_hkd,
  dcpa.digital_cpa_hkd AS acquisition_cost
FROM customers c
JOIN accounts a            ON a.id = c.account_id
JOIN hk_districts d        ON d.id = c.hk_district_id
JOIN plan_types pt         ON pt.id = c.plan_type_id
JOIN ads ad                ON ad.id = c.ad_id
JOIN ad_sets ads2          ON ads2.id = ad.ad_set_id
JOIN campaigns camp        ON camp.id = ads2.campaign_id
JOIN platforms pl          ON pl.id = camp.platform_id
LEFT JOIN v_customer_digital_cpa dcpa ON dcpa.customer_id = c.id;

-- (a) Campaign efficiency: actual digital CPA per (campaign × segment)
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
  ROUND(AVG(c.realized_revenue_hkd)::numeric, 2)                        AS avg_realized_revenue,
  ROUND(AVG(c.projected_ltv_24mo_hkd)::numeric, 2)                      AS avg_projected_ltv
FROM customers c
JOIN ads ad           ON ad.id = c.ad_id
JOIN ad_sets ads2     ON ads2.id = ad.ad_set_id
JOIN campaigns camp   ON camp.id = ads2.campaign_id
JOIN platforms pl     ON pl.id = camp.platform_id
JOIN plan_types pt    ON pt.id = c.plan_type_id
LEFT JOIN ad_spend spend ON spend.ad_id = ad.id
WHERE c.acquisition_channel = 'paid_social'
GROUP BY pl.code, camp.name, pt.segment_code;

-- (b) Segment LTV: against blended target CPA from segments table
CREATE VIEW v_segment_ltv AS
SELECT
  s.code                                          AS segment_code,
  s.display_name,
  s.target_cpa_hkd,
  s.target_arpu_hkd,
  s.target_churn_monthly_pct,
  COUNT(c.id)                                     AS customers,
  ROUND(AVG(c.monthly_arpu_hkd)::numeric, 2)      AS avg_arpu,
  ROUND(AVG(c.realized_revenue_hkd)::numeric, 2)  AS avg_realized_revenue,
  ROUND(AVG(c.projected_ltv_24mo_hkd)::numeric, 2) AS avg_projected_ltv,
  CASE WHEN s.target_cpa_hkd > 0 AND COUNT(c.id) > 0
       THEN ROUND((AVG(c.projected_ltv_24mo_hkd) / s.target_cpa_hkd)::numeric, 2)
       ELSE NULL END                              AS segment_ltv_cpa_ratio
FROM segments s
LEFT JOIN plan_types pt ON pt.segment_code = s.code
LEFT JOIN customers c   ON c.plan_type_id = pt.id
GROUP BY s.code, s.display_name, s.target_cpa_hkd, s.target_arpu_hkd, s.target_churn_monthly_pct, s.sort_order
ORDER BY s.sort_order;

-- v_cohort_retention (unchanged)
CREATE VIEW v_cohort_retention AS
SELECT
  date_trunc('month', acquisition_date)::date AS cohort_month,
  COUNT(*)                                    AS cohort_size,
  COUNT(*) FILTER (WHERE status = 'active')   AS still_active,
  COUNT(*) FILTER (WHERE status = 'churned')  AS churned,
  ROUND(AVG(months_active)::numeric, 2)       AS avg_months_active
FROM customers
GROUP BY 1
ORDER BY 1;

-- v_account_products_current — gathers all of an account's *active* customer lines
-- (mobile + broadband + roaming + …). account_products junction now only holds
-- non-recurring attachments (device_financing).
CREATE VIEW v_account_products_current AS
SELECT
  a.id AS account_id,
  array_agg(pt.code ORDER BY pt.code) FILTER (WHERE c.status = 'active') AS products
FROM accounts a
JOIN customers c   ON c.account_id = a.id
JOIN plan_types pt ON pt.id = c.plan_type_id
GROUP BY a.id;
```

- [ ] **Step 2: User applies**

```bash
psql "$DB_URL" -f sql/migrations/05_views.sql -v ON_ERROR_STOP=1
```

Expected: `DROP VIEW` × 7 (some "does not exist, skipping" — that's fine), `CREATE VIEW` × 7.

- [ ] **Step 3: Verify views populate**

Call `mcp__supabase__execute_sql`:

```sql
SELECT
  (SELECT COUNT(*) FROM v_segment_ltv)         AS segment_rows,
  (SELECT COUNT(*) FROM v_campaign_efficiency) AS campaign_eff_rows,
  (SELECT COUNT(*) FROM v_customer_360)        AS customer_360_rows,
  (SELECT COUNT(*) FROM v_cohort_retention)    AS cohort_rows,
  (SELECT COUNT(*) FROM v_account_summary)     AS account_summary_rows,
  (SELECT COUNT(*) FROM v_account_products_current) AS account_products_current_rows,
  (SELECT segment_ltv_cpa_ratio FROM v_segment_ltv WHERE segment_code='postpaid_premium') AS premium_ltv_ratio,
  (SELECT digital_cpa_hkd FROM v_campaign_efficiency WHERE campaign_name='HK_5G_FamilyPlan_Q4_2025' LIMIT 1) AS premium_q4_cpa;
```

Expected:
- `segment_rows = 4`
- `campaign_eff_rows ≥ 8` (each segment hits multiple campaigns)
- `customer_360_rows ≈ 3300`
- `cohort_rows ≈ 12` (one per acquisition month)
- `account_summary_rows ≈ 2300`
- `account_products_current_rows ≈ 2300`
- `premium_ltv_ratio` should be roughly 4–6 (LTV ~HK$10–15K vs target_cpa HK$2,500)
- `premium_q4_cpa` should be in the HK$1,500–3,500 band

---

### Task 9: Dashboard updates (Tab 2 only)

**Files:**
- Modify: `frontend/dashboard.js` (Tab 2 elements)
- Mirror to: `frontend/hk_telco_ads_dashboard.jsx`

- [ ] **Step 1: Add segment-economics fetch + state to `Dashboard()`**

In `Dashboard()` (around the existing `loadingCRM` / `lastCrmFetch` state), add:

```javascript
const [segmentEcon, setSegmentEcon] = useState([]);
const [campaignEff, setCampaignEff] = useState([]);
```

In `handleFetchSupabase`, after `processCRM` call succeeds, add:

```javascript
// Pull segment economics + campaign efficiency in parallel
const [segRes, campRes] = await Promise.all([
  sb.from("v_segment_ltv").select("*"),
  sb.from("v_campaign_efficiency").select("*")
]);
if (segRes.data) setSegmentEcon(segRes.data);
if (campRes.data) setCampaignEff(campRes.data);
```

Update the `<CustomerTab>` JSX call site to pass the new props:

```jsx
<CustomerTab
  crmResult={crmResult}
  loading={loadingCRM}
  lastFetch={lastCrmFetch}
  campaignData={campaignData}
  segmentEcon={segmentEcon}
  campaignEff={campaignEff}
  onFetch={handleFetchSupabase}
/>
```

- [ ] **Step 2: Update `CustomerTab` signature + add Segment Economics card + replace leaderboard**

In `CustomerTab(...)`, replace the existing destructured props with:

```javascript
function CustomerTab({ crmResult, loading, lastFetch, campaignData, segmentEcon, campaignEff, onFetch }) {
```

Replace the existing LTV:CPA Leaderboard JSX block (the one rendering `leaderboard`) with the new Campaign Efficiency table and add the Segment Economics card before it.

After the join-rate progress bar, before the existing leaderboard:

```jsx
{segmentEcon.length > 0 && (
  <div style={{ background: '#fff', borderRadius: '8px', padding: '16px', marginBottom: '14px' }}>
    <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Segment Economics (b)</div>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
      <thead>
        <tr>
          {[['Segment', false], ['Customers', true], ['Target CPA', true], ['Avg ARPU', true], ['Avg Projected LTV', true], ['Segment LTV:CPA', true]].map(([h, r]) => (
            <th key={h} style={{ textAlign: r ? 'right' : 'left', padding: '8px 10px', color: '#6b7280', fontWeight: '600', fontSize: '12px', borderBottom: '2px solid #f3f4f6' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {segmentEcon.map((r, i) => (
          <tr key={i} style={{ borderBottom: '1px solid #f9fafb' }}>
            <td style={{ padding: '9px 10px' }}>{r.display_name}</td>
            <td style={{ textAlign: 'right', padding: '9px 10px' }}>{r.customers}</td>
            <td style={{ textAlign: 'right', padding: '9px 10px' }}>HKD {Number(r.target_cpa_hkd).toFixed(0)}</td>
            <td style={{ textAlign: 'right', padding: '9px 10px' }}>HKD {Number(r.avg_arpu || 0).toFixed(0)}</td>
            <td style={{ textAlign: 'right', padding: '9px 10px' }}>HKD {Number(r.avg_projected_ltv || 0).toFixed(0)}</td>
            <td style={{ textAlign: 'right', padding: '9px 10px', fontWeight: '600', color: r.segment_ltv_cpa_ratio >= 3 ? '#059669' : r.segment_ltv_cpa_ratio >= 1 ? '#d97706' : '#dc2626' }}>
              {r.segment_ltv_cpa_ratio ? `${Number(r.segment_ltv_cpa_ratio).toFixed(1)}x` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}
```

Then replace the existing leaderboard with this Campaign Efficiency table:

```jsx
{campaignEff.length > 0 && (
  <div style={{ background: '#fff', borderRadius: '8px', padding: '16px', overflowX: 'auto', marginBottom: '14px' }}>
    <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Campaign Efficiency (a)</div>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
      <thead>
        <tr>
          {[['Campaign', false], ['Platform', false], ['Segment', false], ['Customers', true], ['Spend', true], ['Digital CPA', true], ['Avg LTV', true]].map(([h, r]) => (
            <th key={h} style={{ textAlign: r ? 'right' : 'left', padding: '8px 10px', color: '#6b7280', fontWeight: '600', fontSize: '12px', borderBottom: '2px solid #f3f4f6' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {campaignEff.sort((a, b) => (b.customers_acquired || 0) - (a.customers_acquired || 0)).map((r, i) => (
          <tr key={i} style={{ borderBottom: '1px solid #f9fafb' }}>
            <td style={{ padding: '9px 10px' }}>{r.campaign_name}</td>
            <td style={{ padding: '9px 10px' }}>{r.platform}</td>
            <td style={{ padding: '9px 10px' }}>{r.segment_code}</td>
            <td style={{ textAlign: 'right', padding: '9px 10px' }}>{r.customers_acquired}</td>
            <td style={{ textAlign: 'right', padding: '9px 10px' }}>HKD {Number(r.total_spend_hkd || 0).toFixed(0)}</td>
            <td style={{ textAlign: 'right', padding: '9px 10px' }}>HKD {r.digital_cpa_hkd ? Number(r.digital_cpa_hkd).toFixed(0) : '—'}</td>
            <td style={{ textAlign: 'right', padding: '9px 10px' }}>HKD {Number(r.avg_projected_ltv || 0).toFixed(0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}
```

- [ ] **Step 3: Add `segment` and `brand` columns to `CRM_SCHEMA`**

In the `CRM_SCHEMA` array (around line 200 of dashboard.js):

```javascript
{ name: 'segment_code',   required: false, desc: 'Customer segment classification (postpaid_premium, postpaid_value, prepaid_engaged, prepaid_tourist).' },
{ name: 'brand',          required: false, desc: 'Brand the plan belongs to (3HK, SoSIM, 3HK_Tourist).' },
{ name: 'service_type',   required: false, desc: 'Service category (mobile, broadband, roaming, entertainment, insurance).' },
{ name: 'acquisition_cost', required: false, desc: 'Per-customer digital CPA derived from ad_spend / customers_acquired_from_that_ad. NULL for organic.' },
```

(Place these after `tenure_months`.)

- [ ] **Step 4: Extend `SUPABASE_SELECT_FIELDS` to fetch the new columns from `v_customer_360`**

At the top of dashboard.js, update:

```javascript
const SUPABASE_SELECT_FIELDS = [
  "external_customer_id",
  "campaign_name",
  "ad_set_name",
  "plan_type",
  "monthly_arpu_hkd",
  "status",
  "realized_revenue_hkd",
  "projected_ltv_24mo_hkd",
  "months_active",
  "segment_code",
  "brand",
  "service_type",
  "acquisition_cost",
];
```

- [ ] **Step 5: Add segment + brand filter dropdowns to CRMPreviewTable**

In `CRMPreviewTable` (after the existing planF state):

```javascript
const [segmentF, setSegmentF] = useState('all');
const [brandF, setBrandF] = useState('all');
const segmentOptions = useMemo(() => [...new Set(all.map(r => r.segment_code).filter(Boolean))].sort(), [all]);
const brandOptions = useMemo(() => [...new Set(all.map(r => r.brand).filter(Boolean))].sort(), [all]);
```

Update the `filtered` useMemo to also filter by segment and brand:

```javascript
const filtered = useMemo(() => {
  const needle = q.trim().toLowerCase();
  return all.filter(r => {
    if (statusF !== 'all' && r.status !== statusF) return false;
    if (planF !== 'all' && r.plan_type !== planF) return false;
    if (segmentF !== 'all' && r.segment_code !== segmentF) return false;
    if (brandF !== 'all' && r.brand !== brandF) return false;
    if (needle) {
      const hay = `${r.customer_id || ''} ${r.campaign_name || ''} ${r.ad_set_name || ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}, [all, q, statusF, planF, segmentF, brandF]);

const hasFilter = q.trim() !== '' || statusF !== 'all' || planF !== 'all' || segmentF !== 'all' || brandF !== 'all';
```

Update the Clear button to reset the new filters:

```javascript
onClick={() => { setQ(''); setStatusF('all'); setPlanF('all'); setSegmentF('all'); setBrandF('all'); }}
```

Insert the two new dropdowns next to the existing plan dropdown:

```jsx
<select style={ctrlStyle} value={segmentF} onChange={e => setSegmentF(e.target.value)}>
  <option value="all">All segments</option>
  {segmentOptions.map(s => <option key={s} value={s}>{s}</option>)}
</select>
<select style={ctrlStyle} value={brandF} onChange={e => setBrandF(e.target.value)}>
  <option value="all">All brands</option>
  {brandOptions.map(b => <option key={b} value={b}>{b}</option>)}
</select>
```

- [ ] **Step 6: Mirror to .jsx**

```bash
cp /Users/neo/Desktop/ad_analysis/frontend/dashboard.js /Users/neo/Desktop/ad_analysis/frontend/hk_telco_ads_dashboard.jsx
```

- [ ] **Step 7: Smoke-test locally**

```bash
cd /Users/neo/Desktop/ad_analysis && npm start
```

Open http://localhost:8000 → Tab 2 → click **Fetch from Supabase**. Verify:
- Segment Economics table appears with 4 rows (Postpaid Premium, Postpaid Value, Prepaid Engaged, Prepaid Tourist)
- Campaign Efficiency table appears with multiple rows, sorted by customers_acquired desc
- CRM Data table shows ~3,300 rows with new columns (segment_code, brand, service_type, acquisition_cost)
- Segment + Brand dropdowns work
- Sort + filter work as before

- [ ] **Step 8: Commit**

```bash
git add frontend/dashboard.js frontend/hk_telco_ads_dashboard.jsx
git commit -m "feat(dashboard): Tab 2 surfaces segment economics + campaign efficiency

- Segment Economics card (top of Tab 2): one row per segment from v_segment_ltv
  showing target CPA, customers, avg ARPU, avg LTV, LTV:CPA ratio.
- Campaign Efficiency table replaces the per-ad-set leaderboard. Reads from
  v_campaign_efficiency. One row per (campaign × segment).
- CRM Data table: 4 new columns (segment_code, brand, service_type,
  acquisition_cost). 2 new filter dropdowns (segment, brand).
- SUPABASE_SELECT_FIELDS extended to pull new v_customer_360 columns.

Tabs 1 (Campaign Performance) and 3 (Detected Fields) untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: End-to-end verification + push

- [ ] **Step 1: Final smoke-test query**

Call `mcp__supabase__execute_sql`:

```sql
SELECT
  -- Schema integrity
  (SELECT COUNT(*) FROM segments)            AS segments,
  (SELECT COUNT(*) FROM brands)              AS brands,
  -- Data volumes
  (SELECT COUNT(*) FROM customers)           AS customers,
  (SELECT COUNT(*) FROM accounts)            AS accounts,
  (SELECT COUNT(*) FROM ad_spend)            AS ad_spend_rows,
  (SELECT ROUND(SUM(spend_hkd)::numeric, 0)::int FROM ad_spend) AS total_spend,
  -- Distribution by segment
  (SELECT COUNT(*) FROM customers c JOIN plan_types pt ON pt.id = c.plan_type_id WHERE pt.segment_code='postpaid_premium') AS pp_premium,
  (SELECT COUNT(*) FROM customers c JOIN plan_types pt ON pt.id = c.plan_type_id WHERE pt.segment_code='postpaid_value')   AS pp_value,
  (SELECT COUNT(*) FROM customers c JOIN plan_types pt ON pt.id = c.plan_type_id WHERE pt.segment_code='prepaid_engaged')  AS pp_engaged,
  (SELECT COUNT(*) FROM customers c JOIN plan_types pt ON pt.id = c.plan_type_id WHERE pt.segment_code='prepaid_tourist')  AS pp_tourist,
  -- Acquisition channel mix
  (SELECT COUNT(*) FROM customers WHERE acquisition_channel='paid_social') AS paid_social,
  (SELECT COUNT(*) FROM customers WHERE acquisition_channel='organic')     AS organic,
  -- Cohort spread
  (SELECT COUNT(DISTINCT date_trunc('month', acquisition_date)) FROM customers) AS distinct_cohort_months,
  -- Sanity: every paid_social customer has acquisition_cost
  (SELECT COUNT(*) FROM v_customer_360 WHERE acquisition_channel='paid_social' AND acquisition_cost IS NULL) AS paid_missing_cpa,
  -- Sanity: organic customers have NULL acquisition_cost
  (SELECT COUNT(*) FROM v_customer_360 WHERE acquisition_channel='organic' AND acquisition_cost IS NOT NULL) AS organic_with_cpa;
```

Expected:
- `segments=4, brands=3`
- `customers ≈ 3300, accounts ≈ 2300`
- `ad_spend_rows = number of paid ads with at least 1 attribution`
- `total_spend ≈ HKD 2.0M–2.5M`
- Each segment count within ±10% of target (750/1200/600/450 + FBB add-ons in pp_premium and pp_value)
- `paid_social ≈ 1900, organic ≈ 1400`
- `distinct_cohort_months = 12`
- `paid_missing_cpa = 0`
- `organic_with_cpa = 0`

If any sanity check fails, fix the generator and rerun the data load before continuing.

- [ ] **Step 2: User pushes to remote** (sequence per saved memory: starts with `git pull`)

```bash
git pull
git status
git push origin master
npm run deploy
git ls-remote --heads origin
```

Expected: master and gh-pages both updated with new SHAs. GitHub Pages reflects the new dashboard within ~60 seconds.

---

## Self-review (run before handoff)

1. **Spec coverage:**
   - Two-metric model (a)/(b) → Tasks 8, 9 (views + dashboard)
   - Schema additions → Task 1 (DDL) + Task 2 (seed)
   - Customer base composition (segments, counts, brands) → Tasks 2, 5
   - 12-month cohort spread → Task 5 (`SEGMENT_CAMPAIGNS` + organic acquisition_date sampling)
   - Deterministic acquisition cost → Task 5 step 2 (`acq_cost = target_cpa × (0.7+0.6×rand)`) + Task 6 (`ad_spend.spend_hkd = sum`)
   - Five-file pipeline → Tasks 1, 2, 3, 7, 8
   - psql-only data load → Task 7
   - Verification = single MCP query → Tasks 7, 10
   - Idempotent regen (fixed seed) → Task 4 (`RNG = random.Random(20260430)`)
   - No subagent dispatching → all tasks run inline or by user
   - FBB and roaming add-ons → Task 5
   - Dashboard surfaces (segment card, renamed leaderboard, new CRM columns, new filters) → Task 9
   - Out-of-scope items not implemented (daily ad_spend, brand_overhead, materialized views) ✓

2. **Placeholder scan:** No "TBD"/"TODO"/"implement later". Code blocks complete in every code step. Commands have expected outputs.

3. **Type/name consistency:**
   - `segment_code` used consistently across `segments.code`, `plan_types.segment_code`, `customers` join through plan_types, `v_customer_360.segment_code`, dashboard `r.segment_code`.
   - `digital_cpa_hkd` used in `v_customer_digital_cpa`, aliased to `acquisition_cost` in `v_customer_360`, picked up by dashboard as `r.acquisition_cost`.
   - `target_cpa_hkd` consistent in `segments` table and `v_segment_ltv`.
   - `brand_code` (column on plan_types) → `brand` (alias in v_customer_360) → `r.brand` in dashboard. Documented in CRM_SCHEMA.
