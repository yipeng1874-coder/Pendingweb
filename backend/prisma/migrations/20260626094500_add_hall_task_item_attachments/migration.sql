-- CreateTable
CREATE TABLE `hall_task_item_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `hall_task_item_record_id` VARCHAR(191) NOT NULL,
    `file_name` VARCHAR(191) NOT NULL,
    `file_url` VARCHAR(191) NOT NULL,
    `file_size` INTEGER NOT NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `uploaded_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hall_task_item_attachments_hall_task_item_record_id_idx`(`hall_task_item_record_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `hall_task_item_attachments` ADD CONSTRAINT `hall_task_item_attachments_hall_task_item_record_id_fkey` FOREIGN KEY (`hall_task_item_record_id`) REFERENCES `hall_task_item_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
