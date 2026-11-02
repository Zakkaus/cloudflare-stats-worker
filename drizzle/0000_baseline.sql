CREATE TABLE `dim_browser_tab` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dim_browser_tab_value_unique` ON `dim_browser_tab` (`value`);--> statement-breakpoint
CREATE TABLE `dim_browser_ver_tab` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dim_browser_ver_tab_value_unique` ON `dim_browser_ver_tab` (`value`);--> statement-breakpoint
CREATE TABLE `dim_country_tab` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dim_country_tab_value_unique` ON `dim_country_tab` (`value`);--> statement-breakpoint
-- hand-edited: WITHOUT ROWID (drizzle cannot express it; see src/db/schema.ts)
CREATE TABLE `dim_daily_tab` (
	`dimension` text NOT NULL,
	`day` integer NOT NULL,
	`value_id` integer NOT NULL,
	`pv` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`dimension`, `day`, `value_id`)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `dim_device_model_tab` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dim_device_model_tab_value_unique` ON `dim_device_model_tab` (`value`);--> statement-breakpoint
CREATE TABLE `dim_device_type_tab` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dim_device_type_tab_value_unique` ON `dim_device_type_tab` (`value`);--> statement-breakpoint
CREATE TABLE `dim_device_vendor_tab` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dim_device_vendor_tab_value_unique` ON `dim_device_vendor_tab` (`value`);--> statement-breakpoint
CREATE TABLE `dim_os_tab` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dim_os_tab_value_unique` ON `dim_os_tab` (`value`);--> statement-breakpoint
CREATE TABLE `dim_os_ver_tab` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dim_os_ver_tab_value_unique` ON `dim_os_ver_tab` (`value`);--> statement-breakpoint
CREATE TABLE `dim_path_tab` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dim_path_tab_value_unique` ON `dim_path_tab` (`value`);--> statement-breakpoint
CREATE TABLE `dim_ref_domain_tab` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dim_ref_domain_tab_value_unique` ON `dim_ref_domain_tab` (`value`);--> statement-breakpoint
CREATE TABLE `events_monthly_tab` (
	`month` integer NOT NULL,
	`dimension` text NOT NULL,
	`value` text NOT NULL,
	`pv` integer DEFAULT 0 NOT NULL,
	`uv` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`month`, `dimension`, `value`)
);
--> statement-breakpoint
CREATE INDEX `idx_events_monthly_dim` ON `events_monthly_tab` (`month`,`dimension`);--> statement-breakpoint
CREATE INDEX `idx_events_monthly_total` ON `events_monthly_tab` (`dimension`,`month`);--> statement-breakpoint
CREATE TABLE `events_tab` (
	`id` integer PRIMARY KEY NOT NULL,
	`day` integer NOT NULL,
	`visitor_id` integer NOT NULL,
	`path_id` integer NOT NULL,
	`ref_domain_id` integer,
	`country_id` integer,
	`browser_id` integer,
	`browser_ver_id` integer,
	`os_id` integer,
	`os_ver_id` integer,
	`device_type_id` integer,
	`device_vendor_id` integer,
	`device_model_id` integer
);
--> statement-breakpoint
CREATE INDEX `idx_events_day` ON `events_tab` (`day`);--> statement-breakpoint
CREATE INDEX `idx_events_day_country` ON `events_tab` (`day`,`country_id`);--> statement-breakpoint
CREATE INDEX `idx_events_day_path` ON `events_tab` (`day`,`path_id`);--> statement-breakpoint
CREATE INDEX `idx_events_day_ref` ON `events_tab` (`day`,`ref_domain_id`);--> statement-breakpoint
-- hand-edited: WITHOUT ROWID (drizzle cannot express it; see src/db/schema.ts)
CREATE TABLE `hier_daily_tab` (
	`hier` text NOT NULL,
	`day` integer NOT NULL,
	`k0` integer NOT NULL,
	`k1` integer NOT NULL,
	`k2` integer DEFAULT 0 NOT NULL,
	`pv` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`hier`, `day`, `k0`, `k1`, `k2`)
) WITHOUT ROWID;
--> statement-breakpoint
-- hand-edited: WITHOUT ROWID (drizzle cannot express it; see src/db/schema.ts)
CREATE TABLE `meta_tab` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `site_daily_tab` (
	`day` integer PRIMARY KEY NOT NULL,
	`pv` integer DEFAULT 0 NOT NULL,
	`uv` integer DEFAULT 0 NOT NULL
);
