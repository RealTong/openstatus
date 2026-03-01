CREATE TABLE `monitor_result` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`monitor_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`job_type` text NOT NULL,
	`region` text NOT NULL,
	`status_code` integer,
	`latency` integer NOT NULL,
	`request_status` text NOT NULL,
	`message` text,
	`timing_dns` integer,
	`timing_connection` integer,
	`timing_tls` integer,
	`timing_ttfb` integer,
	`timing_transfer` integer,
	`trigger` text DEFAULT 'cron',
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitor`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_monitor_result_monitor_time` ON `monitor_result` (`monitor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_monitor_result_workspace_time` ON `monitor_result` (`workspace_id`,`created_at`);--> statement-breakpoint
DROP INDEX `workspace_stripe_id_unique`;--> statement-breakpoint
DROP INDEX `workspace_id_dsn_unique`;--> statement-breakpoint
ALTER TABLE `workspace` DROP COLUMN `stripe_id`;--> statement-breakpoint
ALTER TABLE `workspace` DROP COLUMN `subscription_id`;--> statement-breakpoint
ALTER TABLE `workspace` DROP COLUMN `plan`;--> statement-breakpoint
ALTER TABLE `workspace` DROP COLUMN `ends_at`;--> statement-breakpoint
ALTER TABLE `workspace` DROP COLUMN `paid_until`;--> statement-breakpoint
ALTER TABLE `workspace` DROP COLUMN `limits`;--> statement-breakpoint
ALTER TABLE `workspace` DROP COLUMN `dsn`;