import { useState, useRef, useEffect, useMemo } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Ban, ChevronDown, ChevronUp, ExternalLink, Flag, FolderOpen, Link2, MessageCircle, Palette, Pencil, Pin, Users, Phone, Video, Search, X, Sparkles, Crown, Shield, UserPlus, Trash2, Camera, Loader2 } from 'lucide-react';
import type { Chat, User } from '@repo/types';
import Avatar from './Avatar';
import AvatarLightbox from './AvatarLightbox';
import GroupCallModal, { createGroupCallId } from './GroupCallModal';
import { useAuth } from '@/contexts/AuthContext';
import {
  apiClient,
  blockUser,
  createReport,
  fetchGroupModerationActivity,
  fetchMyProfile,
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
import { useSearchUsers, useUpdateProfile } from '@/hooks/useUsers';
import { formatDisplayHandle, formatDisplayName, formatUserSubtitle } from '@/utils/user-display';

interface ChatHeaderProps {
  chat: Chat;
  getChatTitle: (chat: Chat) => string;
  getChatAvatar: (chat: Chat) => string | undefined;
  onlineStatus?: { online: boolean; lastSeen: Date | null } | null;
  isGroupChat: boolean;
  onOpenIntelligence?: () => void;
  intelligenceEnabled?: boolean;
  /** Whether the Chat Intelligence panel is currently open (drives the button's active state) */
  intelligenceOpen?: boolean;
  onJumpToMessage?: (messageId: string) => void;
  pinnedCount?: number;
  onOpenPins?: () => void;
  onOpenShared?: () => void;
  onOpenTheme?: () => void;
  onClearChat?: () => void;
  onRemoveConversation?: () => void;
}

type DisplayUser = Partial<User> & { _id: string };

function getUserTitle(user: DisplayUser | undefined, fallback = 'User') {
  return formatDisplayName(user, fallback);
}

function getUserMeta(user: DisplayUser | undefined) {
  return formatUserSubtitle(user, user?.email || '');
}

/** Card block used to group each settings area inside the info modals. */
function SectionCard({
  icon: Icon,
  title,
  description,
  tone = 'default',
  children,
}: {
  icon?: typeof Shield;
  title?: string;
  description?: string;
  tone?: 'default' | 'danger';
  children: React.ReactNode;
}) {
  const danger = tone === 'danger';
  return (
    <section
      className={`rounded-2xl border p-4 text-left ${
        danger
          ? 'border-rose-300/60 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/5'
          : 'border-[color:var(--bl-border)] bg-[color:var(--bl-hover)]'
      }`}
    >
      {title && (
        <div className="mb-3 flex items-start gap-2">
          {Icon && <Icon size={16} className={`mt-0.5 flex-shrink-0 ${danger ? 'text-rose-500' : 'text-teal-600 dark:text-teal-300'}`} />}
          <div>
            <p className={`text-sm font-semibold ${danger ? 'text-rose-700 dark:text-rose-300' : 'text-[color:var(--bl-text)]'}`}>{title}</p>
            {description && <p className={`mt-0.5 text-xs ${danger ? 'text-rose-600/80 dark:text-rose-300/70' : 'text-[color:var(--bl-text-muted)]'}`}>{description}</p>}
          </div>
        </div>
      )}
      {children}
    </section>
  );
}

function UserProfileModal({
  user,
  online,
  onClose,
}: {
  user: DisplayUser | null;
  /** Presence for the shown user, when the caller knows it (direct chats) */
  online?: boolean;
  onClose: () => void;
}) {
  const [notice, setNotice] = useState('');
  const [photoOpen, setPhotoOpen] = useState(false);
  const navigate = useNavigate();
  const { user: currentUser, refreshUser } = useAuth();
  const updateProfile = useUpdateProfile();
  const { uploadMedia, isUploading: isUploadingPhoto } = useFileUpload();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  // Own social handle — the auth user object doesn't carry it.
  const myProfileQuery = useQuery({
    queryKey: ['profiles', 'me'],
    queryFn: fetchMyProfile,
    enabled: Boolean(user && currentUser?._id === user._id),
    staleTime: 60_000,
  });
  useEffect(() => {
    if (!user) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [user, onClose]);

  if (!user) return null;

  // Photo edit/remove is only ever offered on the viewer's own profile —
  // another person's account photo can never be changed from here.
  const isSelf = currentUser?._id === user._id;
  const selfWithLegacyAvatar = currentUser as (typeof currentUser & { avatarUrl?: string; avatar?: string }) | null;
  const displayedAvatarUrl = isSelf
    ? selfWithLegacyAvatar?.avatarUrl || selfWithLegacyAvatar?.avatar
    : user.avatarUrl;

  // Public handle: other users carry profileHandle on /api/users/:id; own
  // handle comes from the profiles API. Normalized without the leading @.
  const publicHandle = ((isSelf ? myProfileQuery.data?.handle || user.profileHandle : user.profileHandle) || '')
    .replace(/^@/, '');
  const openPublicProfile = () => {
    if (publicHandle) {
      onClose();
      navigate(`/p/${publicHandle}`);
    } else if (isSelf) {
      // Own profile without a handle → settings, with the create-handle hint
      onClose();
      navigate('/settings?s=profile&hint=handle');
    }
  };
  const viewProfileButton = (
    <div className="col-span-2">
      <button
        onClick={openPublicProfile}
        disabled={!publicHandle && !isSelf}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
      >
        <ExternalLink size={15} />
        View public profile
      </button>
      {!publicHandle && !isSelf && (
        <p className="mt-1.5 text-center text-xs text-[color:var(--bl-text-muted)]">
          Public profile is not available yet for this user.
        </p>
      )}
    </div>
  );

  const runTrustAction = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      setNotice(success);
    } catch (error: any) {
      setNotice(error?.response?.data?.message || error?.message || 'Action failed');
    }
  };

  const handleOwnPhotoFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setNotice('Choose an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setNotice('Image must be less than 5MB.');
      return;
    }
    setNotice('');
    try {
      const uploaded = await uploadMedia?.(file);
      const nextUrl = uploaded?.mediaUrl || uploaded?.publicUrl;
      if (!nextUrl) throw new Error('Photo upload failed. Try again.');
      await updateProfile.mutateAsync({ avatarUrl: nextUrl });
      if (refreshUser) await refreshUser();
      setNotice('Profile photo updated.');
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      setNotice(err?.response?.data?.message || err?.message || 'Photo update failed');
    }
  };

  const removeOwnPhoto = async () => {
    setNotice('');
    try {
      await updateProfile.mutateAsync({ avatarUrl: '' });
      if (refreshUser) await refreshUser();
      setNotice('Profile photo removed.');
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      setNotice(err?.response?.data?.message || err?.message || 'Photo removal failed');
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-sm rounded-3xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-6 pt-9"
        style={{ boxShadow: 'var(--bl-glow-md), 0 24px 60px -12px rgba(2, 20, 18, 0.45)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close profile"
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--bl-border)] text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)] hover:text-[color:var(--bl-text)]"
        >
          <X size={16} />
        </button>

        {/* Identity */}
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-[-45%]"
              style={{ background: 'radial-gradient(circle, rgba(45, 212, 191, 0.35) 0%, rgba(45, 212, 191, 0) 68%)' }}
            />
            <div className="relative rounded-full p-1 ring-2 ring-teal-400/40">
              <Avatar src={displayedAvatarUrl} alt={getUserTitle(user)} size="xl" online={online} onClick={() => setPhotoOpen(true)} title="Open profile photo" />
            </div>
            {isSelf && (
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={isUploadingPhoto || updateProfile.isPending}
                aria-label="Edit profile photo"
                title="Edit profile photo"
                className="absolute bottom-0 right-0 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-white shadow-md transition hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
              >
                {isUploadingPhoto ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              </button>
            )}
          </div>
          <h3 className="mt-5 text-xl font-bold tracking-tight text-[color:var(--bl-text)]">
            {getUserTitle(user)}
          </h3>
          {(publicHandle || formatDisplayHandle(user)) && (
            <p className="mt-1 text-sm font-medium text-teal-600 dark:text-teal-300">{publicHandle ? `@${publicHandle}` : formatDisplayHandle(user)}</p>
          )}
          {online !== undefined && (
            <p className={`mt-0.5 text-xs font-medium ${online ? 'text-emerald-600 dark:text-emerald-400' : 'text-[color:var(--bl-text-muted)]'}`}>
              {online ? 'Online' : 'Offline'}
            </p>
          )}
          {/* Email is private — only ever shown on your own card */}
          {isSelf && user.email && <p className="mt-0.5 text-xs text-[color:var(--bl-text-muted)]">{user.email}</p>}
        </div>

        {user.about && (
          <div className="mt-5 rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] px-4 py-3 text-left">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--bl-text-muted)]">About</p>
            <p className="mt-1 text-sm leading-6 text-[color:var(--bl-text-secondary)]">{user.about}</p>
          </div>
        )}

        {/* Actions */}
        {isSelf ? (
          <div className="mt-6 grid grid-cols-2 gap-2.5">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) await handleOwnPhotoFile(file);
                e.target.value = '';
              }}
            />
            {viewProfileButton}
            <button
              onClick={() => { onClose(); navigate('/settings?s=profile'); }}
              className="flex items-center justify-center gap-2 rounded-xl border border-teal-500/40 py-2.5 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-500/10"
            >
              <Pencil size={14} />
              Edit profile
            </button>
            <button
              onClick={() => photoInputRef.current?.click()}
              disabled={isUploadingPhoto || updateProfile.isPending}
              className="flex items-center justify-center gap-2 rounded-xl border border-[color:var(--bl-border)] py-2.5 text-sm font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)] disabled:opacity-50"
            >
              {isUploadingPhoto ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
              Edit photo
            </button>
            <button
              onClick={onClose}
              className={`rounded-xl border border-[color:var(--bl-border)] py-2.5 text-sm font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)] ${displayedAvatarUrl ? '' : 'col-span-2'}`}
            >
              Close
            </button>
            {displayedAvatarUrl && (
              <button
                onClick={removeOwnPhoto}
                disabled={isUploadingPhoto || updateProfile.isPending}
                className="flex items-center justify-center gap-2 rounded-xl border border-rose-300/70 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
              >
                <Trash2 size={15} />
                Remove photo
              </button>
            )}
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-2.5">
            {viewProfileButton}
            <button
              onClick={onClose}
              className="flex items-center justify-center gap-2 rounded-xl border border-teal-500/40 py-2.5 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-500/10"
            >
              <MessageCircle size={15} />
              Message
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-[color:var(--bl-border)] py-2.5 text-sm font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
            >
              Close
            </button>
            <button
              onClick={() =>
                runTrustAction(async () => {
                  await blockUser(user._id);
                  // ['chats'] prefix-matches both the chat list query and
                  // every individual useChat(id) detail query (chatKeys.all),
                  // so this refreshes canMessage/blockedState everywhere.
                  await queryClient.invalidateQueries({ queryKey: ['chats'] });
                }, 'User blocked.')
              }
              className="flex items-center justify-center gap-2 rounded-xl border border-[color:var(--bl-border)] py-2.5 text-sm font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
            >
              <Ban size={15} />
              Block
            </button>
            <button
              onClick={() => runTrustAction(() => createReport({ targetType: 'user', targetId: user._id, reason: 'User report' }), 'Report submitted.')}
              className="flex items-center justify-center gap-2 rounded-xl border border-rose-300/70 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
            >
              <Flag size={15} />
              Report
            </button>
          </div>
        )}
        {notice && <p className="mt-3 text-center text-xs text-[color:var(--bl-text-muted)]" role="status">{notice}</p>}
      </div>
      <AvatarLightbox
        isOpen={photoOpen}
        src={displayedAvatarUrl}
        alt={getUserTitle(user)}
        onClose={() => setPhotoOpen(false)}
      />
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
  const [lightboxAvatar, setLightboxAvatar] = useState<{ src?: string | null; alt: string } | null>(null);
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)]"
        style={{ boxShadow: 'var(--bl-glow-md), 0 24px 60px -12px rgba(2, 20, 18, 0.45)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[color:var(--bl-border)] px-6 py-4">
          <h3 className="text-base font-semibold text-[color:var(--bl-text)]">Group info</h3>
          <button
            onClick={onClose}
            aria-label="Close group info"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--bl-border)] text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)] hover:text-[color:var(--bl-text)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Group overview */}
        <div className="flex items-start gap-5 px-6 py-5 text-left">
          <div className="relative flex-shrink-0">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-[-35%]"
              style={{ background: 'radial-gradient(circle, rgba(45, 212, 191, 0.3) 0%, rgba(45, 212, 191, 0) 68%)' }}
            />
            <div className="relative rounded-full p-1 ring-2 ring-teal-400/40">
              {avatarUrl ? (
                <Avatar src={avatarUrl} alt={title} size="xl" onClick={() => setLightboxAvatar({ src: avatarUrl, alt: title })} title="Open group photo" />
              ) : (
                <button type="button" onClick={() => setLightboxAvatar({ src: undefined, alt: title })} className="flex h-20 w-20 items-center justify-center rounded-full bg-teal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400" aria-label="Open group photo">
                  <Users size={30} className="text-white" />
                </button>
              )}
            </div>
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
          <div className="min-w-0 flex-1 pt-1">
            <h4 className="truncate text-xl font-bold tracking-tight text-[color:var(--bl-text)]">{title}</h4>
            <p className="mt-0.5 text-sm text-[color:var(--bl-text-muted)]">
              {members.length} {members.length === 1 ? 'member' : 'members'}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[color:var(--bl-text-muted)]">
              {createdAt && <span>Created {createdAt.toLocaleDateString()}</span>}
              {chat.groupKind === 'temporary' && expiresAt && <span>Expires {expiresAt.toLocaleString()}</span>}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {canEdit && avatarUrl && (
                <button
                  type="button"
                  onClick={removeGroupAvatar}
                  disabled={updateChat.isPending}
                  className="rounded-lg border border-[color:var(--bl-border)] px-2.5 py-1 text-xs font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)] disabled:opacity-60"
                >
                  Remove photo
                </button>
              )}
              <button
                onClick={reportGroup}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300/70 px-2.5 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
              >
                <Flag size={12} />
                Report group
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4 overflow-y-auto border-t border-[color:var(--bl-border)] px-6 py-5">
          {notice && (
            <div className="rounded-xl border border-teal-500/30 bg-teal-50 px-3.5 py-2.5 text-sm text-teal-800 dark:bg-teal-500/10 dark:text-teal-200" role="status">
              {notice}
            </div>
          )}

          {!canEdit && (chat.description || chat.groupContext) && (
            <SectionCard title="Description">
              <p className="whitespace-pre-wrap text-sm leading-6 text-[color:var(--bl-text-secondary)]">
                {chat.description || chat.groupContext}
              </p>
            </SectionCard>
          )}

          {canEdit && (
            <SectionCard title="Group details" description="Name and description shown to all members.">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-left text-xs font-semibold uppercase tracking-wide text-[color:var(--bl-text-muted)]">
                  Name
                  <input
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-3 py-2 text-sm normal-case tracking-normal text-[color:var(--bl-text)] outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:focus:ring-teal-500/20"
                  />
                </label>
                <label className="text-left text-xs font-semibold uppercase tracking-wide text-[color:var(--bl-text-muted)]">
                  Description
                  <input
                    value={editDescription}
                    onChange={(event) => setEditDescription(event.target.value)}
                    placeholder="Add a group description"
                    className="mt-1 w-full rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-3 py-2 text-sm normal-case tracking-normal text-[color:var(--bl-text)] outline-none placeholder:text-[color:var(--bl-text-muted)] focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:focus:ring-teal-500/20"
                  />
                </label>
              </div>
              <button
                onClick={saveDetails}
                disabled={updateChat.isPending}
                className="mt-3 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-60 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
              >
                {updateChat.isPending ? 'Saving...' : 'Save details'}
              </button>
            </SectionCard>
          )}

          {canEdit && (
            <SectionCard icon={Link2} title="Invite link" description="Share a link so people can join this group.">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--bl-text-muted)]">
                  Expiry
                  <select
                    value={inviteExpiry}
                    onChange={(event) => setInviteExpiry(event.target.value as InviteExpiry)}
                    className="mt-1 w-full rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-3 py-2 text-sm normal-case tracking-normal text-[color:var(--bl-text)] outline-none focus:border-teal-400"
                  >
                    <option value="never">Never</option>
                    <option value="1d">1 day</option>
                    <option value="7d">7 days</option>
                    <option value="30d">30 days</option>
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--bl-text-muted)]">
                  Maximum uses
                  <select
                    value={inviteMaxUses}
                    onChange={(event) => setInviteMaxUses(event.target.value === 'unlimited' ? 'unlimited' : Number(event.target.value) as InviteMaxUses)}
                    className="mt-1 w-full rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-3 py-2 text-sm normal-case tracking-normal text-[color:var(--bl-text)] outline-none focus:border-teal-400"
                  >
                    <option value="unlimited">Unlimited</option>
                    <option value="10">10</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </label>
              </div>
              {inviteSettings.data?.invite ? (
                <div className="mt-3 rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-3 text-sm text-[color:var(--bl-text-secondary)]">
                  <div className="font-medium text-[color:var(--bl-text)]">
                    {inviteSettings.data.invite.useCount}
                    {inviteSettings.data.invite.maxUses ? ` / ${inviteSettings.data.invite.maxUses}` : ''} uses
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--bl-text-muted)]">
                    {inviteSettings.data.invite.expiresAt
                      ? `Expires ${new Date(inviteSettings.data.invite.expiresAt).toLocaleString()}`
                      : 'Never expires'}
                  </div>
                  {latestInviteUrl ? (
                    <input
                      readOnly
                      value={latestInviteUrl}
                      className="mt-3 w-full rounded-lg border border-teal-500/30 bg-teal-50 px-3 py-2 text-xs text-teal-800 dark:bg-teal-500/10 dark:text-teal-200"
                    />
                  ) : (
                    <p className="mt-3 text-xs text-[color:var(--bl-text-muted)]">
                      Regenerate to copy a fresh invite URL. Stored links keep only a hash of the token.
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-sm text-[color:var(--bl-text-muted)]">No active invite link.</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {!inviteSettings.data?.invite ? (
                  <button
                    onClick={createInviteLink}
                    disabled={createInvite.isPending}
                    className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-60 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
                  >
                    {createInvite.isPending ? 'Creating...' : 'Create invite link'}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={copyInviteLink}
                      disabled={!latestInviteUrl}
                      className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
                    >
                      Copy link
                    </button>
                    <button
                      onClick={regenerateInviteLink}
                      disabled={regenerateInvite.isPending}
                      className="rounded-xl border border-[color:var(--bl-border)] px-4 py-2 text-sm font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-panel)] disabled:opacity-60"
                    >
                      {regenerateInvite.isPending ? 'Regenerating...' : 'Regenerate'}
                    </button>
                    <button
                      onClick={revokeInviteLink}
                      disabled={revokeInvite.isPending}
                      className="rounded-xl border border-rose-300/70 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
                    >
                      {revokeInvite.isPending ? 'Revoking...' : 'Revoke'}
                    </button>
                  </>
                )}
              </div>
            </SectionCard>
          )}

          {canEdit && (
            <SectionCard icon={Sparkles} title="AI Intelligence" description="Allow Catch Me Up, Group Brain, and AI suggestions.">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-[color:var(--bl-text-secondary)]">
                  {chat.aiEnabled === false ? 'AI features are off for this group.' : 'AI features are on for this group.'}
                </p>
                <button
                  onClick={() => setAiEnabled(chat.aiEnabled === false)}
                  role="switch"
                  aria-checked={chat.aiEnabled !== false}
                  aria-label="Toggle AI Intelligence"
                  className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                    chat.aiEnabled === false ? 'bg-slate-300 dark:bg-slate-700' : 'bg-teal-500'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      chat.aiEnabled === false ? 'translate-x-0.5' : 'translate-x-[22px]'
                    }`}
                  />
                </button>
              </div>
            </SectionCard>
          )}

          {canEdit && (
            <SectionCard icon={Shield} title="Send permissions" description="Control who can send messages in this group.">
              <div className="inline-flex rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-1">
                {(['everyone', 'admins_only'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setSendMode(mode)}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                      (chat.sendMode || 'everyone') === mode
                        ? 'bg-teal-600 text-white shadow-sm dark:bg-teal-500 dark:text-slate-950'
                        : 'text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'
                    }`}
                  >
                    {mode === 'everyone' ? 'Everyone' : 'Admins only'}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-[color:var(--bl-text-muted)]">
                {(chat.sendMode || 'everyone') === 'everyone' ? 'All members can send messages.' : 'Only admins can send messages.'}
              </p>
            </SectionCard>
          )}

          {canEdit && (
            <SectionCard icon={UserPlus} title="Add members" description="Add friends or teammates to the group.">
              <input
                value={memberQuery}
                onChange={(event) => setMemberQuery(event.target.value)}
                placeholder="Search by name, username, or email"
                className="w-full rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-3 py-2 text-sm text-[color:var(--bl-text)] outline-none placeholder:text-[color:var(--bl-text-muted)] focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:focus:ring-teal-500/20"
              />
              {selectedUsers.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {selectedUsers.map((user) => (
                    <button
                      key={user._id}
                      onClick={() => setSelectedMemberIds((ids) => ids.filter((id) => id !== user._id))}
                      className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800 transition hover:bg-teal-100 dark:bg-teal-500/20 dark:text-teal-100 dark:hover:bg-teal-500/30"
                    >
                        {getUserTitle(user as DisplayUser)} x
                    </button>
                  ))}
                </div>
              )}
              {memberQuery.trim().length >= 2 && (
                <div className="mt-2.5 max-h-32 overflow-y-auto rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)]">
                  {isSearching && <p className="px-3 py-2 text-sm text-[color:var(--bl-text-muted)]">Searching...</p>}
                  {!isSearching && availableUsers.length === 0 && <p className="px-3 py-2 text-sm text-[color:var(--bl-text-muted)]">No available users found.</p>}
                  {availableUsers.map((user) => (
                    <button
                      key={user._id}
                      onClick={() => setSelectedMemberIds((ids) => ids.includes(user._id) ? ids.filter((id) => id !== user._id) : [...ids, user._id])}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-[color:var(--bl-hover)]"
                    >
                      <Avatar src={user.avatarUrl} alt={getUserTitle(user as DisplayUser)} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[color:var(--bl-text)]">{getUserTitle(user as DisplayUser)}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={addSelectedMembers}
                disabled={selectedMemberIds.length === 0 || addMember.isPending}
                className="mt-3 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-60 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
              >
                {addMember.isPending ? 'Adding...' : 'Add selected'}
              </button>
            </SectionCard>
          )}

          <SectionCard icon={Users} title="Members" description={canEdit ? 'Manage roles and permissions.' : undefined}>
            <div className="-mx-2 space-y-0.5">
              {members.map((member) => (
                <div
                  key={member._id}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-2 py-2 text-left transition hover:bg-[color:var(--bl-panel)]"
                >
                    <button
                      type="button"
                      onClick={() => setLightboxAvatar({ src: member.avatarUrl, alt: getUserTitle(member) })}
                      className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                      aria-label={`Open ${getUserTitle(member)} photo`}
                    >
                      <Avatar src={member.avatarUrl} alt={getUserTitle(member)} size="md" />
                    </button>
                    <button onClick={() => onSelectMember(member)} className="flex min-w-0 flex-1 text-left">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[color:var(--bl-text)]">
                        {getUserTitle(member, 'Unknown member')}
                      </p>
                      <p className="truncate text-xs text-[color:var(--bl-text-muted)]">
                        {getUserMeta(member) || member._id}
                      </p>
                    </div>
                  </button>
                  <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1">
                    {member._id === ownerId && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                        <Crown size={11} /> Owner
                      </span>
                    )}
                    {member._id !== ownerId && adminIds.has(member._id) && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
                        <Shield size={11} /> Admin
                      </span>
                    )}
                    {restrictedIds.has(member._id) && (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
                        Restricted
                      </span>
                    )}
                    {canEdit && member._id !== currentUserId && member._id !== ownerId && (
                      <>
                        <button
                          onClick={() => submit(() => adminIds.has(member._id) ? demoteMember.mutateAsync(member._id) : promoteMember.mutateAsync(member._id), adminIds.has(member._id) ? 'Member demoted.' : 'Member promoted.')}
                          className="rounded-lg border border-[color:var(--bl-border)] px-2 py-1 text-xs font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
                        >
                          {adminIds.has(member._id) ? 'Demote' : 'Promote'}
                        </button>
                        {isOwner && (
                          <button
                            onClick={() => submit(() => transferOwnership.mutateAsync(member._id), 'Ownership transferred.')}
                            className="rounded-lg border border-[color:var(--bl-border)] px-2 py-1 text-xs font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
                          >
                            Transfer
                          </button>
                        )}
                        <button
                          onClick={() => toggleRestriction(member._id)}
                          className="rounded-lg border border-[color:var(--bl-border)] px-2 py-1 text-xs font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
                        >
                          {restrictedIds.has(member._id) ? 'Allow send' : 'Restrict'}
                        </button>
                        <button
                          onClick={() => removeWithModeration(member._id)}
                          className="rounded-lg border border-rose-300/50 px-2 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          {canEdit && (
            <SectionCard icon={Shield} title="Moderation activity" description="Recent group activity and changes.">
              <div className="space-y-1">
                {moderationActivity.data?.activity?.length ? (
                  moderationActivity.data.activity.slice(0, 8).map((item) => (
                    <div key={item.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-xs text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-panel)]">
                      <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-teal-500" />
                      <span className="min-w-0">
                        <span className="font-semibold text-[color:var(--bl-text)]">{item.actor?.name || item.actor?.username || 'Deleted user'}</span>
                        {' '}
                        {item.action.replaceAll('_', ' ')}
                        {item.target ? ` · ${item.target.name || item.target.username || 'Deleted user'}` : ''}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[color:var(--bl-text-muted)]">No moderation activity yet.</p>
                )}
              </div>
            </SectionCard>
          )}

          <SectionCard icon={AlertTriangle} title="Danger zone" description="These actions cannot be undone." tone="danger">
            <div className="space-y-3">
              <button
                onClick={leave}
                disabled={leaveGroup.isPending || isOwner}
                className="rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] px-4 py-2 text-sm font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)] disabled:opacity-50"
              >
                {isOwner ? 'Transfer ownership before leaving' : leaveGroup.isPending ? 'Leaving...' : 'Leave group'}
              </button>
              {isOwner && (
                <div className="rounded-xl border border-rose-300/60 bg-[color:var(--bl-panel)] p-3.5 dark:border-rose-500/30">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
                    <Trash2 size={15} />
                    Delete group
                  </div>
                  <p className="mb-2 text-xs text-[color:var(--bl-text-muted)]">
                    Permanently delete this group and all its messages for everyone.
                  </p>
                  <input
                    value={deleteConfirmation}
                    onChange={(event) => setDeleteConfirmation(event.target.value)}
                    placeholder={`Type "${title}" to delete`}
                    className="w-full rounded-xl border border-rose-300/60 bg-[color:var(--bl-panel)] px-3 py-2 text-sm text-[color:var(--bl-text)] outline-none placeholder:text-[color:var(--bl-text-muted)] focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-rose-500/40 dark:focus:ring-rose-500/20"
                  />
                  <button
                    onClick={deleteForEveryone}
                    disabled={deleteConfirmation !== title || deleteGroup.isPending}
                    className="mt-2.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-60"
                  >
                    {deleteGroup.isPending ? 'Deleting...' : 'Delete for everyone'}
                  </button>
                </div>
              )}
            </div>
          </SectionCard>
        </div>
        <AvatarLightbox
          isOpen={Boolean(lightboxAvatar)}
          src={lightboxAvatar?.src}
          alt={lightboxAvatar?.alt || title}
          onClose={() => setLightboxAvatar(null)}
        />
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
  intelligenceOpen = false,
  onJumpToMessage,
  pinnedCount = 0,
  onOpenPins,
  onOpenShared,
  onOpenTheme,
  onClearChat,
  onRemoveConversation,
}: ChatHeaderProps) {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const setActiveCall = useAppStore((state) => state.setActiveCall);
  const socket = useAppStore((state) => state.socket);
  const isConnected = useAppStore((state) => state.isConnected);
  const [showSearch, setShowSearch] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [profileUser, setProfileUser] = useState<DisplayUser | null>(null);
  const [callNotice, setCallNotice] = useState<{ title: string; message: string } | null>(null);
  const [groupCall, setGroupCall] = useState<{ callId: string; callType: 'audio' | 'video'; isInitiator?: boolean } | null>(null);
  const [headerAvatarOpen, setHeaderAvatarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
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
    'bl-focus-ring rounded-full p-2 transition hover:bg-teal-50 hover:text-teal-800 dark:hover:bg-teal-500/15 dark:hover:text-teal-100';
  // Direct chats only — group chats aren't subject to 1:1 block rules.
  const isBlockedDirectChat = Boolean(
    chat.type === 'direct' && chat.blockedState && chat.blockedState !== 'none'
  );

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
	        fromUserAvatarUrl: (currentUser as DisplayUser).avatarUrl,
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
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {isGroupChat && getChatAvatar(chat) ? (
              <Avatar src={getChatAvatar(chat)} alt={getChatTitle(chat)} size="md" onClick={() => setHeaderAvatarOpen(true)} title="Open group photo" />
            ) : isGroupChat ? (
              <button type="button" onClick={() => setHeaderAvatarOpen(true)} className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-teal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400" aria-label="Open group photo">
                <Users size={18} className="text-white" />
              </button>
            ) : (
              <Avatar
                src={getChatAvatar(chat)}
                alt={getChatTitle(chat)}
                size="md"
                online={onlineStatus?.online}
                onClick={() => setHeaderAvatarOpen(true)}
                title="Open profile photo"
              />
            )}
            <button
              onClick={openProfileOrGroupInfo}
              className="min-w-0 rounded-xl text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 dark:hover:bg-slate-800/70"
              aria-label={isGroupChat ? 'Open group info' : 'Open user profile'}
            >
              <h2 className="truncate text-[15px] font-semibold text-slate-900 dark:text-white">
                {getChatTitle(chat)}
              </h2>
              <p className={`truncate text-xs ${isOnline ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {getStatusText()}
              </p>
            </button>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-0.5 text-teal-600 dark:text-teal-300">
            {intelligenceEnabled && (
              <button
                onClick={() => { onOpenIntelligence?.(); setShowSearch(false); }}
                aria-label="Open Chat Intelligence"
                title="Open Chat Intelligence"
                aria-pressed={intelligenceOpen}
                className={`bl-focus-ring mr-1 flex h-9 w-9 items-center justify-center rounded-full border transition ${
                  intelligenceOpen
                    ? 'border-teal-500/50 bg-teal-50 text-teal-700 shadow-[0_0_12px_rgba(45,212,191,0.35)] dark:border-teal-400/50 dark:bg-teal-500/20 dark:text-teal-200 dark:shadow-[0_0_14px_rgba(45,212,191,0.45)]'
                    : 'border-teal-500/25 bg-teal-50/70 text-teal-600 hover:border-teal-500/45 hover:bg-teal-50 hover:text-teal-800 hover:shadow-[0_0_10px_rgba(45,212,191,0.25)] dark:border-teal-400/20 dark:bg-teal-500/10 dark:text-teal-300 dark:hover:border-teal-400/40 dark:hover:bg-teal-500/20 dark:hover:text-teal-100'
                }`}
              >
                <Sparkles size={17} />
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
            <button
              onClick={onOpenTheme}
              aria-label="Chat theme"
              title="Chat theme"
              className={btnBase}
            >
              <Palette size={18} />
            </button>
            <button
              onClick={() => {
                if (window.confirm('Clear messages in this conversation for you?')) onClearChat?.();
              }}
              aria-label="Clear chat"
              title="Clear chat"
              className={btnBase}
            >
              <Trash2 size={18} />
            </button>
            {!isGroupChat && (
              <button
                onClick={() => {
                  if (window.confirm('Remove this direct conversation from your list?')) onRemoveConversation?.();
                }}
                aria-label="Remove conversation"
                title="Remove conversation"
                className={`${btnBase} text-rose-600 hover:text-rose-700 dark:text-rose-300 dark:hover:text-rose-200`}
              >
                <X size={18} />
              </button>
            )}

            {/* Search */}
            <button
              onClick={() => { setShowSearch((v) => !v); }}
              aria-label="Search in chat"
              aria-pressed={showSearch}
              className={`${btnBase} ${showSearch ? 'bg-teal-100 text-teal-800 dark:bg-teal-500/25 dark:text-teal-100' : ''}`}
            >
              <Search size={18} />
            </button>

            {/* Video call */}
            <button
              onClick={() => startCall('video')}
              aria-label="Video call"
              disabled={isBlockedDirectChat}
              className={`${btnBase} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
            >
              <Video size={18} />
            </button>

            {/* Voice call */}
            <button
              onClick={() => startCall('audio')}
              aria-label="Audio call"
              disabled={isBlockedDirectChat}
              className={`${btnBase} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
            >
              <Phone size={18} />
            </button>
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
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-28 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-teal-400"
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
      <AvatarLightbox
        isOpen={headerAvatarOpen}
        src={getChatAvatar(chat)}
        alt={getChatTitle(chat)}
        onClose={() => setHeaderAvatarOpen(false)}
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
        online={
          profileUser && directProfileUser && profileUser._id === directProfileUser._id
            ? onlineStatus?.online
            : undefined
        }
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
