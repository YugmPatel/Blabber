const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const buckets = new Map<string, number[]>();

export function checkSearchRateLimit(userId: string, scope: string): boolean {
  const now = Date.now();
  const key = `${userId}:${scope}`;
  const recent = (buckets.get(key) || []).filter((timestamp) => now - timestamp < WINDOW_MS);

  if (recent.length >= MAX_REQUESTS) {
    buckets.set(key, recent);
    return false;
  }

  recent.push(now);
  buckets.set(key, recent);
  return true;
}
