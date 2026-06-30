const SECRET_KEYS = /(authorization|token|credential|password|secret|cookie|playback|manifest|segment|media|path|body|caption)/i;
const LONG_VALUE = /[A-Za-z0-9_-]{24,}/g;

export function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/[?&][^=\s]+=[^&\s]+/g, '?redacted=:redacted').replace(LONG_VALUE, ':redacted');
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEYS.test(key) ? ':redacted' : redact(item),
    ])
  );
}
