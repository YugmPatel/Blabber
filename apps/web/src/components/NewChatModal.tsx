import { useState, type FormEvent } from 'react';
import { X, Search, Loader2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { chatKeys } from '@/hooks/useChats';
import { useAuth } from '@/contexts/AuthContext';
import type { User } from '@repo/types';

interface NewChatModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NewChatModal({ isOpen, onClose }: NewChatModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  // Search users
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['users', 'search', searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return { users: [] };
      const response = await apiClient.get(`/api/users/search?q=${searchQuery}`);
      return response.data;
    },
    enabled: searchQuery.trim().length > 0,
  });

  // Create chat mutation
  const createChatMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!currentUser?._id) {
        throw new Error('User not authenticated');
      }
      const currentUserId = currentUser._id;

      // Check if chat already exists
      const chatsResponse = await apiClient.get('/api/chats');
      const chats = chatsResponse.data.chats || [];
      const existingChat = chats.find(
        (chat: any) =>
          chat.type === 'direct' &&
          chat.participants.length === 2 &&
          chat.participants.includes(currentUserId) &&
          chat.participants.includes(userId)
      );

      if (existingChat) {
        // Chat already exists, just return it
        return { chat: existingChat };
      }

      // Create new chat
      const response = await apiClient.post('/api/chats', {
        type: 'direct',
        participantIds: [currentUserId, userId],
      });
      return response.data;
    },
    onSuccess: () => {
      // Invalidate chats to refetch the list
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
      onClose();
      setSearchQuery('');
    },
  });

  const handleUserSelect = (userId: string) => {
    createChatMutation.mutate(userId);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">New Chat</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <X size={20} className="text-gray-600" />
          </button>
        </div>

        {/* Search Input */}
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <Search
              size={18}
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              placeholder="Search users by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              autoFocus
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {isSearching && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="text-gray-400 animate-spin" />
            </div>
          )}

          {!isSearching && searchQuery && searchResults?.users?.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <p>No users found</p>
              <p className="text-sm text-gray-400 mt-1">Try a different search term</p>
            </div>
          )}

          {!isSearching && !searchQuery && (
            <div className="text-center py-8 text-gray-500">
              <Search size={48} className="mx-auto mb-2 text-gray-300" />
              <p>Search for users to start a chat</p>
            </div>
          )}

          {!isSearching && searchResults?.users && searchResults.users.length > 0 && (
            <div className="space-y-2">
              {searchResults.users.map((user: User) => (
                <button
                  key={user._id}
                  onClick={() => handleUserSelect(user._id)}
                  disabled={createChatMutation.isPending}
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {/* Avatar */}
                  <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center text-white font-semibold flex-shrink-0">
                    {user.username?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
                  </div>

                  {/* User Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {user.username || user.email}
                    </p>
                    {user.username && (
                      <p className="text-sm text-gray-500 truncate">{user.email}</p>
                    )}
                  </div>

                  {createChatMutation.isPending && (
                    <Loader2 size={20} className="text-gray-400 animate-spin" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Error Message */}
        {createChatMutation.isError && (
          <div className="p-4 border-t border-gray-200">
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              Failed to create chat. Please try again.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
