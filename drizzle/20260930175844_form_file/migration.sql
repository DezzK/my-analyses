-- The original form can be a photo as well as a PDF: the column names a file, extension included.
ALTER TABLE `lab_order` RENAME COLUMN `pdf_file` TO `form_file`;
--> statement-breakpoint
UPDATE `lab_order` SET `form_file` = `form_file` || '.pdf' WHERE `form_file` IS NOT NULL;
