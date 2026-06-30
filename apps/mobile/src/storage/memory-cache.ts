type CacheEntry = { key: string; value: unknown };

let cache: CacheEntry[] = [];

export function setMemoryCache(key: string, value: unknown) {
  cache = cache.filter((entry) => entry.key !== key).concat({ key, value });
}

export function getMemoryCache<T>(key: string): T | null {
  return (cache.find((entry) => entry.key === key)?.value as T | undefined) ?? null;
}

export function clearPrivateMemoryCache() {
  cache = [];
}
