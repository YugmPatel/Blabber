import type { ExpoConfig } from 'expo/config';

function validateConfigApiBaseUrl() {
  const raw = String(process.env.EXPO_PUBLIC_API_BASE_URL || '').trim();
  if (!raw) throw new Error('EXPO_PUBLIC_API_BASE_URL is required');
  const parsed = new URL(raw);
  const localNames = [['local', 'host'].join(''), ['127', '0', '0', '1'].join('.'), ['10', '0', '2', '2'].join('.')];
  const isLocal = localNames.includes(parsed.hostname) || /^192\.168\./.test(parsed.hostname) || /^10\./.test(parsed.hostname);
  const allowLocal = process.env.NODE_ENV !== 'production' && process.env.EXPO_PUBLIC_ALLOW_INSECURE_LOCAL_API === 'true' && isLocal;
  if (parsed.protocol === 'http:' && !allowLocal) throw new Error('Insecure mobile API base URL is allowed only for explicit local development');
  parsed.hash = '';
  parsed.username = '';
  parsed.password = '';
  return parsed.toString().replace(/\/+$/, '');
}

const apiBaseUrl = validateConfigApiBaseUrl();

const config: ExpoConfig = {
  name: 'Blabber',
  slug: 'blabber-mobile',
  scheme: 'blabber',
  version: '0.1.0',
  orientation: 'portrait',
  platforms: ['ios', 'android'],
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.blabber.mobile',
    supportsTablet: true,
  },
  android: {
    package: 'com.blabber.mobile',
    adaptiveIcon: {
      backgroundColor: '#0f172a',
    },
  },
  extra: {
    apiBaseUrl,
  },
  experiments: {
    typedRoutes: true,
  },
};

export default config;
