import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessagesSquare,
  CircleDashed,
  UsersRound,
  Landmark,
  CheckSquare,
  Phone,
  LogOut,
  Plus,
  ChevronLeft,
  ChevronRight,
  User,
  Bookmark,
  HelpCircle,
  Moon,
  Settings,
  Sun,
  Archive,
  Newspaper,
  Compass,
  Clapperboard,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { fetchMyProfile } from '@/api/client';
import BlabberMark from '@/components/brand/BlabberMark';
import VeyraMark from '@/components/brand/VeyraMark';
import Avatar from '@/components/Avatar';

export interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  onNewConversation?: () => void;
  onNewGroup?: () => void;
  activeChatFilter?: 'all' | 'groups';
  onChatFilterChange?: (filter: 'all' | 'groups') => void;
  onNavigateMobile?: () => void;
  taskCount?: number;
  /** @deprecated kept for test compatibility */
  onMenuClick?: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

export default function Sidebar({
  collapsed = false,
  onToggle = noop,
  onNewConversation = noop,
  onNewGroup: _onNewGroup,
  activeChatFilter = 'all',
  onChatFilterChange = noop,
  onNavigateMobile,
  taskCount: _taskCount = 0,
}: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { theme, resolvedTheme, toggleTheme } = useTheme();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileAreaRef = useRef<HTMLDivElement>(null);
  const avatarUrl = (user as any)?.avatarUrl || user?.avatar;

  // Fetched lazily so "View profile" can deep-link to the public profile;
  // users without a handle yet are sent to settings to pick one.
  const queryClient = useQueryClient();
  useQuery({
    queryKey: ['profiles', 'me'],
    queryFn: fetchMyProfile,
    enabled: profileMenuOpen,
    staleTime: 60_000,
  });

  // Awaits the profile instead of reading possibly-not-yet-loaded query data —
  // a fast click right after opening the menu must still land on /p/<handle>,
  // not fall through to settings.
  const openPublicProfile = async () => {
    setProfileMenuOpen(false);
    onNavigateMobile?.();
    try {
      const profile = await queryClient.fetchQuery({
        queryKey: ['profiles', 'me'],
        queryFn: fetchMyProfile,
        staleTime: 60_000,
      });
      const cleanHandle = profile.handle?.replace(/^@/, '') || '';
      navigate(cleanHandle ? `/p/${cleanHandle}` : '/settings?s=profile&hint=handle');
    } catch {
      navigate('/settings?s=profile');
    }
  };

  // Close profile menu on outside click
  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (profileAreaRef.current && !profileAreaRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [profileMenuOpen]);

  const handleLogout = async () => {
    setProfileMenuOpen(false);
    await logout();
    navigate('/login', { replace: true });
  };

  const intelligenceItems: Array<{ label: string; icon: typeof UsersRound; path: string; badge?: number }> = [
    { label: 'Groups', icon: UsersRound, path: '/chats' },
    { label: 'Communities', icon: Landmark, path: '/communities' },
    { label: 'Feed', icon: Newspaper, path: '/feed' },
    { label: 'Reels', icon: Clapperboard, path: '/reels' },
    { label: 'Discover', icon: Compass, path: '/discover' },
    { label: 'Archived', icon: Archive, path: '/archived' },
    { label: 'Calls', icon: Phone, path: '/calls' },
    { label: 'My Actions', icon: CheckSquare, path: '/actions' },
  ];

  const navItemBase =
    'relative flex items-center rounded-xl py-2.5 text-sm font-medium transition-colors bl-focus-ring';
  const navItemPadding = collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5';
  const isChatsRoute = location.pathname === '/chats' || location.pathname.startsWith('/chats/');
  const isMomentsRoute = location.pathname === '/status' || location.pathname.startsWith('/moments');
  const isFeedRoute = location.pathname === '/feed';
  const isReelsRoute = location.pathname === '/reels' || location.pathname.startsWith('/reels/');
  const isDiscoverRoute = location.pathname === '/discover';
  const isCommunitiesRoute = location.pathname === '/communities' || location.pathname.startsWith('/c/');
  const isCallsRoute = location.pathname === '/calls';
  const isActionsRoute = location.pathname === '/actions';
  const isArchivedRoute = location.pathname === '/archived';
  const isVeyraRoute = location.pathname === '/veyra';
  // Active state: a calm teal wash plus a slim teal indicator bar (added via
  // `activeIndicator` below) rather than a bright full-width glow.
  const activeNavClass = 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300';
  const inactiveNavClass =
    'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-100';
  const activeIndicator = (
    <span
      aria-hidden="true"
      className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-teal-600 dark:bg-teal-400"
    />
  );

  return (
    <aside
      className="relative flex h-full flex-col border-r border-slate-200 bg-white dark:border-[#1b393c] dark:bg-[#08181a]"
      style={{
        width: collapsed ? 68 : 264,
        transition: 'width 0.22s ease',
        flexShrink: 0,
      }}
    >
      {/* ── Header ─────────────────────────────────── */}
      <div
        className={`flex h-16 items-center border-b border-slate-200 dark:border-slate-800 ${
          collapsed ? 'justify-center gap-1 px-1' : 'justify-between px-4'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {collapsed ? (
            <BlabberMark size={32} variant="icon" className="flex-shrink-0" />
          ) : (
            <BlabberMark size={36} variant="lockup" className="min-w-0" />
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={onToggle}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* ── New Convo button ──────────────────────────── */}
      <div className={`px-4 py-4 ${collapsed ? 'flex justify-center' : ''}`}>
        <button
          onClick={() => {
            onNewConversation();
            onNavigateMobile?.();
          }}
          aria-label="New Convo"
          title={collapsed ? 'New Convo' : undefined}
          className={`bl-focus-ring flex items-center justify-center gap-2 rounded-xl bg-teal-600 text-white shadow-sm transition hover:bg-teal-700 hover:shadow dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400 ${
            collapsed ? 'h-10 w-10' : 'h-10 w-full px-3.5 text-[13px] font-semibold'
          }`}
        >
          <Plus size={16} strokeWidth={2.5} />
          {!collapsed && 'New Convo'}
        </button>
      </div>

      {/* ── Navigation ────────────────────────────────── */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-1">
        {/* Main nav: Convo */}
        <button
          onClick={() => {
            onChatFilterChange('all');
            navigate('/chats');
            onNavigateMobile?.();
          }}
          aria-label="Convo"
          aria-pressed={isChatsRoute && activeChatFilter === 'all'}
          title={collapsed ? 'Convo' : undefined}
          className={`${navItemBase} ${navItemPadding} w-full ${
            isChatsRoute && activeChatFilter === 'all' ? activeNavClass : inactiveNavClass
          }`}
        >
          {isChatsRoute && activeChatFilter === 'all' && activeIndicator}
          <MessagesSquare size={17} className="flex-shrink-0" />
          {!collapsed && <span className="flex-1 truncate text-left">Convo</span>}
        </button>

        <button
          onClick={() => {
            navigate('/moments');
            onNavigateMobile?.();
          }}
          aria-label="Moments"
          aria-pressed={isMomentsRoute}
          title={collapsed ? 'Moments' : undefined}
          className={`${navItemBase} ${navItemPadding} w-full ${
            isMomentsRoute ? activeNavClass : inactiveNavClass
          }`}
        >
          {isMomentsRoute && activeIndicator}
          <CircleDashed size={17} className="flex-shrink-0" />
          {!collapsed && <span className="flex-1 truncate text-left">Moments</span>}
        </button>

        {/* Intelligence items */}
        {intelligenceItems.map((item) => {
          const isItemActive =
            (item.label === 'Groups' && isChatsRoute && activeChatFilter === 'groups') ||
            (item.label === 'Communities' && isCommunitiesRoute) ||
            (item.label === 'Feed' && isFeedRoute) ||
            (item.label === 'Reels' && isReelsRoute) ||
            (item.label === 'Discover' && isDiscoverRoute) ||
            (item.label === 'Archived' && isArchivedRoute) ||
            (item.label === 'Calls' && isCallsRoute) ||
            (item.label === 'My Actions' && isActionsRoute);
          return (
          <button
            key={item.label}
            onClick={() => {
              if (item.label === 'Groups') {
                onChatFilterChange('groups');
                // The filter travels in the URL so ChatsLayout lands directly in
                // Groups view — pages outside /chats have no way to hand over
                // their filter state otherwise (first-click-shows-Convo bug).
                navigate('/chats?filter=groups');
              } else {
                navigate(item.path || '/chats');
              }
              onNavigateMobile?.();
            }}
            aria-label={item.label}
            aria-pressed={
              item.label === 'Groups'
                ? activeChatFilter === 'groups'
                : item.label === 'Communities'
                  ? isCommunitiesRoute
                : item.label === 'Feed'
                  ? isFeedRoute
                : item.label === 'Reels'
                  ? isReelsRoute
                : item.label === 'Discover'
                  ? isDiscoverRoute
                : item.label === 'Archived'
                  ? isArchivedRoute
                : item.label === 'Calls'
                  ? isCallsRoute
                  : item.label === 'My Actions'
                    ? isActionsRoute
                    : undefined
            }
            title={collapsed ? item.label : undefined}
            className={`${navItemBase} ${navItemPadding} w-full ${isItemActive ? activeNavClass : inactiveNavClass}`}
          >
            {isItemActive && activeIndicator}
            <item.icon size={17} className="flex-shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 truncate text-left">{item.label}</span>
                {item.badge !== undefined && (
                  <span className="rounded-full bg-teal-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                    {item.badge}
                  </span>
                )}
              </>
            )}
            {collapsed && item.badge !== undefined && (
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-teal-500" />
            )}
          </button>
          );
        })}

        {/* VEYRA — dedicated ambient-AI entry, visually distinct from ordinary nav items */}
        <button
          onClick={() => {
            navigate('/veyra');
            onNavigateMobile?.();
          }}
          aria-label="VEYRA, Ambient AI"
          aria-pressed={isVeyraRoute}
          title={collapsed ? 'VEYRA' : undefined}
          className={`${navItemBase} ${navItemPadding} bl-focus-ring mt-1 w-full border border-teal-500/30 text-white transition-all hover:brightness-110`}
          style={{
            background: isVeyraRoute
              ? 'linear-gradient(135deg, #0d2f2b, #0a3a34)'
              : 'linear-gradient(135deg, #08201d, #0d2624)',
            boxShadow: isVeyraRoute ? 'var(--bl-glow-md)' : 'none',
          }}
        >
          <VeyraMark size={17} alive={!collapsed || isVeyraRoute} className="flex-shrink-0" />
          {!collapsed && (
            <span className="flex min-w-0 flex-1 flex-col items-start text-left">
              <span className="truncate font-semibold tracking-wide">VEYRA</span>
              <span className="truncate text-[10px] font-normal text-slate-400">AI Companion</span>
            </span>
          )}
        </button>
      </nav>

      {/* ── Profile area (popup + button) ───────────── */}
      <div ref={profileAreaRef} className="relative border-t border-slate-200 p-3 dark:border-slate-700">
        {/* Profile menu popover — fixed width so it never overflows in collapsed mode */}
        {profileMenuOpen && (
          <div
            className="absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-[#1b393c] dark:bg-[#0a1e20]"
            style={{ boxShadow: 'var(--bl-glow-sm), 0 16px 40px -12px rgba(2, 20, 18, 0.4)' }}
          >
            {/* User summary header */}
            <div className="flex items-center gap-2.5 border-b border-slate-100 px-3.5 py-3 dark:border-[#1b393c]">
              <Avatar src={avatarUrl} alt={user?.name || user?.username || 'Account'} size="md" online={true} />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">
                  {user?.name || user?.username}
                </p>
                <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{user?.email}</p>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-1">
              {(
                [
                  {
                    icon: User,
                    label: 'View profile',
                    subtitle: 'See your public profile',
                    action: () => { void openPublicProfile(); },
                  },
                  {
                    icon: Settings,
                    label: 'Settings',
                    subtitle: 'Manage your account',
                    action: () => { navigate('/settings'); setProfileMenuOpen(false); onNavigateMobile?.(); },
                  },
                  {
                    icon: Bookmark,
                    label: 'Saved',
                    subtitle: 'Messages, posts & more',
                    action: () => { navigate('/settings?s=saved'); setProfileMenuOpen(false); onNavigateMobile?.(); },
                  },
                ] as const
              ).map((item) => (
                <button
                  key={item.label}
                  onClick={item.action}
                  className="group flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-teal-50 dark:hover:bg-teal-500/10"
                >
                  <item.icon size={16} className="flex-shrink-0 text-slate-400 transition group-hover:text-teal-600 dark:text-slate-500 dark:group-hover:text-teal-300" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-slate-800 group-hover:text-teal-800 dark:text-slate-200 dark:group-hover:text-teal-200">
                      {item.label}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{item.subtitle}</span>
                  </span>
                </button>
              ))}

              {/* Appearance quick toggle (full control stays in Settings) */}
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  {resolvedTheme === 'dark' ? (
                    <Moon size={16} className="flex-shrink-0 text-slate-400 dark:text-slate-500" />
                  ) : (
                    <Sun size={16} className="flex-shrink-0 text-slate-400 dark:text-slate-500" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-slate-800 dark:text-slate-200">Appearance</span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                      {theme === 'system' ? 'System' : resolvedTheme === 'dark' ? 'Dark mode' : 'Light mode'}
                    </span>
                  </span>
                </div>
                <button
                  onClick={toggleTheme}
                  role="switch"
                  aria-checked={resolvedTheme === 'dark'}
                  aria-label="Toggle dark mode"
                  className={`relative h-5 w-9 flex-shrink-0 overflow-hidden rounded-full transition-colors ${
                    resolvedTheme === 'dark' ? 'bg-teal-500' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      resolvedTheme === 'dark' ? 'translate-x-[18px]' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              <button
                onClick={() => { navigate('/settings?s=help'); setProfileMenuOpen(false); onNavigateMobile?.(); }}
                className="group flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-teal-50 dark:hover:bg-teal-500/10"
              >
                <HelpCircle size={16} className="flex-shrink-0 text-slate-400 transition group-hover:text-teal-600 dark:text-slate-500 dark:group-hover:text-teal-300" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-slate-800 group-hover:text-teal-800 dark:text-slate-200 dark:group-hover:text-teal-200">
                    Help & support
                  </span>
                  <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">Get help and resources</span>
                </span>
              </button>
            </div>

            {/* Logout */}
            <div className="border-t border-slate-100 py-1 dark:border-[#1b393c]">
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-[13px] font-semibold text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20"
              >
                <LogOut size={16} className="flex-shrink-0" />
                Logout
              </button>
            </div>
          </div>
        )}

        {/* Profile trigger button */}
        <button
          onClick={() => setProfileMenuOpen((o) => !o)}
          aria-label="Account menu"
          aria-expanded={profileMenuOpen}
          title={collapsed ? 'Account menu' : undefined}
          className={`flex w-full items-center rounded-xl p-2 transition hover:bg-slate-100 dark:hover:bg-slate-700/60 ${
            collapsed ? 'justify-center gap-0' : 'gap-2.5'
          }`}
        >
          <Avatar
            src={avatarUrl}
            alt={user?.name || user?.username || 'Account'}
            size="sm"
            online={true}
          />
          {!collapsed && (
            <div className="min-w-0 text-left">
              <p className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-200">
                {user?.name || user?.username || 'Account'}
              </p>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{user?.email}</p>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
}
