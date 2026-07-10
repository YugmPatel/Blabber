# Production Architecture Readiness

This document is provider-neutral. It does not configure cloud resources, credentials, domains, storage buckets, push providers, or deployment targets.

## Ready In Repository

- Dockerized service boundaries exist for gateway, auth, users, chats, messages, media, notifications, and web.
- Local full-stack validation exists in `docker-compose.full.yml`.
- Health and readiness endpoints exist across the service stack.
- MongoDB and Redis integrations are centralized through shared config helpers.
- Media upload, scanning, Reel processing, notification, and worker surfaces have local validation coverage.

## Ready Only For Local Or Staged Validation

- `docker-compose.full.yml` is a local deterministic validation stack.
- Local Compose uses local ports, local volumes, and explicit fake/mock/default values.
- Local media storage uses a Docker volume.
- Local ClamAV and fake mobile push modes are validation aids, not production decisions.

## Requires Provider Or Account Decision

| Area | Decision Needed |
| --- | --- |
| Compute/runtime provider | Container hosting or orchestration target |
| Container registry | Registry, naming, retention, vulnerability scanning |
| MongoDB provider | Production cluster, backups, restore access, maintenance policy |
| Redis provider | Persistence, HA, eviction, TLS/auth, monitoring |
| Object storage/CDN | Media storage, CDN, signed URL policy, backup posture |
| Push strategy | Expo Push or direct APNs/FCM |
| CI platform | Provider-neutral command contract runner |
| Domains/CORS | Web, API, media, socket, LiveKit, cookie domains |
| Email/support provider | Sender identity, bounce handling, support workflow |
| Monitoring/alerting | Metrics, logs, traces, paging, error reporting |
| Apple/Google accounts | Store accounts, signing credentials, review ownership |

## Production Topology Requirements

- Separate production database, Redis, media storage, secrets, and provider credentials.
- Immutable application artifact/image references.
- Production domains and CORS allowlists selected before deployment.
- TLS at public ingress.
- Backup, restore, monitoring, alerting, and rollback plans approved before launch.

## Not Claimed

- No production infrastructure exists in this repository today.
- No provider-specific deployment is configured.
- No digest-based artifact promotion flow is implemented yet.
