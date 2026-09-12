ALTER TABLE cms_products ADD COLUMN price_period TEXT NOT NULL DEFAULT '' CHECK(price_period IN ('','month','year','30_days','once'));
ALTER TABLE cms_products ADD COLUMN price_note TEXT NOT NULL DEFAULT '';
ALTER TABLE cms_products ADD COLUMN source_name TEXT NOT NULL DEFAULT '';
ALTER TABLE cms_products ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE cms_products ADD COLUMN source_checked_at TEXT NOT NULL DEFAULT '';
