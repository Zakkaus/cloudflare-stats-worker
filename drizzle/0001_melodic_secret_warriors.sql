-- Drop the composite events_tab indexes: each one cost a written row per pageview
-- (and per prune delete) and nothing queries D1 over a range wide enough to need
-- them any more. Hand-edited to IF EXISTS: idx_events_day_ref was an opt-in, so
-- not every deployment has it.
--
-- Not measured yet: whether DROP INDEX itself bills a written row per indexed
-- row (plan Phase 0). Check `wrangler d1 info` rows_written_24h first and apply
-- on a quiet day; on a ~1.3M-row table that could be most of a day's budget.
DROP INDEX IF EXISTS `idx_events_day_country`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_events_day_path`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_events_day_ref`;
