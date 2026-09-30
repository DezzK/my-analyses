CREATE TABLE `report_block` (
	`template_id` integer NOT NULL,
	`analyte_id` integer NOT NULL,
	`position` integer NOT NULL,
	`view` text NOT NULL,
	`break_after` integer DEFAULT false NOT NULL,
	CONSTRAINT `report_block_pk` PRIMARY KEY(`template_id`, `analyte_id`),
	CONSTRAINT `fk_report_block_template_id_report_template_id_fk` FOREIGN KEY (`template_id`) REFERENCES `report_template`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_report_block_analyte_id_analyte_id_fk` FOREIGN KEY (`analyte_id`) REFERENCES `analyte`(`id`) ON DELETE CASCADE,
	CONSTRAINT "report_block_view" CHECK("view" in ('table', 'chart', 'both'))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_report_template` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`title` text NOT NULL UNIQUE,
	`layout` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_report_template`(`id`, `title`, `layout`, `created_at`, `updated_at`) SELECT `id`, `title`, `layout`, `created_at`, `updated_at` FROM `report_template`;--> statement-breakpoint
DROP TABLE `report_template`;--> statement-breakpoint
ALTER TABLE `__new_report_template` RENAME TO `report_template`;--> statement-breakpoint
PRAGMA foreign_keys=ON;