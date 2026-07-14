#!/usr/bin/env bash
#
# Blabber production deploy script. Runs ON the production VM (/opt/blabber),
# invoked over SSH by .github/workflows/deploy-production.yml.
#
# This script is fetched with `git show <sha>:scripts/production-deploy.sh`
# BEFORE the working tree is reset, so the version that runs always matches
# the commit being deployed. Do not run it manually unless you understand
# that it performs `git reset --hard` and rebuilds/recreates app containers.
#
# Usage: production-deploy.sh <target-git-sha> [force-full-rebuild:true|false]
#
# Deliberately never runs `git clean` — untracked, VM-only files such as
# .env, docker-compose.gcp.yml, docker-compose.hardening.yml,
# livekit.production.yml, and any Caddyfile must survive `git reset --hard`
# unmodified. This script never edits or reads those compose files' content,
# only passes their paths to `docker compose -f`.

set -euo pipefail

REPO_DIR="/opt/blabber"
COMPOSE_FILES=(-f docker-compose.full.yml -f docker-compose.gcp.yml -f docker-compose.hardening.yml)
APP_SERVICES=(auth users chats messages media notifications gateway web)
# mongodb, redis, livekit, clamav are intentionally never in APP_SERVICES and
# must never be added to it — they are excluded from every build/recreate step.

TARGET_SHA="${1:?usage: production-deploy.sh <target-sha> [force-full-rebuild]}"
FORCE_FULL="${2:-false}"
HEALTH_TIMEOUT_SECONDS=120

log() { echo "[deploy] $(date -u +%FT%TZ) $*"; }
fail() { echo "[deploy][ERROR] $(date -u +%FT%TZ) $*" >&2; exit 1; }

on_error() {
  log "Deploy failed. Current container status:"
  docker compose "${COMPOSE_FILES[@]}" ps || true
}
trap on_error ERR

cd "$REPO_DIR"

# --- Preconditions ---------------------------------------------------------
command -v docker >/dev/null 2>&1 || fail "docker not found on PATH"
docker compose version >/dev/null 2>&1 || fail "docker compose plugin not available"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "$REPO_DIR is not a git repository"

PREV_SHA="$(git rev-parse HEAD)"
log "Current HEAD before deploy: $PREV_SHA"
log "Target SHA to deploy:       $TARGET_SHA"

# --- Back up MongoDB before touching anything ------------------------------
log "Backing up MongoDB before deploy..."
mkdir -p backups/mongo
MONGO_CID="$(docker compose "${COMPOSE_FILES[@]}" ps -q mongodb || true)"
[ -n "$MONGO_CID" ] || fail "mongodb container is not running; refusing to deploy without a healthy source to back up"

BACKUP_FILE="backups/mongo/pre-deploy-${TARGET_SHA}-$(date -u +%Y%m%dT%H%M%SZ).archive.gz"

# Same archive format (mongodump --archive --gzip) as scripts/mongo-backup.mjs
# (see docs/backup-restore.md), so it can be restored with `pnpm backup:restore`
# if needed. Uses MONGO_URI from the VM's own .env when present; falls back to
# an unauthenticated local connection inside the container otherwise. This
# script cannot know whether docker-compose.gcp.yml/hardening.yml enable Mongo
# auth, since those files aren't visible outside the VM — verify this matches
# your actual Mongo auth setup (see docs/production-cicd.md).
MONGO_BACKUP_URI=""
if [ -f .env ]; then
  MONGO_BACKUP_URI="$(grep -E '^(MONGO_URI|MONGODB_URI)=' .env | tail -n 1 | cut -d= -f2- || true)"
  MONGO_BACKUP_URI="${MONGO_BACKUP_URI%\"}"
  MONGO_BACKUP_URI="${MONGO_BACKUP_URI#\"}"
fi

if [ -n "$MONGO_BACKUP_URI" ]; then
  docker exec "$MONGO_CID" mongodump --quiet --archive --gzip --uri="$MONGO_BACKUP_URI" > "$BACKUP_FILE" \
    || fail "mongodump failed (via Mongo URI from .env) — aborting deploy, nothing has been changed"
else
  docker exec "$MONGO_CID" mongodump --quiet --archive --gzip > "$BACKUP_FILE" \
    || fail "mongodump failed — aborting deploy, nothing has been changed"
fi
[ -s "$BACKUP_FILE" ] || fail "backup archive is empty — aborting deploy, nothing has been changed"
log "Backup written: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# --- Fetch ------------------------------------------------------------------
log "Fetching origin..."
git fetch origin --quiet || fail "git fetch failed"
git cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null || fail "target sha $TARGET_SHA not found after fetch"

# --- Detect changed services (diff against what was running before this run)
declare -A AFFECTED=()
add_all_app_services() { for s in "${APP_SERVICES[@]}"; do AFFECTED["$s"]=1; done; }

CHANGED_FILES=""
if [ "$PREV_SHA" != "$TARGET_SHA" ] && git cat-file -e "${PREV_SHA}^{commit}" 2>/dev/null; then
  CHANGED_FILES="$(git diff --name-only "$PREV_SHA" "$TARGET_SHA" || true)"
fi

if [ "$FORCE_FULL" = "true" ]; then
  log "force_full_rebuild=true — deploying all app services"
  add_all_app_services
elif [ -z "$CHANGED_FILES" ]; then
  log "No usable previous-SHA diff (first deploy, shallow history, or no-op re-run) — deploying all app services as a safe fallback"
  add_all_app_services
else
  log "Changed files since ${PREV_SHA}:"
  echo "$CHANGED_FILES" | sed 's/^/[deploy]   /'
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
      apps/web/*) AFFECTED[web]=1 ;;
      apps/gateway/*) AFFECTED[gateway]=1 ;;
      services/auth/*) AFFECTED[auth]=1 ;;
      services/users/*) AFFECTED[users]=1 ;;
      services/chats/*) AFFECTED[chats]=1 ;;
      services/messages/*) AFFECTED[messages]=1 ;;
      services/media/*) AFFECTED[media]=1 ;;
      services/notifications/*) AFFECTED[notifications]=1 ;;
      packages/types/*|packages/config/*|packages/utils/*) add_all_app_services ;;
      pnpm-lock.yaml|package.json|pnpm-workspace.yaml) add_all_app_services ;;
      # Base compose file or this script changing affects the whole app stack.
      docker-compose.full.yml|scripts/production-deploy.sh) add_all_app_services ;;
      *) : ;; # docs, mobile app, other packages (eslint-config/tsconfig), etc. -> no service impact
    esac
  done <<< "$CHANGED_FILES"

  # Backend change -> always include gateway too (routes/proxy behavior may depend on it).
  for s in auth users chats messages media notifications; do
    if [ "${AFFECTED[$s]:-0}" = "1" ]; then AFFECTED[gateway]=1; fi
  done
fi

AFFECTED_LIST=()
if [ ${#AFFECTED[@]} -gt 0 ]; then
  AFFECTED_LIST=("${!AFFECTED[@]}")
fi

# --- Reset working tree to target SHA ---------------------------------------
log "Resetting working tree to ${TARGET_SHA}..."
git reset --hard "$TARGET_SHA" || fail "git reset failed"
# git reset --hard never deletes untracked files, so .env, docker-compose.gcp.yml,
# docker-compose.hardening.yml, livekit.production.yml, and any Caddyfile kept
# outside git are untouched. Never add `git clean` to this script.

# --- Validate merged compose config -----------------------------------------
log "Validating merged compose config (full + gcp + hardening)..."
docker compose "${COMPOSE_FILES[@]}" config -q \
  || fail "docker compose config validation failed — check docker-compose.gcp.yml / docker-compose.hardening.yml exist and are valid on this VM"

if [ ${#AFFECTED_LIST[@]} -eq 0 ]; then
  log "Deploy complete: repo updated to ${TARGET_SHA}. No app services required a rebuild (docs/mobile/unrelated files only)."
  exit 0
fi

log "Affected app services: ${AFFECTED_LIST[*]}"

# --- Build only affected services --------------------------------------------
log "Building affected services..."
docker compose "${COMPOSE_FILES[@]}" build "${AFFECTED_LIST[@]}" || fail "docker compose build failed"

# --- Recreate only affected services -----------------------------------------
log "Recreating affected services (mongodb/redis/livekit/clamav are never touched)..."
docker compose "${COMPOSE_FILES[@]}" up -d --no-deps "${AFFECTED_LIST[@]}" || fail "docker compose up failed"

# --- Health checks ------------------------------------------------------------
log "Waiting for affected services to report healthy (timeout ${HEALTH_TIMEOUT_SECONDS}s each)..."
for svc in "${AFFECTED_LIST[@]}"; do
  CID="$(docker compose "${COMPOSE_FILES[@]}" ps -q "$svc")"
  [ -n "$CID" ] || fail "no container found for service $svc after up -d"
  DEADLINE=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  while true; do
    STATUS="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$CID")"
    if [ "$STATUS" = "healthy" ] || [ "$STATUS" = "no-healthcheck" ]; then
      log "$svc: $STATUS"
      break
    fi
    if [ "$STATUS" = "unhealthy" ] || [ $SECONDS -ge $DEADLINE ]; then
      log "=== last 80 log lines for $svc ==="
      docker compose "${COMPOSE_FILES[@]}" logs --no-color --tail=80 "$svc" || true
      fail "$svc did not become healthy in time (status: $STATUS)"
    fi
    sleep 3
  done
done

# --- Informational error-log scan (does not fail the deploy) -----------------
log "Scanning recent logs for errors (informational only)..."
for svc in "${AFFECTED_LIST[@]}"; do
  ERR_COUNT="$(docker compose "${COMPOSE_FILES[@]}" logs --no-color --since=2m "$svc" 2>/dev/null | grep -c '"level":"error"' || true)"
  log "$svc: $ERR_COUNT error-level log lines in the last 2 minutes"
done

log "docker compose ps:"
docker compose "${COMPOSE_FILES[@]}" ps

log "Deploy of ${TARGET_SHA} complete. Affected services: ${AFFECTED_LIST[*]}"
