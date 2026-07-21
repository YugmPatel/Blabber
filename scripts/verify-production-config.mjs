#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const allowedTargets = new Set(['local', 'test', 'staging', 'production']);
const secretNamePattern = /(SECRET|TOKEN|PASSWORD|PRIVATE|KEY|CREDENTIAL|SMTP_PASS|MONGO_URI|REDIS_URL|DATABASE_URL)/i;
const publicPrefixPattern = /^(VITE_|EXPO_PUBLIC_)/;
const placeholderPattern = /(changeme|change-in-production|example|placeholder|your-|test|dev|development|secret|fake|mock)/i;
const localHostPattern = /(^|[/:@])(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal|mongodb|redis|clamav)([/:]|$)/i;
const localDbNamePattern = /(test|dev|local|whatsapp|blabber_full|restore|verify|tmp)/i;

function parseArgs(argv) {
  const args = { target: '', fixture: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--target') args.target = argv[++index] || '';
    else if (value.startsWith('--target=')) args.target = value.split('=').slice(1).join('=');
    else if (value === '--fixture') args.fixture = argv[++index] || '';
    else if (value.startsWith('--fixture=')) args.fixture = value.split('=').slice(1).join('=');
  }
  return args;
}

function loadEnv(fixture) {
  if (!fixture) return { ...process.env };
  const parsed = JSON.parse(readFileSync(fixture, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('fixture must be a JSON object');
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

function value(env, key) {
  return String(env[key] || '').trim();
}

function isMissing(env, key) {
  return value(env, key).length === 0;
}

function isLocalish(raw) {
  return localHostPattern.test(String(raw || '')) || /^http:\/\/10\./.test(String(raw || '')) || /^http:\/\/192\.168\./.test(String(raw || ''));
}

function addFinding(findings, severity, category, variable, message) {
  findings.push({ severity, category, variable, message });
}

function requirePresent(env, findings, category, variables) {
  for (const variable of variables) {
    if (isMissing(env, variable)) addFinding(findings, 'fail', category, variable, 'required production configuration is absent');
  }
}

function validateProduction(env) {
  const findings = [];

  requirePresent(env, findings, 'environment', ['NODE_ENV', 'APP_ENV']);
  if (value(env, 'NODE_ENV') !== 'production') addFinding(findings, 'fail', 'environment', 'NODE_ENV', 'must be production for production verification');
  if (value(env, 'APP_ENV') !== 'production') addFinding(findings, 'fail', 'environment', 'APP_ENV', 'must explicitly separate production from local/test/staging');

  requirePresent(env, findings, 'database', ['MONGO_URI', 'MONGO_DB_NAME']);
  if (isLocalish(value(env, 'MONGO_URI'))) addFinding(findings, 'fail', 'database', 'MONGO_URI', 'production database endpoint cannot be local-only');
  if (localDbNamePattern.test(value(env, 'MONGO_DB_NAME'))) addFinding(findings, 'fail', 'database', 'MONGO_DB_NAME', 'production database name looks non-production');

  requirePresent(env, findings, 'redis', ['REDIS_HOST']);
  if (isLocalish(value(env, 'REDIS_HOST'))) addFinding(findings, 'fail', 'redis', 'REDIS_HOST', 'production Redis endpoint cannot be local-only');

  requirePresent(env, findings, 'jwt', ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']);
  for (const variable of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'MOBILE_PUSH_TOKEN_ENCRYPTION_KEY']) {
    const raw = value(env, variable);
    if (variable !== 'MOBILE_PUSH_TOKEN_ENCRYPTION_KEY' || raw) {
      if (raw.length < 32) addFinding(findings, 'fail', 'secrets', variable, 'secret material is missing or too short');
      if (placeholderPattern.test(raw)) addFinding(findings, 'fail', 'secrets', variable, 'secret material looks placeholder-like');
    }
  }

  requirePresent(env, findings, 'cors', ['ALLOWED_ORIGINS']);
  const origins = value(env, 'ALLOWED_ORIGINS').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (origins.includes('*')) addFinding(findings, 'fail', 'cors', 'ALLOWED_ORIGINS', 'wildcard origins cannot be used for production');
  if (origins.some(isLocalish)) addFinding(findings, 'fail', 'cors', 'ALLOWED_ORIGINS', 'production origins cannot be local-only');
  if (value(env, 'CORS_CREDENTIALS') === 'false') addFinding(findings, 'warn', 'cors', 'CORS_CREDENTIALS', 'credential behavior must be intentionally reviewed');

  if (value(env, 'AUTH_COOKIE_SECURE') !== 'true') addFinding(findings, 'fail', 'auth', 'AUTH_COOKIE_SECURE', 'production auth cookies must be secure');
  if (!['strict', 'lax', 'none'].includes(value(env, 'AUTH_COOKIE_SAME_SITE').toLowerCase())) {
    addFinding(findings, 'fail', 'auth', 'AUTH_COOKIE_SAME_SITE', 'same-site policy must be explicit');
  }

  requirePresent(env, findings, 'web-public', ['VITE_API_URL', 'VITE_SOCKET_URL']);
  for (const variable of ['VITE_API_URL', 'VITE_SOCKET_URL', 'VITE_LIVEKIT_WS_URL', 'EXPO_PUBLIC_API_BASE_URL']) {
    if (value(env, variable) && isLocalish(value(env, variable))) {
      addFinding(findings, 'fail', 'public-runtime', variable, 'public runtime URL cannot point to local-only service in production');
    }
  }
  if (value(env, 'EXPO_PUBLIC_ALLOW_INSECURE_LOCAL_API') === 'true') {
    addFinding(findings, 'fail', 'mobile-public', 'EXPO_PUBLIC_ALLOW_INSECURE_LOCAL_API', 'insecure local mobile API opt-in cannot be enabled for production');
  }

  const publicSecretNames = Object.keys(env).filter((key) => publicPrefixPattern.test(key) && secretNamePattern.test(key));
  for (const variable of publicSecretNames) {
    addFinding(findings, 'fail', 'public-secret-boundary', variable, 'server-only secret category cannot use a public web/mobile prefix');
  }

  for (const variable of ['MEDIA_SCANNER_MODE', 'PUSH_MOCK_MODE', 'MOBILE_PUSH_PROVIDER_MODE', 'OPENROUTER_MOCK_FALLBACK', 'ACCOUNT_MAIL_CAPTURE']) {
    const raw = value(env, variable).toLowerCase();
    if (['mock', 'fake', 'true', 'disabled'].includes(raw)) {
      addFinding(findings, 'fail', 'provider-mode', variable, 'fake/mock/disabled provider mode cannot silently run as production');
    }
  }

  if (value(env, 'MY_ACTIONS_EMAIL_DIGEST_ENABLED') !== 'false') {
    requirePresent(env, findings, 'actions-email-digest', ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']);
    if (!value(env, 'APP_BASE_URL') && !value(env, 'CLIENT_URL') && !value(env, 'FRONTEND_URL')) {
      addFinding(findings, 'fail', 'actions-email-digest', 'APP_BASE_URL', 'digest links require APP_BASE_URL, CLIENT_URL, or FRONTEND_URL');
    }
  }

  if (value(env, 'PUSH_NOTIFICATIONS_ENABLED') === 'true') {
    requirePresent(env, findings, 'web-push', ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']);
    if (value(env, 'MOBILE_PUSH_PROVIDER_MODE') !== 'expo' && value(env, 'MOBILE_PUSH_PROVIDER_MODE') !== 'apns-fcm') {
      addFinding(findings, 'fail', 'mobile-push', 'MOBILE_PUSH_PROVIDER_MODE', 'production push strategy must be explicit and non-fake');
    }
  }

  if (value(env, 'PUBLIC_MEDIA_BASE_URL') && isLocalish(value(env, 'PUBLIC_MEDIA_BASE_URL'))) {
    addFinding(findings, 'fail', 'media', 'PUBLIC_MEDIA_BASE_URL', 'public media URL cannot be local-only in production');
  }
  if (value(env, 'LOCAL_MEDIA_UPLOAD_BASE_URL') && isLocalish(value(env, 'LOCAL_MEDIA_UPLOAD_BASE_URL'))) {
    addFinding(findings, 'fail', 'media', 'LOCAL_MEDIA_UPLOAD_BASE_URL', 'local upload base URL cannot be local-only in production');
  }

  for (const variable of ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'OPS_DIAGNOSTIC_TOKEN', 'MOMENT_INTERNAL_MEDIA_TOKEN']) {
    const raw = value(env, variable);
    if (!raw) addFinding(findings, 'fail', 'internal-secrets', variable, 'internal credential category is required');
    else if (placeholderPattern.test(raw) || raw.length < 16) addFinding(findings, 'fail', 'internal-secrets', variable, 'internal credential looks placeholder-like');
  }

  return findings;
}

function validateNonProduction(env, target) {
  const findings = [];
  if (value(env, 'APP_ENV') && value(env, 'APP_ENV') !== target) {
    addFinding(findings, 'fail', 'environment', 'APP_ENV', `must match explicit target ${target}`);
  }
  if (target === 'staging' && value(env, 'MOBILE_PUSH_PROVIDER_MODE') === 'fake') {
    addFinding(findings, 'warn', 'mobile-push', 'MOBILE_PUSH_PROVIDER_MODE', 'fake provider is allowed only when staging tests explicitly require it');
  }
  return findings;
}

function printSummary(target, fixture, findings) {
  const failures = findings.filter((finding) => finding.severity === 'fail');
  const warnings = findings.filter((finding) => finding.severity === 'warn');
  const safeFindings = findings.map((finding) => ({
    severity: finding.severity,
    category: finding.category,
    variable: finding.variable,
    message: finding.message,
  }));
  console.log(JSON.stringify({
    verifier: 'production-config',
    target,
    source: fixture ? 'synthetic-fixture' : 'process-env',
    passed: failures.length === 0,
    failures: failures.length,
    warnings: warnings.length,
    findings: safeFindings,
  }, null, 2));
}

const args = parseArgs(process.argv.slice(2));
if (!args.target || !allowedTargets.has(args.target)) {
  console.error('verify-production-config requires --target local|test|staging|production');
  process.exit(2);
}

let env;
try {
  env = loadEnv(args.fixture);
} catch (error) {
  console.error(`verify-production-config could not read synthetic fixture: ${error.message}`);
  process.exit(2);
}

const findings = args.target === 'production' ? validateProduction(env) : validateNonProduction(env, args.target);
printSummary(args.target, args.fixture, findings);
process.exit(findings.some((finding) => finding.severity === 'fail') ? 1 : 0);
