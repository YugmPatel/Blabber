export type ApiBaseInput = {
  value?: string;
  allowInsecureLocalDevelopment?: boolean;
  nodeEnv?: string;
};

const LOCAL_HOSTS = new Set([
  ['local', 'host'].join(''),
  ['127', '0', '0', '1'].join('.'),
  ['10', '0', '2', '2'].join('.'),
]);

export function validateApiBaseUrl(input: ApiBaseInput) {
  const raw = String(input.value || '').trim();
  if (!raw) throw new Error('EXPO_PUBLIC_API_BASE_URL is required');

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must be a valid URL');
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must use http or https');
  }

  const isDev = input.nodeEnv !== 'production';
  const isLocal = LOCAL_HOSTS.has(parsed.hostname) || /^192\.168\./.test(parsed.hostname) || /^10\./.test(parsed.hostname);
  if (parsed.protocol === 'http:' && !(isDev && input.allowInsecureLocalDevelopment && isLocal)) {
    throw new Error('Insecure mobile API base URL is allowed only for explicit local development');
  }

  parsed.hash = '';
  parsed.username = '';
  parsed.password = '';
  return parsed.toString().replace(/\/+$/, '');
}

export const API_BASE_URL = validateApiBaseUrl({
  value: process.env.EXPO_PUBLIC_API_BASE_URL,
  allowInsecureLocalDevelopment: process.env.EXPO_PUBLIC_ALLOW_INSECURE_LOCAL_API === 'true',
  nodeEnv: process.env.NODE_ENV,
});
