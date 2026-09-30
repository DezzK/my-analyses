CREATE TABLE `analyte` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`specimen` text,
	`description` text,
	`value_kind` text DEFAULT 'numeric' NOT NULL,
	`canonical_unit_id` integer,
	`display_unit_id` integer,
	`molar_mass` real,
	`reviewed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_analyte_canonical_unit_id_unit_id_fk` FOREIGN KEY (`canonical_unit_id`) REFERENCES `unit`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_analyte_display_unit_id_unit_id_fk` FOREIGN KEY (`display_unit_id`) REFERENCES `unit`(`id`) ON DELETE SET NULL,
	CONSTRAINT "analyte_specimen" CHECK("specimen" is null or "specimen" in ('blood', 'serum', 'plasma', 'urine', 'stool', 'saliva', 'other')),
	CONSTRAINT "analyte_value_kind" CHECK("value_kind" in ('numeric', 'qualitative', 'text'))
);
--> statement-breakpoint
CREATE TABLE `analyte_alias` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`analyte_id` integer NOT NULL,
	`alias` text NOT NULL,
	`lab_id` integer,
	`lab_code` text,
	CONSTRAINT `fk_analyte_alias_analyte_id_analyte_id_fk` FOREIGN KEY (`analyte_id`) REFERENCES `analyte`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_analyte_alias_lab_id_lab_id_fk` FOREIGN KEY (`lab_id`) REFERENCES `lab`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `analyte_unit` (
	`analyte_id` integer NOT NULL,
	`unit_id` integer NOT NULL,
	`factor` real,
	CONSTRAINT `analyte_unit_pk` PRIMARY KEY(`analyte_id`, `unit_id`),
	CONSTRAINT `fk_analyte_unit_analyte_id_analyte_id_fk` FOREIGN KEY (`analyte_id`) REFERENCES `analyte`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_analyte_unit_unit_id_unit_id_fk` FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `lab` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL UNIQUE,
	`connector_id` text,
	`marker_color` text NOT NULL,
	`marker_shape` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "lab_marker_shape" CHECK("marker_shape" in ('circle', 'rect', 'triangle', 'diamond', 'roundRect', 'pin'))
);
--> statement-breakpoint
CREATE TABLE `lab_account` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`lab_id` integer NOT NULL,
	`label` text NOT NULL,
	`external_account_id` text,
	`default_patient_id` integer,
	`session_partition` text NOT NULL UNIQUE,
	`last_sync_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_lab_account_lab_id_lab_id_fk` FOREIGN KEY (`lab_id`) REFERENCES `lab`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_lab_account_default_patient_id_patient_id_fk` FOREIGN KEY (`default_patient_id`) REFERENCES `patient`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `lab_order` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`patient_id` integer NOT NULL,
	`lab_id` integer NOT NULL,
	`lab_account_id` integer,
	`collected_on` text NOT NULL,
	`collected_time` text,
	`cycle_phase` text,
	`external_key` text,
	`source` text NOT NULL,
	`connector_version` text,
	`raw_payload` text,
	`raw_hash` text,
	`pdf_file` text,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_lab_order_patient_id_patient_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patient`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_lab_order_lab_id_lab_id_fk` FOREIGN KEY (`lab_id`) REFERENCES `lab`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_lab_order_lab_account_id_lab_account_id_fk` FOREIGN KEY (`lab_account_id`) REFERENCES `lab_account`(`id`) ON DELETE SET NULL,
	CONSTRAINT "lab_order_cycle_phase" CHECK("cycle_phase" is null or "cycle_phase" in ('follicular', 'ovulatory', 'luteal')),
	CONSTRAINT "lab_order_source" CHECK("source" in ('manual', 'import'))
);
--> statement-breakpoint
CREATE TABLE `panel` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL UNIQUE,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `panel_item` (
	`panel_id` integer NOT NULL,
	`analyte_id` integer NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `panel_item_pk` PRIMARY KEY(`panel_id`, `analyte_id`),
	CONSTRAINT `fk_panel_item_panel_id_panel_id_fk` FOREIGN KEY (`panel_id`) REFERENCES `panel`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_panel_item_analyte_id_analyte_id_fk` FOREIGN KEY (`analyte_id`) REFERENCES `analyte`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `patient` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`title` text NOT NULL,
	`sex` text NOT NULL,
	`birth_date` text NOT NULL,
	`note` text,
	`deleted_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "patient_sex" CHECK("sex" in ('male', 'female'))
);
--> statement-breakpoint
CREATE TABLE `patient_period` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`patient_id` integer NOT NULL,
	`kind` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	CONSTRAINT `fk_patient_period_patient_id_patient_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patient`(`id`) ON DELETE CASCADE,
	CONSTRAINT "patient_period_kind" CHECK("kind" in ('pregnancy', 'menopause'))
);
--> statement-breakpoint
CREATE TABLE `reference_rule` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`analyte_id` integer NOT NULL,
	`lab_id` integer,
	`sex` text,
	`age_from_days` integer,
	`age_to_days` integer,
	`condition` text,
	`low` real,
	`high` real,
	`expected` text,
	`unit_id` integer,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_reference_rule_analyte_id_analyte_id_fk` FOREIGN KEY (`analyte_id`) REFERENCES `analyte`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_reference_rule_lab_id_lab_id_fk` FOREIGN KEY (`lab_id`) REFERENCES `lab`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_reference_rule_unit_id_unit_id_fk` FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON DELETE SET NULL,
	CONSTRAINT "reference_rule_sex" CHECK("sex" is null or "sex" in ('male', 'female')),
	CONSTRAINT "reference_rule_condition" CHECK("condition" is null or "condition" in ('pregnancy_t1', 'pregnancy_t2', 'pregnancy_t3', 'phase_follicular', 'phase_ovulatory', 'phase_luteal', 'postmenopause'))
);
--> statement-breakpoint
CREATE TABLE `report_template` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`title` text NOT NULL,
	`blocks` text DEFAULT '[]' NOT NULL,
	`layout` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `result` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`order_id` integer NOT NULL,
	`analyte_id` integer NOT NULL,
	`raw_value` text NOT NULL,
	`unit_id` integer,
	`ref_raw` text,
	`lab_flag` text,
	`external_key` text,
	`user_edited` integer DEFAULT false NOT NULL,
	`note` text,
	CONSTRAINT `fk_result_order_id_lab_order_id_fk` FOREIGN KEY (`order_id`) REFERENCES `lab_order`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_result_analyte_id_analyte_id_fk` FOREIGN KEY (`analyte_id`) REFERENCES `analyte`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_result_unit_id_unit_id_fk` FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON DELETE SET NULL,
	CONSTRAINT "result_lab_flag" CHECK("lab_flag" is null or "lab_flag" in ('high', 'low', 'normal', 'abnormal'))
);
--> statement-breakpoint
CREATE TABLE `sync_run` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`lab_account_id` integer NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`stats` text,
	`error` text,
	CONSTRAINT `fk_sync_run_lab_account_id_lab_account_id_fk` FOREIGN KEY (`lab_account_id`) REFERENCES `lab_account`(`id`) ON DELETE CASCADE,
	CONSTRAINT "sync_run_status" CHECK("status" in ('running', 'ok', 'error', 'blocked', 'login_required'))
);
--> statement-breakpoint
CREATE TABLE `unit` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`code` text NOT NULL UNIQUE,
	`display` text NOT NULL,
	`dimension` text NOT NULL,
	`scale` real DEFAULT 1 NOT NULL,
	`reviewed` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `unit_spelling` (
	`spelling` text PRIMARY KEY,
	`unit_id` integer NOT NULL,
	CONSTRAINT `fk_unit_spelling_unit_id_unit_id_fk` FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analyte_alias_lab_code` ON `analyte_alias` (`lab_id`,`lab_code`) WHERE "analyte_alias"."lab_code" is not null;--> statement-breakpoint
CREATE INDEX `analyte_alias_analyte` ON `analyte_alias` (`analyte_id`);--> statement-breakpoint
CREATE INDEX `lab_account_lab` ON `lab_account` (`lab_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lab_order_external` ON `lab_order` (`lab_id`,`external_key`) WHERE "lab_order"."external_key" is not null;--> statement-breakpoint
CREATE INDEX `lab_order_patient_date` ON `lab_order` (`patient_id`,`collected_on`);--> statement-breakpoint
CREATE INDEX `patient_period_patient` ON `patient_period` (`patient_id`);--> statement-breakpoint
CREATE INDEX `reference_rule_analyte` ON `reference_rule` (`analyte_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `result_external` ON `result` (`order_id`,`external_key`) WHERE "result"."external_key" is not null;--> statement-breakpoint
CREATE INDEX `result_analyte` ON `result` (`analyte_id`);--> statement-breakpoint
CREATE INDEX `result_order` ON `result` (`order_id`);--> statement-breakpoint
CREATE INDEX `sync_run_account` ON `sync_run` (`lab_account_id`);