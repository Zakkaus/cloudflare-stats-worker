#!/usr/bin/env python3
"""
Cloudflare Stats Worker — deployment manager.

Usage:
  python scripts/manage.py init                    # First-time setup for a new site
  python scripts/manage.py deploy [name]           # Deploy an existing site
  python scripts/manage.py deploy --all            # Deploy all sites
  python scripts/manage.py deploy [name] --migrate # Apply pending DB migrations first
  python scripts/manage.py list                    # List configured sites
  python scripts/manage.py migrate [name]          # Apply pending drizzle migrations (remote)
  python scripts/manage.py migrate --local         # ... against the local D1
  python scripts/manage.py migrate --all           # ... on all sites
  python scripts/manage.py baseline [name|--all]   # Adopt an EXISTING database into migration tracking
  python scripts/manage.py run-sql <file> [name]   # Run an ad-hoc SQL file (one-offs, e.g. backfills)

The schema is defined in src/db/schema.ts; `pnpm db:generate` turns changes into
SQL under drizzle/, and `migrate` applies them per deployment via
`wrangler d1 migrations apply`.

Replaces: scripts/install.sh, scripts/deploy.sh
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT_DIR = Path(__file__).resolve().parent.parent
DEPLOYMENTS_DIR = ROOT_DIR / "deployments"
MIGRATIONS_DIR = ROOT_DIR / "drizzle"        # drizzle-kit output, applied by wrangler
SQL_DIR = ROOT_DIR / "scripts" / "sql"      # ad-hoc, hand-run SQL (not tracked)
ROOT_WRANGLER = ROOT_DIR / "wrangler.toml"
DASHBOARD_DIR = ROOT_DIR / "dashboard-v2"

# ---------------------------------------------------------------------------
# Color helpers (disabled when not a TTY)
# ---------------------------------------------------------------------------

USE_COLOR = sys.stdout.isatty() and sys.stderr.isatty()


def _c(code, text):
    return f"\033[{code}m{text}\033[0m" if USE_COLOR else text


def blue(t):   return _c("1;34", t)
def green(t):  return _c("1;32", t)
def yellow(t): return _c("1;33", t)
def red(t):    return _c("1;31", t)
def bold(t):   return _c("1",    t)


def info(msg):  print(blue("->"), msg)
def ok(msg):    print(green("OK"), msg)
def warn(msg):  print(yellow("!!"), msg)


# ---------------------------------------------------------------------------
# Error type
# ---------------------------------------------------------------------------

class ManageError(Exception):
    pass


# ---------------------------------------------------------------------------
# Subprocess helpers
# ---------------------------------------------------------------------------

def run_streaming(cmd, cwd=None):
    """Run cmd, streaming output to terminal in real time. Returns (rc, combined_output)."""
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=True,
        cwd=str(cwd or ROOT_DIR),
    )

    captured = []
    lock = threading.Lock()

    def _stream(src, dest):
        for line in src:
            with lock:
                captured.append(line)
            dest.write(line)
            dest.flush()

    t_out = threading.Thread(target=_stream, args=(proc.stdout, sys.stdout), daemon=True)
    t_err = threading.Thread(target=_stream, args=(proc.stderr, sys.stderr), daemon=True)
    t_out.start()
    t_err.start()
    t_out.join()
    t_err.join()
    proc.wait()

    return proc.returncode, "".join(captured)


def run_capture(cmd, cwd=None):
    """Run cmd silently. Returns (rc, combined_output)."""
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=True,
        cwd=str(cwd or ROOT_DIR),
    )
    return result.returncode, result.stdout + result.stderr


# ---------------------------------------------------------------------------
# Tool / auth helpers
# ---------------------------------------------------------------------------

def require_tool(name):
    """Check that a tool is on PATH. Prints its version. Raises ManageError if missing."""
    if not shutil.which(name):
        hints = {
            "wrangler": "Install with: pnpm add -g wrangler",
            "pnpm": "Install from: https://pnpm.io/installation",
        }
        raise ManageError(f"'{name}' not found on PATH. {hints.get(name, '')}")
    rc, out = run_capture([name, "--version"])
    version = out.strip().splitlines()[0] if out.strip() else "(unknown)"
    ok(f"{name}: {version}")


def check_auth():
    """Ensure wrangler is logged in to Cloudflare. Launches login if needed."""
    info("Checking Cloudflare authentication...")
    rc, out = run_capture(["wrangler", "whoami"])
    logged_in = rc == 0 and any(k in out for k in ("Account ID", "You are logged in", "account_id"))
    if logged_in:
        for line in out.splitlines():
            if any(k in line for k in ("Account", "User", "Email")):
                print("  ", line.strip())
        ok("Authenticated with Cloudflare")
        return
    warn("Not logged in. Launching wrangler login...")
    result = subprocess.run(["wrangler", "login"], cwd=str(ROOT_DIR))
    if result.returncode != 0:
        raise ManageError("wrangler login failed")
    ok("Login successful")


# ---------------------------------------------------------------------------
# TOML helpers (stdlib only — no tomllib needed)
# ---------------------------------------------------------------------------

def read_compat_date():
    """Read compatibility_date from root wrangler.toml."""
    if not ROOT_WRANGLER.exists():
        raise ManageError(f"Root wrangler.toml not found at {ROOT_WRANGLER}")
    content = ROOT_WRANGLER.read_text(encoding="utf-8")
    m = re.search(r'^compatibility_date\s*=\s*"([^"]+)"', content, re.MULTILINE)
    if not m:
        raise ManageError("Could not read compatibility_date from wrangler.toml")
    return m.group(1)


def read_toml_value(text, key):
    """Extract a quoted string value for a key from TOML text. Returns None if not found."""
    m = re.search(r'^' + re.escape(key) + r'\s*=\s*"([^"]*)"', text, re.MULTILINE)
    return m.group(1) if m else None


def _toml_str(value, field_name):
    """Validate a string is safe to embed in a double-quoted TOML value."""
    if '"' in value or "\\" in value:
        raise ManageError(
            f"{field_name} contains characters not supported in TOML strings: {value!r}"
        )
    return value


DEPLOYMENT_TOML_TEMPLATE = """\
# Managed by scripts/manage.py — do not edit manually
name = "{name}"
main = "../src/index.ts"
compatibility_date = "{compat_date}"
compatibility_flags = ["nodejs_compat"]

# Caches responses in front of the Worker. Required for the Cache-Control
# headers the read endpoints emit to have any effect: the `caches.default` API
# is a no-op on *.workers.dev. See wrangler.toml for the full note.
[cache]
enabled = true
cross_version_cache = false

[observability]
enabled = false
head_sampling_rate = 1

[observability.logs]
enabled = true
head_sampling_rate = 1
invocation_logs = true
persist = true

[observability.traces]
enabled = true
head_sampling_rate = 1
persist = true

[vars]
ALLOWED_ORIGIN        = "{allowed_origin}"
RATE_LIMIT_PER_MINUTE = "{rate_limit}"
TIMEZONE              = "{timezone}"

[[ratelimits]]
name = "RATE_LIMITER"
namespace_id = "1001"
simple = {{ limit = {rate_limit_int}, period = 60 }}

[assets]
directory = "../dashboard-v2/dist"
binding   = "ASSETS"

[triggers]
crons = ["30 15 * * *"]

[[d1_databases]]
binding = "DB"
database_name = "{db_name}"
database_id = "{d1_id}"
migrations_dir = "../drizzle"

# Live dashboard relay (see wrangler.toml at repo root for the full note).
# SQLite storage backend keeps it on the Workers Free plan.
[[durable_objects.bindings]]
name = "REALTIME"
class_name = "RealtimeHub"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RealtimeHub"]

# Parquet archive: one file per closed day, read by the Month-over-Month view
# (see wrangler.toml at repo root). ArchiveWriter is a Durable Object only for
# its own 30s CPU allowance; the Worker itself gets 10ms on the Free plan.
[[r2_buckets]]
binding = "ARCHIVE"
bucket_name = "{bucket_name}"

[[durable_objects.bindings]]
name = "ARCHIVER"
class_name = "ArchiveWriter"

[[migrations]]
tag = "v2"
new_sqlite_classes = ["ArchiveWriter"]
"""


def render_deployment_toml(cfg):
    return DEPLOYMENT_TOML_TEMPLATE.format(
        name=cfg["name"],
        compat_date=cfg["compat_date"],
        allowed_origin=cfg["allowed_origin"],
        rate_limit=cfg["rate_limit"],
        rate_limit_int=int(cfg["rate_limit"]),
        timezone=cfg["timezone"],
        db_name=cfg["db_name"],
        d1_id=cfg["d1_id"],
        bucket_name=cfg["bucket_name"],
    )


def write_deployment_toml(worker_name, cfg):
    DEPLOYMENTS_DIR.mkdir(exist_ok=True)
    path = DEPLOYMENTS_DIR / f"{worker_name}.toml"
    path.write_text(render_deployment_toml(cfg), encoding="utf-8")
    ok(f"Wrote {path.relative_to(ROOT_DIR)}")
    return path


def list_deployment_files():
    if not DEPLOYMENTS_DIR.exists():
        return []
    return sorted(DEPLOYMENTS_DIR.glob("*.toml"))


# ---------------------------------------------------------------------------
# R2 helpers
# ---------------------------------------------------------------------------


def r2_create_or_fetch(bucket_name):
    """Create the R2 bucket for the Parquet archive. Reuses it if it already exists."""
    info(f"Creating R2 bucket '{bucket_name}'...")
    rc, output = run_capture(["wrangler", "r2", "bucket", "create", bucket_name])
    if rc == 0:
        ok(f"R2 bucket created: {bucket_name}")
    elif "already exists" in output.lower() or "already own" in output.lower():
        warn(f"Bucket '{bucket_name}' already exists — reusing it.")
    else:
        print(output)
        raise ManageError(
            f"wrangler r2 bucket create failed (exit {rc}). R2 must be enabled on the "
            "account once (dashboard > R2) before buckets can be created."
        )
    return bucket_name


# ---------------------------------------------------------------------------
# D1 helpers
# ---------------------------------------------------------------------------

_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    re.IGNORECASE,
)
_D1_ID_RE = re.compile(
    r'database_id\s*=\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"',
    re.IGNORECASE,
)


def _extract_d1_id(output):
    """Parse a D1 UUID from wrangler d1 create output."""
    m = _D1_ID_RE.search(output)
    if m:
        return m.group(1)
    # Try JSON parse
    try:
        data = json.loads(output)
        if isinstance(data, dict):
            return data.get("uuid") or data.get("id") or data.get("database_id")
    except (json.JSONDecodeError, ValueError):
        pass
    # Last resort: any UUID-shaped token
    uuids = _UUID_RE.findall(output)
    return uuids[0] if uuids else None


def _find_id_in_list(json_output, db_name):
    """Parse `wrangler d1 list --json` to find a database's UUID by name."""
    # Strip prefix log lines before the JSON array
    start = json_output.find("[")
    if start == -1:
        start = json_output.find("{")
    if start == -1:
        return None
    try:
        data = json.loads(json_output[start:])
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(data, list):
        data = [data]
    for entry in data:
        if entry.get("name") == db_name:
            return entry.get("uuid") or entry.get("id") or entry.get("database_id")
    return None


def d1_create_or_fetch(db_name):
    """Create a D1 database and return its UUID. Reuses existing if it already exists."""
    info(f"Creating D1 database '{db_name}'...")
    rc, output = run_capture(["wrangler", "d1", "create", db_name])
    already_exists = "already exists" in output.lower()

    if rc == 0 and not already_exists:
        d1_id = _extract_d1_id(output)
        if d1_id:
            ok(f"D1 database created: {d1_id}")
            return d1_id
        # Created OK but couldn't parse ID — fall through to list lookup

    if not already_exists and rc != 0:
        # Unexpected failure
        print(output)
        raise ManageError(f"wrangler d1 create failed (exit {rc})")

    warn(f"Database '{db_name}' already exists — fetching ID from d1 list...")
    rc2, list_out = run_capture(["wrangler", "d1", "list", "--json"])
    if rc2 == 0:
        d1_id = _find_id_in_list(list_out, db_name)
        if d1_id:
            ok(f"Found existing D1 ID: {d1_id}")
            return d1_id

    # Manual fallback
    d1_id = input(f"  Could not auto-detect D1 ID for '{db_name}'. Enter it manually: ").strip()
    if not d1_id:
        raise ManageError("D1 database ID is required")
    return d1_id


def apply_migrations(db_name, config_path, remote=True):
    """Apply pending drizzle migrations (drizzle/*.sql) to a D1 database.

    Goes through `wrangler d1 migrations apply`, which tracks what has run in the
    database's own d1_migrations table. --config makes wrangler resolve the D1
    binding (and its migrations_dir) from the deployment's own config."""
    target = "remote" if remote else "local"
    ensure_baselined(db_name, config_path, remote)
    info(f"Applying pending migrations to D1 '{db_name}' ({target})...")
    rc, _ = run_streaming([
        "wrangler", "d1", "migrations", "apply", db_name,
        "--config", str(config_path),
        "--remote" if remote else "--local",
    ])
    if rc != 0:
        raise ManageError(f"Failed to apply migrations to '{db_name}'")
    ok("Migrations up to date")


def resolve_sql_path(name):
    """Resolve an ad-hoc SQL file. Accepts a path (relative/absolute) or a bare
    name resolved under scripts/sql/ (with or without a .sql suffix)."""
    direct = Path(name)
    if direct.is_file():
        return direct.resolve()
    for candidate in (SQL_DIR / name, SQL_DIR / f"{name}.sql"):
        if candidate.is_file():
            return candidate
    raise ManageError(
        f"SQL file not found: {name}\n"
        f"  Looked in: {name}, {SQL_DIR / name}, {SQL_DIR / (name + '.sql')}"
    )


def run_sql_file(db_name, sql_path, config_path, remote=True):
    """Run a SQL file against a D1 database (remote by default, or local).

    Passes --config so wrangler resolves the D1 binding from the deployment's
    own config — required for --local (which maps the name to local SQLite state
    via the binding) and harmless for --remote."""
    target = "remote" if remote else "local"
    info(f"Running {sql_path.name} on D1 '{db_name}' ({target})...")
    rc, _ = run_streaming([
        "wrangler", "d1", "execute", db_name,
        "--config", str(config_path),
        "--remote" if remote else "--local",
        f"--file={sql_path}",
    ])
    if rc != 0:
        raise ManageError(f"Failed to run {sql_path.name} on '{db_name}'")
    ok("SQL applied")


def d1_query(db_name, config_path, sql, remote=True):
    """Run one read-only statement and return its result rows (list of dicts)."""
    rc, out = run_capture([
        "wrangler", "d1", "execute", db_name,
        "--config", str(config_path),
        "--remote" if remote else "--local",
        "--json", "--command", sql,
    ])
    # wrangler prints progress lines around the JSON (and some contain "[").
    m = re.search(r"^\[\s*\{", out, re.MULTILINE)
    if rc != 0 or not m:
        raise ManageError(f"Query failed on '{db_name}': {sql}\n{out.strip()}")
    try:
        data = json.loads(out[m.start():])
        return data[0]["results"]
    except (json.JSONDecodeError, KeyError, IndexError) as e:
        raise ManageError(f"Could not parse wrangler output for '{db_name}': {e}\n{out.strip()}")


def migration_files():
    """drizzle/NNNN_*.sql, in apply order."""
    return sorted(p for p in MIGRATIONS_DIR.glob("*.sql") if re.match(r"^\d{4}_", p.name))


def ensure_baselined(db_name, config_path, remote=True):
    """Refuse to migrate a database that has tables but no recorded baseline.

    The baseline migration is plain CREATE TABLEs (the old schema.sql used IF NOT
    EXISTS, so re-running it was harmless; this is not). On a database that
    predates migrations, wrangler would try to run it and fail with a raw
    'already exists' error, so say what to do instead. A fresh database (no
    events_tab) passes."""
    files = migration_files()
    if not files:
        return
    rows = d1_query(
        db_name, config_path,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('events_tab', 'd1_migrations')",
        remote,
    )
    have = {r["name"] for r in rows}
    if "events_tab" not in have:
        return
    if "d1_migrations" in have:
        recorded = {r["name"] for r in d1_query(db_name, config_path, "SELECT name FROM d1_migrations", remote)}
        if files[0].name in recorded:
            return
    flag = "" if remote else " --local"
    raise ManageError(
        f"'{db_name}' already has tables but {files[0].name} is not recorded as applied.\n"
        f"  Adopt it first: python scripts/manage.py baseline <name>{flag}"
    )


def upgrade_legacy_config(config_path):
    """Bring a deployments/<name>.toml written before the TypeScript move up to date.

    Those configs say `main = "../src/index.js"` (the file no longer exists) and
    have no `migrations_dir`, so deploy fails and `migrations apply` finds
    nothing. The files are script-managed, so fixing the two lines in place is
    safe and idempotent."""
    text = config_path.read_text(encoding="utf-8")
    new = text.replace('main = "../src/index.js"', 'main = "../src/index.ts"')
    if "migrations_dir" not in new:
        new = re.sub(
            r'^(database_id\s*=\s*"[^"]*"[ \t]*\n)',
            r'\1migrations_dir = "../drizzle"\n',
            new, count=1, flags=re.MULTILINE,
        )
    if new != text:
        config_path.write_text(new, encoding="utf-8")
        ok(f"Updated {config_path.name} for the TypeScript worker (main, migrations_dir)")


def expected_schema_objects(baseline_path):
    """Tables and indexes the baseline migration creates: (tables, indexes)."""
    sql = baseline_path.read_text(encoding="utf-8")
    tables = set(re.findall(r"CREATE TABLE `?(\w+)`?", sql))
    indexes = set(re.findall(r"CREATE (?:UNIQUE )?INDEX `?(\w+)`?", sql))
    return tables, indexes


# The old schema declared dimension uniqueness inline (`value TEXT UNIQUE`), which
# SQLite backs with an auto-index. drizzle emits the same constraint as an explicit
# named index. Same behaviour, so its absence is not drift.
_EQUIVALENT_TO_INLINE_UNIQUE = re.compile(r"^dim_\w+_tab_value_unique$")


# ---------------------------------------------------------------------------
# Dashboard build
# ---------------------------------------------------------------------------

def build_dashboard():
    info("Installing dashboard dependencies...")
    rc, _ = run_streaming(["pnpm", "--dir", "dashboard-v2", "install"])
    if rc != 0:
        raise ManageError("pnpm install failed for dashboard-v2")
    info("Building dashboard...")
    rc, _ = run_streaming(["pnpm", "--dir", "dashboard-v2", "build"])
    if rc != 0:
        raise ManageError("pnpm build failed for dashboard-v2")
    ok("Dashboard built -> dashboard-v2/dist")


# ---------------------------------------------------------------------------
# Input helpers
# ---------------------------------------------------------------------------

def _prompt(label, default=None, required=True):
    """Prompt user for input. Returns the entered value or default."""
    suffix = f" [{default}]" if default else ""
    while True:
        value = input(f"  {label}{suffix}: ").strip()
        if not value and default is not None:
            return default
        if value:
            return value
        if not required:
            return ""
        print(f"  {yellow('!!')} This field is required.")


def _prompt_yn(label, default=False):
    suffix = "[y/N]" if not default else "[Y/n]"
    value = input(f"  {label} {suffix}: ").strip().lower()
    if not value:
        return default
    return value.startswith("y")


# ---------------------------------------------------------------------------
# Command: init
# ---------------------------------------------------------------------------

def cmd_init(args):
    print()
    print(bold("Cloudflare Stats Worker — New Deployment Setup"))
    print()

    require_tool("wrangler")
    require_tool("pnpm")
    check_auth()

    print()
    info("Collecting deployment configuration...")
    print()

    worker_name = _prompt("Worker name (lowercase letters, numbers, hyphens)", "cloudflare-stats-worker")
    if not re.match(r"^[a-z0-9-]+$", worker_name):
        raise ManageError(
            f"Worker name '{worker_name}' is invalid. "
            "Use only lowercase letters, numbers, and hyphens."
        )

    allowed_origin = _prompt("Allowed website origin (e.g. https://blog.example.com)")
    allowed_origin = allowed_origin.rstrip("/")
    if not allowed_origin.startswith("https://") and not allowed_origin.startswith("http://"):
        allowed_origin = "https://" + allowed_origin
        warn(f"No scheme provided — using: {allowed_origin}")

    rate_limit_str = _prompt("Rate limit per IP per minute", "120")
    try:
        rate_limit_int = int(rate_limit_str)
        if rate_limit_int <= 0:
            raise ValueError
    except ValueError:
        raise ManageError(f"Rate limit must be a positive integer, got: {rate_limit_str!r}")

    timezone = _prompt("Timezone", "Asia/Tokyo")

    default_db = f"{worker_name}-db"
    db_name = _prompt("D1 database name", default_db)
    bucket_name = _prompt("R2 bucket for the Parquet archive", f"{worker_name}-archive")

    # Validate all string values are TOML-safe
    for val, fname in [
        (worker_name, "Worker name"),
        (allowed_origin, "Allowed origin"),
        (timezone, "Timezone"),
        (db_name, "D1 database name"),
        (bucket_name, "R2 bucket name"),
    ]:
        _toml_str(val, fname)

    print()

    # Check for existing config
    config_path = DEPLOYMENTS_DIR / f"{worker_name}.toml"
    if config_path.exists():
        warn(f"deployments/{worker_name}.toml already exists.")
        if not _prompt_yn("Overwrite?", default=False):
            raise ManageError("Aborted.")

    compat_date = read_compat_date()
    info(f"Using compatibility_date: {compat_date}")

    # D1 + R2 setup
    d1_id = d1_create_or_fetch(db_name)
    r2_create_or_fetch(bucket_name)

    # Write config first: `wrangler d1 migrations apply` resolves the database
    # and its migrations_dir from it.
    cfg = {
        "name": worker_name,
        "compat_date": compat_date,
        "allowed_origin": allowed_origin,
        "rate_limit": str(rate_limit_int),
        "timezone": timezone,
        "db_name": db_name,
        "d1_id": d1_id,
        "bucket_name": bucket_name,
    }
    write_deployment_toml(worker_name, cfg)
    apply_migrations(db_name, config_path)

    # Build dashboard
    build_dashboard()

    # Deploy
    info(f"Deploying {worker_name}...")
    rc, _ = run_streaming(["wrangler", "deploy", "--config", str(config_path)])
    if rc != 0:
        raise ManageError("wrangler deploy failed")

    # Success summary
    print()
    print(green("Done."))
    print(f"  Worker    : {worker_name}")
    print(f"  Origin    : {allowed_origin}")
    print(f"  Config    : deployments/{worker_name}.toml")
    print()
    print("  Next: add the beacon to your site (check deploy output above for the URL):")
    print(f'    <script defer src="https://<your-worker-domain>/report.js"></script>')
    print()


# ---------------------------------------------------------------------------
# Command: deploy
# ---------------------------------------------------------------------------

def _resolve_single_config(name):
    """Resolve one deployment config path. Prompts interactively when name is None."""
    configs = list_deployment_files()
    if name is not None:
        config_path = DEPLOYMENTS_DIR / f"{name}.toml"
        if not config_path.exists():
            raise ManageError(
                f"deployments/{name}.toml not found\n"
                "  Run: python scripts/manage.py list"
            )
        return config_path

    if not configs:
        raise ManageError(
            "No deployments found in deployments/\n"
            "  Run: python scripts/manage.py init"
        )
    print()
    print(bold("Available deployments:"))
    for i, p in enumerate(configs, 1):
        content = p.read_text(encoding="utf-8")
        origin = read_toml_value(content, "ALLOWED_ORIGIN") or ""
        print(f"  {i}. {p.stem:<35} {origin}")
    print()
    choice = input("  Enter number or name [1]: ").strip() or "1"
    if choice.isdigit():
        idx = int(choice) - 1
        if not (0 <= idx < len(configs)):
            raise ManageError(f"Invalid choice: {choice}")
        return configs[idx]
    config_path = DEPLOYMENTS_DIR / f"{choice}.toml"
    if not config_path.exists():
        raise ManageError(f"No deployment found for '{choice}'")
    return config_path


def _deploy_one(config_path, migrate_first):
    """Deploy a single site from its config file. Returns True on success."""
    upgrade_legacy_config(config_path)
    content = config_path.read_text(encoding="utf-8")
    db_name = read_toml_value(content, "database_name")

    if migrate_first and db_name:
        try:
            apply_migrations(db_name, config_path)
        except ManageError as e:
            # Do not ship code that expects a schema the database does not have.
            warn(f"Migration failed, not deploying {config_path.stem}: {e}")
            return False

    info(f"Deploying {config_path.stem}...")
    rc, _ = run_streaming(["wrangler", "deploy", "--config", str(config_path)])
    return rc == 0


def cmd_deploy(args):
    configs = list_deployment_files()

    if args.all:
        if not configs:
            raise ManageError(
                "No deployments found in deployments/\n"
                "  Run: python scripts/manage.py init"
            )
        build_dashboard()
        results = []
        for cfg_path in configs:
            success = _deploy_one(cfg_path, args.migrate)
            results.append((cfg_path.stem, success))
        # Summary table
        print()
        print(bold("Deploy results:"))
        for name, success in results:
            status = green("OK") if success else red("FAILED")
            print(f"  {status}  {name}")
        if any(not s for _, s in results):
            sys.exit(1)
        return

    # Single deployment
    config_path = _resolve_single_config(args.name)

    build_dashboard()
    success = _deploy_one(config_path, args.migrate)
    if not success:
        raise ManageError("Deployment failed")

    print()
    print(green("Done."))
    print()


# ---------------------------------------------------------------------------
# Commands: migrate / run-sql / baseline
# ---------------------------------------------------------------------------

def _resolve_targets(args):
    """The deployment configs a command applies to: --all, or one by name."""
    if args.all:
        targets = list_deployment_files()
        if not targets:
            raise ManageError(
                "No deployments found in deployments/\n"
                "  Run: python scripts/manage.py init"
            )
    else:
        targets = [_resolve_single_config(args.name)]
    for p in targets:
        upgrade_legacy_config(p)
    return targets


def _db_name_of(config_path):
    return read_toml_value(config_path.read_text(encoding="utf-8"), "database_name")


def _confirm_remote(args, remote, targets, what):
    """List the targets and, for remote runs, ask before touching production."""
    where = "REMOTE" if remote else "LOCAL"
    print()
    (warn if remote else info)(f"About to {what} against {where} D1 for:")
    for p in targets:
        print(f"    {p.stem:<35} -> {_db_name_of(p) or '(unknown)'}")
    print()
    # Only the remote path touches production data, so only it needs confirming.
    if remote and not args.yes and not _prompt_yn("This modifies production data. Continue?", default=False):
        raise ManageError("Aborted.")


def _print_results(title, results):
    print()
    print(bold(title))
    for name, success in results:
        status = green("OK") if success else red("FAILED")
        print(f"  {status}  {name}")
    if any(not s for _, s in results):
        sys.exit(1)


def cmd_migrate(args):
    """Apply pending drizzle migrations (drizzle/*.sql) to each target."""
    remote = not args.local
    targets = _resolve_targets(args)
    pending = ", ".join(f.name for f in migration_files()) or "(none found)"
    _confirm_remote(args, remote, targets, f"apply migrations [{pending}] (only those not yet recorded)")

    results = []
    for p in targets:
        db_name = _db_name_of(p)
        if not db_name:
            warn(f"{p.stem}: no database_name in config — skipping")
            results.append((p.stem, False))
            continue
        try:
            apply_migrations(db_name, p, remote=remote)
            results.append((p.stem, True))
        except ManageError as e:
            warn(str(e))
            results.append((p.stem, False))
    _print_results("Migration results:", results)


def cmd_run_sql(args):
    """Run an ad-hoc SQL file (a one-off backfill, say). Not tracked anywhere."""
    sql_path = resolve_sql_path(args.file)
    remote = not args.local
    targets = _resolve_targets(args)
    _confirm_remote(args, remote, targets, f"run {bold(sql_path.name)}")

    results = []
    for p in targets:
        db_name = _db_name_of(p)
        if not db_name:
            warn(f"{p.stem}: no database_name in config — skipping")
            results.append((p.stem, False))
            continue
        try:
            run_sql_file(db_name, sql_path, p, remote=remote)
            results.append((p.stem, True))
        except ManageError as e:
            warn(str(e))
            results.append((p.stem, False))
    _print_results("Results:", results)


# Wrangler's own bookkeeping table. Created here with exactly the DDL wrangler
# uses, so a later `d1 migrations apply` carries on from it.
_D1_MIGRATIONS_DDL = (
    "CREATE TABLE IF NOT EXISTS d1_migrations("
    "id INTEGER PRIMARY KEY AUTOINCREMENT, "
    "name TEXT UNIQUE, "
    "applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)"
)


def _baseline_one(config_path, remote, dry_run):
    """Adopt one EXISTING database into migration tracking.

    The baseline migration (drizzle/0000_*.sql) describes the schema these
    databases already have, so it must be RECORDED as applied, never run: running
    it would at best do nothing and at worst create objects the deployment
    deliberately lacks (idx_events_day_ref was a ~one-written-row-per-event
    opt-in; migration 0001 drops it everywhere anyway).

    Returns True when the database is now (or already was) tracked."""
    db_name = _db_name_of(config_path)
    if not db_name:
        warn(f"{config_path.stem}: no database_name in config — skipping")
        return False

    files = migration_files()
    if not files:
        raise ManageError(f"No migrations found in {MIGRATIONS_DIR}")
    baseline = files[0]
    info(f"{config_path.stem}: checking '{db_name}' against {baseline.name}...")

    objects = d1_query(
        db_name, config_path,
        "SELECT type, name FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'",
        remote,
    )
    have_tables = {o["name"] for o in objects if o["type"] == "table"}
    have_indexes = {o["name"] for o in objects if o["type"] == "index"}
    want_tables, want_indexes = expected_schema_objects(baseline)

    missing_tables = sorted(want_tables - have_tables)
    if missing_tables:
        # Nothing to adopt: a database that lacks tables should simply be migrated.
        warn(f"  missing tables: {', '.join(missing_tables)}")
        warn("  this database is not at the baseline schema — use `migrate`, not `baseline`.")
        return False

    for idx in sorted(want_indexes - have_indexes):
        if _EQUIVALENT_TO_INLINE_UNIQUE.match(idx):
            continue
        if idx == "idx_events_day_ref":
            warn(f"  index {idx} is absent (it was an opt-in, and 0001 drops it anyway)")
        else:
            warn(f"  index {idx} is absent and will NOT be created by baselining")

    columns = {c["name"] for c in d1_query(db_name, config_path, "PRAGMA table_info(events_tab)", remote)}
    if "ref_path_id" in columns:
        warn("  events_tab still has the retired ref_path_id column "
             "(run scripts/sql/drop-referrer-path.sql if you want it gone)")

    if "d1_migrations" in have_tables:
        recorded = {r["name"] for r in d1_query(db_name, config_path, "SELECT name FROM d1_migrations", remote)}
        if baseline.name in recorded:
            ok(f"  already tracked ({baseline.name} recorded)")
            return True

    if dry_run:
        info(f"  dry run: would record {baseline.name} as applied")
        return True

    target = "remote" if remote else "local"
    rc, _ = run_capture([
        "wrangler", "d1", "execute", db_name,
        "--config", str(config_path),
        "--remote" if remote else "--local",
        "--command",
        f"{_D1_MIGRATIONS_DDL}; INSERT OR IGNORE INTO d1_migrations (name) VALUES ('{baseline.name}')",
    ])
    if rc != 0:
        raise ManageError(f"Failed to record {baseline.name} on '{db_name}' ({target})")
    ok(f"  recorded {baseline.name} as applied")
    return True


def cmd_baseline(args):
    remote = not args.local
    targets = _resolve_targets(args)
    if not args.dry_run:
        _confirm_remote(args, remote, targets, "record the baseline migration as already applied")

    results = []
    for p in targets:
        try:
            results.append((p.stem, _baseline_one(p, remote, args.dry_run)))
        except ManageError as e:
            warn(str(e))
            results.append((p.stem, False))
    _print_results("Baseline results:", results)
    print()
    info("Next: `python scripts/manage.py migrate` should now report nothing to apply.")


# ---------------------------------------------------------------------------
# Command: list
# ---------------------------------------------------------------------------

def cmd_list(args):
    configs = list_deployment_files()
    if not configs:
        print("No deployments found in deployments/")
        print("Run:  python scripts/manage.py init")
        return

    rows = []
    for p in configs:
        content = p.read_text(encoding="utf-8")
        rows.append({
            "name":   read_toml_value(content, "name") or p.stem,
            "origin": read_toml_value(content, "ALLOWED_ORIGIN") or "",
            "db":     read_toml_value(content, "database_name") or "",
        })

    keys = ("name", "origin", "db")
    headers = {"name": "NAME", "origin": "ALLOWED_ORIGIN", "db": "D1 DATABASE"}
    col_w = {k: max(len(headers[k]), max(len(r[k]) for r in rows)) for k in keys}

    header = "  ".join(f"{headers[k]:<{col_w[k]}}" for k in keys)
    sep = "  ".join("─" * col_w[k] for k in keys)
    print(bold(header))
    print(sep)
    for r in rows:
        print("  ".join(f"{r[k]:<{col_w[k]}}" for k in keys))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        prog="manage.py",
        description="Cloudflare Stats Worker — deployment manager",
    )
    sub = parser.add_subparsers(dest="command", metavar="command")
    sub.required = True

    # init
    sub.add_parser("init", help="First-time setup for a new site")

    # deploy
    p_deploy = sub.add_parser("deploy", help="Deploy an existing site")
    p_deploy.add_argument(
        "name", nargs="?", default=None,
        help="Deployment name (stem of deployments/<name>.toml). Omit to pick interactively.",
    )
    p_deploy.add_argument(
        "--all", action="store_true",
        help="Deploy all sites in deployments/",
    )
    p_deploy.add_argument(
        "--migrate", "--schema", dest="migrate", action="store_true",
        help="Apply pending database migrations before deploying (--schema is the old spelling)",
    )

    def add_target_args(p, local_help):
        p.add_argument(
            "name", nargs="?", default=None,
            help="Deployment name (stem of deployments/<name>.toml). Omit to pick interactively.",
        )
        p.add_argument("--all", action="store_true", help="Apply to all sites in deployments/")
        p.add_argument("--local", action="store_true", help=local_help)
        p.add_argument("-y", "--yes", action="store_true", help="Skip the confirmation prompt (remote only)")

    # migrate
    p_migrate = sub.add_parser("migrate", help="Apply pending drizzle migrations (drizzle/*.sql) to a deployment")
    add_target_args(p_migrate, "Run against the local D1 instead of remote (no confirmation needed)")

    # baseline
    p_baseline = sub.add_parser(
        "baseline",
        help="Adopt an existing database into migration tracking (records 0000 as applied, does not run it)",
    )
    add_target_args(p_baseline, "Run against the local D1 instead of remote")
    p_baseline.add_argument("--dry-run", action="store_true", help="Only report drift; change nothing")

    # run-sql
    p_sql = sub.add_parser("run-sql", help="Run an ad-hoc SQL file (e.g. scripts/sql/backfill-rollups.sql)")
    p_sql.add_argument("file", help="SQL file: a path, or a name resolved under scripts/sql/")
    add_target_args(p_sql, "Run against the local D1 instead of remote (no confirmation needed)")

    # list
    sub.add_parser("list", help="List configured sites")

    args = parser.parse_args()

    try:
        if args.command == "init":
            cmd_init(args)
        elif args.command == "deploy":
            cmd_deploy(args)
        elif args.command == "migrate":
            cmd_migrate(args)
        elif args.command == "baseline":
            cmd_baseline(args)
        elif args.command == "run-sql":
            cmd_run_sql(args)
        elif args.command == "list":
            cmd_list(args)
    except ManageError as e:
        print(f"\n{red('Error:')} {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nAborted.", file=sys.stderr)
        sys.exit(130)
    except Exception as e:
        print(f"\n{red('Unexpected error:')} {e}", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
