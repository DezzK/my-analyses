CREATE TABLE `order_form` (
	`order_id` integer NOT NULL,
	`position` integer NOT NULL,
	`file` text NOT NULL,
	CONSTRAINT `order_form_pk` PRIMARY KEY(`order_id`, `position`),
	CONSTRAINT `fk_order_form_order_id_lab_order_id_fk` FOREIGN KEY (`order_id`) REFERENCES `lab_order`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
-- Every form stored so far becomes its order's first.
INSERT INTO `order_form` (`order_id`, `position`, `file`) SELECT `id`, 0, `form_file` FROM `lab_order` WHERE `form_file` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `lab_order` DROP COLUMN `form_file`;