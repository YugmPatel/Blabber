import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  MessagesSquare,
  Users,
  FileText,
  CheckSquare,
  GitBranch,
  Brain,
  Clock3,
  LogOut,
  Plus,
  ChevronLeft,
  ChevronRight,
  User,
  Bell,
  HelpCircle,
  Moon,
  Sun,
  Shield,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import BlabberLogo from '@/components/BlabberLogo';
import Avatar from '@/components/Avatar';

export interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  onNewConversation?: () => void;
  onNewGroup?: () => void;
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
  onNavigateMobile,
  taskCount = 0,
}: SidebarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileAreaRef = useRef<HTMLDivElement>(null);

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

  const mainNavItems = [
    { to: '/chats', label: 'All Chats', icon: MessagesSquare, end: true },
  ];

  // Intelligence items: no real routes yet, navigate to /chats
  const intelligenceItems = [
    { label: 'Groups', icon: Users },
    { label: 'Summaries', icon: FileText },
    { label: 'Tasks', icon: CheckSquare, badge: taskCount > 0 ? taskCount : undefined },
    { label: 'Decisions', icon: GitBranch },
    { label: 'Memories', icon: Brain },
    { label: 'Waiting On', icon: Clock3 },
  ];

  const navItemBase =
    'relative flex items-center rounded-xl py-2.5 text-sm font-medium transition-colors';
  const navItemPadding = collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5';

  return (
    <aside
      className="relative flex h-full flex-col border-r border-slate-200 bg-[#f8faf9] dark:border-slate-700 dark:bg-slate-900"
      style={{
        width: collapsed ? 64 : 220,
        transition: 'width 0.22s ease',
        flexShrink: 0,
      }}
    >
      {/* ── Header ─────────────────────────────────── */}
      <div className="flex h-14 items-center justify-between border-b border-slate-200 px-3 dark:border-slate-700">
        <div className="flex min-w-0 items-center gap-2.5">
          <BlabberLogo size={30} className="flex-shrink-0" />
          {!collapsed && (
            <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">
              Blabber
            </span>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={onToggle}
          className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200 ${
            collapsed ? 'mx-auto' : ''
          }`}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* ── New Chat button ──────────────────────────── */}
      <div className={`px-3 py-3 ${collapsed ? 'flex justify-center' : ''}`}>
        <button
          onClick={() => {
            onNewConversation();
            onNavigateMobile?.();
          }}
          aria-label="New conversation"
          title={collapsed ? 'New conversation' : undefined}
          className={`flex items-center justify-center gap-2 rounded-xl bg-slate-950 text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 ${
            collapsed ? 'h-9 w-9' : 'h-9 w-full px-3 text-[13px] font-semibold'
          }`}
        >
          <Plus size={15} strokeWidth={2.5} />
          {!collapsed && 'New chat'}
        </button>
      </div>

      {/* ── Navigation ────────────────────────────────── */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
        {/* Main nav: All Chats */}
        {mainNavItems.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            end={item.end}
            onClick={onNavigateMobile}
            aria-label={item.label}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `${navItemBase} ${navItemPadding} ${
                isActive
                  ? 'bg-[#e7f8f4] text-[#0f766e] dark:bg-teal-900/40 dark:text-teal-300'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-100'
              }`
            }
          >
            <item.icon size={17} className="flex-shrink-0" />
            {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
          </NavLink>
        ))}

        {/* Intelligence items */}
        {intelligenceItems.map((item) => (
          <button
            key={item.label}
            onClick={() => {
              navigate('/chats');
              onNavigateMobile?.();
            }}
            aria-label={item.label}
            title={collapsed ? item.label : undefined}
            className={`${navItemBase} ${navItemPadding} w-full text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-100`}
          >
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
        ))}
      </nav>

      {/* ── Profile area (popup + button) ───────────── */}
      <div ref={profileAreaRef} className="relative border-t border-slate-200 p-3 dark:border-slate-700">
        {/* Profile menu popover — fixed width so it never overflows in collapsed mode */}
        {profileMenuOpen && (
          <div className="absolute bottom-full left-0 z-50 mb-2 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
            {/* User header */}
            <div className="border-b border-slate-100 px-3 py-2.5 dark:border-slate-700">
              <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">
                {user?.name || user?.username}
              </p>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{user?.email}</p>
            </div>

            {/* Menu items */}
            {(
              [
                {
                  icon: User,
                  label: 'Profile',
                  action: () => { navigate('/settings?s=profile'); setProfileMenuOpen(false); onNavigateMobile?.(); },
                },
                {
                  icon: Shield,
                  label: 'Privacy',
                  action: () => { navigate('/settings?s=privacy'); setProfileMenuOpen(false); },
                },
                {
                  icon: Bell,
                  label: 'Notifications',
                  action: () => { navigate('/settings?s=notifications'); setProfileMenuOpen(false); },
                },
                {
                  icon: HelpCircle,
                  label: 'Help',
                  action: () => { navigate('/settings?s=help'); setProfileMenuOpen(false); },
                },
              ] as const
            ).map((item) => (
              <button
                key={item.label}
                onClick={item.action}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
              >
                <item.icon size={15} className="flex-shrink-0 text-slate-400 dark:text-slate-500" />
                {item.label}
              </button>
            ))}

            {/* Theme toggle row */}
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-300">
                {theme === 'dark' ? (
                  <Moon size={15} className="text-slate-400" />
                ) : (
                  <Sun size={15} className="text-slate-400" />
                )}
                {theme === 'dark' ? 'Dark mode' : 'Light mode'}
              </div>
              <button
                onClick={toggleTheme}
                role="switch"
                aria-checked={theme === 'dark'}
                aria-label="Toggle dark mode"
                className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
                  theme === 'dark' ? 'bg-teal-500' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    theme === 'dark' ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Logout */}
            <div className="border-t border-slate-100 pt-1 dark:border-slate-700">
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-rose-600 transition hover:bg-rose-50 dark:hover:bg-rose-900/20"
              >
                <LogOut size={15} className="flex-shrink-0" />
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
