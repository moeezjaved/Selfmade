-- Self-heal convergence gauge: the rollup writes the corpus-wide count of unscored
-- (performance_score = 0) ads to the status row each run. The /admin/health panel
-- reads discovery_rollup_status, so this turns "verify the self-heal drains to 0"
-- from a manual curl into a passive gauge — if score_zero flatlines instead of
-- trending down, the sentinel floor isn't working (un-scoreable ads looping).
alter table discovery_rollup_status add column if not exists score_zero int;
