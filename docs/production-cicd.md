# Production CI/CD

Automates deploying the already-provisioned production stack (single GCP
Compute Engine VM at `/opt/blabber`, serving `app.blabber.dev`,
`api.blabber.dev`, `livekit.blabber.dev`) without SSHing in by hand.

This does **not** provision or modify any infrastructure. It assumes the VM
already has Docker, Docker Compose, Caddy, `.env`, `livekit.production.yml`,
`docker-compose.gcp.yml`, and `docker-compose.hardening.yml` in place, and it
never edits any of those files. It also never stores application secrets
(OAuth, SMTP, OpenRouter, VAPID, JWT, etc.) in GitHub — those stay in the VM's
`.env` only.

## How it works

- `.github/workflows/deploy-production.yml` — thin GitHub Actions job. Writes
  an SSH key and known_hosts from repo secrets, then runs a single SSH command,
  then verifies the three public endpoints from the runner.
- `scripts/production-deploy.sh` — the actual deploy logic, versioned in this
  repo and run **on the VM**. The workflow extracts this exact file at the
  target commit (`git show <sha>:scripts/production-deploy.sh`) before
  touching the working tree, so the script that runs always matches the
  commit being deployed, even mid-migration of the script itself.

Every production compose command uses all three files together:

```bash
docker compose \
  -f docker-compose.full.yml \
  -f docker-compose.gcp.yml \
  -f docker-compose.hardening.yml \
  ...
```

`docker-compose.full.yml` alone is never used for production — that file is
this repo's local validation stack.

### What a deploy run does, in order

1. Confirms `docker` and `docker compose` are available.
2. Backs up MongoDB (`mongodump --archive --gzip` from inside the `mongodb`
   container) to `backups/mongo/pre-deploy-<sha>-<timestamp>.archive.gz`
   **before touching anything else**. If the backup fails or is empty, the
   deploy aborts and nothing else happens.
3. `git fetch origin`.
4. Diffs the previous deployed commit against the target commit to work out
   which app services actually changed (see mapping below). Falls back to
   deploying every app service if there's no usable previous commit to diff
   against, or if you asked for `force_full_rebuild`.
5. `git reset --hard <target-sha>`. This **never** runs `git clean`, so
   untracked VM-only files (`.env`, `docker-compose.gcp.yml`,
   `docker-compose.hardening.yml`, `livekit.production.yml`, any Caddyfile)
   are left exactly as they were.
6. Validates the merged compose config (`docker compose ... config -q`).
7. Builds only the affected services.
8. Recreates only the affected services (`up -d --no-deps <services>`).
   `mongodb`, `redis`, `livekit`, and `clamav` are never rebuilt or recreated
   by this workflow.
9. Polls each affected service's container health status (every service
   already has a Docker `HEALTHCHECK` baked into its Dockerfile) until healthy
   or a timeout, dumping the last 80 log lines and exiting non-zero on
   failure/timeout.
10. Scans each affected service's last 2 minutes of logs for
    `"level":"error"` lines and prints a count (informational, does not fail
    the deploy).
11. Prints `docker compose ps`.

Back in the GitHub Actions job, after the SSH step succeeds:

- `curl https://api.blabber.dev/healthz`
- Confirms `https://app.blabber.dev` returns HTTP 200
- Confirms `https://livekit.blabber.dev` completes a TLS handshake with a
  valid certificate (LiveKit is a WebSocket/RTC endpoint, so a plain HTTP GET
  isn't expected to return 200 — only the TLS handshake is checked)

### Changed-file → service mapping

| Path | Affected service(s) |
| --- | --- |
| `apps/web/**` | `web` |
| `apps/gateway/**` | `gateway` |
| `services/auth/**` | `auth` |
| `services/users/**` | `users` |
| `services/chats/**` | `chats` |
| `services/messages/**` | `messages` |
| `services/media/**` | `media` |
| `services/notifications/**` | `notifications` |
| `packages/types/**`, `packages/config/**`, `packages/utils/**` | all app services |
| `pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml` | all app services |
| `docker-compose.full.yml`, `scripts/production-deploy.sh` | all app services |
| anything else (docs, mobile app, other packages) | none |

Whenever any backend service (`auth`/`users`/`chats`/`messages`/`media`/`notifications`)
is affected, `gateway` is always added too, since gateway routing/proxy
behavior can depend on those services. `mongodb`, `redis`, `livekit`, and
`clamav` are never deployed by this workflow under any circumstance.

## Required GitHub secrets

Set these under **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Value |
| --- | --- |
| `PROD_SSH_HOST` | The VM's hostname or IP (e.g. `api.blabber.dev` or the bare IP) |
| `PROD_SSH_USER` | The SSH user the deploy key logs in as |
| `PROD_SSH_PORT` | SSH port (usually `22`) |
| `PROD_SSH_KEY` | The **private** key (PEM/OpenSSH format), full contents including header/footer lines |
| `PROD_KNOWN_HOSTS` | The VM's public host key line(s), in `known_hosts` format |

No application secret (JWT, OAuth, SMTP, OpenRouter, VAPID, Mongo credentials)
is ever stored in GitHub — those all remain in the VM's `.env`.

### Generating the deploy SSH key

On your own machine (not the VM):

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ./blabber_deploy_key -N ""
```

This produces `blabber_deploy_key` (private) and `blabber_deploy_key.pub`
(public). Then:

1. Append `blabber_deploy_key.pub` to `~/.ssh/authorized_keys` for
   `PROD_SSH_USER` on the VM (consider restricting this key with a
   `command=` / `no-port-forwarding` prefix in `authorized_keys` if you want
   to further scope what it can do).
2. Paste the full contents of `blabber_deploy_key` (the private key) into the
   `PROD_SSH_KEY` secret.
3. Get the known-hosts line for `PROD_KNOWN_HOSTS` from a machine you already
   trust the VM from:
   ```bash
   ssh-keyscan -p <port> <host> > known_hosts_entry
   cat known_hosts_entry
   ```
   Verify the fingerprint matches what you expect (e.g. against the GCP
   console's serial console output, or a fingerprint you recorded when you
   first provisioned the VM) before pasting it in — this is what lets the
   workflow use `StrictHostKeyChecking=yes` instead of blindly trusting
   whatever key the host presents on first connect.
4. Delete the local copies of the private key once both secrets are set.

### Optional repository variable

`AUTO_DEPLOY_ON_PUSH` (Settings → Secrets and variables → Actions →
**Variables** tab, not Secrets) — set to `false` to disable the push-to-main
auto-deploy without editing the workflow file. Leaving it unset or `true`
keeps auto-deploy enabled. `workflow_dispatch` (manual runs) always works
regardless of this variable.

## Triggering a deploy

**Manual:** Actions tab → "Deploy Production" → "Run workflow" → pick the
branch/tag → optionally check "Rebuild and recreate ALL app services
regardless of changed files" → Run workflow.

**Automatic:** every push to `main` triggers a deploy of that commit.

## Disabling auto-deploy

- **Temporarily, without a code change:** set the `AUTO_DEPLOY_ON_PUSH`
  repository variable to `false`.
- **Permanently:** edit `.github/workflows/deploy-production.yml` and remove
  (or comment out) the `push:` trigger block, keeping only
  `workflow_dispatch`.

## Testing the workflow safely the first time

1. Add all 5 secrets.
2. Trigger it manually via `workflow_dispatch` rather than waiting for a push
   to `main` — this lets you watch the run and abort/investigate before it's
   tied to a normal commit-and-push habit.
3. Watch the "Deploy over SSH" step's log. The remote script logs every
   phase (backup, fetch, diff, reset, validate, build, recreate, health
   check) with `[deploy]` prefixes, so a failure at any phase tells you
   exactly which phase it was in and dumps the last 80 log lines of the
   failing service if it got that far.
4. If the compose-config-validation step fails immediately, it most likely
   means `docker-compose.gcp.yml` or `docker-compose.hardening.yml` isn't
   actually present at `/opt/blabber` on the VM, or has a syntax error —
   this workflow assumes both already exist there and never creates them.

## Checking deploy logs

- GitHub: Actions tab → "Deploy Production" → pick the run → expand the
  "Deploy over SSH" step for the full remote-script log, or the "Verify
  public endpoints" step for the post-deploy checks.
- On the VM directly: `cd /opt/blabber && docker compose -f docker-compose.full.yml -f docker-compose.gcp.yml -f docker-compose.hardening.yml logs --tail=200 <service>`

## Rollback

This workflow does **not** implement automatic rollback or automatic database
restore — a bad deploy needs a deliberate, human-triggered fix:

1. **Roll the code back:** trigger `workflow_dispatch` again, but first
   `git revert` the bad commit (or push/tag an earlier known-good commit to
   `main`) so `github.sha` points at the commit you actually want running.
   The same script will diff, rebuild, and recreate only what changed between
   what's currently running and that earlier commit.
2. **Restore the pre-deploy MongoDB backup, only if the bad deploy actually
   corrupted data** (most bad deploys don't — a code rollback alone is
   usually sufficient). Every deploy writes
   `backups/mongo/pre-deploy-<sha>-<timestamp>.archive.gz` on the VM before
   changing anything. Restore with the existing guarded restore script (see
   `docs/backup-restore.md`):
   ```bash
   pnpm backup:restore -- --archive backups/mongo/pre-deploy-<sha>-<timestamp>.archive.gz \
     --target-db <explicit-non-prod-target> --confirm-non-prod-restore
   ```
   This script deliberately refuses to restore directly over the production
   database — restoring into production from a backup is a manual, deliberate
   operation outside of this pipeline, by design.
3. If a specific service is unhealthy after a partial deploy, you can also
   manually re-run just that service on the VM:
   ```bash
   cd /opt/blabber
   docker compose -f docker-compose.full.yml -f docker-compose.gcp.yml -f docker-compose.hardening.yml \
     up -d --no-deps <service>
   ```

## Known limitations / things to verify for your VM

- The MongoDB backup step uses `MONGO_URI` from the VM's `.env` if present,
  otherwise connects to `mongodb` without auth. This script has no visibility
  into `docker-compose.gcp.yml`/`docker-compose.hardening.yml` (they aren't
  in this repo), so double-check this matches however Mongo auth is actually
  configured in production before relying on it.
- Health checks rely on each service's built-in Docker `HEALTHCHECK`
  (`services/*/Dockerfile`, `apps/gateway/Dockerfile`, `apps/web/Dockerfile`).
  If a future Dockerfile change removes a service's `HEALTHCHECK`, this
  script treats that service as healthy immediately (`no-healthcheck`) rather
  than failing the deploy — it can't detect the absence of a check as itself
  a problem.
