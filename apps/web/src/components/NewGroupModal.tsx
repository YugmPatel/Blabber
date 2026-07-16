import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Search, Loader2, Users, Check, Clock, Timer, Archive, Camera } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { apiClient, searchUsers, type UserSearchResult } from '@/api/client';
import { chatKeys, useChats } from '@/hooks/useChats';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useAuth } from '@/contexts/AuthContext';
import type { Chat, User } from '@repo/types';
import { formatDisplayName, formatUserSubtitle } from '@/utils/user-display';

interface NewGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExpirationOption = '1hour' | '24hours' | '3days' | '1week' | 'custom';
type TemporaryCompletionBehavior = 'end_only' | 'end_and_delete';

const expirationOptions: { value: ExpirationOption; label: string; ms?: number }[] = [
  { value: '1hour', label: '1 hour', ms: 60 * 60 * 1000 },
  { value: '24hours', label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { value: '3days', label: '3 days', ms: 3 * 24 * 60 * 60 * 1000 },
  { value: '1week', label: '1 week', ms: 7 * 24 * 60 * 60 * 1000 },
  { value: 'custom', label: 'Custom' },
];

const SEARCH_MIN_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

type GroupCandidate = Pick<User, '_id' | 'username' | 'email' | 'name' | 'avatarUrl' | 'profileHandle'> & {
  displayHandle?: string;
};

function userSearchResultToCandidate(user: UserSearchResult): GroupCandidate {
  return {
    _id: user.id,
    username: user.username,
    email: '',
    name: user.displayName,
    avatarUrl: user.avatarUrl,
    profileHandle: user.profileHandle,
    displayHandle: user.displayHandle || undefined,
  };
}

function profileToCandidate(profile: NonNullable<Chat['participantProfiles']>[number]): GroupCandidate {
  return {
    _id: profile._id,
    username: profile.username || '',
    email: profile.email || '',
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    profileHandle: profile.profileHandle,
    displayHandle: profile.displayHandle,
  };
}

export default function NewGroupModal({ isOpen, onClose }: NewGroupModalProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<'select' | 'details'>('select');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [isTemporary, setIsTemporary] = useState(false);
  const [expiration, setExpiration] = useState<ExpirationOption>('24hours');
  const [temporaryCompletionBehavior, setTemporaryCompletionBehavior] = useState<TemporaryCompletionBehavior>('end_only');
  const [customExpirationDate, setCustomExpirationDate] = useState('');
  const [disappearingMessages, setDisappearingMessages] = useState(false);
  const [disappearingDuration, setDisappearingDuration] = useState<'24h' | '7d' | '90d'>('24h');
  const [groupAvatar, setGroupAvatar] = useState<string>('');
  const [groupAvatarUrl, setGroupAvatarUrl] = useState<string>('');
  const [avatarUploadError, setAvatarUploadError] = useState<string>('');
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const { uploadMedia } = useFileUpload();
  const { data: chats = [], isLoading: isLoadingChats } = useChats();

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearchQuery(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const getExpirationDate = (): Date | null => {
    if (!isTemporary) return null;
    if (expiration === 'custom' && customExpirationDate) {
      return new Date(customExpirationDate);
    }
    const option = expirationOptions.find((o) => o.value === expiration);
    if (option?.ms) {
      return new Date(Date.now() + option.ms);
    }
    return null;
  };

  const selectedIds = useMemo(() => new Set(selectedUsers.map((user) => user._id)), [selectedUsers]);
  const searchEnabled = isOpen && debouncedSearchQuery.length >= SEARCH_MIN_LENGTH;
  const searchResults = useQuery({
    queryKey: ['user-search', debouncedSearchQuery],
    queryFn: () => searchUsers(debouncedSearchQuery),
    enabled: searchEnabled,
  });
  const recentCandidates = useMemo(() => {
    const byId = new Map<string, GroupCandidate>();
    chats.forEach((chat) => {
      (chat.participantProfiles || []).forEach((profile) => {
        if (profile._id === currentUser?._id) return;
        if (!byId.has(profile._id)) byId.set(profile._id, profileToCandidate(profile));
      });
    });
    return Array.from(byId.values()).slice(0, 30);
  }, [chats, currentUser?._id]);
  const eligibleUsers = useMemo(() => {
    // Group invites are governed by the backend's groupInvitePrivacy check
    // (services/chats/src/contact-privacy.ts canAddToGroup), which defaults
    // to 'everyone' and is independent from messagePrivacy/canMessage (used
    // for direct-chat eligibility, defaults to 'followers'). Filtering
    // candidates by canMessage here was hiding users who are perfectly
    // addable to a group but haven't been messaged/followed — the same
    // search results New Convo already shows in full. Any group-invite
    // restriction still gets enforced server-side on create, surfaced via
    // createGroupErrorMessage.
    const source = searchEnabled
      ? (searchResults.data?.users || []).map(userSearchResultToCandidate)
      : recentCandidates;
    const byId = new Map<string, GroupCandidate>();
    source.forEach((user) => {
      if (!user._id || user._id === currentUser?._id || selectedIds.has(user._id)) return;
      if (!byId.has(user._id)) byId.set(user._id, user);
    });
    return Array.from(byId.values());
  }, [currentUser?._id, recentCandidates, searchEnabled, searchResults.data?.users, selectedIds]);
  const isSearching = searchEnabled ? searchResults.isLoading : isLoadingChats;

  // Create group mutation
  const createGroupMutation = useMutation({
    mutationFn: async (): Promise<Chat> => {
      if (!currentUser?._id) {
        throw new Error('User not authenticated');
      }

      const participantIds = Array.from(
        new Set([currentUser._id, ...selectedUsers.map((u) => u._id)].filter(Boolean))
      );

      const payload = {
        type: 'group',
        participantIds,
        title: groupName.trim() || 'New Group',
        description: groupDescription.trim() || undefined,
        ...(groupAvatarUrl ? { avatarUrl: groupAvatarUrl } : {}),
        groupKind: isTemporary ? 'temporary' : 'standard',
        temporaryCompletionBehavior: isTemporary ? temporaryCompletionBehavior : undefined,
        expiresAt: getExpirationDate()?.toISOString(),
      };

      const response = await apiClient.post<{ chat: Chat }>('/api/chats', payload);
      return response.data.chat;
    },
    onSuccess: (chat) => {
      // Insert the real, server-confirmed chat directly into every cached
      // chat-list query so it appears instantly regardless of invalidation/
      // refetch timing, and seed its own detail cache so the chat page it's
      // about to navigate to doesn't need a fresh fetch to render.
      queryClient.getQueryCache().findAll({ queryKey: chatKeys.lists() }).forEach((query) => {
        queryClient.setQueryData<Chat[]>(query.queryKey, (old) => {
          if (!old) return old;
          if (old.some((existing) => existing._id === chat._id)) return old;
          return [chat, ...old];
        });
      });
      queryClient.setQueryData(chatKeys.detail(chat._id), chat);
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
      handleClose();
      navigate(`/chats/${chat._id}`);
    },
  });

  const handleUserToggle = (user: GroupCandidate) => {
    setSelectedUsers((prev) => {
      const isSelected = prev.some((u) => u._id === user._id);
      if (isSelected) {
        return prev.filter((u) => u._id !== user._id);
      }
      return [...prev, user as User];
    });
  };

  const handleClose = () => {
    setStep('select');
    setSearchQuery('');
    setDebouncedSearchQuery('');
    setSelectedUsers([]);
    setGroupName('');
    setGroupDescription('');
    setIsTemporary(false);
    setExpiration('24hours');
    setTemporaryCompletionBehavior('end_only');
    setCustomExpirationDate('');
    setDisappearingMessages(false);
    setGroupAvatar('');
    setGroupAvatarUrl('');
    setAvatarUploadError('');
    setIsUploadingAvatar(false);
    onClose();
  };

  const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be less than 5MB');
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onload = (event) => {
      setGroupAvatar(event.target?.result as string);
    };
    reader.readAsDataURL(file);

    setIsUploadingAvatar(true);
    setAvatarUploadError('');
    const uploaded = await uploadMedia?.(file);
    if (uploaded?.mediaUrl || uploaded?.publicUrl) {
      setGroupAvatarUrl(uploaded.mediaUrl || uploaded.publicUrl || '');
    } else {
      setGroupAvatarUrl('');
      setAvatarUploadError('We could not upload this group photo. Try again.');
    }
    setIsUploadingAvatar(false);

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
    if (!groupName.trim() || isUploadingAvatar) return;
    if (isTemporary && !getExpirationDate()) return;
    createGroupMutation.mutate();
  };

  const createGroupErrorMessage = createGroupMutation.error
    ? axios.isAxiosError(createGroupMutation.error)
      ? createGroupMutation.error.response?.data?.message || createGroupMutation.error.message
      : createGroupMutation.error instanceof Error
        ? createGroupMutation.error.message
        : 'Failed to create group. Please try again.'
    : '';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex w-full flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-center gap-3">
            {step === 'details' && (
              <button
                onClick={handleBack}
                className="rounded-lg p-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <svg
                  className="h-5 w-5 text-slate-600 dark:text-slate-400"
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
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Create Group
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X size={20} className="text-slate-600 dark:text-slate-400" />
          </button>
        </div>

        {step === 'select' ? (
          <>
            {/* Selected users chips */}
            {selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3 dark:border-slate-700">
                {selectedUsers.map((user) => (
                  <div
                    key={user._id}
                    className="flex items-center gap-1 rounded-full bg-[#0f766e] px-3 py-1 text-sm text-white"
                  >
                    <span>{formatDisplayName(user)}</span>
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
            <div className="border-b border-slate-200 p-4 dark:border-slate-700">
              <div className="mb-3 flex items-center gap-6 text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
                <span className="text-[#0f766e]">Basics</span>
                <span>Members</span>
                <span>Description</span>
              </div>
              <div className="relative">
                <Search
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  placeholder="Search people you can message..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-400 dark:focus:border-teal-500"
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

              {!isSearching && searchEnabled && searchResults.isError && (
                <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                  <p className="font-medium text-slate-700 dark:text-slate-300">Search failed</p>
                  <p className="mt-1 text-xs">Please try again in a moment.</p>
                </div>
              )}

              {!isSearching && searchEnabled && !searchResults.isError && eligibleUsers.length === 0 && (
                <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                  <p>No people found</p>
                </div>
              )}

              {!isSearching && !searchEnabled && searchQuery.trim().length > 0 && searchQuery.trim().length < SEARCH_MIN_LENGTH && (
                <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                  <p>Keep typing to search</p>
                </div>
              )}

              {!isSearching && !searchQuery && eligibleUsers.length === 0 && (
                <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                  <Users size={48} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                  <p>Select people from your conversations</p>
                </div>
              )}

              {!isSearching && eligibleUsers.length > 0 && (
                <div className="space-y-2">
                  {eligibleUsers
                    .map((user) => {
                      const isSelected = selectedUsers.some((u) => u._id === user._id);
                      return (
                        <button
                          key={user._id}
                          onClick={() => handleUserToggle(user)}
                          className="flex w-full items-center gap-3 rounded-xl border border-transparent p-3 text-left transition-colors hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800/70"
                        >
                          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#00a884] font-semibold text-white">
                            {formatDisplayName(user)[0]?.toUpperCase() || '?'}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-slate-900 dark:text-white">
                              {formatDisplayName(user)}
                            </p>
                            {formatUserSubtitle(user, user.email) && (
                              <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                                {formatUserSubtitle(user, user.email)}
                              </p>
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
            <div className="border-t border-slate-200 p-4 dark:border-slate-700">
              <button
                onClick={handleNext}
                disabled={selectedUsers.length < 1}
                className="w-full rounded-xl bg-slate-900 py-2.5 font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
              >
                Next ({selectedUsers.length} selected)
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Group details */}
            <div className="flex-1 overflow-y-auto p-6">
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
                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800">
                      <Users size={40} className="text-slate-500 dark:text-slate-400" />
                    </div>
                  )}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingAvatar}
                    className="absolute bottom-0 right-0 p-2 bg-[#00a884] rounded-full text-white hover:bg-[#008f72] transition-colors disabled:bg-gray-400"
                    aria-label="Upload group photo"
                  >
                    {isUploadingAvatar ? (
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
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Add group icon</p>
                {avatarUploadError && (
                  <p className="mt-2 max-w-xs text-center text-xs text-rose-600 dark:text-rose-400">
                    {avatarUploadError}
                  </p>
                )}
              </div>

              {/* Group name input */}
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Group Name</label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Enter group name..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-[#99f6e4] dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-400 dark:focus:border-teal-500"
                  autoFocus
                />
              </div>

              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Description</label>
                <textarea
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  placeholder="What is this group for?"
                  maxLength={500}
                  className="min-h-20 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-[#99f6e4] dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-400 dark:focus:border-teal-500"
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Describe what this group is for. Blabber uses this to help members and improve summaries, actions, and group memory.
                </p>
              </div>

              {/* Members preview */}
              <div className="mb-4">
                <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                  Members ({selectedUsers.length + 1})
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    You
                  </span>
                  {selectedUsers.map((user) => (
                    <span
                      key={user._id}
                      className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      {formatDisplayName(user)}
                    </span>
                  ))}
                </div>
              </div>

              {/* Temporary Group Toggle */}
              <div className="mb-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100">
                      <Timer size={20} className="text-orange-600" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">Temporary Group</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Ends at a set time, then becomes read-only</p>
                    </div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={isTemporary}
                    onClick={() => setIsTemporary(!isTemporary)}
                    className={`relative h-6 w-11 flex-shrink-0 overflow-hidden rounded-full transition-colors ${
                      isTemporary ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  >
                    <span
                      className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        isTemporary ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                {isTemporary && (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Group expires in:</p>
                    <div className="flex flex-wrap gap-2">
                      {expirationOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setExpiration(option.value)}
                          className={`rounded-full px-3 py-1 text-sm transition-colors ${
                            expiration === option.value
                              ? 'bg-orange-500 text-white'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    {expiration === 'custom' && (
                      <input
                        type="datetime-local"
                        aria-label="Custom expiration date and time"
                        value={customExpirationDate}
                        min={new Date().toISOString().slice(0, 16)}
                        onChange={(e) => setCustomExpirationDate(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-orange-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    )}
                    {getExpirationDate() && (
                      <div className="flex items-center gap-2 rounded-lg bg-orange-50 p-2 text-sm text-orange-700">
                        <Archive size={16} />
                        <span>
                          Group will end on{' '}
                          {getExpirationDate()?.toLocaleString(undefined, {
                            weekday: 'long',
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">When it ends:</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {([
                          ['end_only', 'End only', 'Keep it readable and disable new messages.'],
                          ['end_and_delete', 'End and delete', 'Remove it from active convo lists.'],
                        ] as const).map(([value, label, description]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setTemporaryCompletionBehavior(value)}
                            className={`rounded-xl border px-3 py-2 text-left transition ${
                              temporaryCompletionBehavior === value
                                ? 'border-orange-400 bg-orange-50 text-orange-900 dark:border-orange-500/70 dark:bg-orange-500/15 dark:text-orange-100'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-orange-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                            }`}
                          >
                            <span className="block text-sm font-semibold">{label}</span>
                            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{description}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Disappearing Messages Toggle */}
              <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100">
                      <Clock size={20} className="text-purple-600" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">Disappearing Messages</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Messages auto-delete</p>
                    </div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={disappearingMessages}
                    onClick={() => setDisappearingMessages(!disappearingMessages)}
                    className={`relative h-6 w-11 flex-shrink-0 overflow-hidden rounded-full transition-colors ${
                      disappearingMessages ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  >
                    <span
                      className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        disappearingMessages ? 'translate-x-[22px]' : 'translate-x-0.5'
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
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
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
            <div className="border-t border-slate-200 p-4 dark:border-slate-700">
              <button
                onClick={handleCreate}
                disabled={createGroupMutation.isPending || isUploadingAvatar || !groupName.trim() || (isTemporary && !getExpirationDate())}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
              >
                {createGroupMutation.isPending ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    Creating...
                  </>
                ) : isUploadingAvatar ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    Uploading photo...
                  </>
                ) : (
                  'Create Group'
                )}
              </button>
            </div>

            {/* Error */}
            {createGroupMutation.isError && (
              <div className="border-t border-slate-200 p-4 dark:border-slate-700">
                <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  {createGroupErrorMessage}
                </div>
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  );
}
