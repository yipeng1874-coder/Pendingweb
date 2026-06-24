-- CreateTable
CREATE TABLE `export_tasks` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `status` ENUM('pending', 'processing', 'done', 'failed') NOT NULL DEFAULT 'pending',
    `params` JSON NOT NULL,
    `file_path` VARCHAR(191) NULL,
    `row_count` INTEGER NULL,
    `error_msg` TEXT NULL,
    `creator_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `export_tasks_creator_id_type_status_idx`(`creator_id`, `type`, `status`),
    INDEX `export_tasks_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `export_tasks` ADD CONSTRAINT `export_tasks_creator_id_fkey` FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
