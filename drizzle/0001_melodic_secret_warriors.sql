-- Drop the composite events_tab indexes: each one cost a written row per pageview
-- and nothing queries D1 over a range wide enough to need them any more.
-- Hand-edited to IF EXISTS: idx_events_day_ref was an opt-in, so not every
-- deployment has it.
--
-- Measured (plan Phase 0, 2026-11-03): DROP INDEX bills 0 written rows, so this
-- is safe to apply at any time.
DROP INDEX IF EXISTS `idx_events_day_country`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_events_day_path`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_events_day_ref`;
