# Backup And Restore

Mongo logical backups are created with:

```bash
pnpm backup:mongo
```

The backup script runs `mongodump` inside the configured Mongo container, writes a compressed archive under `backups/mongo`, and writes a manifest containing source DB, byte size, retention policy, and SHA-256 checksum. The default retention window is 14 days via `BACKUP_RETENTION_DAYS`.

Restore is intentionally guarded:

```bash
pnpm backup:restore -- --archive backups/mongo/<file>.archive.gz --target-db blabber_restore_verify --confirm-non-prod-restore
```

The target DB must be explicit, must differ from the source DB, and must look non-production (`test`, `staging`, `restore`, `verify`, `tmp`, or `dev`). The restore verifies the manifest checksum before calling `mongorestore --drop` into the target namespace.

Representative verification is available with:

```bash
pnpm backup:verify
```

It writes a sentinel document, backs up the source DB, restores into a throwaway verification DB, validates the sentinel, then drops the verification DB.
