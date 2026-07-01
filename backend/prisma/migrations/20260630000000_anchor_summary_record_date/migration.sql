-- Step 1: Drop the unique index on base_org_id
ALTER TABLE `anchor_daily_summaries` DROP INDEX `anchor_daily_summaries_base_org_id_key`;

-- Step 2: Add record_date column with a temporary default
ALTER TABLE `anchor_daily_summaries` ADD COLUMN `record_date` VARCHAR(10) NOT NULL DEFAULT '2025-01-01';

-- Step 3: Copy upload_date values to record_date
UPDATE `anchor_daily_summaries` SET `record_date` = `upload_date`;

-- Step 4: Drop the old upload_date column
ALTER TABLE `anchor_daily_summaries` DROP COLUMN `upload_date`;

-- Step 5: Create the new compound unique index
CREATE UNIQUE INDEX `anchor_daily_summaries_base_org_id_record_date_key` ON `anchor_daily_summaries`(`base_org_id` ASC, `record_date` ASC);
