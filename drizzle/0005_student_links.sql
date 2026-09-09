ALTER TABLE `students` ADD `access_token` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `students_access_token_unique` ON `students` (`access_token`);
--> statement-breakpoint
CREATE TABLE `group_change_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer NOT NULL,
	`assignment_id` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`admin_note` text,
	`resolved_by_admin_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by_admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `group_change_requests_status_idx` ON `group_change_requests` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `group_change_requests_student_idx` ON `group_change_requests` (`student_id`);
