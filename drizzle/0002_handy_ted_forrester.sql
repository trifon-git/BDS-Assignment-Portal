CREATE TABLE `forum_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`parent_id` integer,
	`author_student_id` integer NOT NULL,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `forum_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `forum_messages_team_idx` ON `forum_messages` (`team_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `forum_messages_parent_idx` ON `forum_messages` (`parent_id`);