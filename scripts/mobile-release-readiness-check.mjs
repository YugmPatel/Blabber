#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function has(pattern, text) {
  return pattern.test(text);
}

const appConfig = read('apps/mobile/app.config.ts');
const pkg = JSON.parse(read('apps/mobile/package.json'));
const envExample = existsSync('apps/mobile/.env.example') ? read('apps/mobile/.env.example') : '';
const findings = [];

function pass(category, message) {
  findings.push({ severity: 'pass', category, message });
}

function block(category, message) {
  findings.push({ severity: 'blocker', category, message });
}

function note(category, message) {
  findings.push({ severity: 'note', category, message });
}

if (appConfig.includes('EXPO_PUBLIC_API_BASE_URL') && appConfig.includes('validateConfigApiBaseUrl')) pass('api', 'explicit public API base URL is required and validated');
else block('api', 'explicit public API base URL validation is missing');

if (!appConfig.includes('localhost') && !appConfig.includes('127.0.0.1')) pass('api', 'no hardcoded localhost API fallback in app config');
else block('api', 'app config contains local-only API fallback');

if (has(/scheme:\s*'[^']+'/m, appConfig)) pass('identity', 'app scheme is configured');
else block('identity', 'app scheme is missing');

if (has(/bundleIdentifier:\s*'[^']+'/m, appConfig)) pass('identity', 'iOS bundle identifier is configured');
else block('identity', 'iOS bundle identifier is missing');

if (has(/package:\s*'[^']+'/m, appConfig)) pass('identity', 'Android package identifier is configured');
else block('identity', 'Android package identifier is missing');

if (has(/buildNumber:\s*'[^']+'/m, appConfig) && has(/versionCode:\s*\d+/m, appConfig)) pass('versioning', 'native build number/versionCode strategy is configured');
else block('versioning', 'native build number/versionCode strategy is absent');

if (has(/icon:\s*'[^']+'/m, appConfig)) pass('assets', 'app icon is configured');
else block('assets', 'app icon asset is absent');

if (has(/splash:/m, appConfig)) pass('assets', 'splash configuration is present');
else block('assets', 'splash configuration is absent');

if (!has(/NSCameraUsageDescription|android\.permission\.CAMERA|cameraPermission/m, appConfig)) pass('permissions', 'camera permission is not configured in app metadata');
else note('permissions', 'camera permission appears configured and needs release review');

const serializedDependencies = JSON.stringify({ ...pkg.dependencies, ...pkg.devDependencies });
if (!has(/sentry|firebase|analytics|amplitude|segment|admob|ads/i, serializedDependencies)) pass('privacy', 'no analytics/ad SDK dependency detected');
else block('privacy', 'analytics/ad SDK dependency detected and requires review');

if (!has(/EXPO_PUBLIC_.*(SECRET|TOKEN|PASSWORD|PRIVATE|KEY)/i, `${appConfig}\n${envExample}`)) pass('public-secret-boundary', 'no public Expo secret-like variable detected');
else block('public-secret-boundary', 'public Expo secret-like variable detected');

note('push', 'mobile push is structurally present but not production-ready without provider credentials, native entitlements, and real-device testing');
note('store', 'store metadata, screenshots, support URL, privacy URL, terms URL, signing credentials, and account setup require human/provider work');
note('runtime', 'Expo 56 validation should run with Node >=20.19.4');

const blockers = findings.filter((finding) => finding.severity === 'blocker');
console.log(JSON.stringify({
  check: 'mobile-release-readiness',
  inspected: true,
  structuralConfigReady: blockers.length === 0,
  storeReady: false,
  blockers: blockers.length,
  findings,
}, null, 2));
