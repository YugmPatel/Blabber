import { useState, useEffect } from 'react';
import { X, Bookmark, Search, Trash2, ExternalLink, MessageSquare } from 'lucide-react';

interface BookmarkedMessage {
  id: string;
  messageId: string;
  chatId: string;
  chatName: string;
  content: string;
  senderName: string;
  timestamp: Date;
  note?: string;
}

interface BookmarksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToMessage?: (chatId: string, messageId: string) => void;
}

export default function BookmarksModal({
  isOpen,
  onClose,
  onNavigateToMessage,
}: BookmarksModalProps) {
  const [bookmarks, setBookmarks] = useState<BookmarkedMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'chat'>('recent');

  // Load bookmarks from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('messageBookmarks');
    if (saved) {
      const parsed = JSON.parse(saved);
      setBookmarks(
        parsed.map((b: BookmarkedMessage) => ({ ...b, timestamp: new Date(b.timestamp) }))
      );
    }
  }, [isOpen]);

  const filteredBookmarks = bookmarks
    .filter(
      (b) =>
        b.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.chatName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.senderName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.note?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'recent') {
        return b.timestamp.getTime() - a.timestamp.getTime();
      }
      return a.chatName.localeCompare(b.chatName);
    });

  const groupedByChat = filteredBookmarks.reduce(
    (acc, bookmark) => {
      if (!acc[bookmark.chatName]) {
        acc[bookmark.chatName] = [];
      }
      acc[bookmark.chatName].push(bookmark);
      return acc;
    },
    {} as Record<string, BookmarkedMessage[]>
  );

  const handleRemoveBookmark = (id: string) => {
    const updated = bookmarks.filter((b) => b.id !== id);
    setBookmarks(updated);
    localStorage.setItem('messageBookmarks', JSON.stringify(updated));
  };

  const handleClearAll = () => {
    if (confirm('Are you sure you want to remove all bookmarks?')) {
      setBookmarks([]);
      localStorage.removeItem('messageBookmarks');
    }
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex h-[600px] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <Bookmark className="h-5 w-5 text-[#00a884]" />
            <h2 className="text-lg font-semibold text-gray-900">Saved Messages</h2>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              {bookmarks.length}
            </span>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-gray-500 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        {/* Search and filters */}
        <div className="border-b border-gray-200 p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search saved messages..."
              className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 focus:border-[#00a884] focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <button
                onClick={() => setSortBy('recent')}
                className={`rounded-full px-3 py-1 text-sm ${
                  sortBy === 'recent' ? 'bg-[#00a884] text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                Recent
              </button>
              <button
                onClick={() => setSortBy('chat')}
                className={`rounded-full px-3 py-1 text-sm ${
                  sortBy === 'chat' ? 'bg-[#00a884] text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                By Chat
              </button>
            </div>
            {bookmarks.length > 0 && (
              <button onClick={handleClearAll} className="text-sm text-red-500 hover:text-red-700">
                Clear All
              </button>
            )}
          </div>
        </div>

        {/* Bookmarks list */}
        <div className="flex-1 overflow-y-auto">
          {filteredBookmarks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8">
              <Bookmark size={48} className="mb-2 text-gray-300" />
              {bookmarks.length === 0 ? (
                <>
                  <p className="font-medium">No saved messages yet</p>
                  <p className="text-sm text-center mt-1">
                    Long press on any message and tap "Save" to bookmark it
                  </p>
                </>
              ) : (
                <p>No messages match your search</p>
              )}
            </div>
          ) : sortBy === 'chat' ? (
            // Grouped by chat view
            <div className="p-4 space-y-4">
              {Object.entries(groupedByChat).map(([chatName, messages]) => (
                <div key={chatName}>
                  <div className="flex items-center gap-2 mb-2">
                    <MessageSquare size={16} className="text-gray-400" />
                    <p className="text-sm font-medium text-gray-700">{chatName}</p>
                    <span className="text-xs text-gray-400">({messages.length})</span>
                  </div>
                  <div className="space-y-2 ml-6">
                    {messages.map((bookmark) => (
                      <BookmarkItem
                        key={bookmark.id}
                        bookmark={bookmark}
                        onRemove={handleRemoveBookmark}
                        onNavigate={onNavigateToMessage}
                        formatDate={formatDate}
                        showChat={false}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // Recent view
            <div className="p-4 space-y-2">
              {filteredBookmarks.map((bookmark) => (
                <BookmarkItem
                  key={bookmark.id}
                  bookmark={bookmark}
                  onRemove={handleRemoveBookmark}
                  onNavigate={onNavigateToMessage}
                  formatDate={formatDate}
                  showChat={true}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Bookmark item component
function BookmarkItem({
  bookmark,
  onRemove,
  onNavigate,
  formatDate,
  showChat,
}: {
  bookmark: BookmarkedMessage;
  onRemove: (id: string) => void;
  onNavigate?: (chatId: string, messageId: string) => void;
  formatDate: (date: Date) => string;
  showChat: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 hover:border-[#00a884] transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {showChat && (
            <p className="text-xs text-[#00a884] font-medium mb-1">{bookmark.chatName}</p>
          )}
          <p className="text-sm text-gray-900 line-clamp-2">{bookmark.content}</p>
          {bookmark.note && (
            <p className="text-xs text-gray-500 mt-1 italic">Note: {bookmark.note}</p>
          )}
          <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
            <span>{bookmark.senderName}</span>
            <span>•</span>
            <span>{formatDate(bookmark.timestamp)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onNavigate && (
            <button
              onClick={() => onNavigate(bookmark.chatId, bookmark.messageId)}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-[#00a884]"
              title="Go to message"
            >
              <ExternalLink size={16} />
            </button>
          )}
          <button
            onClick={() => onRemove(bookmark.id)}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500"
            title="Remove bookmark"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper function to add a bookmark (export for use in MessageBubble)
export function addBookmark(message: {
  messageId: string;
  chatId: string;
  chatName: string;
  content: string;
  senderName: string;
  timestamp: Date;
  note?: string;
}) {
  const saved = localStorage.getItem('messageBookmarks');
  const bookmarks: BookmarkedMessage[] = saved ? JSON.parse(saved) : [];

  // Check if already bookmarked
  if (bookmarks.some((b) => b.messageId === message.messageId)) {
    return false;
  }

  const newBookmark: BookmarkedMessage = {
    id: Date.now().toString(),
    ...message,
  };

  bookmarks.push(newBookmark);
  localStorage.setItem('messageBookmarks', JSON.stringify(bookmarks));
  return true;
}

export function removeBookmark(messageId: string) {
  const saved = localStorage.getItem('messageBookmarks');
  if (!saved) return;

  const bookmarks: BookmarkedMessage[] = JSON.parse(saved);
  const updated = bookmarks.filter((b) => b.messageId !== messageId);
  localStorage.setItem('messageBookmarks', JSON.stringify(updated));
}

export function isBookmarked(messageId: string): boolean {
  const saved = localStorage.getItem('messageBookmarks');
  if (!saved) return false;

  const bookmarks: BookmarkedMessage[] = JSON.parse(saved);
  return bookmarks.some((b) => b.messageId === messageId);
}
