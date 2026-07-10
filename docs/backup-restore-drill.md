# Release G Batch 2 Backup Restore Drill

This document describes the local backup and restore verification posture for Release G Batch 2. It does not claim production backup coverage and does not configure production credentials.

## Existing Scripts

The repository includes:

- `scripts/mongo-backup.mjs`
- `scripts/mongo-restore.mjs`
- `scripts/mongo-backup-verify.mjs`

The restore script requires explicit non-production confirmation and rejects restoring into the same active source database. The verify script restores into an isolated local verification target and drops the verification target after checking the sentinel.

## Batch 2 Smoke Drill

`scripts/release-g-hardening-smoke.mjs` adds an isolated generated fixture drill. It creates synthetic fixture metadata, copies only summarized fixture metadata into a separate restore target collection, verifies the expected fixture shape, and cleans both source and target artifacts.

The smoke does not print:

- archive paths
- raw database names
- connection strings
- fixture payload values
- storage paths
- account, message, media, or community data

## Guardrails

Never restore into the active local Blabber database during smoke validation. Never use production hosts, production credentials, real user data, real media data, or real provider payloads in the drill.

Binary media backup is not verified by the existing Mongo-only scripts. Media-file backup and restore coverage remains a separate operations concern and should not be claimed as complete by Release G Batch 2.

## Validation

Tracked validation:

```sh
pnpm smoke:release-g-hardening
```

For manual local backup verification, use the existing backup scripts only against the local Docker stack and isolated non-production restore targets.
