export const RESERVED_USERNAMES = new Set([
  'admin',
  'support',
  'blabber',
  'api',
  'app',
  'www',
  'root',
  'security',
  'help',
  'terms',
  'privacy',
  'login',
  'signup',
  'settings',
  'system',
]);

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username.toLowerCase());
}
