-- 05_views.sql — drop and recreate all dashboard views with new schema awareness.

DROP VIEW IF EXISTS v_account_summary CASCADE;
DROP VIEW IF EXISTS v_customer_360 CASCADE;
DROP VIEW IF EXISTS v_acquisition_by_campaign CASCADE;
DROP VIEW IF EXISTS v_cohort_retention CASCADE;
DROP VIEW IF EXISTS v_account_products_current CASCADE;
DROP VIEW IF EXISTS v_segment_ltv CASCADE;
DROP VIEW IF EXISTS v_campaign_efficiency CASCADE;
DROP VIEW IF EXISTS v_customer_digital_cpa CASCADE;

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

-- v_account_summary: counts active mobile + broadband + roaming + entertainment + insurance lines.
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

-- v_customer_360 — extended with segment_code, brand, service_type, acquisition_cost
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
-- Campaign-level total_spend and CPA are computed once (via CTEs) to avoid
-- per-customer-join inflation. Segment grouping shows which segment the
-- campaign reached; CPA is shared across segments within a campaign because
-- ad spend isn't apportioned per segment at the platform level.
CREATE VIEW v_campaign_efficiency AS
WITH campaign_spend_totals AS (
  SELECT camp.id AS campaign_id, COALESCE(SUM(spend.spend_hkd), 0) AS total_spend_hkd
  FROM campaigns camp
  LEFT JOIN ad_sets ads2 ON ads2.campaign_id = camp.id
  LEFT JOIN ads ad       ON ad.ad_set_id = ads2.id
  LEFT JOIN ad_spend spend ON spend.ad_id = ad.id
  GROUP BY camp.id
),
campaign_paid_customers AS (
  SELECT camp.id AS campaign_id, COUNT(c.id) AS total_customers
  FROM customers c
  JOIN ads ad         ON ad.id = c.ad_id
  JOIN ad_sets ads2   ON ads2.id = ad.ad_set_id
  JOIN campaigns camp ON camp.id = ads2.campaign_id
  WHERE c.acquisition_channel = 'paid_social'
  GROUP BY camp.id
)
SELECT
  pl.code                                                              AS platform,
  camp.name                                                            AS campaign_name,
  pt.segment_code,
  COUNT(c.id)                                                          AS customers_acquired,
  cst.total_spend_hkd,
  CASE WHEN cpc.total_customers > 0
       THEN ROUND(cst.total_spend_hkd / cpc.total_customers, 2)
       ELSE NULL END                                                   AS digital_cpa_hkd,
  ROUND(AVG(c.realized_revenue_hkd)::numeric, 2)                       AS avg_realized_revenue,
  ROUND(AVG(c.projected_ltv_24mo_hkd)::numeric, 2)                     AS avg_projected_ltv
FROM customers c
JOIN ads ad                       ON ad.id = c.ad_id
JOIN ad_sets ads2                 ON ads2.id = ad.ad_set_id
JOIN campaigns camp               ON camp.id = ads2.campaign_id
JOIN platforms pl                 ON pl.id = camp.platform_id
JOIN plan_types pt                ON pt.id = c.plan_type_id
LEFT JOIN campaign_spend_totals cst   ON cst.campaign_id = camp.id
LEFT JOIN campaign_paid_customers cpc ON cpc.campaign_id = camp.id
WHERE c.acquisition_channel = 'paid_social'
GROUP BY pl.code, camp.name, pt.segment_code, cst.total_spend_hkd, cpc.total_customers;

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

-- v_cohort_retention
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

-- v_account_products_current: all of an account's *active* customer lines
CREATE VIEW v_account_products_current AS
SELECT
  a.id AS account_id,
  array_agg(pt.code ORDER BY pt.code) FILTER (WHERE c.status = 'active') AS products
FROM accounts a
JOIN customers c   ON c.account_id = a.id
JOIN plan_types pt ON pt.id = c.plan_type_id
GROUP BY a.id;
