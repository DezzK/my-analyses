CREATE TABLE `dictionary_link` (
	`entry_key` text PRIMARY KEY,
	`analyte_id` integer NOT NULL,
	CONSTRAINT `fk_dictionary_link_analyte_id_analyte_id_fk` FOREIGN KEY (`analyte_id`) REFERENCES `analyte`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `analyte` ADD `separated` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `analyte_merge` ADD `reviewed` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `dictionary_link_analyte` ON `dictionary_link` (`analyte_id`);