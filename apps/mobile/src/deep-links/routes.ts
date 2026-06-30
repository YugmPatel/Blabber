export type MobileRoute =
  | { name: 'profile'; handle: string }
  | { name: 'community'; handle: string }
  | { name: 'reel'; reelId: string }
  | { name: 'chat'; chatId: string }
  | { name: 'discover' }
  | { name: 'notifications' };

const SAFE_HANDLE = /^[a-z0-9_][a-z0-9_.-]{1,29}$/i;
const SAFE_ID = /^[a-f0-9]{24}$/i;
const BLOCKED_PARAMS = /(access|refresh|token|playback|manifest|invite|reset|verification|media)/i;

export function parseMobileDeepLink(raw: string): MobileRoute | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'blabber:') return null;
  for (const key of url.searchParams.keys()) {
    if (BLOCKED_PARAMS.test(key)) return null;
  }

  const parts = [url.hostname, ...url.pathname.split('/').filter(Boolean)];
  const [kind, value] = parts;
  if (kind === 'p' && value && SAFE_HANDLE.test(value)) return { name: 'profile', handle: value.toLowerCase() };
  if (kind === 'c' && value && SAFE_HANDLE.test(value)) return { name: 'community', handle: value.toLowerCase() };
  if (kind === 'reels' && value && SAFE_ID.test(value)) return { name: 'reel', reelId: value };
  if (kind === 'chats' && value && SAFE_ID.test(value)) return { name: 'chat', chatId: value };
  if (kind === 'discover' && !value) return { name: 'discover' };
  if (kind === 'notifications' && !value) return { name: 'notifications' };
  return null;
}

export function parseNotificationTarget(target?: string | null) {
  if (!target || target.startsWith('http')) return null;
  return parseMobileDeepLink(target.startsWith('blabber://') ? target : `blabber://${target.replace(/^\/+/, '')}`);
}
