CREATE TABLE `lab_person` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`lab_account_id` integer NOT NULL,
	`person_key` text NOT NULL,
	`name` text NOT NULL,
	`birth_date` text,
	`patient_id` integer,
	`skipped` integer DEFAULT false NOT NULL,
	`order_count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_lab_person_lab_account_id_lab_account_id_fk` FOREIGN KEY (`lab_account_id`) REFERENCES `lab_account`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_lab_person_patient_id_patient_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patient`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `lab_order` ADD `lab_person_id` integer REFERENCES lab_person(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `lab_person_key` ON `lab_person` (`lab_account_id`,`person_key`);