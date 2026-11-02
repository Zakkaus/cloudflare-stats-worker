#!/usr/bin/env bash
# Export the D1 database for local analysis.
#
#   bash scripts/export.sh [database-name] [output-dir]
#
# Why: the hosted dashboard is deliberately constrained to pre-aggregated
# rollups so it fits inside D1's free 5M rows/day. Anything the rollups cannot
# answer -- cross-filtered breakdowns, arbitrary cohorts, long-range
# exploration -- belongs here instead, where queries are free and unlimited.
#
# The export runs through D1's export job (not the query path), so it should not
# bill rows read the way a SELECT would. That is not documented either way,
# so treat it as unverified: check `wrangler d1 insights` afterwards the first
# time, and if it does register, run it right after the 00:00 UTC quota reset.
set -euo pipefail

DB="${1:-cloudflare_stats_db}"
OUT_DIR="${2:-./local}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="${OUT_DIR}/${DB}-${STAMP}.sql"
SQLITE_DB="${OUT_DIR}/${DB}.db"

mkdir -p "$OUT_DIR"

echo "==> Exporting ${DB} (remote) -> ${DUMP}"
npx wrangler d1 export "$DB" --remote --output="$DUMP"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo ""
  echo "Dump written to ${DUMP}."
  echo "sqlite3 is not on PATH, so the local database was not built. Install it, or"
  echo "open the dump with any SQLite client."
  exit 0
fi

echo "==> Building ${SQLITE_DB}"
rm -f "$SQLITE_DB"
# Both pragmas are safe here: this is a throwaway local copy, and they make
# importing ~1.3M INSERT statements minutes faster.
sqlite3 "$SQLITE_DB" "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;" >/dev/null
sqlite3 "$SQLITE_DB" ".read ${DUMP}"

# Indexes are free locally -- none of the write-amplification or rows-billed
# trade-offs that keep production down to four apply here.
echo "==> Adding analysis indexes (free locally)"
sqlite3 "$SQLITE_DB" <<'SQL'
CREATE INDEX IF NOT EXISTS ix_day_browser  ON events_tab(day, browser_id);
CREATE INDEX IF NOT EXISTS ix_day_os       ON events_tab(day, os_id);
CREATE INDEX IF NOT EXISTS ix_day_devtype  ON events_tab(day, device_type_id);
CREATE INDEX IF NOT EXISTS ix_day_visitor  ON events_tab(day, visitor_id);
CREATE INDEX IF NOT EXISTS ix_visitor      ON events_tab(visitor_id);
SQL

echo ""
sqlite3 "$SQLITE_DB" "SELECT 'events: ' || COUNT(*) || '  days: ' || MIN(day) || '..' || MAX(day) FROM events_tab;"
cat <<EOF

Done. ${SQLITE_DB}

  sqlite3 ${SQLITE_DB}

Cross-filtered questions the hosted dashboard cannot answer, e.g. visitors per
country for one path -- exact, and free:

  SELECT c.value AS country, COUNT(DISTINCT e.visitor_id) AS uv
  FROM events_tab e
  JOIN dim_path_tab p    ON p.id = e.path_id
  JOIN dim_country_tab c ON c.id = e.country_id
  WHERE p.value = '/some/page/'
  GROUP BY c.value ORDER BY uv DESC;

For heavier work, DuckDB reads SQLite directly and gives you GROUPING SETS,
QUALIFY and approx_count_distinct, none of which SQLite has:

  duckdb -c "INSTALL sqlite; LOAD sqlite; ATTACH '${SQLITE_DB}' AS s (TYPE sqlite); \\
             SELECT day, COUNT(*) FROM s.events_tab GROUP BY day ORDER BY day;"

To point a local worker at this data instead of the tiny dev database:

  npx wrangler d1 execute ${DB} --local --file=${DUMP}
  npx wrangler dev
EOF
