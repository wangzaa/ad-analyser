-- 03_truncate.sql — wipe all customer-level data tables before regen.
-- ad_sets / ads / campaigns / lookup tables retained.
TRUNCATE customer_events, customers, account_products, ad_spend, accounts RESTART IDENTITY CASCADE;
