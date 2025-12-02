import { useState, useRef } from 'react';
import { X, Search, Loader2, Users, Check, Clock, Timer, Trash2, Camera } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { chatKeys } from '@/hooks/useChats';
import { useAuth } from '@/contexts/AuthContext';
import { useFileUpload } from '@/hooks/useFileUpload';
import type { User } from '@repo/types';

interface NewGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExpirationOption = 'never' | '1day' | '3days' | '1week' | '2weeks' | '1month' | 'custom';

const expirationOptions: { value: ExpirationOption; label: string; days?: number }[] = [
  { value: 'never', label: 'Never (Permanent)' },
  { value: '1day', label: '1 Day', days: 1 },
  { value: '3days', label: '3 Days', days: 3 },
  { value: '1week', label: '1 Week', days: 7 },
  { value: '2weeks', label: '2 Weeks', days: 14 },
  { value: '1month', label: '1 Month', days: 30 },
  { value: 'custom', label: 'Custom Date' },
];

export default function NewGroupModal({ isOpen, onClose }: NewGroupModalProps) {
  const [step, setStep] = useState<'select' | 'details'>('select');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [groupName, setGroupName] = useState('');
  const [isTemporary, setIsTemporary] = useState(false);
  const [expiration, setExpiration] = useState<ExpirationOption>('1week');
  const [customExpirationDate, setCustomExpirationDate] = useState('');
  const [disappearingMessages, setDisappearingMessages] = useState(false);
  const [disappearingDuration, setDisappearingDuration] = useState<'24h' | '7d' | '90d'>('24h');
  const [groupAvatar, setGroupAvatar] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const { uploadFile, isUploading } = useFileUpload();

  const getExpirationDate = (): Date | null => {
    if (!isTemporary) return null;
    if (expiration === 'never') return null;
    if (expiration === 'custom' && customExpirationDate) {
      return new Date(customExpirationDate);
    }
    const option = expirationOptions.find((o) => o.value === expiration);
    if (option?.days) {
      const date = new Date();
      date.setDate(date.getDate() + option.days);
      return date;
    }
    return null;
  };

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

  // Create group mutation
  const createGroupMutation = useMutation({
    mutationFn: async () => {
      if (!currentUser?._id) {
        throw new Error('User not authenticated');
      }

      const participantIds = [currentUser._id, ...selectedUsers.map((u) => u._id)];

      const response = await apiClient.post('/api/chats', {
        type: 'group',
        participantIds,
        title: groupName.trim() || 'New Group',
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
      handleClose();
    },
  });

  const handleUserToggle = (user: User) => {
    setSelectedUsers((prev) => {
      const isSelected = prev.some((u) => u._id === user._id);
      if (isSelected) {
        return prev.filter((u) => u._id !== user._id);
      }
      return [...prev, user];
    });
  };

  const handleClose = () => {
    setStep('select');
    setSearchQuery('');
    setSelectedUsers([]);
    setGroupName('');
    setIsTemporary(false);
    setExpiration('1week');
    setCustomExpirationDate('');
    setDisappearingMessages(false);
    setGroupAvatar('');
    onClose();
  };

  const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onload = (event) => {
      setGroupAvatar(event.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload to server (in production)
    await uploadFile(file);

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleNext = () => {
    if (selectedUsers.length >= 1) {
      setStep('details');
    }
  };

  const handleBack = () => {
    setStep('select');
  };

  const handleCreate = () => {
    createGroupMutation.mutate();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div className="flex items-center gap-3">
            {step === 'details' && (
              <button
                onClick={handleBack}
                className="rounded-lg p-1 transition-colors hover:bg-gray-100"
              >
                <svg
                  className="h-5 w-5 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
            )}
            <h2 className="text-lg font-semibold text-gray-900">
              {step === 'select' ? 'Add Group Members' : 'New Group'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 transition-colors hover:bg-gray-100"
            aria-label="Close"
          >
            <X size={20} className="text-gray-600" />
          </button>
        </div>

        {step === 'select' ? (
          <>
            {/* Selected users chips */}
            {selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-2 border-b border-gray-200 p-3">
                {selectedUsers.map((user) => (
                  <div
                    key={user._id}
                    className="flex items-center gap-1 rounded-full bg-[#00a884] px-3 py-1 text-sm text-white"
                  >
                    <span>{user.username || user.email}</span>
                    <button
                      onClick={() => handleUserToggle(user)}
                      className="ml-1 rounded-full hover:bg-white/20"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Search Input */}
            <div className="border-b border-gray-200 p-4">
              <div className="relative">
                <Search
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#00a884]"
                  autoFocus
                />
              </div>
            </div>

            {/* User list */}
            <div className="flex-1 overflow-y-auto p-4">
              {isSearching && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-gray-400" />
                </div>
              )}

              {!isSearching && searchQuery && searchResults?.users?.length === 0 && (
                <div className="py-8 text-center text-gray-500">
                  <p>No users found</p>
                </div>
              )}

              {!isSearching && !searchQuery && (
                <div className="py-8 text-center text-gray-500">
                  <Users size={48} className="mx-auto mb-2 text-gray-300" />
                  <p>Search for users to add to group</p>
                </div>
              )}

              {!isSearching && searchResults?.users && searchResults.users.length > 0 && (
                <div className="space-y-2">
                  {searchResults.users
                    .filter((user: User) => user._id !== currentUser?._id)
                    .map((user: User) => {
                      const isSelected = selectedUsers.some((u) => u._id === user._id);
                      return (
                        <button
                          key={user._id}
                          onClick={() => handleUserToggle(user)}
                          className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-gray-50"
                        >
                          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#00a884] font-semibold text-white">
                            {user.username?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-gray-900">
                              {user.username || user.email}
                            </p>
                            {user.username && (
                              <p className="truncate text-sm text-gray-500">{user.email}</p>
                            )}
                          </div>
                          <div
                            className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                              isSelected ? 'border-[#00a884] bg-[#00a884]' : 'border-gray-300'
                            }`}
                          >
                            {isSelected && <Check size={14} className="text-white" />}
                          </div>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Next button */}
            <div className="border-t border-gray-200 p-4">
              <button
                onClick={handleNext}
                disabled={selectedUsers.length < 1}
                className="w-full rounded-lg bg-[#00a884] py-2 font-medium text-white transition-colors hover:bg-[#008f72] disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                Next ({selectedUsers.length} selected)
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Group details */}
            <div className="flex-1 p-6 overflow-y-auto">
              {/* Group icon with upload */}
              <div className="mb-6 flex flex-col items-center">
                <div className="relative">
                  {groupAvatar ? (
                    <img
                      src={groupAvatar}
                      alt="Group"
                      className="h-24 w-24 rounded-full object-cover border-4 border-[#00a884]"
                    />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gray-200">
                      <Users size={40} className="text-gray-500" />
                    </div>
                  )}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="absolute bottom-0 right-0 p-2 bg-[#00a884] rounded-full text-white hover:bg-[#008f72] transition-colors disabled:bg-gray-400"
                  >
                    {isUploading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Camera size={16} />
                    )}
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarSelect}
                  className="hidden"
                />
                <p className="text-xs text-gray-500 mt-2">Add group icon</p>
              </div>

              {/* Group name input */}
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-gray-700">Group Name</label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Enter group name..."
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#00a884]"
                  autoFocus
                />
              </div>

              {/* Members preview */}
              <div className="mb-4">
                <p className="mb-2 text-sm font-medium text-gray-700">
                  Members ({selectedUsers.length + 1})
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                    You
                  </span>
                  {selectedUsers.map((user) => (
                    <span
                      key={user._id}
                      className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
                    >
                      {user.username || user.email}
                    </span>
                  ))}
                </div>
              </div>

              {/* Temporary Group Toggle */}
              <div className="mb-4 rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100">
                      <Timer size={20} className="text-orange-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Temporary Group</p>
                      <p className="text-sm text-gray-500">Auto-delete after set time</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsTemporary(!isTemporary)}
                    className={`relative h-6 w-11 rounded-full transition-colors ${
                      isTemporary ? 'bg-[#00a884]' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        isTemporary ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                {isTemporary && (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm font-medium text-gray-700">Group expires in:</p>
                    <div className="flex flex-wrap gap-2">
                      {expirationOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setExpiration(option.value)}
                          className={`rounded-full px-3 py-1 text-sm transition-colors ${
                            expiration === option.value
                              ? 'bg-orange-500 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    {expiration === 'custom' && (
                      <input
                        type="date"
                        value={customExpirationDate}
                        min={new Date().toISOString().split('T')[0]}
                        onChange={(e) => setCustomExpirationDate(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-orange-500 focus:outline-none"
                      />
                    )}
                    {getExpirationDate() && (
                      <div className="flex items-center gap-2 rounded-lg bg-orange-50 p-2 text-sm text-orange-700">
                        <Trash2 size={16} />
                        <span>
                          Group will be deleted on{' '}
                          {getExpirationDate()?.toLocaleDateString('en-US', {
                            weekday: 'long',
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Disappearing Messages Toggle */}
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100">
                      <Clock size={20} className="text-purple-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Disappearing Messages</p>
                      <p className="text-sm text-gray-500">Messages auto-delete</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setDisappearingMessages(!disappearingMessages)}
                    className={`relative h-6 w-11 rounded-full transition-colors ${
                      disappearingMessages ? 'bg-[#00a884]' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        disappearingMessages ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                {disappearingMessages && (
                  <div className="mt-4 flex gap-2">
                    {(['24h', '7d', '90d'] as const).map((duration) => (
                      <button
                        key={duration}
                        onClick={() => setDisappearingDuration(duration)}
                        className={`flex-1 rounded-lg py-2 text-sm transition-colors ${
                          disappearingDuration === duration
                            ? 'bg-purple-500 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {duration === '24h' ? '24 Hours' : duration === '7d' ? '7 Days' : '90 Days'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Create button */}
            <div className="border-t border-gray-200 p-4">
              <button
                onClick={handleCreate}
                disabled={createGroupMutation.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#00a884] py-2 font-medium text-white transition-colors hover:bg-[#008f72] disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {createGroupMutation.isPending ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Group'
                )}
              </button>
            </div>

            {/* Error */}
            {createGroupMutation.isError && (
              <div className="border-t border-gray-200 p-4">
                <div className="rounded bg-red-50 px-4 py-3 text-red-700">
                  Failed to create group. Please try again.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
