/*
  Teams become per-assignment.

  A team now belongs to exactly one assignment, and "one student, one team"
  becomes "one student, one team *per assignment*".

  DESTRUCTIVE. Existing teams predate the assignment column and there is no
  correct assignment to attribute them to, so they are dropped along with their
  memberships — and, by cascade, the submissions made through them. Back up
  data/ before running this on anything you care about. It is written for a
  database that has not yet been used in anger.

  Hand-written rather than generated: SQLite refuses ALTER TABLE ... ADD COLUMN
  with a NOT NULL constraint and no default, even on an empty table, so both
  tables are rebuilt instead.
*/
PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP INDEX IF EXISTS `team_members_student_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `team_members_team_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `teams_access_token_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `teams_short_code_unique`;--> statement-breakpoint
DELETE FROM `submissions`;--> statement-breakpoint
DELETE FROM `team_members`;--> statement-breakpoint
DELETE FROM `teams`;--> statement-breakpoint
DROP TABLE `team_members`;--> statement-breakpoint
DROP TABLE `teams`;--> statement-breakpoint
CREATE TABLE `teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` integer NOT NULL,
	`name` text NOT NULL,
	`access_token` text NOT NULL,
	`short_code` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_access_token_unique` ON `teams` (`access_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `teams_short_code_unique` ON `teams` (`short_code`);--> statement-breakpoint
CREATE INDEX `teams_assignment_idx` ON `teams` (`assignment_id`);--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`assignment_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_assignment_student_unique` ON `team_members` (`assignment_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `team_members_team_idx` ON `team_members` (`team_id`);--> statement-breakpoint
ALTER TABLE `assignments` ADD `grouping` text DEFAULT 'copy' NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=ON;
