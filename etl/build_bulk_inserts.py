"""
Build compact bulk INSERT statements for customers, account_products, and customer_events
using literal integer FK IDs.

FK IDs are computed deterministically from CSV content + known seed insertion order:
- dim/lookup IDs (districts, plan_types, product_types, platforms): hardcoded from seed migration order
- account IDs: alphabetic sort of distinct external_account_id, IDs 1..634
- ad IDs: sentinel = 1, paid ads in (platform, campaign, ad_set, ad) sort order = 2..14

Outputs:
  sql/generated/bulk_customers.sql        — one INSERT with VALUES (...) per customer
  sql/generated/bulk_account_products.sql — one INSERT with VALUES (...) per (account, product)
  sql/generated/bulk_customer_events.sql  — one INSERT with VALUES (...) per event
"""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = Path("/Users/neo/Desktop/ad_analysis_prep/data/crm_customers_v2.csv")
OUT_DIR = ROOT / "sql" / "generated"
OUT_DIR.mkdir(exist_ok=True)

# Dim/lookup IDs (from seed migration insertion order)
PLAN_TYPES = {
    "5G_Single_Basic": 1, "5G_Single_Standard": 2, "5G_Single_Premium": 3,
    "5G_Family_2Line": 4, "5G_Family_4Line": 5, "5G_Gamer_Unlimited": 6,
    "Roaming_Pass_7d": 7, "Roaming_Pass_14d": 8,
}
PRODUCT_TYPES = {
    "mobile": 1, "mobile_additional": 2, "broadband": 3,
    "entertainment": 4, "device_financing": 5, "insurance": 6,
}
DISTRICTS = {
    "Central & Western": 1, "Eastern": 2, "Southern": 3, "Wan Chai": 4,
    "Kowloon City": 5, "Kwun Tong": 6, "Sham Shui Po": 7, "Wong Tai Sin": 8,
    "Yau Tsim Mong": 9, "Islands": 10, "Kwai Tsing": 11, "North": 12,
    "Sai Kung": 13, "Sha Tin": 14, "Tai Po": 15, "Tsuen Wan": 16,
    "Tuen Mun": 17, "Yuen Long": 18,
}
SENTINEL_AD_ID = 1


def s(v: str | None) -> str:
    if v is None or v == "" or v == "n/a":
        return "NULL"
    return "'" + v.replace("'", "''") + "'"


def b(v: str) -> str:
    return "true" if v.strip().upper() == "Y" else "false"


def n(v: str) -> str:
    return v.strip() if v.strip() else "NULL"


def d(v: str) -> str:
    v = v.strip()
    return f"'{v}'" if v else "NULL"


def main() -> None:
    rows = list(csv.DictReader(CSV_PATH.open()))
    print(f"Loaded {len(rows)} CSV rows")

    # accounts: alphabetic sort of distinct external_account_id → IDs 1..N
    distinct_accounts = sorted({r["account_id"] for r in rows})
    accounts = {ext: i + 1 for i, ext in enumerate(distinct_accounts)}
    assert len(accounts) == 634, f"expected 634 accounts, got {len(accounts)}"

    # ads: sentinel=1; paid ads numbered in (platform, campaign, ad_set, ad) sort order from 2
    paid_tuples = sorted({
        (r["platform"], r["campaign_name"], r["ad_set_name"], r["ad_name"])
        for r in rows if r["acquisition_channel"] == "paid_social"
    })
    ads = {f"{p}|{c}|{s_}|{a}": i + 2 for i, (p, c, s_, a) in enumerate(paid_tuples)}

    # ---- bulk_customers.sql ----
    customer_values: list[str] = []
    for r in rows:
        if r["acquisition_channel"] == "organic":
            ad_id = SENTINEL_AD_ID
        else:
            key = f'{r["platform"]}|{r["campaign_name"]}|{r["ad_set_name"]}|{r["ad_name"]}'
            ad_id = ads[key]

        customer_values.append(
            "("
            f"{s(r['customer_id'])},"
            f"{accounts[r['account_id']]},"
            f"{s(r['age_band'])},"
            f"{s(r['gender'])},"
            f"{DISTRICTS[r['hk_district']]},"
            f"{s(r['language_pref'])},"
            f"{ad_id},"
            f"{s(r['acquisition_channel'])},"
            f"{d(r['acquisition_date'])},"
            f"{PLAN_TYPES[r['plan_type']]},"
            f"{n(r['monthly_arpu_hkd'])},"
            f"{n(r['contract_months'])},"
            f"{b(r['cross_sell_broadband'])},"
            f"{b(r['cross_sell_entertainment'])},"
            f"{b(r['cross_sell_device_financing'])},"
            f"{n(r['monthly_total_revenue_hkd'])},"
            f"{s(r['customer_relationship_type'])},"
            f"{n(r['prior_tenure_months'])},"
            f"{s(r['status'])},"
            f"{s(r['activation_status'])},"
            f"{d(r['activation_date'])},"
            f"{n(r['activation_lag_days'])},"
            f"{d(r['churn_date'])},"
            f"{n(r['months_active'])},"
            f"{n(r['realized_revenue_hkd'])},"
            f"{n(r['projected_ltv_24mo_hkd'])}"
            ")"
        )
    CUST_HEADER = (
        "INSERT INTO customers ("
        "external_customer_id, account_id, age_band, gender, hk_district_id, language_pref, "
        "ad_id, acquisition_channel, acquisition_date, plan_type_id, monthly_arpu_hkd, "
        "contract_months, cross_sell_broadband, cross_sell_entertainment, cross_sell_device_fin, "
        "monthly_total_revenue_hkd, relationship_type, prior_tenure_months, status, "
        "activation_status, activation_date, activation_lag_days, churn_date, months_active, "
        "realized_revenue_hkd, projected_ltv_24mo_hkd) VALUES\n"
    )
    chunk_size = 200
    for i, start in enumerate(range(0, len(customer_values), chunk_size), start=1):
        chunk = customer_values[start:start + chunk_size]
        sql = CUST_HEADER + ",\n".join(chunk) + ";\n"
        path = OUT_DIR / f"bulk_customers_{i}.sql"
        path.write_text(sql)
        print(f"Wrote {path.name} ({len(sql):,} bytes, {len(chunk)} rows)")

    # ---- bulk_account_products.sql ----
    account_acq_date: dict[str, str] = {}
    account_products_now: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        acct = r["account_id"]
        if acct not in account_acq_date or r["acquisition_date"] < account_acq_date[acct]:
            account_acq_date[acct] = r["acquisition_date"]
        for tok in r["products_now"].split("|"):
            if tok and tok != "none":
                account_products_now[acct].add(tok)

    ap_values: list[str] = []
    for acct in sorted(account_products_now):
        for prod in sorted(account_products_now[acct]):
            ap_values.append(
                f"({accounts[acct]}, {PRODUCT_TYPES[prod]}, {d(account_acq_date[acct])})"
            )
    sql = (
        "INSERT INTO account_products (account_id, product_type_id, acquired_at) VALUES\n"
        + ",\n".join(ap_values)
        + ";\n"
    )
    (OUT_DIR / "bulk_account_products.sql").write_text(sql)
    print(f"Wrote bulk_account_products.sql ({len(sql):,} bytes, {len(ap_values)} rows)")

    # ---- bulk_customer_events.sql ----
    # customers will be inserted in CSV row order, getting bigserial IDs 1..679
    ev_values: list[str] = []
    for i, r in enumerate(rows, start=1):
        cid = i

        if r["activation_status"] == "active" and r["activation_date"]:
            ev_values.append(
                f"({cid}, 'activated', {d(r['activation_date'])}::timestamptz, '{{}}'::jsonb)"
            )
        elif r["activation_status"] == "failed":
            ts = r["activation_date"] or r["acquisition_date"]
            ev_values.append(
                f"({cid}, 'activation_failed', {d(ts)}::timestamptz, '{{}}'::jsonb)"
            )

        if r["churn_date"]:
            ev_values.append(
                f"({cid}, 'churned', {d(r['churn_date'])}::timestamptz, '{{}}'::jsonb)"
            )

        at_acq = {p for p in r["products_at_acquisition"].split("|") if p and p != "none"}
        now = {p for p in r["products_now"].split("|") if p and p != "none"}
        for prod in sorted(at_acq):
            payload = json.dumps({"product_code": prod, "timestamp_estimated": False})
            ev_values.append(
                f"({cid}, 'product_added', {d(r['acquisition_date'])}::timestamptz, "
                f"'{payload}'::jsonb)"
            )
        for prod in sorted(now - at_acq):
            payload = json.dumps({"product_code": prod, "timestamp_estimated": True})
            ev_values.append(
                f"({cid}, 'product_added', {d(r['acquisition_date'])}::timestamptz, "
                f"'{payload}'::jsonb)"
            )

    EV_HEADER = "INSERT INTO customer_events (customer_id, event_type, occurred_at, payload) VALUES\n"
    chunk_size = 500
    for i, start in enumerate(range(0, len(ev_values), chunk_size), start=1):
        chunk = ev_values[start:start + chunk_size]
        sql = EV_HEADER + ",\n".join(chunk) + ";\n"
        path = OUT_DIR / f"bulk_customer_events_{i}.sql"
        path.write_text(sql)
        print(f"Wrote {path.name} ({len(sql):,} bytes, {len(chunk)} rows)")


if __name__ == "__main__":
    main()
