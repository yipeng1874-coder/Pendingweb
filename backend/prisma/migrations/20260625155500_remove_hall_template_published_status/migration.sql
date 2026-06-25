-- 将 hall_task_templates 表中 status=published 的记录改为 draft
-- （因为 published 只是一个透明的中间状态，等同于 draft）
UPDATE `hall_task_templates` SET `status` = 'draft' WHERE `status` = 'published';

-- 修改枚举，移除 published 值
ALTER TABLE `hall_task_templates` MODIFY COLUMN `status` ENUM('draft', 'archived') NOT NULL DEFAULT 'draft';
