import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Archive,
  Menu,
  Plus,
  Users,
  Settings,
  User,
  MoreVertical,
  Circle,
  Sparkles,
  Bookmark,
} from 'lucide-react';
import ChatList from './ChatList';
import NewChatModal from './NewChatModal';
import NewGroupModal from './NewGroupModal';
import MetaAIChat from './MetaAIChat';
import BookmarksModal from './BookmarksModal';
import { useChats } from '../hooks/useChats';
import { useAuth } from '@/contexts/AuthContext';

interface SidebarProps {
  onMenuClick?: () => void;
}

type ChatFilter = 'all' | 'unread' | 'groups' | 'direct';

export default function Sidebar({ onMenuClick }: SidebarProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [isNewGroupModalOpen, setIsNewGroupModalOpen] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ChatFilter>('all');
  const [showMetaAI, setShowMetaAI] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);

  // Fetch chats
  const { data: chats = [], isLoading, error } = useChats();

  // Mock pinned and archived chat IDs (in a real app, these would come from the backend)
  const pinnedChatIds: string[] = [];
  const archivedChatIds: string[] = [];
  const unreadCounts: Record<string, number> = {};

  // Filter chats based on search query and active filter
  const filteredChats = useMemo(() => {
    let result = chats;

    // Apply type filter
    if (activeFilter === 'groups') {
      result = result.filter((chat) => chat.type === 'group');
    } else if (activeFilter === 'direct') {
      result = result.filter((chat) => chat.type === 'direct');
    } else if (activeFilter === 'unread') {
      result = result.filter((chat) => (unreadCounts[chat._id] || 0) > 0);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((chat) => {
        if (chat.title?.toLowerCase().includes(query)) return true;
        if (chat.lastMessageRef?.body.toLowerCase().includes(query)) return true;
        return false;
      });
    }

    return result;
  }, [chats, searchQuery]);

  return (
    <>
      <div className="w-full md:w-80 bg-white border-r border-gray-200 flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-gray-900">Chats</h1>
            <div className="flex items-center gap-2">
              {/* New chat/group dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowNewMenu(!showNewMenu)}
                  className="p-2 rounded-lg bg-[#00a884] hover:bg-[#008f72] transition-colors"
                  aria-label="New chat or group"
                  title="New chat or group"
                >
                  <Plus size={20} className="text-white" />
                </button>

                {showNewMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowNewMenu(false)} />
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                      <button
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
                        onClick={() => {
                          setShowNewMenu(false);
                          setIsNewChatModalOpen(true);
                        }}
                      >
                        <Plus size={18} className="text-gray-500" />
                        New Chat
                      </button>
                      <button
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
                        onClick={() => {
                          setShowNewMenu(false);
                          setIsNewGroupModalOpen(true);
                        }}
                      >
                        <Users size={18} className="text-gray-500" />
                        New Group
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => setShowArchived(!showArchived)}
                className={`p-2 rounded-lg hover:bg-gray-100 transition-colors ${
                  showArchived ? 'bg-gray-200' : ''
                }`}
                aria-label={showArchived ? 'Show active chats' : 'Show archived chats'}
                title={showArchived ? 'Show active chats' : 'Show archived chats'}
              >
                <Archive size={20} className="text-gray-600" />
              </button>
              {/* User menu */}
              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                  aria-label="Menu"
                >
                  <MoreVertical size={20} className="text-gray-600" />
                </button>

                {showUserMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowUserMenu(false)} />
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                      <button
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
                        onClick={() => {
                          setShowUserMenu(false);
                          navigate('/profile');
                        }}
                      >
                        <User size={18} className="text-gray-500" />
                        Profile
                      </button>
                      <button
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
                        onClick={() => {
                          setShowUserMenu(false);
                          navigate('/status');
                        }}
                      >
                        <Circle size={18} className="text-gray-500" />
                        Status
                      </button>
                      <button
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
                        onClick={() => {
                          setShowUserMenu(false);
                          navigate('/settings');
                        }}
                      >
                        <Settings size={18} className="text-gray-500" />
                        Settings
                      </button>
                      <button
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
                        onClick={() => {
                          setShowUserMenu(false);
                          setShowBookmarks(true);
                        }}
                      >
                        <Bookmark size={18} className="text-gray-500" />
                        Saved Messages
                      </button>
                      <hr className="my-1 border-gray-200" />
                      <button
                        className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-3"
                        onClick={() => {
                          setShowUserMenu(false);
                          setShowMetaAI(true);
                        }}
                      >
                        <Sparkles size={18} className="text-blue-600" />
                        Meta AI
                      </button>
                    </div>
                  </>
                )}
              </div>
              {onMenuClick && (
                <button
                  onClick={onMenuClick}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors md:hidden"
                  aria-label="Open menu"
                >
                  <Menu size={20} className="text-gray-600" />
                </button>
              )}
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search
              size={18}
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              aria-label="Search chats"
            />
          </div>

          {/* Filter chips */}
          <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
            {(['all', 'unread', 'groups', 'direct'] as ChatFilter[]).map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
                  activeFilter === filter
                    ? 'bg-[#00a884] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {filter === 'all'
                  ? 'All'
                  : filter === 'unread'
                    ? 'Unread'
                    : filter === 'groups'
                      ? 'Groups'
                      : 'Direct'}
              </button>
            ))}
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center h-32 text-gray-500">
              Loading chats...
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-32 text-red-500">
              Error loading chats
            </div>
          )}

          {!isLoading && !error && filteredChats.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500 px-4">
              <p className="text-center mb-2">No chats yet</p>
              <p className="text-sm text-center text-gray-400">
                Start a conversation by searching for users
              </p>
            </div>
          )}

          {!isLoading && !error && filteredChats.length > 0 && (
            <ChatList
              chats={filteredChats}
              pinnedChatIds={pinnedChatIds}
              archivedChatIds={archivedChatIds}
              unreadCounts={unreadCounts}
              showArchived={showArchived}
            />
          )}
        </div>
      </div>

      {/* New Chat Modal */}
      <NewChatModal isOpen={isNewChatModalOpen} onClose={() => setIsNewChatModalOpen(false)} />

      {/* New Group Modal */}
      <NewGroupModal isOpen={isNewGroupModalOpen} onClose={() => setIsNewGroupModalOpen(false)} />

      {/* Meta AI Chat */}
      <MetaAIChat isOpen={showMetaAI} onClose={() => setShowMetaAI(false)} />

      {/* Bookmarks Modal */}
      <BookmarksModal isOpen={showBookmarks} onClose={() => setShowBookmarks(false)} />
    </>
  );
}
