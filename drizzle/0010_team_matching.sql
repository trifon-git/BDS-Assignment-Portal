CREATE TABLE `team_matching_responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`answers` text NOT NULL,
	`submitted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_matching_responses_unique` ON `team_matching_responses` (`assignment_id`, `student_id`);
