import { useState, useRef, useEffect, useMemo } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, FolderOpen, Pin, Users, Phone, Video, Search, MoreVertical, X, Sparkles, Crown, Shield, UserPlus, Trash2, Camera, Loader2 } from 'lucide-react';
import type { Chat, User } from '@repo/types';
import Avatar from './Avatar';
import GroupCallModal, { createGroupCallId } from './GroupCallModal';
import { useAuth } from '@/contexts/AuthContext';
import {
  apiClient,
  blockUser,
  createReport,
  fetchGroupModerationActivity,
  moderationRemoveGroupMember,
  restrictGroupMember,
  searchChatMessages,
  unrestrictGroupMember,
  updateGroupModerationSettings,
  updateGroupIntelligenceSettings,
} from '@/api/client';
import { useAppStore } from '@/store/app-store';
import { useFileUpload } from '@/hooks/useFileUpload';
import {
  useAddMember,
  useDeleteGroup,
  useDemoteMember,
  useLeaveGroup,
  useCreateInviteLink,
  usePromoteMember,
  useInviteLinkSettings,
  useRegenerateInviteLink,
  useRevokeInviteLink,
  useTransferOwnership,
  useUpdateChat,
} from '@/hooks/useChats';
import type { InviteExpiry, InviteMaxUses } from '@/api/client';
import { useSearchUsers } from '@/hooks/useUsers';

interface ChatHeaderProps {
  chat: Chat;
  getChatTitle: (chat: Chat) => string;
  getChatAvatar: (chat: Chat) => string | undefined;
  onlineStatus?: { online: boolean; lastSeen: Date | null } | null;
  isGroupChat: boolean;
  onOpenIntelligence?: () => void;
  intelligenceEnabled?: boolean;
  onJumpToMessage?: (messageId: string) => void;
  pinnedCount?: number;
  onOpenPins?: () => void;
  onOpenShared?: () => void;
  onArchiveChat?: () => void;
  onUnarchiveChat?: () => void;
  isArchived?: boolean;
}

type DisplayUser = Partial<User> & { _id: string };

function getUserTitle(user: DisplayUser | undefined, fallback = 'User') {
  return user?.name || user?.username || user?.email || fallback;
}

function getUserMeta(user: DisplayUser | undefined) {
  return [user?.email, user?.username ? `@${user.username}` : ''].filter(Boolean).join(' • ');
}

function UserProfileModal({
  user,
  onClose,
}: {
  user: DisplayUser | null;
  onClose: () => void;
}) {
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!user) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [user, onClose]);

  if (!user) return null;

  const runTrustAction = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      setNotice(success);
    } catch (error: any) {
      setNotice(error?.response?.data?.message || error?.message || 'Action failed');
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center">
          <Avatar src={user.avatarUrl} alt={getUserTitle(user)} size="xl" />
          <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">
            {getUserTitle(user)}
          </h3>
          {getUserMeta(user) && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{getUserMeta(user)}</p>
          )}
          {user.about && (
            <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {user.about}
            </p>
          )}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          >
            Message
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button
            onClick={() => runTrustAction(() => blockUser(user._id), 'User blocked.')}
            className="rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Block
          </button>
          <button
            onClick={() => runTrustAction(() => createReport({ targetType: 'user', targetId: user._id, reason: 'User report' }), 'Report submitted.')}
            className="rounded-xl border border-rose-200 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
          >
            Report
          </button>
        </div>
        {notice && <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">{notice}</p>}
      </div>
    </div>
  );
}

function GroupInfoModal({
  isOpen,
  onClose,
  chat,
  title,
  avatarUrl,
  members,
  currentUserId,
  onSelectMember,
}: {
  isOpen: boolean;
  onClose: () => void;
  chat: Chat;
  title: string;
  avatarUrl?: string;
  members: DisplayUser[];
  currentUserId?: string;
  onSelectMember: (user: DisplayUser) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ownerId = chat.ownerId || chat.admins?.[0];
  const adminIds = new Set(chat.admins || []);
  const isOwner = ownerId === currentUserId;
  const isAdmin = Boolean(currentUserId && adminIds.has(currentUserId));
  const canEdit = isOwner || isAdmin;
  const [editTitle, setEditTitle] = useState(title);
  const [editDescription, setEditDescription] = useState(chat.description || chat.groupContext || '');
  const [memberQuery, setMemberQuery] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const updateChat = useUpdateChat(chat._id);
  const { uploadMedia, isUploading: isUploadingGroupAvatar } = useFileUpload();
  const addMember = useAddMember(chat._id);
  const promoteMember = usePromoteMember(chat._id);
  const demoteMember = useDemoteMember(chat._id);
  const transferOwnership = useTransferOwnership(chat._id);
  const leaveGroup = useLeaveGroup(chat._id);
  const deleteGroup = useDeleteGroup(chat._id);
  const inviteSettings = useInviteLinkSettings(chat._id, isOpen && canEdit && chat.type === 'group');
  const createInvite = useCreateInviteLink(chat._id);
  const regenerateInvite = useRegenerateInviteLink(chat._id);
  const revokeInvite = useRevokeInviteLink(chat._id);
  const { data: searchUsers = [], isFetching: isSearching } = useSearchUsers(memberQuery.trim());
  const memberIds = new Set(members.map((member) => member._id));
  const availableUsers = searchUsers.filter((user) => !memberIds.has(user._id));
  const selectedUsers = searchUsers.filter((user) => selectedMemberIds.includes(user._id));
  const [inviteExpiry, setInviteExpiry] = useState<InviteExpiry>('never');
  const [inviteMaxUses, setInviteMaxUses] = useState<InviteMaxUses>('unlimited');
  const [latestInviteUrl, setLatestInviteUrl] = useState('');
  const moderationActivity = useQuery({
    queryKey: ['group-moderation-activity', chat._id],
    queryFn: () => fetchGroupModerationActivity(chat._id),
    enabled: isOpen && canEdit && chat.type === 'group',
  });
  const restrictedIds = new Set((chat.memberRestrictions || []).map((restriction) => restriction.userId));

  useEffect(() => {
    setEditTitle(title);
    setEditDescription(chat.description || chat.groupContext || '');
  }, [title, chat.description, chat.groupContext, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const createdAt = chat.createdAt ? new Date(chat.createdAt) : null;
  const expiresAt = chat.expiresAt ? new Date(chat.expiresAt) : null;
  const submit = async (action: () => Promise<unknown>, success: string) => {
    setNotice(null);
    try {
      await action();
      setNotice(success);
    } catch (error: any) {
      setNotice(error?.response?.data?.message || error?.message || 'Something went wrong');
    }
  };

  const saveDetails = () => submit(
    async () => {
      await updateChat.mutateAsync({
        title: editTitle.trim() || title,
        description: editDescription.trim(),
      });
    },
    'Group details updated.'
  );

  const updateGroupAvatar = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setNotice('Choose an image file for the group photo.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setNotice('This group photo is too large.');
      return;
    }

    await submit(async () => {
      const uploaded = await uploadMedia?.(file);
      const nextAvatarUrl = uploaded?.mediaUrl || uploaded?.publicUrl;
      if (!nextAvatarUrl) {
        throw new Error('We could not upload this group photo. Try again.');
      }
      await updateChat.mutateAsync({ avatarUrl: nextAvatarUrl });
    }, 'Group photo updated.');
  };

  const removeGroupAvatar = () => submit(
    async () => {
      await updateChat.mutateAsync({ avatarUrl: '' });
    },
    'Group photo removed.'
  );

  const addSelectedMembers = () => submit(
    async () => {
      for (const userId of selectedMemberIds) {
        await addMember.mutateAsync(userId);
      }
      setSelectedMemberIds([]);
      setMemberQuery('');
    },
    'Members added.'
  );

  const buildInviteUrl = (token: string) => `${window.location.origin}/join/${encodeURIComponent(token)}`;

  const createInviteLink = () => submit(async () => {
    const result = await createInvite.mutateAsync({ expiresIn: inviteExpiry, maxUses: inviteMaxUses });
    setLatestInviteUrl(buildInviteUrl(result.token));
  }, 'Invite link created.');

  const regenerateInviteLink = () => submit(async () => {
    if (!window.confirm('Regenerating this link will immediately invalidate the previous link.')) return;
    const result = await regenerateInvite.mutateAsync({ expiresIn: inviteExpiry, maxUses: inviteMaxUses });
    setLatestInviteUrl(buildInviteUrl(result.token));
  }, 'Invite link regenerated.');

  const revokeInviteLink = () => submit(async () => {
    if (!window.confirm('Revoking this link prevents anyone new from joining with it.')) return;
    await revokeInvite.mutateAsync();
    setLatestInviteUrl('');
  }, 'Invite link revoked.');

  const copyInviteLink = () => submit(async () => {
    if (!latestInviteUrl) {
      throw new Error('Regenerate the invite link to copy a fresh URL.');
    }
    await navigator.clipboard.writeText(latestInviteUrl);
  }, 'Invite link copied.');

  const reportGroup = () => submit(async () => {
    await createReport({ targetType: 'group', targetId: chat._id, reason: 'Group report' });
  }, 'Group report submitted.');

  const setSendMode = (sendMode: 'everyone' | 'admins_only') => submit(async () => {
    await updateGroupModerationSettings(chat._id, sendMode);
    queryClient.invalidateQueries({ queryKey: ['chats'] });
  }, 'Send permissions updated.');

  const setAiEnabled = (aiEnabled: boolean) => submit(async () => {
    await updateGroupIntelligenceSettings(chat._id, aiEnabled);
    queryClient.invalidateQueries({ queryKey: ['chats'] });
    queryClient.invalidateQueries({ queryKey: ['chat', chat._id] });
  }, aiEnabled ? 'AI Intelligence enabled.' : 'AI Intelligence disabled.');

  const toggleRestriction = (memberId: string) => submit(async () => {
    if (restrictedIds.has(memberId)) {
      await unrestrictGroupMember(chat._id, memberId);
    } else {
      await restrictGroupMember(chat._id, memberId);
    }
    queryClient.invalidateQueries({ queryKey: ['chats'] });
    queryClient.invalidateQueries({ queryKey: ['group-moderation-activity', chat._id] });
  }, restrictedIds.has(memberId) ? 'Member can send again.' : 'Member restricted.');

  const removeWithModeration = (memberId: string) => submit(async () => {
    await moderationRemoveGroupMember(chat._id, memberId);
    queryClient.invalidateQueries({ queryKey: ['chats'] });
    queryClient.invalidateQueries({ queryKey: ['group-moderation-activity', chat._id] });
  }, 'Member removed.');

  const leave = () => submit(
    async () => {
      await leaveGroup.mutateAsync();
      onClose();
      navigate('/chats');
    },
    'You left the group.'
  );

  const deleteForEveryone = () => submit(
    async () => {
      await deleteGroup.mutateAsync(deleteConfirmation);
      onClose();
      navigate('/chats');
    },
    'Group deleted.'
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Group info</h3>
          <button
            onClick={onClose}
            aria-label="Close group info"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-5 text-center">
          <div className="relative mx-auto h-20 w-20">
            {avatarUrl ? (
              <Avatar src={avatarUrl} alt={title} size="xl" />
            ) : (
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-teal-600">
                <Users size={30} className="text-white" />
              </div>
            )}
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={isUploadingGroupAvatar || updateChat.isPending}
                  className="absolute bottom-0 right-0 rounded-full bg-teal-600 p-2 text-white shadow-lg transition hover:bg-teal-700 disabled:opacity-60"
                  aria-label="Change group photo"
                >
                  {isUploadingGroupAvatar ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void updateGroupAvatar(file);
                    event.target.value = '';
                  }}
                />
              </>
            )}
          </div>
          {canEdit && avatarUrl && (
            <div className="mt-3">
              <button
                type="button"
                onClick={removeGroupAvatar}
                disabled={updateChat.isPending}
                className="text-xs font-semibold text-rose-600 transition hover:text-rose-700 disabled:opacity-60 dark:text-rose-400"
              >
                Remove photo
              </button>
            </div>
          )}
          <h4 className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">{title}</h4>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </p>
          <button
            onClick={reportGroup}
            className="mt-3 rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
          >
            Report group
          </button>
          <div className="mt-2 flex flex-wrap justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {createdAt && <span>Created {createdAt.toLocaleDateString()}</span>}
            {chat.groupKind === 'temporary' && expiresAt && <span>Expires {expiresAt.toLocaleString()}</span>}
          </div>
        </div>
        <div className="overflow-y-auto border-t border-slate-200 dark:border-slate-700">
          {notice && (
            <div className="mx-5 mt-4 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {notice}
            </div>
          )}

          {!canEdit && (chat.description || chat.groupContext) && (
            <div className="border-b border-slate-200 p-5 text-left dark:border-slate-700">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Description
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">
                {chat.description || chat.groupContext}
              </p>
            </div>
          )}

          {canEdit && (
            <div className="space-y-3 border-b border-slate-200 p-5 dark:border-slate-700">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Name
                  <input
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm normal-case tracking-normal text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </label>
                <label className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Description
                  <input
                    value={editDescription}
                    onChange={(event) => setEditDescription(event.target.value)}
                    placeholder="Add a group description"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm normal-case tracking-normal text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </label>
              </div>
              <button
                onClick={saveDetails}
                disabled={updateChat.isPending}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-950"
              >
                {updateChat.isPending ? 'Saving...' : 'Save details'}
              </button>
            </div>
          )}

          {canEdit && (
            <div className="space-y-3 border-b border-slate-200 p-5 text-left dark:border-slate-700">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <UserPlus size={16} />
                Invite link
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Expiry
                  <select
                    value={inviteExpiry}
                    onChange={(event) => setInviteExpiry(event.target.value as InviteExpiry)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm normal-case tracking-normal text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="never">Never</option>
                    <option value="1d">1 day</option>
                    <option value="7d">7 days</option>
                    <option value="30d">30 days</option>
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Maximum uses
                  <select
                    value={inviteMaxUses}
                    onChange={(event) => setInviteMaxUses(event.target.value === 'unlimited' ? 'unlimited' : Number(event.target.value) as InviteMaxUses)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm normal-case tracking-normal text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="unlimited">Unlimited</option>
                    <option value="10">10</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </label>
              </div>
              {inviteSettings.data?.invite ? (
                <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  <div className="font-medium text-slate-900 dark:text-white">
                    {inviteSettings.data.invite.useCount}
                    {inviteSettings.data.invite.maxUses ? ` / ${inviteSettings.data.invite.maxUses}` : ''} uses
                  </div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {inviteSettings.data.invite.expiresAt
                      ? `Expires ${new Date(inviteSettings.data.invite.expiresAt).toLocaleString()}`
                      : 'Never expires'}
                  </div>
                  {latestInviteUrl ? (
                    <input
                      readOnly
                      value={latestInviteUrl}
                      className="mt-3 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    />
                  ) : (
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                      Regenerate to copy a fresh invite URL. Stored links keep only a hash of the token.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">No active invite link.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {!inviteSettings.data?.invite ? (
                  <button
                    onClick={createInviteLink}
                    disabled={createInvite.isPending}
                    className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60"
                  >
                    {createInvite.isPending ? 'Creating...' : 'Create invite link'}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={copyInviteLink}
                      disabled={!latestInviteUrl}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-950"
                    >
                      Copy link
                    </button>
                    <button
                      onClick={regenerateInviteLink}
                      disabled={regenerateInvite.isPending}
                      className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      {regenerateInvite.isPending ? 'Regenerating...' : 'Regenerate'}
                    </button>
                    <button
                      onClick={revokeInviteLink}
                      disabled={revokeInvite.isPending}
                      className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
                    >
                      {revokeInvite.isPending ? 'Revoking...' : 'Revoke'}
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center justify-between gap-4 pt-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">AI Intelligence</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Allow Catch Me Up, Group Brain, and AI suggestions.</p>
                </div>
                <button
                  onClick={() => setAiEnabled(chat.aiEnabled === false)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    chat.aiEnabled === false
                      ? 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                      : 'bg-teal-600 text-white hover:bg-teal-700'
                  }`}
                >
                  {chat.aiEnabled === false ? 'Off' : 'On'}
                </button>
              </div>
            </div>
          )}

          {canEdit && (
            <div className="space-y-3 border-b border-slate-200 p-5 text-left dark:border-slate-700">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Shield size={16} />
                Send permissions
              </div>
              <div className="inline-flex rounded-xl border border-slate-200 p-1 dark:border-slate-700">
                {(['everyone', 'admins_only'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setSendMode(mode)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      (chat.sendMode || 'everyone') === mode
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {mode === 'everyone' ? 'Everyone' : 'Admins only'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {canEdit && (
            <div className="space-y-3 border-b border-slate-200 p-5 dark:border-slate-700">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <UserPlus size={16} />
                Add members
              </div>
              <input
                value={memberQuery}
                onChange={(event) => setMemberQuery(event.target.value)}
                placeholder="Search people by name, username, or email"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              {selectedUsers.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedUsers.map((user) => (
                    <button
                      key={user._id}
                      onClick={() => setSelectedMemberIds((ids) => ids.filter((id) => id !== user._id))}
                      className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800 dark:bg-teal-500/20 dark:text-teal-100"
                    >
                      {getUserTitle(user as DisplayUser)}
                    </button>
                  ))}
                </div>
              )}
              {memberQuery.trim().length >= 2 && (
                <div className="max-h-32 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  {isSearching && <p className="px-3 py-2 text-sm text-slate-500">Searching...</p>}
                  {!isSearching && availableUsers.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">No available users found.</p>}
                  {availableUsers.map((user) => (
                    <button
                      key={user._id}
                      onClick={() => setSelectedMemberIds((ids) => ids.includes(user._id) ? ids.filter((id) => id !== user._id) : [...ids, user._id])}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Avatar src={user.avatarUrl} alt={getUserTitle(user as DisplayUser)} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-100">{getUserTitle(user as DisplayUser)}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={addSelectedMembers}
                disabled={selectedMemberIds.length === 0 || addMember.isPending}
                className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60"
              >
                {addMember.isPending ? 'Adding...' : 'Add selected'}
              </button>
            </div>
          )}

          <div className="p-2">
          {members.map((member) => (
            <div
              key={member._id}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <button onClick={() => onSelectMember(member)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <Avatar src={member.avatarUrl} alt={getUserTitle(member)} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                    {getUserTitle(member, 'Unknown member')}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {member._id === ownerId ? 'Owner' : adminIds.has(member._id) ? 'Admin' : getUserMeta(member) || member._id}
                  </p>
                </div>
              </button>
              <div className="flex flex-shrink-0 items-center gap-1">
                {member._id === ownerId && <Crown size={15} className="text-amber-500" />}
                {member._id !== ownerId && adminIds.has(member._id) && <Shield size={15} className="text-teal-500" />}
                {canEdit && member._id !== currentUserId && member._id !== ownerId && (
                  <>
                    <button
                      onClick={() => submit(() => adminIds.has(member._id) ? demoteMember.mutateAsync(member._id) : promoteMember.mutateAsync(member._id), adminIds.has(member._id) ? 'Member demoted.' : 'Member promoted.')}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      {adminIds.has(member._id) ? 'Demote' : 'Promote'}
                    </button>
                    {isOwner && (
                      <button
                        onClick={() => submit(() => transferOwnership.mutateAsync(member._id), 'Ownership transferred.')}
                        className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        Transfer
                      </button>
                    )}
                    <button
                      onClick={() => toggleRestriction(member._id)}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      {restrictedIds.has(member._id) ? 'Allow send' : 'Restrict'}
                    </button>
                    <button
                      onClick={() => removeWithModeration(member._id)}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          </div>

          {canEdit && (
            <div className="border-t border-slate-200 p-5 text-left dark:border-slate-700">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Shield size={16} />
                Moderation activity
              </div>
              <div className="space-y-2">
                {moderationActivity.data?.activity?.length ? (
                  moderationActivity.data.activity.slice(0, 8).map((item) => (
                    <div key={item.id} className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <span className="font-semibold">{item.actor?.name || item.actor?.username || 'Deleted user'}</span>
                      {' '}
                      {item.action.replaceAll('_', ' ')}
                      {item.target ? ` · ${item.target.name || item.target.username || 'Deleted user'}` : ''}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No moderation activity yet.</p>
                )}
              </div>
            </div>
          )}

          <div className="space-y-3 border-t border-slate-200 p-5 dark:border-slate-700">
            <button
              onClick={leave}
              disabled={leaveGroup.isPending || isOwner}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {isOwner ? 'Transfer ownership before leaving' : leaveGroup.isPending ? 'Leaving...' : 'Leave group'}
            </button>
            {isOwner && (
              <div className="rounded-xl border border-rose-200 p-3 dark:border-rose-500/30">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
                  <Trash2 size={15} />
                  Delete group
                </div>
                <input
                  value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  placeholder={`Type "${title}" to delete`}
                  className="w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-rose-500/40 dark:bg-slate-800 dark:text-white"
                />
                <button
                  onClick={deleteForEveryone}
                  disabled={deleteConfirmation !== title || deleteGroup.isPending}
                  className="mt-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                >
                  {deleteGroup.isPending ? 'Deleting...' : 'Delete for everyone'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── "Coming Soon" call placeholder ───────────────────────────────────────────

function ComingSoonModal({
  isOpen,
  onClose,
  title,
  message,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-50 dark:bg-teal-900/30">
          {title.toLowerCase().includes('video') ? (
            <Video size={28} className="text-teal-600 dark:text-teal-400" />
          ) : (
            <Phone size={28} className="text-teal-600 dark:text-teal-400" />
          )}
        </div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{message}</p>
        <button
          onClick={onClose}
          className="mt-6 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ── Main ChatHeader ───────────────────────────────────────────────────────────

export default function ChatHeader({
  chat,
  getChatTitle,
  getChatAvatar,
  onlineStatus,
  isGroupChat,
  onOpenIntelligence,
  intelligenceEnabled = true,
  onJumpToMessage,
  pinnedCount = 0,
  onOpenPins,
  onOpenShared,
  onArchiveChat,
  onUnarchiveChat,
  isArchived = false,
}: ChatHeaderProps) {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const setActiveCall = useAppStore((state) => state.setActiveCall);
  const socket = useAppStore((state) => state.socket);
  const isConnected = useAppStore((state) => state.isConnected);
  const [showMenu, setShowMenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [profileUser, setProfileUser] = useState<DisplayUser | null>(null);
  const [callNotice, setCallNotice] = useState<{ title: string; message: string } | null>(null);
  const [groupCall, setGroupCall] = useState<{ callId: string; callType: 'audio' | 'video'; isInitiator?: boolean } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const participantQueries = useQueries({
    queries: chat.participants.map((participantId) => ({
      queryKey: ['users', participantId] as const,
      queryFn: async () => {
        const { data } = await apiClient.get<{ user: User }>(`/api/users/${participantId}`);
        return data.user;
      },
      staleTime: 60_000,
      enabled: Boolean(participantId),
    })),
  });

  const members = useMemo(() => {
    const byId = new Map<string, DisplayUser>();
    participantQueries.forEach((query, index) => {
      const participantId = chat.participants[index];
      if (participantId) {
        byId.set(participantId, query.data ? { ...query.data, _id: participantId } : { _id: participantId });
      }
    });
    if (currentUser?._id) {
      byId.set(currentUser._id, {
        ...(currentUser as DisplayUser),
        _id: currentUser._id,
        name: currentUser.name || currentUser.username || 'You',
      });
    }
    return chat.participants.map((participantId) => byId.get(participantId) || { _id: participantId });
  }, [chat.participants, currentUser, participantQueries]);

  const directProfileUser = useMemo(
    () => members.find((member) => member._id !== currentUser?._id) || null,
    [currentUser?._id, members]
  );

  const { data: activeGroupCallData } = useQuery({
    queryKey: ['chats', chat._id, 'active-group-call'],
    queryFn: async () => {
      const { data } = await apiClient.get<{
        activeCall: {
          callId: string;
          chatId: string;
          callType: 'audio' | 'video';
          callerId: string;
          startedAt: string;
        } | null;
      }>(`/api/chats/${chat._id}/calls/active`);
      return data.activeCall;
    },
    enabled: isGroupChat,
    refetchInterval: isGroupChat ? 15_000 : false,
  });

  useEffect(() => {
    if (!socket || !isGroupChat) return;

    const activeCallQueryKey = ['chats', chat._id, 'active-group-call'];
    const clearIfCurrentCall = (data: { callId: string; chatId: string }) => {
      if (data.chatId !== chat._id) return;
      queryClient.setQueryData(activeCallQueryKey, null);
      setGroupCall((current) => (current?.callId === data.callId ? null : current));
    };
    const updateParticipants = (data: {
      callId: string;
      chatId: string;
      activeParticipantIds: string[];
    }) => {
      if (data.chatId !== chat._id) return;
      if (data.activeParticipantIds.length === 0) {
        clearIfCurrentCall(data);
      } else {
        void queryClient.invalidateQueries({ queryKey: activeCallQueryKey });
      }
    };

    socket.on('group-call:ended', clearIfCurrentCall);
    socket.on('group-call:participants', updateParticipants);
    return () => {
      socket.off('group-call:ended', clearIfCurrentCall);
      socket.off('group-call:participants', updateParticipants);
    };
  }, [socket, isGroupChat, chat._id, queryClient]);

  const trimmedSearch = searchQuery.trim();
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearchQuery(trimmedSearch), 250);
    return () => window.clearTimeout(timeout);
  }, [trimmedSearch]);

  const chatSearch = useQuery({
    queryKey: ['messages', 'search', chat._id, debouncedSearchQuery],
    queryFn: () => searchChatMessages({ chatId: chat._id, q: debouncedSearchQuery, limit: 20 }),
    enabled: showSearch && debouncedSearchQuery.length >= 2,
    staleTime: 20_000,
  });
  const searchResults = chatSearch.data?.results || [];
  const searchMatchCount = searchResults.length;

  useEffect(() => {
    setActiveSearchIndex(0);
  }, [debouncedSearchQuery, chat._id]);

  const jumpToSearchResult = (index: number) => {
    const result = searchResults[index];
    if (!result) return;
    setActiveSearchIndex(index);
    onJumpToMessage?.(result.messageId);
  };

  const goToSearchResult = (direction: 1 | -1) => {
    if (searchResults.length === 0) return;
    const nextIndex = (activeSearchIndex + direction + searchResults.length) % searchResults.length;
    jumpToSearchResult(nextIndex);
  };

  const positionMenu = () => {
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 208;
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - menuWidth - margin);
    setMenuPosition({
      top: rect.bottom + 6,
      left: Math.min(maxLeft, Math.max(margin, rect.right - menuWidth)),
    });
  };

  // Close menu on outside click or Escape
  useEffect(() => {
    if (!showMenu) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowMenu(false); };
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    const handleReposition = () => positionMenu();
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [showMenu]);

  // Focus search input when opened
  useEffect(() => {
    if (showSearch) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearchQuery('');
    }
  }, [showSearch]);

  const formatLastSeen = (lastSeen: Date) => {
    const diff = Date.now() - new Date(lastSeen).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(lastSeen).toLocaleDateString();
  };

  const getStatusText = () => {
    if (isGroupChat) return `${members.length} ${members.length === 1 ? 'member' : 'members'}`;
    if (onlineStatus?.online) return 'online';
    if (onlineStatus?.lastSeen) return `last seen ${formatLastSeen(onlineStatus.lastSeen)}`;
    return '';
  };

  const isOnline = !isGroupChat && onlineStatus?.online;
  const openProfileOrGroupInfo = () => {
    if (isGroupChat) {
      setShowGroupInfo(true);
    } else if (directProfileUser) {
      setProfileUser(directProfileUser);
    }
  };

  const btnBase =
    'rounded-full p-2 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white';

  const createDirectCallId = () =>
    globalThis.crypto?.randomUUID?.() || `call-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const startCall = (callType: 'audio' | 'video') => {
    const title = callType === 'video' ? 'Video call' : 'Audio call';

    if (isGroupChat) {
      if (!socket || !isConnected || !currentUser?._id) {
        setCallNotice({ title, message: 'Realtime connection is required to start a group call.' });
        return;
      }
      const callId = createGroupCallId(chat._id);
      setShowSearch(false);
      socket.emit('group-call:start', {
        callId,
        chatId: chat._id,
        chatTitle: getChatTitle(chat),
        chatAvatarUrl: getChatAvatar(chat),
        fromUserId: currentUser._id,
        fromUserName: getUserTitle(currentUser as DisplayUser, 'You'),
        callType,
        startedAt: new Date().toISOString(),
      });
      setGroupCall({ callId, callType, isInitiator: true });
      return;
    }

    if (chat.participants.length !== 2) {
      setCallNotice({ title, message: 'Calls need a valid direct chat participant.' });
      return;
    }

    if (!currentUser?._id || !directProfileUser?._id) {
      setCallNotice({ title, message: 'Could not find a direct chat participant to call.' });
      return;
    }

    setShowSearch(false);
    setActiveCall({
      callId: createDirectCallId(),
      chatId: chat._id,
      callType,
      direction: 'outgoing',
      status: 'outgoing',
      fromUserId: currentUser._id,
      fromUserName: getUserTitle(currentUser as DisplayUser, 'You'),
      toUserId: directProfileUser._id,
      peerUserId: directProfileUser._id,
      peerName: getUserTitle(directProfileUser),
      peerAvatarUrl: directProfileUser.avatarUrl,
    });
  };

  return (
    <>
      {/* ── Main header bar ── */}
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between px-4 py-3">
          {/* Left: avatar + info */}
          <button
            onClick={openProfileOrGroupInfo}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 dark:hover:bg-slate-800/70"
            aria-label={isGroupChat ? 'Open group info' : 'Open user profile'}
          >
            {isGroupChat && getChatAvatar(chat) ? (
              <Avatar src={getChatAvatar(chat)} alt={getChatTitle(chat)} size="md" />
            ) : isGroupChat ? (
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-teal-600">
                <Users size={18} className="text-white" />
              </div>
            ) : (
              <Avatar
                src={getChatAvatar(chat)}
                alt={getChatTitle(chat)}
                size="md"
                online={onlineStatus?.online}
              />
            )}
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-semibold text-slate-900 dark:text-white">
                {getChatTitle(chat)}
              </h2>
              <p className={`truncate text-xs ${isOnline ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {getStatusText()}
              </p>
            </div>
          </button>

          {/* Right: action buttons */}
          <div className="flex items-center gap-0.5 text-slate-500 dark:text-slate-400">
            {intelligenceEnabled && (
              <button
                onClick={() => { onOpenIntelligence?.(); setShowSearch(false); }}
                aria-label="Open Chat Intelligence"
                title="Open Chat Intelligence"
                className={btnBase}
              >
                <Sparkles size={18} />
              </button>
            )}

            {/* Search */}
            {pinnedCount > 0 && (
              <button
                onClick={onOpenPins}
                aria-label="Pinned messages"
                title="Pinned messages"
                className={btnBase}
              >
                <span className="relative">
                  <Pin size={17} />
                  <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-500 px-1 text-[9px] font-bold text-white">
                    {pinnedCount}
                  </span>
                </span>
              </button>
            )}

            {/* Search */}
            <button
              onClick={onOpenShared}
              aria-label="Shared content"
              title="Shared content"
              className={btnBase}
            >
              <FolderOpen size={18} />
            </button>

            {/* Search */}
            <button
              onClick={() => { setShowSearch((v) => !v); }}
              aria-label="Search in chat"
              aria-pressed={showSearch}
              className={`${btnBase} ${showSearch ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : ''}`}
            >
              <Search size={18} />
            </button>

            {/* Video call */}
            <button
              onClick={() => startCall('video')}
              aria-label="Video call"
              className={btnBase}
            >
              <Video size={18} />
            </button>

            {/* Voice call */}
            <button
              onClick={() => startCall('audio')}
              aria-label="Audio call"
              className={btnBase}
            >
              <Phone size={18} />
            </button>

            {/* Three-dot menu — anchored with relative wrapper */}
            <div ref={menuRef} className="relative">
              <button
                ref={menuButtonRef}
                onClick={() => {
                  if (!showMenu) positionMenu();
                  setShowMenu((v) => !v);
                }}
                aria-label="More options"
                aria-expanded={showMenu}
                aria-haspopup="menu"
                className={`${btnBase} ${showMenu ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : ''}`}
              >
                <MoreVertical size={18} />
              </button>

              {showMenu && (
                <div
                  role="menu"
                  className="fixed z-[100] w-52 max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800"
                  style={{ top: menuPosition.top, left: menuPosition.left }}
                >
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                    onClick={() => { setShowMenu(false); openProfileOrGroupInfo(); }}
                  >
                    View profile
                  </button>
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                    onClick={() => { setShowMenu(false); setShowSearch(true); }}
                  >
                    Search in chat
                  </button>
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                    onClick={() => { setShowMenu(false); onOpenShared?.(); }}
                  >
                    Shared
                  </button>
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                    onClick={() => setShowMenu(false)}
                  >
                    Mute notifications
                  </button>
                  {(onArchiveChat || onUnarchiveChat) && (
                    <button
                      role="menuitem"
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] text-slate-700 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                      onClick={() => {
                        setShowMenu(false);
                        if (isArchived) onUnarchiveChat?.();
                        else onArchiveChat?.();
                      }}
                    >
                      {isArchived ? 'Unarchive chat' : 'Archive chat'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Inline search bar ── */}
        {showSearch && (
          <div className="border-t border-slate-100 px-4 py-2 dark:border-slate-800">
            <div className="relative flex items-center gap-2">
              <Search size={14} className="absolute left-3 text-slate-400" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setShowSearch(false);
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) goToSearchResult(-1);
                    else if (searchResults.length > 0) {
                      if (activeSearchIndex === 0) jumpToSearchResult(0);
                      else goToSearchResult(1);
                    }
                  }
                }}
                placeholder="Search in this chat…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-28 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-teal-500"
              />
              {trimmedSearch && (
                <div className="absolute right-9 flex items-center gap-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {chatSearch.isFetching ? 'Searching' : searchMatchCount ? `${activeSearchIndex + 1}/${searchMatchCount}` : '0'}
                  </span>
                  {chatSearch.isFetching ? (
                    <Loader2 size={13} className="animate-spin text-slate-400" />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => goToSearchResult(-1)}
                        disabled={searchResults.length === 0}
                        className="rounded p-0.5 text-slate-500 hover:bg-slate-200 disabled:opacity-40 dark:hover:bg-slate-700"
                        aria-label="Previous search result"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => goToSearchResult(1)}
                        disabled={searchResults.length === 0}
                        className="rounded p-0.5 text-slate-500 hover:bg-slate-200 disabled:opacity-40 dark:hover:bg-slate-700"
                        aria-label="Next search result"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </>
                  )}
                </div>
              )}
              <button
                onClick={() => setShowSearch(false)}
                aria-label="Close search"
                className="absolute right-2 rounded-lg p-1 text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {isGroupChat && activeGroupCallData && !groupCall && (
          <div className="flex items-center justify-between gap-3 border-t border-teal-100 bg-teal-50 px-4 py-2 dark:border-teal-900/50 dark:bg-teal-950/30">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-teal-900 dark:text-teal-100">
                {activeGroupCallData.callType === 'video' ? 'Video call in progress' : 'Audio call in progress'}
              </p>
              <p className="truncate text-xs text-teal-700 dark:text-teal-300">
                Join the active group call
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setGroupCall({
                  callId: activeGroupCallData.callId,
                  callType: activeGroupCallData.callType,
                  isInitiator: false,
                })
              }
              className="shrink-0 rounded-full bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700"
            >
              Join
            </button>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      <ComingSoonModal
        isOpen={Boolean(callNotice)}
        onClose={() => setCallNotice(null)}
        title={callNotice?.title || 'Call'}
        message={callNotice?.message || ''}
      />

      <GroupInfoModal
        isOpen={showGroupInfo}
        onClose={() => setShowGroupInfo(false)}
        chat={chat}
        title={getChatTitle(chat)}
        avatarUrl={getChatAvatar(chat)}
        members={members}
        currentUserId={currentUser?._id}
        onSelectMember={(member) => setProfileUser(member)}
      />

      <UserProfileModal
        user={profileUser}
        onClose={() => setProfileUser(null)}
      />

      {groupCall && (
        <GroupCallModal
          chat={chat}
          title={getChatTitle(chat)}
          callType={groupCall.callType}
          callId={groupCall.callId}
          isInitiator={groupCall.isInitiator}
          onClose={() => setGroupCall(null)}
        />
      )}
    </>
  );
}
