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

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "data" / "raw" / "crm_customers_v2.csv"
OUT_DIR = ROOT / "sql" / "generated"
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
