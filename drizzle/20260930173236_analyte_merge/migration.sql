CREATE TABLE `analyte_merge` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`source_id` integer NOT NULL,
	`target_id` integer NOT NULL,
	`record` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_analyte_merge_target_id_analyte_id_fk` FOREIGN KEY (`target_id`) REFERENCES `analyte`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `analyte_merge_target` ON `analyte_merge` (`target_id`);