#!/usr/bin/env node
import { existsSync } from 'node:fs';

const requiredDocs = [
  'docs/production-architecture.md',
  'docs/environment-and-secrets.md',
  'docs/ci-cd-release-pipeline.md',
  'docs/staging-rollout-and-rollback.md',
  'docs/mobile-store-readiness.md',
  'docs/push-production-readiness.md',
  'docs/legal-privacy-support-checklist.md',
  'docs/final-launch-gate.md',
  'docs/release-g-production-readiness.md',
];

const checks = requiredDocs.map((path) => ({ path, present: existsSync(path) }));
const missing = checks.filter((check) => !check.present);
console.log(JSON.stringify({
  gate: 'launch-readiness-artifacts',
  mode: 'config-only',
  deploys: false,
  callsExternalProviders: false,
  docsReady: missing.length === 0,
  missing: missing.map((check) => check.path),
}, null, 2));
process.exit(missing.length === 0 ? 0 : 1);
