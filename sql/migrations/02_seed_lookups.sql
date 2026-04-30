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
UPDATE plan_types SET brand_code='3HK', segment_code='postpaid_premium', service_type='mobile'
  WHERE code IN ('5G_Family_4Line','5G_Family_2Line','5G_Single_Premium');
UPDATE plan_types SET brand_code='3HK', segment_code='postpaid_value',   service_type='mobile'
  WHERE code IN ('5G_Single_Standard','5G_Single_Basic','5G_Gamer_Unlimited');
UPDATE plan_types SET brand_code='3HK', segment_code='postpaid_value',   service_type='roaming'
  WHERE code IN ('Roaming_Pass_7d','Roaming_Pass_14d');

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

-- Set start/end dates on existing campaigns
UPDATE campaigns SET start_date='2025-11-01', end_date='2025-11-14' WHERE name='HK_5G_FamilyPlan_Q4_2025';
UPDATE campaigns SET start_date='2025-11-03', end_date='2025-11-16' WHERE name='HK_5G_GamerUnlimited_Q4';
UPDATE campaigns SET start_date='2025-11-08', end_date='2025-11-21' WHERE name='HK_RoamingPass_Asia_Q4_2025';

-- New paid campaigns spread across 2025 cohort months
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

-- One ad_set per new campaign (single creative per campaign — sufficient for mock)
INSERT INTO ad_sets (name, campaign_id)
SELECT camp.name || '_default_adset', camp.id
FROM campaigns camp
WHERE camp.name IN (
  'HK_5G_FamilyPlan_Q1_2025','HK_5G_FamilyPlan_Q2_2025','HK_5G_FamilyPlan_Q3_2025',
  'HK_5G_GamerUnlimited_Q1','HK_5G_GamerUnlimited_Q2','HK_5G_GamerUnlimited_Q3',
  'HK_SoSIM_LaunchFlight_Q1','HK_SoSIM_AlwaysOn_Q2','HK_SoSIM_AlwaysOn_Q3','HK_SoSIM_AlwaysOn_Q4',
  'HK_RoamingPass_GoldenWeek','HK_RoamingPass_Summer'
);

-- One ad per new ad_set
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
