-- 添加 hall_task_records 表的 (record_date, hall_org_id) 联合索引
-- 优化按日期查厅任务记录的查询性能
CREATE INDEX `hall_task_records_record_date_hall_org_id_idx` ON `hall_task_records`(`record_date`, `hall_org_id`);
