ALTER TABLE `projects` ADD `source` text DEFAULT 'claude-code' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `source` text DEFAULT 'claude-code' NOT NULL;