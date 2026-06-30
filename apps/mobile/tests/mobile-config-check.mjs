#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const config = readFileSync(new URL('../app.config.ts', import.meta.url), 'utf8');
const env = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

assert(config.includes("scheme: 'blabber'"), 'custom blabber:// scheme configured');
assert(config.includes('validateConfigApiBaseUrl'), 'Expo config validates API base URL');
assert(!config.includes('localhost'), 'Expo config has no hardcoded localhost');
assert(!config.includes('127.0.0.1'), 'Expo config has no hardcoded loopback');
assert(env.includes('https://api.example.invalid'), '.env.example uses placeholder HTTPS URL');
assert(!/SECRET|TOKEN|PASSWORD=.*[^=\s]/.test(env), '.env.example contains no secrets');

console.log('mobile config check passed');
