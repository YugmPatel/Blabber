# Final Launch Gate

Release G can be considered for launch only when every item below is complete and human-approved.

## Required Gates

- Full test suite green.
- Full media suite green.
- All accepted smoke suites green.
- Provider selection complete.
- Production config verified.
- Staging rehearsal complete.
- Backup and restore plan approved.
- Monitoring and alerting active.
- Rollback plan rehearsed where feasible.
- Real push staging validation complete if push is enabled.
- Device, emulator, browser, and accessibility plan complete.
- Store metadata, assets, and privacy disclosures complete.
- Legal review complete.
- Support workflow active.
- Human release approval recorded.

## Current Stage 1 Gate Command

```sh
pnpm verify:launch-gate
```

This command verifies repository launch artifacts only. It does not prove production readiness by itself.

## Not Claimed

- No production deployment.
- No store approval.
- No legal compliance approval.
- No provider activation.
- No real push delivery.
