# hk_dash Supabase schema implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the normalized + view-layer Supabase schema designed in `docs/specs/2026-04-29-hk-dash-supabase-schema-design.md`, then load `data/crm_customers_v2.csv` into it (679 customers, 634 accounts).

**Architecture:** DDL applied via Supabase MCP `apply_migration` (one migration per logical group). CSV ingestion via a Python script (`scripts/etl_csv_to_sql.py`) that emits four SQL files; those files are then applied via `apply_migration` in dependency order.

**Tech Stack:** Supabase Postgres 17 (project ref `mlsjehglsotapwvalbor`), Supabase MCP server (`apply_migration`, `execute_sql`, `list_tables`), Python 3 stdlib (`csv`, `pathlib`, `collections`).

**Notes:**
- Working directory: `/Users/neo/Desktop/ad_analysis` (git repo).
- Verification queries assume the ETL produced the expected counts (679 customers, 634 accounts, 13 ads, 8 ad_sets, 4 campaigns plus organic sentinels).
- `plan_category` vocabulary in source data is `subscription` and `one-off` (verified from CSV).
- All `apply_migration` calls go to `project_id="mlsjehglsotapwvalbor"`.

---

### Task 1: Migration — lookup/dim tables

**Files:**
- Apply via MCP: migration name `01_lookup_dims`

- [ ] **Step 1: Apply DDL via Supabase MCP**

Call `mcp__supabase__apply_migration` with:
- `project_id`: `mlsjehglsotapwvalbor`
- `name`: `01_lookup_dims`
- `query`:

```sql
CREATE TABLE hk_districts (
  id     smallserial PRIMARY KEY,
  name   text UNIQUE NOT NULL,
  region text
);

CREATE TABLE plan_types (
  id                       smallserial PRIMARY KEY,
  code                     text UNIQUE NOT NULL,
  display_name             text NOT NULL,
  plan_category            text NOT NULL CHECK (plan_category IN ('subscription','one-off')),
  default_arpu_hkd         numeric(10,2),
  contract_months_default  smallint
);

CREATE TABLE product_types (
  id              smallserial PRIMARY KEY,
  code            text UNIQUE NOT NULL,
  display_name    text NOT NULL,
  category        text,
  is_subscription boolean NOT NULL DEFAULT true
);

CREATE TABLE platforms (
  id           smallserial PRIMARY KEY,
  code         text UNIQUE NOT NULL,
  display_name text NOT NULL
);
```

- [ ] **Step 2: Verify tables exist**

Call `mcp__supabase__list_tables` with `project_id="mlsjehglsotapwvalbor"`, `schemas=["public"]`, `verbose=false`.
Expected: `hk_districts`, `plan_types`, `product_types`, `platforms` all listed.

---

### Task 2: Migration — marketing attribution tables

**Files:**
- Apply via MCP: migration name `02_attribution`

- [ ] **Step 1: Apply DDL via Supabase MCP**

Call `mcp__supabase__apply_migration` with:
- `project_id`: `mlsjehglsotapwvalbor`
- `name`: `02_attribution`
- `query`:

```sql
CREATE TABLE campaigns (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  platform_id smallint NOT NULL REFERENCES platforms(id),
  start_date  date,
  end_date    date,
  UNIQUE (name, platform_id)
);

CREATE TABLE ad_sets (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  campaign_id bigint NOT NULL REFERENCES campaigns(id),
  UNIQUE (name, campaign_id)
);

CREATE TABLE ads (
  id        bigserial PRIMARY KEY,
  name      text NOT NULL,
  ad_set_id bigint NOT NULL REFERENCES ad_sets(id),
  UNIQUE (name, ad_set_id)
);
```

- [ ] **Step 2: Verify tables exist**

Call `mcp__supabase__list_tables`. Expected new tables: `campaigns`, `ad_sets`, `ads`.

---

### Task 3: Migration — operational tables

**Files:**
- Apply via MCP: migration name `03_operational`

- [ ] **Step 1: Apply DDL via Supabase MCP**

Call `mcp__supabase__apply_migration` with:
- `project_id`: `mlsjehglsotapwvalbor`
- `name`: `03_operational`
- `query`:

```sql
CREATE TABLE accounts (
  id                  bigserial PRIMARY KEY,
  external_account_id text UNIQUE NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id                          bigserial PRIMARY KEY,
  external_customer_id        text UNIQUE NOT NULL,
  account_id                  bigint NOT NULL REFERENCES accounts(id),

  age_band                    text NOT NULL,
  gender                      text NOT NULL,
  hk_district_id              smallint NOT NULL REFERENCES hk_districts(id),
  language_pref               text NOT NULL,

  ad_id                       bigint NOT NULL REFERENCES ads(id),
  acquisition_channel         text NOT NULL CHECK (acquisition_channel IN ('paid_social','organic')),
  acquisition_date            date NOT NULL,

  plan_type_id                smallint NOT NULL REFERENCES plan_types(id),
  monthly_arpu_hkd            numeric(10,2) NOT NULL,
  contract_months             smallint NOT NULL,
  cross_sell_broadband        boolean NOT NULL,
  cross_sell_entertainment    boolean NOT NULL,
  cross_sell_device_fin       boolean NOT NULL,
  monthly_total_revenue_hkd   numeric(10,2) NOT NULL,

  relationship_type           text NOT NULL CHECK (relationship_type IN ('net_new','add_line','cross_sell','reactivation')),
  prior_tenure_months         smallint NOT NULL DEFAULT 0,

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
);

CREATE INDEX ON customers (account_id);
CREATE INDEX ON customers (ad_id);
CREATE INDEX ON customers (acquisition_date);
CREATE INDEX ON customers (status);

CREATE TABLE account_products (
  id              bigserial PRIMARY KEY,
  account_id      bigint NOT NULL REFERENCES accounts(id),
  product_type_id smallint NOT NULL REFERENCES product_types(id),
  acquired_at     date NOT NULL,
  removed_at      date,
  UNIQUE (account_id, product_type_id, acquired_at)
);

CREATE INDEX ON account_products (account_id);
```

- [ ] **Step 2: Verify tables exist**

Call `mcp__supabase__list_tables`. Expected new tables: `accounts`, `customers`, `account_products`.

---

### Task 4: Migration — event log table

**Files:**
- Apply via MCP: migration name `04_event_log`

- [ ] **Step 1: Apply DDL via Supabase MCP**

Call `mcp__supabase__apply_migration` with:
- `project_id`: `mlsjehglsotapwvalbor`
- `name`: `04_event_log`
- `query`:

```sql
CREATE TABLE customer_events (
  id          bigserial PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers(id),
  event_type  text NOT NULL CHECK (event_type IN (
                'activated','activation_failed','plan_changed',
                'churned','reactivated','completed',
                'cross_sell_added','product_added','product_removed'
              )),
  occurred_at timestamptz NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON customer_events (customer_id, occurred_at DESC);
CREATE INDEX ON customer_events (event_type, occurred_at DESC);
```

- [ ] **Step 2: Verify table exists**

Call `mcp__supabase__list_tables`. Expected new table: `customer_events`.

---

### Task 5: Migration — seed dim data + sentinel attribution rows

**Files:**
- Apply via MCP: migration name `05_seed_dims`

- [ ] **Step 1: Apply seed data via Supabase MCP**

Call `mcp__supabase__apply_migration` with:
- `project_id`: `mlsjehglsotapwvalbor`
- `name`: `05_seed_dims`
- `query`:

```sql
-- HK districts (18 districts grouped by region)
INSERT INTO hk_districts (name, region) VALUES
  ('Central & Western', 'HK Island'),
  ('Eastern',           'HK Island'),
  ('Southern',          'HK Island'),
  ('Wan Chai',          'HK Island'),
  ('Kowloon City',      'Kowloon'),
  ('Kwun Tong',         'Kowloon'),
  ('Sham Shui Po',      'Kowloon'),
  ('Wong Tai Sin',      'Kowloon'),
  ('Yau Tsim Mong',     'Kowloon'),
  ('Islands',           'New Territories'),
  ('Kwai Tsing',        'New Territories'),
  ('North',             'New Territories'),
  ('Sai Kung',          'New Territories'),
  ('Sha Tin',           'New Territories'),
  ('Tai Po',            'New Territories'),
  ('Tsuen Wan',         'New Territories'),
  ('Tuen Mun',          'New Territories'),
  ('Yuen Long',         'New Territories');

-- Plan types (8 plans observed in CSV)
INSERT INTO plan_types (code, display_name, plan_category) VALUES
  ('5G_Single_Basic',     '5G Single Basic',      'subscription'),
  ('5G_Single_Standard',  '5G Single Standard',   'subscription'),
  ('5G_Single_Premium',   '5G Single Premium',    'subscription'),
  ('5G_Family_2Line',     '5G Family 2-Line',     'subscription'),
  ('5G_Family_4Line',     '5G Family 4-Line',     'subscription'),
  ('5G_Gamer_Unlimited',  '5G Gamer Unlimited',   'subscription'),
  ('Roaming_Pass_7d',     'Roaming Pass 7-day',   'one-off'),
  ('Roaming_Pass_14d',    'Roaming Pass 14-day',  'one-off');

-- Product types
INSERT INTO product_types (code, display_name, category, is_subscription) VALUES
  ('mobile',            'Mobile line',            'connectivity', true),
  ('mobile_additional', 'Additional mobile line', 'connectivity', true),
  ('broadband',         'Home broadband',         'connectivity', true),
  ('entertainment',     'Entertainment bundle',   'content',      true),
  ('device_financing',  'Device financing',       'finance',      false),
  ('insurance',         'Device insurance',       'finance',      true);

-- Platforms (paid + organic sentinel)
INSERT INTO platforms (code, display_name) VALUES
  ('meta',    'Meta'),
  ('tiktok',  'TikTok'),
  ('organic', 'Organic / no platform');

-- Sentinel attribution chain for organic acquisitions
WITH p AS (SELECT id FROM platforms WHERE code = 'organic'),
     c AS (
       INSERT INTO campaigns (name, platform_id)
       SELECT '__organic_no_campaign__', p.id FROM p
       RETURNING id
     ),
     s AS (
       INSERT INTO ad_sets (name, campaign_id)
       SELECT '__organic_no_ad_set__', c.id FROM c
       RETURNING id
     )
INSERT INTO ads (name, ad_set_id)
SELECT '__organic_no_ad__', s.id FROM s;
```

- [ ] **Step 2: Verify seed counts**

Call `mcp__supabase__execute_sql` with:
- `project_id`: `mlsjehglsotapwvalbor`
- `query`:

```sql
SELECT
  (SELECT COUNT(*) FROM hk_districts)  AS districts,
  (SELECT COUNT(*) FROM plan_types)    AS plans,
  (SELECT COUNT(*) FROM product_types) AS products,
  (SELECT COUNT(*) FROM platforms)     AS platforms,
  (SELECT COUNT(*) FROM campaigns)     AS sentinel_campaigns,
  (SELECT COUNT(*) FROM ad_sets)       AS sentinel_ad_sets,
  (SELECT COUNT(*) FROM ads)           AS sentinel_ads;
```

Expected: `districts=18, plans=8, products=6, platforms=3, sentinel_campaigns=1, sentinel_ad_sets=1, sentinel_ads=1`.

- [ ] **Step 3: Commit**

```bash
cd /Users/neo/Desktop/ad_analysis && git add docs/specs docs/plans && git commit -m "feat: hk_dash supabase schema spec + plan + 5 schema migrations"
```

---

### Task 6: Write Python ETL script

**Files:**
- Create: `/Users/neo/Desktop/ad_analysis/scripts/etl_csv_to_sql.py`
- Outputs: `/Users/neo/Desktop/ad_analysis/scripts/etl_out/10_attribution.sql`, `11_accounts_customers.sql`, `12_account_products.sql`, `13_customer_events.sql`

- [ ] **Step 1: Create the script**

Write to `/Users/neo/Desktop/ad_analysis/scripts/etl_csv_to_sql.py`:

```python
"""
Read crm_customers_v2.csv and emit four SQL files in dependency order:
  10_attribution.sql       — INSERT distinct (platform, campaign, ad_set, ad) rows
  11_accounts_customers.sql — INSERT accounts then customers
  12_account_products.sql  — INSERT account_products from products_now (current holdings)
  13_customer_events.sql   — INSERT customer_events backfilled from snapshot fields

All INSERTs use lookups against pre-seeded dim tables via subqueries on `code`/`name`.
The script runs locally and produces SQL only — no DB connection required.
"""
from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

CSV_PATH = Path(__file__).parent.parent / "data" / "crm_customers_v2.csv"
OUT_DIR = Path(__file__).parent / "etl_out"
OUT_DIR.mkdir(exist_ok=True)


def sql_str(v: str | None) -> str:
    """Quote a string for SQL, or return NULL."""
    if v is None or v == "" or v == "n/a":
        return "NULL"
    return "'" + v.replace("'", "''") + "'"


def sql_bool(v: str) -> str:
    return "true" if v.strip().upper() == "Y" else "false"


def sql_int(v: str) -> str:
    return v.strip() if v.strip() else "NULL"


def sql_num(v: str) -> str:
    return v.strip() if v.strip() else "NULL"


def sql_date(v: str) -> str:
    v = v.strip()
    return f"'{v}'" if v else "NULL"


def main() -> None:
    rows = list(csv.DictReader(CSV_PATH.open()))
    print(f"Loaded {len(rows)} rows from {CSV_PATH}")

    # ---- 10_attribution.sql ----
    # Distinct (platform, campaign, ad_set, ad) tuples (paid only; organic uses sentinels).
    paid = [r for r in rows if r["acquisition_channel"] == "paid_social"]
    tuples = sorted({(r["platform"], r["campaign_name"], r["ad_set_name"], r["ad_name"]) for r in paid})

    lines: list[str] = []
    lines.append("-- Attribution: paid campaigns/ad_sets/ads (organic uses sentinel rows from 05_seed_dims)")
    seen_campaigns: set[tuple[str, str]] = set()
    seen_ad_sets: set[tuple[str, str]] = set()
    for plat, camp, ads_, ad in tuples:
        if (plat, camp) not in seen_campaigns:
            lines.append(
                f"INSERT INTO campaigns (name, platform_id) "
                f"SELECT {sql_str(camp)}, id FROM platforms WHERE code = {sql_str(plat)} "
                f"ON CONFLICT DO NOTHING;"
            )
            seen_campaigns.add((plat, camp))
        if (camp, ads_) not in seen_ad_sets:
            lines.append(
                f"INSERT INTO ad_sets (name, campaign_id) "
                f"SELECT {sql_str(ads_)}, c.id FROM campaigns c JOIN platforms p ON p.id = c.platform_id "
                f"WHERE c.name = {sql_str(camp)} AND p.code = {sql_str(plat)} "
                f"ON CONFLICT DO NOTHING;"
            )
            seen_ad_sets.add((camp, ads_))
        lines.append(
            f"INSERT INTO ads (name, ad_set_id) "
            f"SELECT {sql_str(ad)}, s.id FROM ad_sets s "
            f"JOIN campaigns c ON c.id = s.campaign_id "
            f"JOIN platforms p ON p.id = c.platform_id "
            f"WHERE s.name = {sql_str(ads_)} AND c.name = {sql_str(camp)} AND p.code = {sql_str(plat)} "
            f"ON CONFLICT DO NOTHING;"
        )
    (OUT_DIR / "10_attribution.sql").write_text("\n".join(lines) + "\n")
    print(f"Wrote {OUT_DIR / '10_attribution.sql'} ({len(lines)} statements)")

    # ---- 11_accounts_customers.sql ----
    lines = ["-- Accounts (distinct external_account_id)"]
    distinct_accounts = sorted({r["account_id"] for r in rows})
    for ext_id in distinct_accounts:
        lines.append(
            f"INSERT INTO accounts (external_account_id) VALUES ({sql_str(ext_id)}) "
            f"ON CONFLICT DO NOTHING;"
        )

    lines.append("\n-- Customers (one row per CSV row)")
    for r in rows:
        # ad_id resolution: organic uses the sentinel chain.
        if r["acquisition_channel"] == "organic":
            ad_lookup = (
                "(SELECT id FROM ads WHERE name = '__organic_no_ad__' "
                "AND ad_set_id = (SELECT id FROM ad_sets WHERE name = '__organic_no_ad_set__'))"
            )
        else:
            ad_lookup = (
                f"(SELECT a.id FROM ads a "
                f"JOIN ad_sets s ON s.id = a.ad_set_id "
                f"JOIN campaigns c ON c.id = s.campaign_id "
                f"JOIN platforms p ON p.id = c.platform_id "
                f"WHERE a.name = {sql_str(r['ad_name'])} "
                f"AND s.name = {sql_str(r['ad_set_name'])} "
                f"AND c.name = {sql_str(r['campaign_name'])} "
                f"AND p.code = {sql_str(r['platform'])})"
            )

        lines.append(
            "INSERT INTO customers ("
            "external_customer_id, account_id, age_band, gender, hk_district_id, language_pref, "
            "ad_id, acquisition_channel, acquisition_date, plan_type_id, monthly_arpu_hkd, "
            "contract_months, cross_sell_broadband, cross_sell_entertainment, cross_sell_device_fin, "
            "monthly_total_revenue_hkd, relationship_type, prior_tenure_months, status, "
            "activation_status, activation_date, activation_lag_days, churn_date, months_active, "
            "realized_revenue_hkd, projected_ltv_24mo_hkd"
            ") VALUES ("
            f"{sql_str(r['customer_id'])}, "
            f"(SELECT id FROM accounts WHERE external_account_id = {sql_str(r['account_id'])}), "
            f"{sql_str(r['age_band'])}, {sql_str(r['gender'])}, "
            f"(SELECT id FROM hk_districts WHERE name = {sql_str(r['hk_district'])}), "
            f"{sql_str(r['language_pref'])}, "
            f"{ad_lookup}, "
            f"{sql_str(r['acquisition_channel'])}, {sql_date(r['acquisition_date'])}, "
            f"(SELECT id FROM plan_types WHERE code = {sql_str(r['plan_type'])}), "
            f"{sql_num(r['monthly_arpu_hkd'])}, {sql_int(r['contract_months'])}, "
            f"{sql_bool(r['cross_sell_broadband'])}, {sql_bool(r['cross_sell_entertainment'])}, "
            f"{sql_bool(r['cross_sell_device_financing'])}, "
            f"{sql_num(r['monthly_total_revenue_hkd'])}, "
            f"{sql_str(r['customer_relationship_type'])}, {sql_int(r['prior_tenure_months'])}, "
            f"{sql_str(r['status'])}, {sql_str(r['activation_status'])}, "
            f"{sql_date(r['activation_date'])}, {sql_int(r['activation_lag_days'])}, "
            f"{sql_date(r['churn_date'])}, {sql_int(r['months_active'])}, "
            f"{sql_num(r['realized_revenue_hkd'])}, {sql_num(r['projected_ltv_24mo_hkd'])}"
            ");"
        )
    (OUT_DIR / "11_accounts_customers.sql").write_text("\n".join(lines) + "\n")
    print(f"Wrote {OUT_DIR / '11_accounts_customers.sql'} ({len(lines)} statements)")

    # ---- 12_account_products.sql ----
    # Use products_now (current holdings) per account. Acquired_at = MIN(acquisition_date) for that account.
    # Products in products_at_acquisition share the same acquired_at; later-added products
    # (in products_now but not products_at_acquisition for any line) are flagged via a separate
    # placeholder acquired_at = same date but flagged in customer_events backfill.
    account_acq_date: dict[str, str] = {}
    account_products_now: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        acct = r["account_id"]
        # Earliest acquisition_date wins
        if acct not in account_acq_date or r["acquisition_date"] < account_acq_date[acct]:
            account_acq_date[acct] = r["acquisition_date"]
        for tok in r["products_now"].split("|"):
            if tok and tok != "none":
                account_products_now[acct].add(tok)

    lines = ["-- Account products (current holdings; acquired_at = earliest acquisition_date for the account)"]
    for acct in sorted(account_products_now):
        for prod in sorted(account_products_now[acct]):
            lines.append(
                f"INSERT INTO account_products (account_id, product_type_id, acquired_at) "
                f"SELECT a.id, p.id, {sql_date(account_acq_date[acct])} "
                f"FROM accounts a, product_types p "
                f"WHERE a.external_account_id = {sql_str(acct)} AND p.code = {sql_str(prod)} "
                f"ON CONFLICT DO NOTHING;"
            )
    (OUT_DIR / "12_account_products.sql").write_text("\n".join(lines) + "\n")
    print(f"Wrote {OUT_DIR / '12_account_products.sql'} ({len(lines)} statements)")

    # ---- 13_customer_events.sql ----
    # For each customer:
    #   activated         if activation_status='active'   at activation_date
    #   activation_failed if activation_status='failed'   at COALESCE(activation_date, acquisition_date)
    #   churned           if churn_date IS NOT NULL       at churn_date
    #   product_added     for each product in products_at_acquisition (skip 'none')
    #     occurred_at = acquisition_date
    #     payload includes timestamp_estimated=false
    #   product_added     for each product in (products_now - products_at_acquisition)
    #     occurred_at = acquisition_date  (placeholder)
    #     payload includes timestamp_estimated=true
    lines = ["-- Customer events backfilled from CSV snapshot"]
    for r in rows:
        cid = r["customer_id"]
        cust_lookup = f"(SELECT id FROM customers WHERE external_customer_id = {sql_str(cid)})"

        if r["activation_status"] == "active" and r["activation_date"]:
            lines.append(
                f"INSERT INTO customer_events (customer_id, event_type, occurred_at, payload) VALUES ("
                f"{cust_lookup}, 'activated', {sql_date(r['activation_date'])}::timestamptz, '{{}}'::jsonb);"
            )
        elif r["activation_status"] == "failed":
            ts = r["activation_date"] or r["acquisition_date"]
            lines.append(
                f"INSERT INTO customer_events (customer_id, event_type, occurred_at, payload) VALUES ("
                f"{cust_lookup}, 'activation_failed', {sql_date(ts)}::timestamptz, '{{}}'::jsonb);"
            )

        if r["churn_date"]:
            lines.append(
                f"INSERT INTO customer_events (customer_id, event_type, occurred_at, payload) VALUES ("
                f"{cust_lookup}, 'churned', {sql_date(r['churn_date'])}::timestamptz, '{{}}'::jsonb);"
            )

        at_acq = {p for p in r["products_at_acquisition"].split("|") if p and p != "none"}
        now = {p for p in r["products_now"].split("|") if p and p != "none"}
        for prod in sorted(at_acq):
            lines.append(
                f"INSERT INTO customer_events (customer_id, event_type, occurred_at, payload) VALUES ("
                f"{cust_lookup}, 'product_added', {sql_date(r['acquisition_date'])}::timestamptz, "
                f"jsonb_build_object('product_code', {sql_str(prod)}, 'timestamp_estimated', false));"
            )
        for prod in sorted(now - at_acq):
            lines.append(
                f"INSERT INTO customer_events (customer_id, event_type, occurred_at, payload) VALUES ("
                f"{cust_lookup}, 'product_added', {sql_date(r['acquisition_date'])}::timestamptz, "
                f"jsonb_build_object('product_code', {sql_str(prod)}, 'timestamp_estimated', true));"
            )
    (OUT_DIR / "13_customer_events.sql").write_text("\n".join(lines) + "\n")
    print(f"Wrote {OUT_DIR / '13_customer_events.sql'} ({len(lines)} statements)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the script and verify output**

```bash
cd /Users/neo/Desktop/ad_analysis && python3 scripts/etl_csv_to_sql.py
```

Expected stdout:
- `Loaded 679 rows from .../crm_customers_v2.csv`
- Four `Wrote .../etl_out/N_*.sql` lines

Verify file sizes are sane:
```bash
wc -l /Users/neo/Desktop/ad_analysis/scripts/etl_out/*.sql
```
Expected order of magnitude: `10_attribution.sql` ~30 lines, `11_accounts_customers.sql` ~1300 lines (634 accounts + 679 customers + headers), `12_account_products.sql` ~700 lines, `13_customer_events.sql` ~2000+ lines.

- [ ] **Step 3: Commit**

```bash
cd /Users/neo/Desktop/ad_analysis && git add scripts/etl_csv_to_sql.py scripts/etl_out/*.sql && git commit -m "feat: ETL script + generated SQL for hk_dash CSV ingest"
```

---

### Task 7: Apply attribution SQL (10_attribution.sql)

**Files:**
- Read: `/Users/neo/Desktop/ad_analysis/scripts/etl_out/10_attribution.sql`

- [ ] **Step 1: Read the generated SQL**

Use `Read` on `/Users/neo/Desktop/ad_analysis/scripts/etl_out/10_attribution.sql`. Capture full contents.

- [ ] **Step 2: Apply via Supabase MCP**

Call `mcp__supabase__apply_migration` with:
- `project_id`: `mlsjehglsotapwvalbor`
- `name`: `10_attribution`
- `query`: the full contents of `10_attribution.sql`

- [ ] **Step 3: Verify counts**

Call `mcp__supabase__execute_sql`:
```sql
SELECT
  (SELECT COUNT(*) FROM platforms)  AS platforms_total,
  (SELECT COUNT(*) FROM campaigns)  AS campaigns_total,
  (SELECT COUNT(*) FROM ad_sets)    AS ad_sets_total,
  (SELECT COUNT(*) FROM ads)        AS ads_total;
```

Expected: `platforms_total=3, campaigns_total=4 (3 paid + 1 organic sentinel), ad_sets_total=8 (7 paid + 1 sentinel), ads_total=13 (12 paid + 1 sentinel)`. (CSV has 3 paid campaigns; the earlier 4-distinct count included the `n/a` organic row.)

---

### Task 8: Apply accounts + customers SQL

**Files:**
- Read: `/Users/neo/Desktop/ad_analysis/scripts/etl_out/11_accounts_customers.sql`

- [ ] **Step 1: Read the generated SQL**

Use `Read` on `/Users/neo/Desktop/ad_analysis/scripts/etl_out/11_accounts_customers.sql`.

- [ ] **Step 2: Apply via Supabase MCP**

Call `mcp__supabase__apply_migration` with:
- `project_id`: `mlsjehglsotapwvalbor`
- `name`: `11_accounts_customers`
- `query`: full contents of `11_accounts_customers.sql`

If the query is rejected for size, split: apply the `INSERT INTO accounts ...` block first as `11a_accounts`, then the `INSERT INTO customers ...` block as `11b_customers`.

- [ ] **Step 3: Verify counts and FK integrity**

Call `mcp__supabase__execute_sql`:
```sql
SELECT
  (SELECT COUNT(*) FROM accounts)  AS accounts_total,
  (SELECT COUNT(*) FROM customers) AS customers_total,
  (SELECT COUNT(*) FROM customers WHERE ad_id IS NULL)             AS customers_missing_ad,
  (SELECT COUNT(*) FROM customers WHERE plan_type_id IS NULL)      AS customers_missing_plan,
  (SELECT COUNT(*) FROM customers WHERE hk_district_id IS NULL)    AS customers_missing_district,
  (SELECT COUNT(*) FROM customers WHERE account_id IS NULL)        AS customers_missing_account;
```

Expected: `accounts_total=634, customers_total=679, all "missing_*" = 0`.

---

### Task 9: Apply account_products and customer_events SQL

**Files:**
- Read: `/Users/neo/Desktop/ad_analysis/scripts/etl_out/12_account_products.sql`
- Read: `/Users/neo/Desktop/ad_analysis/scripts/etl_out/13_customer_events.sql`

- [ ] **Step 1: Apply 12_account_products.sql**

Use `Read` on `12_account_products.sql`, then call `mcp__supabase__apply_migration`:
- `name`: `12_account_products`
- `query`: full file contents

- [ ] **Step 2: Apply 13_customer_events.sql**

Use `Read` on `13_customer_events.sql`, then call `mcp__supabase__apply_migration`:
- `name`: `13_customer_events`
- `query`: full file contents

If size limit hit, split the file into halves at a row boundary and apply as `13a_customer_events` and `13b_customer_events`.

- [ ] **Step 3: Verify counts**

Call `mcp__supabase__execute_sql`:
```sql
SELECT
  (SELECT COUNT(*) FROM account_products)        AS account_products_total,
  (SELECT COUNT(DISTINCT account_id) FROM account_products) AS accounts_with_products,
  (SELECT COUNT(*) FROM customer_events)         AS events_total,
  (SELECT COUNT(*) FROM customer_events WHERE event_type = 'activated') AS activated,
  (SELECT COUNT(*) FROM customer_events WHERE event_type = 'churned')   AS churned,
  (SELECT COUNT(*) FROM customer_events WHERE event_type = 'product_added') AS product_added;
```

Expected:
- `accounts_with_products` ≤ 634 (some accounts may have only 'none' products and skip)
- `activated + activation_failed` ≈ 679 (one per customer)
- `churned` matches the count of non-null `churn_date` rows in CSV
- `product_added` ≥ 679 (at least one per customer who has any non-'none' product)

Cross-check against CSV:
```bash
awk -F',' 'NR>1 && $22 != "" {n++} END {print "csv_churn_rows="n}' /Users/neo/Desktop/ad_analysis/data/crm_customers_v2.csv
```
The output number should equal the `churned` count from the SQL above.

- [ ] **Step 4: Commit**

```bash
cd /Users/neo/Desktop/ad_analysis && git commit --allow-empty -m "chore: applied ETL migrations 10-13 to hk_dash supabase project"
```

---

### Task 10: Migration — dashboard views

**Files:**
- Apply via MCP: migration name `20_dashboard_views`

- [ ] **Step 1: Apply view DDL**

Call `mcp__supabase__apply_migration` with:
- `project_id`: `mlsjehglsotapwvalbor`
- `name`: `20_dashboard_views`
- `query`:

```sql
CREATE VIEW v_account_summary AS
SELECT
  a.id AS account_id,
  a.external_account_id,
  COUNT(*) FILTER (WHERE c.status = 'active') AS n_active_lines,
  COALESCE(SUM(c.monthly_arpu_hkd) FILTER (WHERE c.status = 'active'), 0) AS total_account_arpu_hkd,
  (SELECT COUNT(DISTINCT product_type_id)
     FROM account_products ap
     WHERE ap.account_id = a.id AND ap.removed_at IS NULL) >= 2 AS multi_product_flag
FROM accounts a
LEFT JOIN customers c ON c.account_id = a.id
GROUP BY a.id, a.external_account_id;

CREATE VIEW v_customer_360 AS
SELECT
  c.id, c.external_customer_id,
  a.external_account_id,
  c.age_band, c.gender, c.language_pref,
  d.name AS hk_district, d.region,
  pt.code AS plan_type, pt.plan_category,
  c.monthly_arpu_hkd, c.contract_months,
  c.cross_sell_broadband, c.cross_sell_entertainment, c.cross_sell_device_fin,
  c.acquisition_channel, c.acquisition_date,
  pl.code AS platform,
  camp.name AS campaign_name,
  ads.name AS ad_set_name,
  ad.name AS ad_name,
  c.relationship_type, c.prior_tenure_months,
  c.status, c.activation_status, c.activation_date, c.activation_lag_days,
  c.churn_date, c.months_active,
  c.realized_revenue_hkd, c.projected_ltv_24mo_hkd
FROM customers c
JOIN accounts a       ON a.id = c.account_id
JOIN hk_districts d   ON d.id = c.hk_district_id
JOIN plan_types pt    ON pt.id = c.plan_type_id
JOIN ads ad           ON ad.id = c.ad_id
JOIN ad_sets ads      ON ads.id = ad.ad_set_id
JOIN campaigns camp   ON camp.id = ads.campaign_id
JOIN platforms pl     ON pl.id = camp.platform_id;

CREATE VIEW v_acquisition_by_campaign AS
SELECT
  pl.code  AS platform,
  camp.name AS campaign_name,
  COUNT(*)                                          AS customers_acquired,
  COUNT(*) FILTER (WHERE c.status = 'churned')      AS customers_churned,
  AVG(c.monthly_arpu_hkd)                           AS avg_arpu,
  SUM(c.realized_revenue_hkd)                       AS realized_revenue,
  SUM(c.projected_ltv_24mo_hkd)                     AS projected_ltv
FROM customers c
JOIN ads ad         ON ad.id = c.ad_id
JOIN ad_sets ads    ON ads.id = ad.ad_set_id
JOIN campaigns camp ON camp.id = ads.campaign_id
JOIN platforms pl   ON pl.id = camp.platform_id
GROUP BY pl.code, camp.name;

CREATE VIEW v_cohort_retention AS
SELECT
  date_trunc('month', acquisition_date)::date AS cohort_month,
  COUNT(*)                                    AS cohort_size,
  COUNT(*) FILTER (WHERE status = 'active')   AS still_active,
  COUNT(*) FILTER (WHERE status = 'churned')  AS churned,
  AVG(months_active)                          AS avg_months_active
FROM customers
GROUP BY 1
ORDER BY 1;

CREATE VIEW v_account_products_current AS
SELECT
  ap.account_id,
  array_agg(pt.code ORDER BY pt.code) AS products
FROM account_products ap
JOIN product_types pt ON pt.id = ap.product_type_id
WHERE ap.removed_at IS NULL
GROUP BY ap.account_id;
```

- [ ] **Step 2: Verify views return rows**

Call `mcp__supabase__execute_sql`:
```sql
SELECT
  (SELECT COUNT(*) FROM v_account_summary)         AS account_summary_rows,
  (SELECT COUNT(*) FROM v_customer_360)            AS customer_360_rows,
  (SELECT COUNT(*) FROM v_acquisition_by_campaign) AS acq_by_campaign_rows,
  (SELECT COUNT(*) FROM v_cohort_retention)        AS cohort_rows,
  (SELECT COUNT(*) FROM v_account_products_current) AS account_products_rows;
```

Expected:
- `account_summary_rows = 634`
- `customer_360_rows = 679`
- `acq_by_campaign_rows = 5` (4 paid + 1 organic sentinel)
- `cohort_rows ≥ 1`
- `account_products_rows ≤ 634`

---

### Task 11: End-to-end verification

- [ ] **Step 1: Cross-check counts vs CSV**

Run:
```bash
cd /Users/neo/Desktop/ad_analysis
echo "csv_customers=$(awk -F',' 'NR>1' data/crm_customers_v2.csv | wc -l | tr -d ' ')"
echo "csv_accounts=$(awk -F',' 'NR>1 {print $30}' data/crm_customers_v2.csv | sort -u | wc -l | tr -d ' ')"
echo "csv_active=$(awk -F',' 'NR>1 && $20=="active"' data/crm_customers_v2.csv | wc -l | tr -d ' ')"
echo "csv_churned=$(awk -F',' 'NR>1 && $20=="churned"' data/crm_customers_v2.csv | wc -l | tr -d ' ')"
```

Then call `mcp__supabase__execute_sql`:
```sql
SELECT
  (SELECT COUNT(*) FROM customers)                                 AS db_customers,
  (SELECT COUNT(*) FROM accounts)                                  AS db_accounts,
  (SELECT COUNT(*) FROM customers WHERE status = 'active')         AS db_active,
  (SELECT COUNT(*) FROM customers WHERE status = 'churned')        AS db_churned;
```

Expected: each DB count matches the CSV-side count exactly.

- [ ] **Step 2: Sanity-check `v_customer_360` against the CSV header**

Call `mcp__supabase__execute_sql`:
```sql
SELECT * FROM v_customer_360 WHERE external_customer_id = 'CUST100001';
```

Expected one row matching CSV row 2:
- `external_account_id='ACCT100001'`, `age_band='35-44'`, `gender='female'`, `hk_district='Wan Chai'`,
  `language_pref='Cantonese'`, `plan_type='5G_Single_Premium'`, `plan_category='subscription'`,
  `monthly_arpu_hkd=488`, `contract_months=24`, `cross_sell_entertainment=true`, others false,
  `acquisition_channel='paid_social'`, `platform='meta'`, `campaign_name='HK_5G_FamilyPlan_Q4_2025'`,
  `relationship_type='net_new'`, `status='active'`, `activation_status='active'`,
  `activation_date='2025-11-10'`, `activation_lag_days=4`.

- [ ] **Step 3: Run Supabase advisors for security/perf lints**

Call `mcp__supabase__get_advisors` with `project_id="mlsjehglsotapwvalbor"`, `type="security"` and again with `type="performance"`. Review results — common findings to expect: tables without RLS (acceptable for now per spec, RLS deferred), missing primary key on a view (views don't have PKs, ignorable). Document any findings the user should act on later.

- [ ] **Step 4: Generate TypeScript types for the dashboard front end**

Call `mcp__supabase__generate_typescript_types` with `project_id="mlsjehglsotapwvalbor"`. Save the output to `/Users/neo/Desktop/ad_analysis/types/supabase.ts`.

- [ ] **Step 5: Commit**

```bash
cd /Users/neo/Desktop/ad_analysis
mkdir -p types
# (write supabase.ts from step 4 output)
git add types/supabase.ts
git commit -m "feat: hk_dash views, advisor pass, generated TS types"
```

---

## Self-review

**Spec coverage:** Each spec section maps to a task —
- Marketing attribution tables → Task 2 + seed in Task 5 (sentinels) + Task 7 (paid)
- Lookup/dim tables → Task 1 + seed in Task 5
- Operational tables → Task 3 + Task 8
- Event log → Task 4 + Task 9
- Dashboard views → Task 10
- CSV→events backfill rules → Task 6 (Python) + Task 9 (apply)

**Placeholder scan:** No TBD/TODO. All SQL is concrete; Python script is complete; verification queries have expected numeric outputs.

**Type/name consistency:** Column names match across tasks (`cross_sell_device_fin`, `external_customer_id`, etc.). Migration names are sequential. Sentinel row names are consistent (`__organic_no_*__`). View names match those listed in the spec.
