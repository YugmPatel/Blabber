#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function run(args) {
  return spawnSync(process.execPath, ['scripts/verify-production-config.mjs', ...args], {
    encoding: 'utf8',
  });
}

function parseJson(output) {
  return JSON.parse(output.trim());
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const missingTarget = run([]);
assert(missingTarget.status === 2, 'missing target must fail closed');

const valid = run(['--target', 'production', '--fixture', 'scripts/fixtures/production-config.valid.json']);
assert(valid.status === 0, 'valid synthetic production fixture should pass');
const validSummary = parseJson(valid.stdout);
assert(validSummary.passed === true, 'valid fixture summary should pass');
assert(validSummary.source === 'synthetic-fixture', 'valid fixture should identify synthetic source');

const invalid = run(['--target', 'production', '--fixture', 'scripts/fixtures/production-config.invalid.json']);
assert(invalid.status === 1, 'invalid synthetic production fixture should fail');
const invalidSummary = parseJson(invalid.stdout);
assert(invalidSummary.passed === false, 'invalid fixture summary should fail');
const categories = new Set(invalidSummary.findings.map((finding) => finding.category));
for (const category of ['environment', 'database', 'redis', 'secrets', 'cors', 'auth', 'public-runtime', 'public-secret-boundary', 'provider-mode', 'actions-email-digest', 'mobile-push']) {
  assert(categories.has(category), `invalid fixture should report ${category}`);
}

const serialized = `${valid.stdout}\n${invalid.stdout}\n${missingTarget.stderr}`;
assert(!serialized.includes('public-secret-placeholder'), 'verifier output must not include public secret fixture value');
assert(!serialized.includes('mongodb://localhost:27017'), 'verifier output must not include database URLs');
assert(!serialized.includes('dev-secret'), 'verifier output must not include secret values');

console.log(JSON.stringify({
  verifierTests: 'passed',
  cases: 3,
}, null, 2));
