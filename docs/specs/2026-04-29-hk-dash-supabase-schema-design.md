# hk_dash Supabase schema design

**Date:** 2026-04-29
**Project:** `hk_dash` (Supabase ref `mlsjehglsotapwvalbor`, ap-southeast-2)
**Source data:** `/Users/neo/Desktop/ad_analysis/data/crm_customers_v2.csv` — 679 rows, 35 cols, mock HK telco CRM.

## Purpose and approach

Hybrid OLTP + analytics schema in Postgres on Supabase. Normalized base tables for write integrity; plain SQL views as the dashboard read surface. Snapshot of current state plus a lightweight append-only event log for history.

Three explicit calls made during brainstorming:

1. **Account-level rollups (`n_active_lines`, `total_account_arpu_hkd`, `multi_product_flag`) are derived via view, not stored.** Single source of truth, no risk of drift; trivial cost at this scale; upgrade path to materialized view if it ever matters.
2. **`cross_sell_*` booleans live on `customers`** (sales-attribution at acquisition), separate from `account_products` (current account holdings). Different facts.
3. **`text + CHECK` constraint, not Postgres ENUM,** for fixed-vocabulary fields with no metadata (`status`, `activation_status`, `relationship_type`, `acquisition_channel`). Lookup tables for vocabularies that grow or carry metadata (`plan_types`, `product_types`, `hk_districts`, `platforms`).

## Architecture

```
DIM/LOOKUP             OPERATIONAL                     EVENTS
─────────────          ────────────────                ──────
plan_types             accounts                        customer_events
hk_districts           ├─ customers ──┐
product_types          │   └─ FKs → ads, plan, district
platforms              └─ account_products ←─ product_types
campaigns
ad_sets
ads
```

Foreign-key flow:
- `customers` → `accounts`, `plan_types`, `hk_districts`, `ads`
- `ads` → `ad_sets` → `campaigns` → `platforms`
- `account_products` → `accounts`, `product_types`
- `customer_events` → `customers`

## Marketing attribution tables

```sql
platforms (
  id            smallserial PK,
  code          text UNIQUE NOT NULL,        -- 'meta', 'tiktok', 'organic'
  display_name  text NOT NULL
)

campaigns (
  id            bigserial PK,
  name          text NOT NULL,                -- 'HK_5G_FamilyPlan_Q4_2025'
  platform_id   smallint NOT NULL REFERENCES platforms,
  start_date    date,
  end_date      date,
  UNIQUE (name, platform_id)
)

ad_sets (
  id            bigserial PK,
  name          text NOT NULL,                -- 'FamilyPlan_Parents_30-45_HK'
  campaign_id   bigint NOT NULL REFERENCES campaigns,
  UNIQUE (name, campaign_id)
)

ads (
  id            bigserial PK,
  name          text NOT NULL,                -- '5G_Family_Video_v1_Canto'
  ad_set_id     bigint NOT NULL REFERENCES ad_sets,
  UNIQUE (name, ad_set_id)
)
```

**Sentinel-row pattern for organic:** seed `platforms`/`campaigns`/`ad_sets`/`ads` with one "no-campaign" sentinel row per level. Organic customers FK to those rows so `customers.ad_id` and parents are always `NOT NULL`. Keeps queries simple (no LEFT JOIN), at the small cost of filtering sentinels out of campaign aggregates.

## Lookup/dim tables

```sql
hk_districts (
  id            smallserial PK,
  name          text UNIQUE NOT NULL,         -- 'Wan Chai'
  region        text                          -- 'HK Island' / 'Kowloon' / 'New Territories'
)

plan_types (
  id                       smallserial PK,
  code                     text UNIQUE NOT NULL,   -- '5G_Family_4Line'
  display_name             text NOT NULL,
  plan_category            text NOT NULL,          -- 'subscription' / 'pass'
  default_arpu_hkd         numeric(10,2),
  contract_months_default  smallint
)

product_types (
  id              smallserial PK,
  code            text UNIQUE NOT NULL,           -- 'mobile' / 'broadband' / ...
  display_name    text NOT NULL,
  category        text,                            -- 'connectivity' / 'content' / 'finance'
  is_subscription boolean NOT NULL DEFAULT true
)
```

Initial `product_types` seed: `mobile`, `mobile_additional`, `broadband`, `entertainment`, `device_financing`, `insurance`. Extended via `INSERT`, no migration needed.

## Operational tables

```sql
accounts (
  id                  bigserial PK,
  external_account_id text UNIQUE NOT NULL,        -- 'ACCT100001'
  created_at          timestamptz NOT NULL DEFAULT now()
)

customers (
  id                          bigserial PK,
  external_customer_id        text UNIQUE NOT NULL,   -- 'CUST100001'
  account_id                  bigint NOT NULL REFERENCES accounts,

  -- demographics
  age_band                    text NOT NULL,
  gender                      text NOT NULL,
  hk_district_id              smallint NOT NULL REFERENCES hk_districts,
  language_pref               text NOT NULL,

  -- attribution (sentinel rows for organic; never NULL)
  ad_id                       bigint NOT NULL REFERENCES ads,
  acquisition_channel         text NOT NULL CHECK (acquisition_channel IN ('paid_social','organic')),
  acquisition_date            date NOT NULL,

  -- subscription
  plan_type_id                smallint NOT NULL REFERENCES plan_types,
  monthly_arpu_hkd            numeric(10,2) NOT NULL,
  contract_months             smallint NOT NULL,
  cross_sell_broadband        boolean NOT NULL,
  cross_sell_entertainment    boolean NOT NULL,
  cross_sell_device_fin       boolean NOT NULL,
  monthly_total_revenue_hkd   numeric(10,2) NOT NULL,

  -- relationship at acquisition
  relationship_type           text NOT NULL CHECK (relationship_type IN ('net_new','add_line','cross_sell','reactivation')),
  prior_tenure_months         smallint NOT NULL DEFAULT 0,

  -- lifecycle (current state; history in customer_events)
  status                      text NOT NULL CHECK (status IN ('active','churned','completed','repeat_purchase')),
  activation_status           text NOT NULL CHECK (activation_status IN ('active','pending','failed')),
  activation_date             date,
  activation_lag_days         smallint,
  churn_date                  date,
  months_active               smallint NOT NULL DEFAULT 0,
  realized_revenue_hkd        numeric(10,2) NOT NULL DEFAULT 0,
  projected_ltv_24mo_hkd      numeric(10,2),

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
)

account_products (
  id                bigserial PK,
  account_id        bigint NOT NULL REFERENCES accounts,
  product_type_id   smallint NOT NULL REFERENCES product_types,
  acquired_at       date NOT NULL,
  removed_at        date,                              -- NULL = currently held
  UNIQUE (account_id, product_type_id, acquired_at)
)
```

## Event log

```sql
customer_events (
  id            bigserial PK,
  customer_id   bigint NOT NULL REFERENCES customers,
  event_type    text NOT NULL CHECK (event_type IN (
                  'activated','activation_failed','plan_changed',
                  'churned','reactivated','completed',
                  'cross_sell_added','product_added','product_removed'
                )),
  occurred_at   timestamptz NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
)

CREATE INDEX ON customer_events (customer_id, occurred_at DESC);
CREATE INDEX ON customer_events (event_type, occurred_at DESC);
```

`payload` is per-event-type:
- `plan_changed` → `{"from_plan_id": …, "to_plan_id": …}`
- `churned` → `{"reason": "…"}`
- `product_added` / `product_removed` → `{"product_type_id": …}`

### CSV → events backfill

When seeding from `crm_customers_v2.csv`:

| Source field(s) | Event |
|---|---|
| `activation_date` (when `activation_status='active'`) | `activated` at `activation_date` |
| `activation_status='failed'` | `activation_failed` at `acquisition_date + activation_lag_days` |
| `churn_date` (non-null) | `churned` at `churn_date` |
| Each item in `products_at_acquisition` | `product_added` at `acquisition_date` |
| Items in `products_now` not in `products_at_acquisition` | `product_added` at `acquisition_date` (placeholder), `payload.timestamp_estimated = true` |

The estimated-timestamp flag in payload makes it explicit which event timestamps are real vs backfilled. From go-live forward, real events carry real timestamps.

## Dashboard views (plain, not materialized)

```sql
v_account_summary
  -- per account: n_active_lines, total_account_arpu_hkd, multi_product_flag

v_customer_360
  -- one row per customer with all dim fields joined (CSV-equivalent shape)

v_acquisition_by_campaign
  -- platform, campaign_name, customers_acquired, customers_churned,
  -- avg_arpu, realized_revenue, projected_ltv

v_cohort_retention
  -- cohort_month, cohort_size, still_active, churned, avg_months_active

v_account_products_current
  -- account_id, products[] (recreates products_now, always current)
```

Plain views recompute on every read. At 679 rows everything stays sub-millisecond. Convert to `MATERIALIZED VIEW` per-view if scale or hot-path latency demands it.

## Out of scope (deliberate)

- Spend / cost data on campaigns. No source data yet.
- Trigger-driven materialization or `updated_at` auto-bumping. Add when needed.
- RLS policies. Will be defined alongside auth setup, not in this schema spec.
- Customer support / ticketing tables. Different domain.
- Index tuning beyond the two `customer_events` indexes. Add based on observed query patterns.
