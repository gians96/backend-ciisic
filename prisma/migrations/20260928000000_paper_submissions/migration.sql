CREATE TABLE `PaperSubmission` (
    `id` VARCHAR(36) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `mainAuthor` JSON NOT NULL,
    `coauthors` JSON NOT NULL,
    `filename` VARCHAR(255) NOT NULL,
    `originalFilename` VARCHAR(255) NOT NULL,
    `size` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `PaperSubmission_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
