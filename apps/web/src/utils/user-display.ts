type DisplayableUser = {
  _id?: string;
  name?: string | null;
  username?: string | null;
  email?: string | null;
  profileHandle?: string | null;
  displayHandle?: string | null;
};

function cleanHandle(value?: string | null) {
  const trimmed = String(value || '').trim().replace(/^@/, '');
  return trimmed || '';
}

export function formatDisplayName(user?: DisplayableUser | null, fallback = 'User') {
  return user?.name?.trim() || cleanHandle(user?.profileHandle) || cleanHandle(user?.displayHandle) || user?.username?.trim() || user?.email?.trim() || fallback;
}

export function formatDisplayHandle(user?: DisplayableUser | null) {
  if (!user) return '';
  const preferred = cleanHandle(user.profileHandle) || cleanHandle(user.displayHandle);
  if (preferred) return `@${preferred}`;
  const username = cleanHandle(user.username);
  if (username) return `@${username}`;
  return '';
}

export function formatUserSubtitle(user?: DisplayableUser | null, fallback = '') {
  return formatDisplayHandle(user) || fallback;
}
