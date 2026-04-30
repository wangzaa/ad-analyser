"""Generate 3HK realistic mock dataset → sql/generated/04_data.sql

Produces: ~3,300 customer-rows across 4 segments, 12-month cohorts (Jan–Dec 2025),
deterministic acquisition-cost attribution, FBB add-on rows.

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
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT_PATH = ROOT / "sql" / "generated" / "04_data.sql"
REFERENCE_IDS_PATH = ROOT / "etl" / "reference_ids.json"

RNG = random.Random(20260430)  # fixed seed → reproducible output

# ── Reference data (must match 02_seed_lookups.sql) ───────────────────────────

SEGMENT_TARGETS = {
    "postpaid_premium": {"count": 750,  "target_cpa": 2500, "target_arpu_band": (200, 400), "monthly_churn": 0.010},
    "postpaid_value":   {"count": 1200, "target_cpa": 250,  "target_arpu_band": (80, 180),  "monthly_churn": 0.020},
    "prepaid_engaged":  {"count": 600,  "target_cpa": 50,   "target_arpu_band": (50, 100),  "monthly_churn": 0.040},
    "prepaid_tourist":  {"count": 450,  "target_cpa": 30,   "target_arpu_band": (30, 60),   "monthly_churn": 0.220},
}

# (code, segment, plan_category, default ARPU, contract months, service_type)
PLAN_TYPES = [
    ("5G_Single_Basic",        "postpaid_value",   "subscription", 198, 12, "mobile"),
    ("5G_Single_Standard",     "postpaid_value",   "subscription", 298, 24, "mobile"),
    ("5G_Single_Premium",      "postpaid_premium", "subscription", 488, 24, "mobile"),
    ("5G_Family_2Line",        "postpaid_premium", "subscription", 388, 24, "mobile"),
    ("5G_Family_4Line",        "postpaid_premium", "subscription", 588, 24, "mobile"),
    ("5G_Gamer_Unlimited",     "postpaid_value",   "subscription", 348, 24, "mobile"),
    ("Roaming_Pass_7d",        "postpaid_value",   "one-off",      88,   0, "roaming"),
    ("Roaming_Pass_14d",       "postpaid_value",   "one-off",      168,  0, "roaming"),
    ("SoSIM_5G_30GB",          "postpaid_value",   "subscription", 98,   0, "mobile"),
    ("SoSIM_5G_100GB",         "postpaid_value",   "subscription", 158,  0, "mobile"),
    ("Prepaid_CrossBorder_30d","prepaid_engaged",  "prepaid",      78,   0, "mobile"),
    ("Prepaid_CrossBorder_90d","prepaid_engaged",  "prepaid",      198,  0, "mobile"),
    ("Prepaid_Tourist_8d",     "prepaid_tourist",  "prepaid",      48,   0, "mobile"),
    ("Prepaid_Tourist_15d",    "prepaid_tourist",  "prepaid",      88,   0, "mobile"),
    ("FBB_FTTH_500M",          "postpaid_value",   "subscription", 198, 24, "broadband"),
    ("FBB_FTTH_1G",            "postpaid_premium", "subscription", 298, 24, "broadband"),
]

HK_DISTRICTS = ["Central & Western","Eastern","Southern","Wan Chai","Kowloon City","Kwun Tong","Sham Shui Po","Wong Tai Sin","Yau Tsim Mong","Islands","Kwai Tsing","North","Sai Kung","Sha Tin","Tai Po","Tsuen Wan","Tuen Mun","Yuen Long"]
LANGUAGES = ["Cantonese","English","Mandarin"]
GENDERS = ["female","male"]
AGE_BANDS = ["18-24","25-34","35-44","45-54","55-64"]

SEGMENT_CAMPAIGNS = {
    "postpaid_premium": ["HK_5G_FamilyPlan_Q1_2025","HK_5G_FamilyPlan_Q2_2025","HK_5G_FamilyPlan_Q3_2025","HK_5G_FamilyPlan_Q4_2025"],
    "postpaid_value":   ["HK_5G_GamerUnlimited_Q1","HK_5G_GamerUnlimited_Q2","HK_5G_GamerUnlimited_Q3","HK_5G_GamerUnlimited_Q4",
                         "HK_SoSIM_LaunchFlight_Q1","HK_SoSIM_AlwaysOn_Q2","HK_SoSIM_AlwaysOn_Q3","HK_SoSIM_AlwaysOn_Q4"],
    "prepaid_engaged":  ["HK_RoamingPass_Asia_Q4_2025","HK_RoamingPass_GoldenWeek","HK_RoamingPass_Summer"],
    "prepaid_tourist":  ["HK_RoamingPass_Asia_Q4_2025","HK_RoamingPass_GoldenWeek","HK_RoamingPass_Summer"],
}

PAID_SOCIAL_RATE = {
    "postpaid_premium": 0.85,
    "postpaid_value":   0.70,
    "prepaid_engaged":  0.10,
    "prepaid_tourist":  0.05,
}

CAMPAIGN_WINDOWS = {
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

REFERENCE_DATE = date(2025, 12, 31)


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
    acquisition_channel: str
    ad_id: int
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
    acquisition_cost_hkd: float | None


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_ids():
    return json.loads(REFERENCE_IDS_PATH.read_text())


def pick_acquisition_date(campaign_name: str) -> date:
    s, e = CAMPAIGN_WINDOWS[campaign_name]
    sd = date.fromisoformat(s); ed = date.fromisoformat(e)
    return sd + timedelta(days=RNG.randint(0, (ed - sd).days))


def pick_organic_acquisition_date() -> date:
    start = date(2025, 1, 1)
    return start + timedelta(days=RNG.randint(0, 364))


def assign_ad_id(campaign_name: str, platform: str, ids) -> int:
    prefix = f"{platform}|{campaign_name}|"
    candidates = [(k, v) for k, v in ids["ads"].items() if k.startswith(prefix)]
    if not candidates:
        raise ValueError(f"No ads for {prefix}")
    candidates.sort()
    return candidates[0][1]


def _b(v: bool) -> str:
    return "true" if v else "false"


def _s(v) -> str:
    if v is None or v == "":
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def _d(v) -> str:
    return "NULL" if v is None else f"'{v.isoformat()}'"


def _n(v) -> str:
    return "NULL" if v is None else str(v)


# ── Main pipeline ─────────────────────────────────────────────────────────────

def main() -> None:
    ids = load_ids()
    plan_id = {code: ids["plan_types"][code] for code, *_ in PLAN_TYPES}
    district_id = ids["hk_districts"]
    sentinel_ad_id = ids["sentinel_ad_id"]

    customers: list[Customer] = []
    accounts: list[tuple[int, str]] = []
    next_account_id = 1
    next_customer_id = 1

    # 1. Generate segmented customer rows (3000 base)
    for segment_code, cfg in SEGMENT_TARGETS.items():
        segment_plans = [p for p in PLAN_TYPES if p[1] == segment_code and p[5] != "broadband"]
        for _ in range(cfg["count"]):
            plan = RNG.choice(segment_plans)
            plan_code, _, plan_category, default_arpu, contract_months, service_type = plan

            # Channel assignment
            paid = RNG.random() < PAID_SOCIAL_RATE[segment_code]
            campaign_pool = SEGMENT_CAMPAIGNS[segment_code]
            if paid and campaign_pool:
                campaign_name = RNG.choice(campaign_pool)
                platform = "tiktok" if "Gamer" in campaign_name else "meta"
                ad_id = assign_ad_id(campaign_name, platform, ids)
                acq_date = pick_acquisition_date(campaign_name)
                channel = "paid_social"
            else:
                ad_id = sentinel_ad_id
                acq_date = pick_organic_acquisition_date()
                channel = "organic"

            # ARPU ±10%
            arpu = round(default_arpu * (0.9 + 0.2 * RNG.random()), 2)

            # Acquisition cost: target_cpa with ±30% noise (only for paid)
            acq_cost = round(cfg["target_cpa"] * (0.7 + 0.6 * RNG.random()), 2) if channel == "paid_social" else None

            # Churn: geometric draw from monthly churn rate
            p = cfg["monthly_churn"]
            k = 1
            while RNG.random() > p:
                k += 1
                if k > 24:
                    k = 99
                    break
            months_to_churn = k

            tenure_so_far = max(0, (REFERENCE_DATE - acq_date).days // 30)
            if plan_category == "one-off":
                status = "completed"
                months_active = min(tenure_so_far, 1)
                churn_date = None
                realized = float(arpu)
            elif plan_category == "prepaid":
                if months_to_churn <= tenure_so_far:
                    status = "churned"
                    churn_date = acq_date + timedelta(days=months_to_churn * 30)
                    months_active = months_to_churn
                else:
                    status = "active"
                    churn_date = None
                    months_active = min(tenure_so_far, 12)
                realized = float(arpu * months_active)
            else:  # subscription
                if months_to_churn <= tenure_so_far:
                    status = "churned"
                    churn_date = acq_date + timedelta(days=months_to_churn * 30)
                    months_active = months_to_churn
                else:
                    status = "active"
                    churn_date = None
                    months_active = min(tenure_so_far, 12)
                realized = float(arpu * months_active)

            projected_ltv = None
            if status == "active" and plan_category == "subscription":
                expected_tenure_months = (1 / cfg["monthly_churn"]) if cfg["monthly_churn"] > 0 else 24
                projected_ltv = round(arpu * min(expected_tenure_months, 24) * 0.85, 2)

            # Activation
            if channel == "paid_social":
                activation_lag = RNG.randint(1, 5)
                activation_dt = acq_date + timedelta(days=activation_lag)
                activation_status = "active" if RNG.random() > 0.04 else "failed"
                if activation_status == "failed":
                    activation_dt = None
            else:
                activation_lag = 0
                activation_dt = acq_date
                activation_status = "active"

            # Account assignment: 30% chance to join an existing account (multi-line household)
            if accounts and RNG.random() < 0.30:
                acct_id = RNG.choice(accounts)[0]
            else:
                acct_id = next_account_id
                accounts.append((next_account_id, f"ACCT{next_account_id:06d}"))
                next_account_id += 1

            age = RNG.choice(AGE_BANDS)
            gender = RNG.choice(GENDERS)
            district = RNG.choice(HK_DISTRICTS)
            language = RNG.choice(LANGUAGES) if RNG.random() > 0.1 else "Cantonese"

            cs_bb_p  = 0.35 if segment_code == "postpaid_premium" else (0.15 if segment_code == "postpaid_value" else 0.0)
            cs_ent_p = 0.20 if segment_code in ("postpaid_premium","postpaid_value") else 0.0
            cs_dev_p = 0.15 if segment_code == "postpaid_premium" else 0.05
            cs_bb  = RNG.random() < cs_bb_p
            cs_ent = RNG.random() < cs_ent_p
            cs_dev = RNG.random() < cs_dev_p

            customers.append(Customer(
                id=next_customer_id,
                external_customer_id=f"CUST{next_customer_id:06d}",
                account_id=acct_id,
                segment_code=segment_code,
                plan_type_id=plan_id[plan_code],
                plan_code=plan_code,
                monthly_arpu_hkd=arpu,
                contract_months=contract_months,
                acquisition_channel=channel,
                ad_id=ad_id,
                acquisition_date=acq_date,
                activation_date=activation_dt,
                activation_lag_days=(activation_lag if activation_status != "failed" else None),
                activation_status=activation_status,
                age_band=age,
                gender=gender,
                hk_district_id=district_id[district],
                language_pref=language,
                cross_sell_broadband=cs_bb,
                cross_sell_entertainment=cs_ent,
                cross_sell_device_fin=cs_dev,
                monthly_total_revenue_hkd=arpu + (50 if cs_ent else 0) + (200 if cs_bb else 0),
                relationship_type="net_new",
                prior_tenure_months=0,
                status=status,
                churn_date=churn_date,
                months_active=months_active,
                realized_revenue_hkd=round(realized, 2),
                projected_ltv_24mo_hkd=projected_ltv,
                acquisition_cost_hkd=acq_cost,
            ))
            next_customer_id += 1

    # 2. FBB add-on customer-rows
    primaries_premium = [c for c in customers if c.segment_code == "postpaid_premium"]
    primaries_value   = [c for c in customers if c.segment_code == "postpaid_value"]
    n_fbb_premium = round(0.25 * len(primaries_premium))
    n_fbb_value   = round(0.15 * len(primaries_value))

    chosen_premium_accts = RNG.sample(list({c.account_id for c in primaries_premium}), min(n_fbb_premium, len({c.account_id for c in primaries_premium})))
    chosen_value_accts   = RNG.sample(list({c.account_id for c in primaries_value}),   min(n_fbb_value,   len({c.account_id for c in primaries_value})))

    for acct_id in chosen_premium_accts + chosen_value_accts:
        primary = next(c for c in customers if c.account_id == acct_id)
        plan_code = "FBB_FTTH_1G" if primary.segment_code == "postpaid_premium" else "FBB_FTTH_500M"
        arpu = 298.0 if plan_code == "FBB_FTTH_1G" else 198.0
        acq_offset = RNG.randint(0, 90)
        acq_date = primary.acquisition_date + timedelta(days=acq_offset)
        if acq_date > REFERENCE_DATE:
            acq_date = REFERENCE_DATE
        tenure = max(0, (REFERENCE_DATE - acq_date).days // 30)

        customers.append(Customer(
            id=next_customer_id,
            external_customer_id=f"CUST{next_customer_id:06d}",
            account_id=acct_id,
            segment_code=primary.segment_code,
            plan_type_id=plan_id[plan_code],
            plan_code=plan_code,
            monthly_arpu_hkd=arpu,
            contract_months=24,
            acquisition_channel="organic",
            ad_id=sentinel_ad_id,
            acquisition_date=acq_date,
            activation_date=acq_date,
            activation_lag_days=0,
            activation_status="active",
            age_band=primary.age_band,
            gender=primary.gender,
            hk_district_id=primary.hk_district_id,
            language_pref=primary.language_pref,
            cross_sell_broadband=False,
            cross_sell_entertainment=False,
            cross_sell_device_fin=False,
            monthly_total_revenue_hkd=arpu,
            relationship_type="cross_sell",
            prior_tenure_months=tenure,
            status="active",
            churn_date=None,
            months_active=min(tenure, 12),
            realized_revenue_hkd=round(arpu * min(tenure, 12), 2),
            projected_ltv_24mo_hkd=round(arpu * 24 * 0.85, 2),
            acquisition_cost_hkd=None,
        ))
        next_customer_id += 1

    write_sql(customers, accounts)
    print(f"Generated {len(customers)} customer-rows across {len(accounts)} accounts")


def write_sql(customers: list[Customer], accounts: list[tuple[int, str]]) -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    chunks: list[str] = []

    chunks.append("-- 04_data.sql — generated by etl/generate_3hk_mock.py — do not edit by hand")
    chunks.append("-- Spec: docs/specs/2026-04-30-3hk-realistic-mock-data-design.md")

    # accounts
    chunks.append("\n-- accounts")
    rows = ",\n".join(f"({aid}, {_s(ext)})" for aid, ext in accounts)
    chunks.append(f"INSERT INTO accounts (id, external_account_id) VALUES\n{rows};")
    chunks.append("SELECT setval(pg_get_serial_sequence('accounts','id'), (SELECT MAX(id) FROM accounts));")

    # customers
    chunks.append("\n-- customers")
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

    # customer_events
    chunks.append("\n-- customer_events")
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

    # ad_spend
    chunks.append("\n-- ad_spend")
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

    OUT_PATH.write_text("\n".join(chunks) + "\n")


if __name__ == "__main__":
    main()
