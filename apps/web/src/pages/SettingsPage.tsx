import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  User,
  Bell,
  Shield,
  Moon,
  HelpCircle,
  Sparkles,
  Camera,
  Loader2,
  Check,
  Trash2,
  ArrowLeft,
  Sun,
  ExternalLink,
  Mail,
  Laptop,
  Smartphone,
  MonitorSmartphone,
  Download,
  LogOut,
  Compass,
  Bookmark,
  LayoutGrid,
  ArrowRight,
  Globe,
  Pencil,
  MessageSquare,
  Clapperboard,
  Newspaper,
  Users,
  ChevronDown,
  Activity,
  Clock,
  ShieldCheck,
  Lock,
  Plus,
  History,
  AtSign,
  Phone,
  CircleDashed,
  CalendarDays,
  ListChecks,
  Eye,
  EyeOff,
  Heart,
  UserPlus,
  Monitor,
  Rocket,
  Bug,
  Unlock,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUpdateProfile } from '@/hooks/useUsers';
import { useTheme } from '@/hooks/useTheme';
import Avatar from '@/components/Avatar';
import CameraModal from '@/components/CameraModal';
import VeyraMark from '@/components/brand/VeyraMark';
import {
  apiClient,
  apiErrorMessage,
  approveFollowRequest,
  blockUser,
  declineFollowRequest,
  downloadDataExport,
  fetchBlockedUsers,
  fetchAccountStatus,
  fetchDataExports,
  fetchDeviceSessions,
  fetchIncomingFollowRequests,
  fetchMyProfile,
  fetchMyReports,
  fetchProfilePosts,
  fetchProfileReels,
  fetchSavedPosts,
  fetchDiscoveryPreferences,
  fetchDiscoveryTopics,
  getAccessToken,
  logoutOtherDeviceSessions,
  normalizeMediaUrl,
  requestAccountDeletion,
  requestDataExport,
  requestEmailChange,
  requestPasswordReset,
  resendEmailVerification,
  revokeDeviceSession,
  unblockUser,
  clearDiscoveryPersonalization,
  updateCreatorDiscovery,
  updateDiscoveryPreferences,
  updateProfileHandle,
  updateSocialProfile,
  fetchVeyraScopeCandidates,
  fetchVeyraSettings,
  grantVeyraScope,
  revokeVeyraScope,
  updateVeyraSettings,
} from '@/api/client';
import type { DiscoveryTopic, VeyraSettings } from '@/api/client';
import { useSavedMessages } from '@/hooks/useMessages';
import { groupActiveDeviceSessions } from '@/utils/device-sessions';
import { SavedContentSection } from './SavedMessagesPage';

// ── Section registry ────────────────────────────────────────────────────────

type SectionKey = 'control-center' | 'profile' | 'saved' | 'account' | 'privacy' | 'notifications' | 'appearance' | 'ai' | 'discovery' | 'help';

const SECTIONS: { key: SectionKey; label: string; icon: typeof User }[] = [
  { key: 'control-center', label: 'Control Center', icon: LayoutGrid },
  { key: 'profile',       label: 'Edit Profile',   icon: User       },
  { key: 'saved',         label: 'Saved',          icon: Bookmark   },
  { key: 'account',       label: 'Account',        icon: Shield     },
  { key: 'privacy',       label: 'Privacy',         icon: Shield     },
  { key: 'notifications', label: 'Notifications',   icon: Bell       },
  { key: 'appearance',    label: 'Appearance',      icon: Moon       },
  { key: 'ai',            label: 'AI privacy',      icon: Sparkles   },
  { key: 'discovery',     label: 'Discovery',       icon: Compass    },
  { key: 'help',          label: 'Help',            icon: HelpCircle },
];

const SECTION_KEYS = new Set<string>(SECTIONS.map((section) => section.key));

// ── Shared input style ───────────────────────────────────────────────────────

const INPUT = `w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm
  text-slate-900 outline-none transition
  focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100
  dark:border-slate-700 dark:bg-slate-800 dark:text-white
  dark:focus:border-teal-500 dark:focus:bg-slate-800`;

const DISABLED_INPUT = `w-full rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5
  text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500`;

interface AvatarPresignResponse {
  uploadUrl: string;
  mediaId: string;
  mediaUrl?: string;
  publicUrl?: string;
  url?: string;
  uploadAuthRequired?: boolean;
  storage?: 's3' | 'local';
}

type ThemePreference = 'light' | 'dark' | 'system';

type MessagePrivacy = 'everyone' | 'followers' | 'no_one';
type GroupInvitePrivacy = 'everyone' | 'followers' | 'contacts' | 'no_one';

const CONTACT_PRIVACY_LABEL: Record<GroupInvitePrivacy, string> = {
  everyone: 'Everyone',
  followers: 'Followers',
  contacts: 'My contacts',
  no_one: 'No one',
};

interface UserSettings {
  readReceiptsEnabled: boolean;
  presenceVisible: boolean;
  lastSeenVisible: boolean;
  incomingCallsEnabled: boolean;
  themePreference: ThemePreference;
  chatIntelligenceEnabled: boolean;
  momentArchiveEnabled: boolean;
  messagePrivacy: MessagePrivacy;
  groupInvitePrivacy: GroupInvitePrivacy;
  timezone?: string;
  updatedAt?: string;
}

const settingsKey = ['user-settings'] as const;

function useUserSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: async () => {
      const { data } = await apiClient.get<{ settings: UserSettings }>('/api/users/settings/me');
      return data.settings;
    },
  });
}

function useUpdateUserSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<UserSettings>) => {
      const { data } = await apiClient.patch<{ settings: UserSettings }>(
        '/api/users/settings/me',
        patch
      );
      return data.settings;
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsKey, settings);
    },
  });
}

interface MomentContact {
  _id: string;
  name: string;
  avatarUrl?: string | null;
}

// ── Toggle component ─────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-6 w-11 flex-shrink-0 overflow-hidden rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
        checked ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span
        className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function CloseFriendsSettings() {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState('');
  const contacts = useQuery({
    queryKey: ['moment-contacts'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ contacts: MomentContact[] }>('/api/moments/contacts');
      return data.contacts;
    },
  });
  const closeFriends = useQuery({
    queryKey: ['moment-close-friends'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ closeFriends: MomentContact[] }>('/api/moments/close-friends');
      return data.closeFriends;
    },
  });
  const addFriend = useMutation({
    mutationFn: async (userId: string) => apiClient.post('/api/moments/close-friends', { userId }),
    onSuccess: () => {
      setSelectedUserId('');
      queryClient.invalidateQueries({ queryKey: ['moment-close-friends'] });
    },
  });
  const removeFriend = useMutation({
    mutationFn: async (userId: string) => apiClient.delete(`/api/moments/close-friends/${userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['moment-close-friends'] }),
  });
  const closeFriendIds = new Set((closeFriends.data ?? []).map((friend) => friend._id));
  const availableContacts = (contacts.data ?? []).filter((contact) => !closeFriendIds.has(contact._id));

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Close Friends Moments</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Choose contacts who can receive Close Friends Moments.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          value={selectedUserId}
          onChange={(event) => setSelectedUserId(event.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="">Select a contact</option>
          {availableContacts.map((contact) => (
            <option key={contact._id} value={contact._id}>{contact.name}</option>
          ))}
        </select>
        <button
          onClick={() => selectedUserId && addFriend.mutate(selectedUserId)}
          disabled={!selectedUserId || addFriend.isPending}
          className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:bg-slate-300"
        >
          Add
        </button>
      </div>
      <div className="mt-4 space-y-2">
        {closeFriends.isLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading Close Friends...</p>
        ) : (closeFriends.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No Close Friends selected.</p>
        ) : (
          closeFriends.data!.map((friend) => (
            <div key={friend._id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2 dark:border-slate-700">
              <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{friend.name}</span>
              <button
                onClick={() => removeFriend.mutate(friend._id)}
                className="text-sm font-semibold text-rose-600 transition hover:text-rose-700"
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// ── Section: Profile ─────────────────────────────────────────────────────────

function ProfileSection() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  // Set when another surface (account menu, /profile) wanted the public
  // profile but the account has no handle yet.
  const needsHandleHint = searchParams.get('hint') === 'handle';
  const updateProfile = useUpdateProfile();
  const profileUser =
    user as (typeof user & { about?: string; avatarUrl?: string; role?: string; department?: string }) | null;

  const persistedAvatarUrl = profileUser?.avatarUrl || profileUser?.avatar || '';
  const [name, setName] = useState(user?.name || '');
  const [about, setAbout] = useState(profileUser?.about || '');
  const [role, setRole] = useState(profileUser?.role || '');
  const [department, setDepartment] = useState(profileUser?.department || '');
  // savedAvatarUrl is the real server URL — never a base64 blob
  const [savedAvatarUrl, setSavedAvatarUrl] = useState(persistedAvatarUrl);
  // localPreview is base64 only for display while upload is in-progress or failed
  const [localPreview, setLocalPreview] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [savedBannerUrl, setSavedBannerUrl] = useState('');
  const [profileBannerPositionY, setProfileBannerPositionY] = useState(50);
  const [localBannerPreview, setLocalBannerPreview] = useState('');
  const [bannerUploadError, setBannerUploadError] = useState('');
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);
  const [showCameraCapture, setShowCameraCapture] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [profileHandle, setProfileHandle] = useState('');
  const [profileBio, setProfileBio] = useState('');
  const [profileWebsite, setProfileWebsite] = useState('');
  const [profileVisibility, setProfileVisibility] = useState<'private' | 'public'>('private');
  const [profileNotice, setProfileNotice] = useState('');
  const [profileError, setProfileError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const displayedAvatar = normalizeMediaUrl(localPreview || savedAvatarUrl);
  const displayedBanner = normalizeMediaUrl(localBannerPreview || savedBannerUrl);
  const bannerObjectPosition = `center ${profileBannerPositionY}%`;
  const socialProfileQuery = useQuery({
    queryKey: ['profiles', 'me'],
    queryFn: fetchMyProfile,
  });
  const followRequestsQuery = useQuery({
    queryKey: ['profiles', 'requests', 'incoming'],
    queryFn: fetchIncomingFollowRequests,
  });
  const accountStatusQuery = useQuery({
    queryKey: ['account-status'],
    queryFn: fetchAccountStatus,
  });
  const saveSocialProfile = useMutation({
    mutationFn: updateSocialProfile,
    onSuccess: async (profile) => {
      setProfileBio(profile.bio || '');
      setProfileWebsite(profile.website || '');
      setSavedBannerUrl(profile.profileBannerUrl || '');
      setProfileBannerPositionY(profile.profileBannerPositionY ?? 50);
      setProfileVisibility(profile.visibility || 'private');
      setProfileNotice('Profile saved.');
      setProfileError('');
      queryClient.setQueryData(['profiles', 'me'], profile);
      if (profile.handle) queryClient.setQueryData(['profiles', profile.handle], profile);
      await socialProfileQuery.refetch();
      if (refreshUser) refreshUser();
    },
    onError: (err) => {
      const message = apiErrorMessage(err, 'Unable to save profile.');
      setProfileError(message);
      setProfileNotice('');
    },
  });
  const saveHandle = useMutation({
    mutationFn: updateProfileHandle,
    onSuccess: async (profile) => {
      setProfileHandle(profile.handle || '');
      setProfileNotice('Handle saved.');
      setProfileError('');
      queryClient.setQueryData(['profiles', 'me'], profile);
      if (profile.handle) queryClient.setQueryData(['profiles', profile.handle], profile);
      await socialProfileQuery.refetch();
    },
    onError: (err) => {
      const message = apiErrorMessage(err, 'Unable to save username.');
      setProfileError(message);
      setProfileNotice('');
    },
  });
  const approveRequest = useMutation({
    mutationFn: approveFollowRequest,
    onSuccess: async () => {
      await followRequestsQuery.refetch();
      await socialProfileQuery.refetch();
      setProfileNotice('Follow request approved.');
      setProfileError('');
    },
    onError: (err) => {
      setProfileError(apiErrorMessage(err, 'Unable to approve this follow request.'));
      setProfileNotice('');
    },
  });
  const declineRequest = useMutation({
    mutationFn: declineFollowRequest,
    onSuccess: async () => {
      await followRequestsQuery.refetch();
      await socialProfileQuery.refetch();
      setProfileNotice('Follow request declined.');
      setProfileError('');
    },
    onError: (err) => {
      setProfileError(apiErrorMessage(err, 'Unable to decline this follow request.'));
      setProfileNotice('');
    },
  });

  useEffect(() => {
    setName(user?.name || '');
    setAbout(profileUser?.about || '');
    setRole(profileUser?.role || '');
    setDepartment(profileUser?.department || '');
    setSavedAvatarUrl(persistedAvatarUrl);
  }, [user?._id, user?.name, profileUser?.about, profileUser?.role, profileUser?.department, persistedAvatarUrl]);

  useEffect(() => {
    const profile = socialProfileQuery.data;
    if (!profile) return;
    setProfileHandle(profile.handle || '');
    setProfileBio(profile.bio || '');
    setProfileWebsite(profile.website || '');
    setSavedBannerUrl(profile.profileBannerUrl || '');
    setProfileBannerPositionY(profile.profileBannerPositionY ?? 50);
    setProfileVisibility(profile.visibility || 'private');
  }, [socialProfileQuery.data]);

  const uploadAvatar = async (
    file: File
  ): Promise<{ mediaUrl: string | null; errorMessage?: string }> => {
    setIsUploadingAvatar(true);
    try {
      const { data: presignData } = await apiClient.post<AvatarPresignResponse>('/api/media/presign', {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      });

      const uploadHeaders: Record<string, string> = { 'Content-Type': file.type };
      if (presignData.uploadAuthRequired) {
        const token = getAccessToken();
        if (token) {
          uploadHeaders.Authorization = `Bearer ${token}`;
        }
      }

      await axios.put(presignData.uploadUrl, file, {
        headers: uploadHeaders,
        withCredentials: Boolean(presignData.uploadAuthRequired),
      });

      return {
        mediaUrl:
          presignData.mediaUrl ||
          presignData.publicUrl ||
          presignData.url ||
          presignData.uploadUrl.split('?')[0] ||
          null,
      };
    } catch (err) {
      const errorMessage = axios.isAxiosError(err)
        ? err.response?.data?.message || err.message
        : 'Avatar upload failed';
      return { mediaUrl: null, errorMessage };
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const uploadBanner = async (
    file: File
  ): Promise<{ mediaUrl: string | null; errorMessage?: string }> => {
    setIsUploadingBanner(true);
    try {
      const { data: presignData } = await apiClient.post<AvatarPresignResponse>('/api/media/presign', {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      });

      const uploadHeaders: Record<string, string> = { 'Content-Type': file.type };
      if (presignData.uploadAuthRequired) {
        const token = getAccessToken();
        if (token) uploadHeaders.Authorization = `Bearer ${token}`;
      }

      await axios.put(presignData.uploadUrl, file, {
        headers: uploadHeaders,
        withCredentials: Boolean(presignData.uploadAuthRequired),
      });

      return {
        mediaUrl:
          presignData.mediaUrl ||
          presignData.publicUrl ||
          presignData.url ||
          presignData.uploadUrl.split('?')[0] ||
          null,
      };
    } catch (err) {
      const errorMessage = axios.isAxiosError(err)
        ? err.response?.data?.message || err.message
        : 'Banner upload failed';
      return { mediaUrl: null, errorMessage };
    } finally {
      setIsUploadingBanner(false);
    }
  };

  const handleCancel = () => {
    setName(user?.name || '');
    setAbout(profileUser?.about || '');
    setRole(profileUser?.role || '');
    setDepartment(profileUser?.department || '');
    setSavedAvatarUrl(persistedAvatarUrl);
    setLocalPreview('');
    setUploadError('');
    const profile = socialProfileQuery.data;
    setProfileHandle(profile?.handle || '');
    setProfileBio(profile?.bio || '');
    setProfileWebsite(profile?.website || '');
    setSavedBannerUrl(profile?.profileBannerUrl || '');
    setProfileBannerPositionY(profile?.profileBannerPositionY ?? 50);
    setLocalBannerPreview('');
    setBannerUploadError('');
    setProfileVisibility(profile?.visibility || 'private');
    setProfileNotice('');
    setProfileError('');
  };

  // One Save changes button persists every supported field: account profile
  // (name/about/role/department/avatar), social profile (bio/website/visibility),
  // and the handle only when it actually changed (handle changes are rate-limited).
  const handleSaveAll = async () => {
    setIsSavingAll(true);
    setProfileError('');
    setProfileNotice('');
    const oldHandle = (socialProfileQuery.data?.handle || '').replace(/^@/, '').toLowerCase();
    try {
      await updateProfile.mutateAsync({ name, about, role, department, avatarUrl: savedAvatarUrl });
      const socialProfile = await saveSocialProfile.mutateAsync({
        name,
        bio: profileBio,
        website: profileWebsite,
        profileBannerUrl: savedBannerUrl,
        profileBannerPositionY,
        visibility: profileVisibility,
      });
      let finalProfile = socialProfile;
      const currentHandle = (socialProfile.handle || oldHandle).replace(/^@/, '').toLowerCase();
      const nextHandle = profileHandle.trim().replace(/^@/, '').toLowerCase();
      if (nextHandle && nextHandle !== currentHandle) {
        finalProfile = await saveHandle.mutateAsync(nextHandle);
      }
      const finalHandle = (finalProfile.handle || nextHandle || currentHandle).replace(/^@/, '').toLowerCase();
      setProfileHandle(finalHandle);
      setProfileBio(finalProfile.bio || profileBio);
      setProfileWebsite(finalProfile.website || profileWebsite);
      setSavedBannerUrl(finalProfile.profileBannerUrl || '');
      setProfileBannerPositionY(finalProfile.profileBannerPositionY ?? profileBannerPositionY ?? 50);
      queryClient.setQueryData(['profiles', 'me'], finalProfile);
      if (oldHandle) queryClient.invalidateQueries({ queryKey: ['profiles', oldHandle] });
      if (finalHandle) {
        queryClient.setQueryData(['profiles', finalHandle], finalProfile);
        await queryClient.invalidateQueries({ queryKey: ['profiles', finalHandle] });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['profile-posts', finalHandle] }),
          queryClient.invalidateQueries({ queryKey: ['profile-reels', finalHandle] }),
          queryClient.invalidateQueries({ queryKey: ['profile-followers', finalHandle] }),
          queryClient.invalidateQueries({ queryKey: ['profile-following', finalHandle] }),
        ]);
      }
      await queryClient.invalidateQueries({ queryKey: ['profiles', 'me'] });
      await refreshUser?.();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      const message = apiErrorMessage(err, 'Unable to save your profile.');
      setProfileError(message);
      setProfileNotice('');
    } finally {
      setIsSavingAll(false);
    }
  };

  const handleAvatarFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { alert('Please select an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { alert('Image must be less than 5MB'); return; }

    // Show local preview immediately (base64) — this never goes to the server
    const reader = new FileReader();
    reader.onload = (ev) => setLocalPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    setUploadError('');
    const uploadResult = await uploadAvatar(file);
    if (uploadResult.mediaUrl) {
      setSavedAvatarUrl(uploadResult.mediaUrl);
      setLocalPreview(''); // clear preview once real URL is set
      try {
        await updateProfile.mutateAsync({
          name,
          about,
          role,
          department,
          avatarUrl: uploadResult.mediaUrl,
        });
        if (refreshUser) refreshUser();
      } catch (err) {
        console.error('Failed to save avatar URL:', err);
        setUploadError('Avatar uploaded, but saving it to your profile failed. Try saving again.');
      }
    } else {
      // Upload failed — keep the local preview for display but warn the user
      setUploadError(
        uploadResult.errorMessage ||
          'Avatar upload failed. Changes to your photo will not be saved. Other profile fields can still be saved.'
      );
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleAvatarFile(file);
  };

  const handleBannerFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { alert('Please select an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { alert('Image must be less than 5MB'); return; }

    const reader = new FileReader();
    reader.onload = (ev) => setLocalBannerPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    setBannerUploadError('');
    const uploadResult = await uploadBanner(file);
    if (uploadResult.mediaUrl) {
      setSavedBannerUrl(uploadResult.mediaUrl);
      setProfileBannerPositionY(50);
      setLocalBannerPreview('');
    } else {
      setBannerUploadError(
        uploadResult.errorMessage ||
          'Banner upload failed. Changes to your banner will not be saved. Other profile fields can still be saved.'
      );
    }

    if (bannerInputRef.current) bannerInputRef.current.value = '';
  };

  const handleBannerFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleBannerFile(file);
  };

  const publicHandle = (profileHandle || socialProfileQuery.data?.handle || '').replace(/^@/, '');
  const profileLoaded = Boolean(socialProfileQuery.data);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Edit Profile</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Update your profile details and how others see you.
          </p>
        </div>
        <div className="flex flex-shrink-0 flex-col items-start gap-1 sm:items-end">
          <button
            onClick={() => publicHandle && navigate(`/p/${publicHandle}`)}
            disabled={!publicHandle}
            className="inline-flex items-center gap-2 rounded-xl border border-teal-500/40 px-3.5 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-500/10"
          >
            <Eye size={14} />
            Preview your profile
          </button>
          {profileLoaded && !publicHandle && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Create a username first to preview your public profile.
            </p>
          )}
        </div>
      </div>

      {needsHandleHint && !publicHandle && (
        <div className="rounded-xl border border-teal-500/40 bg-teal-50 px-4 py-3 text-sm text-teal-800 dark:bg-teal-500/10 dark:text-teal-200">
          Your public profile needs a username. Pick one in “Basic info” below, then use “Preview your
          profile”.
        </div>
      )}

      {(profileNotice || profileError) && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            profileError
              ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'
          }`}
        >
          {profileError || profileNotice}
        </div>
      )}

      {/* Profile banner */}
      <SecurityCard>
        <div className="p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Profile banner</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Shown at the top of your public profile.</p>
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-r from-teal-100 via-sky-100 to-cyan-50 dark:border-slate-700 dark:from-teal-950 dark:via-slate-900 dark:to-sky-950">
            {displayedBanner ? (
              <img
                src={displayedBanner}
                alt="Profile banner preview"
                className="h-36 w-full object-cover sm:h-44"
                style={{ objectPosition: bannerObjectPosition }}
              />
            ) : (
              <div className="h-36 w-full sm:h-44" />
            )}
          </div>
          {displayedBanner && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label htmlFor="profile-banner-position" className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  Banner position
                </label>
                <span className="text-xs text-slate-400 dark:text-slate-500">{profileBannerPositionY}%</span>
              </div>
              <input
                id="profile-banner-position"
                type="range"
                min={0}
                max={100}
                value={profileBannerPositionY}
                onChange={(event) => setProfileBannerPositionY(Number(event.target.value))}
                className="w-full accent-teal-600"
              />
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => bannerInputRef.current?.click()}
              disabled={isUploadingBanner}
              className="inline-flex items-center gap-2 rounded-xl border border-teal-500/50 px-3.5 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-500/10"
            >
              {isUploadingBanner ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              Change banner
            </button>
            {(savedBannerUrl || localBannerPreview) && (
              <button
                onClick={() => {
                  setSavedBannerUrl('');
                  setLocalBannerPreview('');
                  setProfileBannerPositionY(50);
                  setBannerUploadError('');
                }}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-rose-300 hover:text-rose-600 dark:border-slate-600 dark:text-slate-200 dark:hover:border-rose-500/50 dark:hover:text-rose-300"
              >
                Remove
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            JPG, PNG, WebP or GIF. Max size 5MB. Changes take effect when you save.
          </p>
          {bannerUploadError && <p className="mt-2 text-xs text-rose-500">{bannerUploadError}</p>}
        </div>
      </SecurityCard>

      {/* Profile photo */}
      <SecurityCard>
        <div className="p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Profile photo</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">This is how others see you on Blabber.</p>
          <div className="mt-4 flex flex-wrap items-center gap-5">
            <div className="relative">
              {displayedAvatar ? (
                <img
                  src={displayedAvatar}
                  alt="Profile"
                  className="h-24 w-24 rounded-full border-4 border-teal-500 object-cover"
                />
              ) : (
                <Avatar alt={user?.name || 'User'} size="xl" />
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingAvatar}
                className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-white shadow transition hover:bg-teal-700 disabled:opacity-50"
                aria-label="Change profile photo"
              >
                {isUploadingAvatar ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingAvatar}
                className="rounded-xl border border-teal-500/50 px-3.5 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-500/10"
              >
                Change photo
              </button>
              <button
                onClick={() => setShowCameraCapture(true)}
                disabled={isUploadingAvatar}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/60"
              >
                Take photo
              </button>
              {(savedAvatarUrl || localPreview) && (
                <button
                  onClick={() => {
                    setSavedAvatarUrl('');
                    setLocalPreview('');
                    setUploadError('');
                  }}
                  className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-rose-300 hover:text-rose-600 dark:border-slate-600 dark:text-slate-200 dark:hover:border-rose-500/50 dark:hover:text-rose-300"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            JPG, PNG or GIF. Max size 5MB. Removing your photo takes effect when you save changes.
          </p>
          {uploadError && <p className="mt-2 text-xs text-rose-500">{uploadError}</p>}
        </div>
      </SecurityCard>

      {/* Basic info */}
      <SecurityCard>
        <div className="p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Basic info</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            This information will be visible on your public profile.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  Display name
                </label>
                <span className="text-xs text-slate-400 dark:text-slate-500">{name.length} / 100</span>
              </div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                className={INPUT}
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Username</label>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {profileHandle.replace(/^@/, '').length} / 30
                </span>
              </div>
              <div className="flex rounded-xl border border-slate-200 bg-slate-50 focus-within:border-teal-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-teal-500">
                <span className="px-3.5 py-2.5 text-sm text-slate-400">@</span>
                <input
                  type="text"
                  value={profileHandle}
                  onChange={(e) => setProfileHandle(e.target.value.trimStart().replace(/^@+/, '').toLowerCase())}
                  placeholder="your_username"
                  className="min-w-0 flex-1 bg-transparent py-2.5 pr-3.5 text-sm text-slate-900 outline-none dark:text-white"
                  maxLength={30}
                />
              </div>
            </div>
          </div>
          {profileHandle && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              blabber.com/{profileHandle.replace(/^@/, '')}
            </p>
          )}
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Bio</label>
              <span className="text-xs text-slate-400 dark:text-slate-500">{profileBio.length} / 160</span>
            </div>
            <textarea
              value={profileBio}
              onChange={(e) => setProfileBio(e.target.value)}
              className={`${INPUT} resize-none`}
              rows={3}
              maxLength={160}
            />
          </div>
        </div>
      </SecurityCard>

      {/* Work & status (kept from the previous design — shown in chat profile cards) */}
      <SecurityCard>
        <div className="p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Work & status</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Your role, team, and a short status note, shown on your profile card in chats.
          </p>
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">Role</label>
                <input
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="Senior Product Designer"
                  className={INPUT}
                  maxLength={120}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  Department
                </label>
                <input
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="Design"
                  className={INPUT}
                  maxLength={120}
                />
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  Profile note
                </label>
                <span className="text-xs text-slate-400 dark:text-slate-500">{about.length} / 140</span>
              </div>
              <textarea
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                placeholder="Focusing on Blabber V2 launch 🚀"
                className={`${INPUT} resize-none`}
                rows={3}
                maxLength={140}
              />
            </div>
          </div>
        </div>
      </SecurityCard>

      {/* Contact info */}
      <SecurityCard>
        <div className="p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Contact info</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            This information is private and will not be shown on your profile.
          </p>
          <div className="mt-4">
            <label className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">Email</label>
            <div className="flex flex-wrap items-center gap-2.5">
              <input type="email" value={user?.email || ''} disabled className={`${DISABLED_INPUT} max-w-sm`} />
              {accountStatusQuery.data && (
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    accountStatusQuery.data.user.emailVerified
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                  }`}
                >
                  {accountStatusQuery.data.user.emailVerified ? 'Verified' : 'Unverified'}
                </span>
              )}
              <button onClick={() => navigate('/settings?s=account')} className={CHANGE_BTN}>
                Manage
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Email changes are handled in Account & Security.
            </p>
          </div>
        </div>
      </SecurityCard>

      {/* Links */}
      <SecurityCard>
        <div className="p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Links</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Add a link to your website or portfolio.
          </p>
          <div className="mt-4">
            <label className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">Website</label>
            <input
              type="url"
              value={profileWebsite}
              onChange={(e) => setProfileWebsite(e.target.value)}
              placeholder="https://example.com"
              className={INPUT}
            />
          </div>
        </div>
      </SecurityCard>

      {/* Profile visibility */}
      <SecurityCard>
        <div className="p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Profile visibility</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Choose who can see your profile and posts.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-slate-900 dark:text-white">Public profile</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {profileVisibility === 'public'
                  ? 'Anyone on Blabber can see your profile and public posts.'
                  : 'Only approved followers can see your posts.'}
              </p>
            </div>
            <PrivacySelect
              value={profileVisibility}
              options={[
                { value: 'public', label: 'Public' },
                { value: 'private', label: 'Private' },
              ]}
              onChange={(value) => setProfileVisibility(value as 'private' | 'public')}
              label="Public profile visibility"
            />
          </div>
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            {socialProfileQuery.data?.counts?.followers ?? 0} followers ·{' '}
            {socialProfileQuery.data?.counts?.following ?? 0} following · Also editable in Privacy & Visibility.
          </p>
        </div>
      </SecurityCard>

      {/* Follow requests */}
      <SecurityCard>
        <div className="p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Follow requests ({followRequestsQuery.data?.requests.length ?? 0})
          </h2>
          <div className="mt-3 space-y-2">
            {(followRequestsQuery.data?.requests || []).map((request) => {
              const requesterIdentifier = request.requester.handle || request.requester.id || request.requester.username || '';
              const requestBusy = approveRequest.isPending || declineRequest.isPending;
              return (
              <div
                key={request.requester.id || request.requester.handle || request.requestedAt}
                className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-900/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                    {request.requester.name}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {request.requester.displayHandle || (request.requester.username ? `@${request.requester.username}` : 'No username yet')}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => requesterIdentifier && approveRequest.mutate(requesterIdentifier)}
                    disabled={!requesterIdentifier || requestBusy}
                    className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {approveRequest.isPending ? 'Approving...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => requesterIdentifier && declineRequest.mutate(requesterIdentifier)}
                    disabled={!requesterIdentifier || requestBusy}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
                  >
                    {declineRequest.isPending ? 'Declining...' : 'Decline'}
                  </button>
                </div>
              </div>
              );
            })}
            {followRequestsQuery.data?.requests.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400">No pending requests.</p>
            )}
          </div>
        </div>
      </SecurityCard>

      {/* Save / Cancel */}
      <div className="flex justify-end gap-3">
        <button
          onClick={handleCancel}
          className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          onClick={handleSaveAll}
          disabled={isSavingAll}
          className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60"
        >
          {isSavingAll ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          {saved ? 'Saved!' : 'Save changes'}
        </button>
      </div>

      {/* Safety note */}
      <div className="flex items-center gap-3 rounded-2xl border border-teal-500/30 bg-teal-50/60 px-5 py-4 dark:border-teal-500/25 dark:bg-teal-500/10">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300">
          <ShieldCheck size={16} />
        </span>
        <div>
          <p className="text-[14px] font-semibold text-slate-900 dark:text-white">Keep your profile safe</p>
          <p className="text-[13px] text-slate-600 dark:text-slate-300">
            Never share personal info like passwords or phone numbers in your bio.
          </p>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
      <input ref={bannerInputRef} type="file" accept="image/*" onChange={handleBannerFileSelect} className="hidden" />
      <CameraModal
        isOpen={showCameraCapture}
        onClose={() => setShowCameraCapture(false)}
        onCapture={handleAvatarFile}
        confirmLabel="Use Photo"
      />
    </div>
  );
}

// ── Section: Account ────────────────────────────────────────────────────────

function formatDateTime(value?: string) {
  if (!value) return 'Not available';
  return new Date(value).toLocaleString();
}

const CHANGE_BTN =
  'rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-[13px] font-semibold text-slate-700 transition hover:border-teal-300 hover:text-teal-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-teal-500/50 dark:hover:text-teal-300';

function SecurityCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      {children}
    </section>
  );
}

function SecurityHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-2 text-[15px] font-semibold text-slate-900 dark:text-white">{children}</h2>;
}

function AccountRow({
  icon: Icon,
  label,
  value,
  destructive = false,
  action,
  expanded = false,
  panel,
  last = false,
}: {
  icon: typeof Mail;
  label: string;
  value?: React.ReactNode;
  destructive?: boolean;
  action?: React.ReactNode;
  expanded?: boolean;
  panel?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={last ? '' : 'border-b border-slate-100 dark:border-slate-700'}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <span
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
            destructive
              ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'
              : 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300'
          }`}
        >
          <Icon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`text-[14px] font-semibold ${
              destructive ? 'text-rose-600 dark:text-rose-300' : 'text-slate-900 dark:text-white'
            }`}
          >
            {label}
          </p>
          {value && <div className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{value}</div>}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {expanded && panel && <div className="px-5 pb-5">{panel}</div>}
    </div>
  );
}

function ExpandButton({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-expanded={open}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700/60 dark:hover:text-slate-200"
    >
      <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );
}

function sessionDeviceIcon(label: string) {
  const normalized = label.toLowerCase();
  return normalized.includes('ios') || normalized.includes('android') ? Smartphone : Laptop;
}

const VISIBLE_SESSION_LIMIT = 5;

function AccountSection() {
  const { user, refreshUser, logout } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<null | 'email' | 'password' | 'export' | 'delete'>(null);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [exportPassword, setExportPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  const statusQuery = useQuery({
    queryKey: ['account-status'],
    queryFn: fetchAccountStatus,
  });

  const sessionsQuery = useQuery({
    queryKey: ['account-sessions'],
    queryFn: fetchDeviceSessions,
  });

  const exportsQuery = useQuery({
    queryKey: ['account-exports'],
    queryFn: fetchDataExports,
  });

  const showError = (err: unknown, fallback: string) => {
    const message = axios.isAxiosError(err) ? err.response?.data?.message || fallback : fallback;
    setError(message);
    setMessage('');
  };

  const accountUser = statusQuery.data?.user || user;
  const isGoogleOnly = statusQuery.data?.user?.authProvider === 'google';
  const emailVerified = Boolean(accountUser?.emailVerified);

  const toggleExpanded = (key: 'email' | 'password' | 'export' | 'delete') =>
    setExpanded((prev) => (prev === key ? null : key));

  const passwordReset = useMutation({
    mutationFn: () => requestPasswordReset(accountUser?.email || ''),
    onSuccess: () => {
      setMessage('Password reset link sent. Check your email to set a new password.');
      setError('');
      setExpanded(null);
    },
    onError: (err) => showError(err, 'Unable to send the password reset link.'),
  });

  const verification = useMutation({
    mutationFn: resendEmailVerification,
    onSuccess: async () => {
      setMessage('Verification email sent.');
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['account-status'] });
    },
    onError: (err) => showError(err, 'Unable to send verification email.'),
  });

  const emailChange = useMutation({
    mutationFn: requestEmailChange,
    onSuccess: () => {
      setMessage('Check your new email to confirm the change.');
      setError('');
      setNewEmail('');
      setEmailPassword('');
    },
    onError: (err) => showError(err, 'Unable to request email change.'),
  });

  const revokeSession = useMutation({
    mutationFn: revokeDeviceSession,
    onSuccess: async (result) => {
      setMessage(result.currentRevoked ? 'This device was logged out.' : 'Device session revoked.');
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['account-sessions'] });
      if (result.currentRevoked) await logout();
    },
    onError: (err) => showError(err, 'Unable to revoke device session.'),
  });

  const logoutOthers = useMutation({
    mutationFn: logoutOtherDeviceSessions,
    onSuccess: async (result) => {
      setMessage(`${result.revoked} other device session${result.revoked === 1 ? '' : 's'} logged out.`);
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['account-sessions'] });
    },
    onError: (err) => showError(err, 'Unable to log out other devices.'),
  });

  const dataExport = useMutation({
    mutationFn: requestDataExport,
    onSuccess: async () => {
      setMessage('Data export requested.');
      setError('');
      setExportPassword('');
      await queryClient.invalidateQueries({ queryKey: ['account-exports'] });
      window.setTimeout(() => queryClient.invalidateQueries({ queryKey: ['account-exports'] }), 1500);
    },
    onError: (err) => showError(err, 'Unable to request data export.'),
  });

  const deletion = useMutation({
    mutationFn: requestAccountDeletion,
    onSuccess: async (result) => {
      setMessage(`Account deletion scheduled for ${formatDateTime(result.deletion.scheduledFor)}.`);
      setError('');
      await refreshUser().catch(() => undefined);
      await logout();
    },
    onError: (err) => showError(err, 'Unable to schedule account deletion.'),
  });

  const latestExport = exportsQuery.data?.exports[0] || statusQuery.data?.export;
  const sessions = sessionsQuery.data?.sessions || [];
  const { activeSessions, groups: deviceGroups } = groupActiveDeviceSessions(sessions);
  const visibleDeviceGroups = deviceGroups.slice(0, VISIBLE_SESSION_LIMIT);
  const displayedDeviceGroups = showAllSessions
    ? activeSessions.map((session) => ({
        key: session.id,
        label: session.label || 'Unknown device',
        current: session.current,
        lastActiveAt: session.lastActiveAt || session.createdAt,
        sessions: [session],
      }))
    : visibleDeviceGroups;
  const hasSessionDetails = activeSessions.length > deviceGroups.length || deviceGroups.length > VISIBLE_SESSION_LIMIT;
  const otherSessionCount = activeSessions.filter((session) => !session.current).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Account & Security</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Manage your account, security settings and connected devices.
        </p>
      </div>

      {(message || error) && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            error
              ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'
          }`}
        >
          {error || message}
        </div>
      )}

      <div>
        <SecurityHeading>Account</SecurityHeading>
        <SecurityCard>
          <AccountRow
            icon={Mail}
            label="Email address"
            value={
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate">{accountUser?.email}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    emailVerified
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                  }`}
                >
                  {emailVerified ? 'Verified' : 'Unverified'}
                </span>
              </span>
            }
            action={
              <button onClick={() => toggleExpanded('email')} className={CHANGE_BTN} aria-expanded={expanded === 'email'}>
                Change
              </button>
            }
            expanded={expanded === 'email'}
            panel={
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                {!emailVerified ? (
                  <div className="space-y-3">
                    <p className="text-[13px] text-slate-600 dark:text-slate-300">
                      Verify your current email before changing it.
                    </p>
                    <button
                      onClick={() => verification.mutate()}
                      disabled={verification.isPending}
                      className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60"
                    >
                      {verification.isPending && <Loader2 size={15} className="animate-spin" />}
                      Resend verification email
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                      <input
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="New email address"
                        className={INPUT}
                      />
                      <input
                        type="password"
                        value={emailPassword}
                        onChange={(e) => setEmailPassword(e.target.value)}
                        placeholder="Current password"
                        className={INPUT}
                      />
                      <button
                        onClick={() => emailChange.mutate({ newEmail, currentPassword: emailPassword })}
                        disabled={emailChange.isPending || !newEmail || !emailPassword}
                        className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
                      >
                        {emailChange.isPending ? 'Sending…' : 'Send confirmation'}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      We'll email the new address a confirmation link before anything changes.
                    </p>
                  </>
                )}
              </div>
            }
          />
          <AccountRow
            icon={Lock}
            label="Password"
            value={
              isGoogleOnly
                ? "You sign in with Google, so password sign-in isn't set up for this account."
                : 'Manage your password'
            }
            action={
              !isGoogleOnly ? (
                <button
                  onClick={() => toggleExpanded('password')}
                  className={CHANGE_BTN}
                  aria-expanded={expanded === 'password'}
                >
                  Change
                </button>
              ) : undefined
            }
            expanded={expanded === 'password' && !isGoogleOnly}
            panel={
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                <p className="text-[13px] text-slate-600 dark:text-slate-300">
                  We'll email {accountUser?.email} a secure link to set a new password.
                </p>
                <button
                  onClick={() => passwordReset.mutate()}
                  disabled={passwordReset.isPending || !accountUser?.email}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60"
                >
                  {passwordReset.isPending && <Loader2 size={15} className="animate-spin" />}
                  Email me a reset link
                </button>
              </div>
            }
            last
          />
        </SecurityCard>
      </div>

      <div>
        <SecurityHeading>Your devices & sessions</SecurityHeading>
        <SecurityCard>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-700">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
              <MonitorSmartphone size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-slate-900 dark:text-white">
                {sessionsQuery.data
                  ? `You're currently signed in on ${deviceGroups.length} recognized device${deviceGroups.length === 1 ? '' : 's'}`
                  : 'Checking your active sessions…'}
              </p>
              <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">
                Review your active sessions and manage access.
              </p>
            </div>
          </div>

          {sessionsQuery.isLoading ? (
            <p className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">Loading devices…</p>
          ) : sessionsQuery.isError ? (
            <p className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">
              Unable to load your devices right now.
            </p>
          ) : displayedDeviceGroups.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">
              No active device sessions found.
            </p>
          ) : (
            displayedDeviceGroups.map((group) => {
              const session = group.sessions[0];
              const DeviceIcon = sessionDeviceIcon(group.label);
              const groupedSessionCount = group.sessions.length;
              return (
                <div
                  key={group.key}
                  className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3.5 dark:border-slate-700"
                >
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300">
                    <DeviceIcon size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-slate-900 dark:text-white">
                      <span className="truncate">{group.label}</span>
                      {group.current && (
                        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
                          This device
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {groupedSessionCount > 1 && `${groupedSessionCount} session records · `}
                      Last active {formatDateTime(group.lastActiveAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (groupedSessionCount > 1) {
                        setShowAllSessions(true);
                        return;
                      }
                      if (
                        session.current &&
                        !window.confirm('This is your current device. Revoking it will sign you out here. Continue?')
                      ) {
                        return;
                      }
                      revokeSession.mutate(session.id);
                    }}
                    disabled={revokeSession.isPending}
                    className={CHANGE_BTN}
                  >
                    {groupedSessionCount > 1 ? 'Review' : session.current ? 'Sign out' : 'Revoke'}
                  </button>
                </div>
              );
            })
          )}

          {hasSessionDetails && (
            <button
              onClick={() => setShowAllSessions((value) => !value)}
              className="w-full border-b border-slate-100 px-5 py-3 text-center text-[13px] font-semibold text-teal-700 transition hover:bg-teal-50/60 dark:border-slate-700 dark:text-teal-300 dark:hover:bg-teal-500/10"
            >
              {showAllSessions ? 'Back to device overview' : 'Review all session records'}
            </button>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 px-5 py-3.5 dark:bg-slate-900/30">
            <p className="text-[13px] text-slate-500 dark:text-slate-400">Signed out from unknown device?</p>
            <button
              onClick={() => logoutOthers.mutate()}
              disabled={logoutOthers.isPending || otherSessionCount === 0}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-rose-600 transition hover:text-rose-700 disabled:opacity-50 dark:text-rose-400 dark:hover:text-rose-300"
            >
              Sign out all other devices
              <LogOut size={14} />
            </button>
          </div>
        </SecurityCard>
      </div>

      <div>
        <SecurityHeading>Data & account</SecurityHeading>
        <SecurityCard>
          <AccountRow
            icon={Download}
            label="Download your data"
            value="Get a copy of your data from Blabber."
            action={
              <ExpandButton
                open={expanded === 'export'}
                onClick={() => toggleExpanded('export')}
                label="Toggle data export options"
              />
            }
            expanded={expanded === 'export'}
            panel={
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                {emailVerified ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                      <input
                        type="password"
                        value={exportPassword}
                        onChange={(e) => setExportPassword(e.target.value)}
                        placeholder="Confirm current password"
                        className={INPUT}
                      />
                      <button
                        onClick={() => dataExport.mutate(exportPassword)}
                        disabled={dataExport.isPending || !exportPassword}
                        className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
                      >
                        {dataExport.isPending ? 'Requesting…' : 'Request export'}
                      </button>
                    </div>
                    {latestExport && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Latest export: {latestExport.status}
                          {latestExport.expiresAt ? `, expires ${formatDateTime(latestExport.expiresAt)}` : ''}
                        </p>
                        <button
                          onClick={() => latestExport.id && downloadDataExport(latestExport.id)}
                          disabled={latestExport.status !== 'ready'}
                          className={CHANGE_BTN}
                        >
                          Download
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-[13px] text-slate-600 dark:text-slate-300">
                    Verify your email to request a data export.
                  </p>
                )}
              </div>
            }
          />
          <AccountRow
            icon={Trash2}
            label="Delete account"
            value="Permanently delete your account and all your data."
            destructive
            action={
              <ExpandButton
                open={expanded === 'delete'}
                onClick={() => toggleExpanded('delete')}
                label="Toggle account deletion options"
              />
            }
            expanded={expanded === 'delete'}
            panel={
              <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-4 dark:border-rose-900/40 dark:bg-rose-950/20">
                <p className="text-[13px] text-rose-700 dark:text-rose-300">
                  Deletion disables sign-in immediately. We'll email you a link to cancel within 7 days, after which
                  your data is permanently removed.
                </p>
                {emailVerified ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                    <input
                      type="password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      placeholder="Current password"
                      className={INPUT}
                    />
                    <input
                      type="text"
                      value={deleteConfirmation}
                      onChange={(e) => setDeleteConfirmation(e.target.value)}
                      placeholder="Type DELETE"
                      className={INPUT}
                    />
                    <button
                      onClick={() => deletion.mutate({ currentPassword: deletePassword, confirmation: 'DELETE' })}
                      disabled={deletion.isPending || deleteConfirmation !== 'DELETE' || !deletePassword}
                      className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
                    >
                      {deletion.isPending ? 'Deleting…' : 'Delete account'}
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">
                    Verify your email before deleting your account.
                  </p>
                )}
              </div>
            }
            last
          />
        </SecurityCard>
      </div>
    </div>
  );
}

// ── Section: Privacy ─────────────────────────────────────────────────────────

function PrivacyCard({
  icon: Icon,
  title,
  subtitle,
  right,
  children,
}: {
  icon: typeof Shield;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
            <Icon size={16} />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function PrivacyRow({
  label,
  desc,
  control,
  last = false,
}: {
  label: string;
  desc?: string;
  control: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 ${
        last ? '' : 'border-b border-slate-100 dark:border-slate-700'
      }`}
    >
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-slate-900 dark:text-white">{label}</p>
        {desc && <p className="text-xs text-slate-500 dark:text-slate-400">{desc}</p>}
      </div>
      <div className="flex-shrink-0">{control}</div>
    </div>
  );
}

/** Styled native select — custom chevron, teal focus ring. */
function PrivacySelect({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-xl border border-slate-200 bg-slate-50 py-2 pl-3.5 pr-8 text-[13px] font-medium text-slate-800 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-600 dark:bg-slate-700/60 dark:text-slate-100 dark:focus:border-teal-500"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

function PrivacySection() {
  const settingsQuery = useUserSettings();
  const updateSettings = useUpdateUserSettings();
  const queryClient = useQueryClient();
  const [blockUserId, setBlockUserId] = useState('');
  const [blockNotice, setBlockNotice] = useState('');
  const [visibilityNotice, setVisibilityNotice] = useState('');
  const socialProfileQuery = useQuery({ queryKey: ['profiles', 'me'], queryFn: fetchMyProfile });
  const blockedUsers = useQuery({
    queryKey: ['blocked-users'],
    queryFn: fetchBlockedUsers,
  });
  const myReports = useQuery({
    queryKey: ['my-reports'],
    queryFn: fetchMyReports,
  });
  const saveVisibility = useMutation({
    mutationFn: (visibility: 'private' | 'public') => updateSocialProfile({ visibility }),
    onSuccess: (profile) => {
      queryClient.setQueryData(['profiles', 'me'], profile);
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      setVisibilityNotice('Profile visibility updated.');
    },
    onError: (error) => {
      const err = error as { response?: { data?: { message?: string } } };
      setVisibilityNotice(err?.response?.data?.message || 'Unable to update profile visibility.');
    },
  });
  const blockMutation = useMutation({
    mutationFn: blockUser,
    onSuccess: () => {
      setBlockUserId('');
      setBlockNotice('User blocked.');
      queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
    },
    onError: (error: any) => setBlockNotice(error?.response?.data?.message || 'Unable to block user.'),
  });
  const unblockMutation = useMutation({
    mutationFn: unblockUser,
    onSuccess: () => {
      setBlockNotice('User unblocked.');
      queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
    },
    onError: (error: any) => setBlockNotice(error?.response?.data?.message || 'Unable to unblock user.'),
  });
  const settings = settingsQuery.data;
  const visibility = socialProfileQuery.data?.visibility;

  // The backend supports two tiers: 'public' (anyone) and 'private' (only
  // approved followers see the full profile/content). There is no fully
  // hidden "only me" tier, so exactly these two are offered.
  const visibilityOptions: Array<{ value: 'public' | 'private'; label: string; desc: string }> = [
    { value: 'public', label: 'Public', desc: 'Anyone on Blabber can see your profile and content.' },
    { value: 'private', label: 'Followers', desc: 'Only followers you approve can see your profile and content.' },
  ];

  const toggleFor = (key: 'readReceiptsEnabled' | 'presenceVisible' | 'lastSeenVisible' | 'momentArchiveEnabled', label: string) =>
    settings ? (
      <Toggle checked={settings[key]} onChange={() => updateSettings.mutate({ [key]: !settings[key] })} label={label} />
    ) : (
      <span className="text-xs text-slate-400">…</span>
    );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Privacy &amp; Visibility</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Control who can reach you and what others can see.
        </p>
      </div>

      {/* ── Profile visibility ── */}
      <PrivacyCard
        icon={Globe}
        title="Profile visibility"
        subtitle="Choose who can see your profile and content."
      >
        {socialProfileQuery.isLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading profile visibility…</p>
        ) : socialProfileQuery.isError ? (
          <p className="text-sm text-rose-600 dark:text-rose-300">Unable to load profile visibility.</p>
        ) : (
          <div className="space-y-2" role="radiogroup" aria-label="Profile visibility">
            {visibilityOptions.map((option) => {
              const selected = visibility === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={saveVisibility.isPending}
                  onClick={() => !selected && saveVisibility.mutate(option.value)}
                  className={`flex w-full items-center justify-between gap-4 rounded-xl border px-4 py-3 text-left transition disabled:opacity-60 ${
                    selected
                      ? 'border-teal-500/60 bg-teal-50/60 shadow-[0_0_10px_rgba(45,212,191,0.15)] dark:border-teal-400/50 dark:bg-teal-500/10'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-700/40'
                  }`}
                >
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${selected ? 'text-teal-800 dark:text-teal-200' : 'text-slate-900 dark:text-white'}`}>
                      {option.label}
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{option.desc}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={`flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border-2 ${
                      selected ? 'border-teal-500' : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    {selected && <span className="h-2 w-2 rounded-full bg-teal-500" />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {visibilityNotice && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400" role="status">{visibilityNotice}</p>
        )}
      </PrivacyCard>

      {/* ── How people can reach you ── */}
      <PrivacyCard icon={Users} title="How people can reach you">
        <PrivacyRow
          label="Who can message you"
          desc="Controls who can start a new conversation with you. Existing conversations can always continue."
          control={
            settings ? (
              <PrivacySelect
                label="Who can message you"
                value={settings.messagePrivacy}
                options={[
                  { value: 'everyone', label: 'Everyone' },
                  { value: 'followers', label: 'Followers' },
                  { value: 'no_one', label: 'No one' },
                ]}
                onChange={(value) => updateSettings.mutate({ messagePrivacy: value as MessagePrivacy })}
              />
            ) : (
              <span className="text-xs text-slate-400">…</span>
            )
          }
        />
        <PrivacyRow
          label="Who can call you"
          control={
            settings ? (
              <PrivacySelect
                label="Who can call you"
                value={settings.incomingCallsEnabled ? 'everyone' : 'no_one'}
                options={[
                  { value: 'everyone', label: 'Everyone' },
                  { value: 'no_one', label: 'No one' },
                ]}
                onChange={(value) => updateSettings.mutate({ incomingCallsEnabled: value === 'everyone' })}
              />
            ) : (
              <span className="text-xs text-slate-400">…</span>
            )
          }
        />
        <PrivacyRow
          label="Who can add you to groups"
          desc="My contacts means people you already have a conversation with."
          control={
            settings ? (
              <PrivacySelect
                label="Who can add you to groups"
                value={settings.groupInvitePrivacy}
                options={[
                  { value: 'everyone', label: 'Everyone' },
                  { value: 'followers', label: 'Followers' },
                  { value: 'contacts', label: 'My contacts' },
                  { value: 'no_one', label: 'No one' },
                ]}
                onChange={(value) => updateSettings.mutate({ groupInvitePrivacy: value as GroupInvitePrivacy })}
              />
            ) : (
              <span className="text-xs text-slate-400">…</span>
            )
          }
          last
        />
        {updateSettings.isError && (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-300" role="status">
            Could not save your privacy change. Try again.
          </p>
        )}
      </PrivacyCard>

      {/* ── Activity & presence ── */}
      <PrivacyCard icon={Activity} title="Activity & presence">
        <PrivacyRow
          label="Show online status"
          desc="Let others see when you're online."
          control={toggleFor('presenceVisible', 'Show online status')}
        />
        <PrivacyRow
          label="Last seen"
          desc="Let others see your last active time."
          control={toggleFor('lastSeenVisible', 'Last seen')}
        />
        <PrivacyRow
          label="Read receipts"
          desc="Let others know when you've read their messages."
          control={toggleFor('readReceiptsEnabled', 'Read receipts')}
          last
        />
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          Turning off read receipts does not affect message delivery or unread counts.
        </p>
      </PrivacyCard>

      {/* ── Moments & stories ── */}
      <PrivacyCard icon={Clock} title="Moments & stories">
        <PrivacyRow
          label="Save moments to archive"
          desc="Automatically save moments after 24 hours."
          control={toggleFor('momentArchiveEnabled', 'Save moments to archive')}
          last
        />
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          Who can see each Moment is chosen when you post it, including a Close Friends audience, managed below.
        </p>
      </PrivacyCard>

      <CloseFriendsSettings />
      {/* ── Safety ── */}
      <PrivacyCard
        icon={Shield}
        title="Safety"
        subtitle="Manage who is blocked and review reports you've submitted."
      >
        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Blocked users</h3>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={blockUserId}
                onChange={(event) => setBlockUserId(event.target.value)}
                placeholder="User ID"
                className={INPUT}
              />
              <button
                onClick={() => blockMutation.mutate(blockUserId.trim())}
                disabled={!blockUserId.trim() || blockMutation.isPending}
                className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
              >
                Block
              </button>
            </div>
            {blockNotice && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400" role="status">{blockNotice}</p>}
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-700">
              {blockedUsers.data?.blockedUsers?.length ? (
                blockedUsers.data.blockedUsers.map((item) => (
                  <div key={item.userId} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">
                        {item.user?.name || item.user?.username || item.userId}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Blocked {new Date(item.blockedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => unblockMutation.mutate(item.userId)}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700/60"
                    >
                      Unblock
                    </button>
                  </div>
                ))
              ) : (
                <p className="py-3 text-sm text-slate-500 dark:text-slate-400">
                  No blocked users. People you block can't message, call, or see your profile.
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Report history</h3>
            <div className="mt-1 divide-y divide-slate-100 dark:divide-slate-700">
              {myReports.data?.reports?.length ? (
                myReports.data.reports.map((report) => (
                  <div key={report.id} className="py-3">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {report.targetType} report · {report.status}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {report.reason} · {new Date(report.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                ))
              ) : (
                <p className="py-3 text-sm text-slate-500 dark:text-slate-400">
                  No reports submitted. Reports you file about users or content will appear here.
                </p>
              )}
            </div>
          </div>
        </div>
      </PrivacyCard>

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Privacy changes may affect what appears on your public profile, in Discover, and in Moments.
        Private conversations remain separate from public profile visibility.
      </p>
    </div>
  );
}

// ── Section: Notifications ───────────────────────────────────────────────────

interface NotificationPreferences {
  userId: string;
  messageNotificationsEnabled: boolean;
  callNotificationsEnabled: boolean;
  notificationPreviewsEnabled: boolean;
  mentionNotificationsEnabled: boolean;
  actionRemindersEnabled: boolean;
  actionReminderDueTomorrowEnabled: boolean;
  actionReminderDueTodayEnabled: boolean;
  actionReminderOverdueEnabled: boolean;
  actionReminderStaleEnabled: boolean;
  eventRemindersEnabled: boolean;
  eventReminderDayBeforeEnabled: boolean;
  eventReminderHourBeforeEnabled: boolean;
  momentUpdatesEnabled: boolean;
  momentActivityEnabled: boolean;
  postActivityEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursTimezone: string;
  updatedAt: string;
}

function getBrowserPermission(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

function permissionLabel(permission: NotificationPermission | 'unsupported') {
  if (permission === 'granted') return 'Allowed';
  if (permission === 'denied') return 'Denied';
  if (permission === 'unsupported') return 'Unsupported';
  return 'Not asked';
}

function getBrowserTimezone() {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timezone) return null;
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

async function ensurePushSubscription(userId: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are not supported in this browser.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Browser notification permission was not granted.');
  }

  const { data: keyData } = await apiClient.get<{ publicKey: string }>('/api/notifications/push/vapid-public-key');
  if (!keyData.publicKey) {
    throw new Error('Web push is not configured on this server.');
  }

  const registration = await navigator.serviceWorker.register('/sw.js');
  const readyRegistration = await navigator.serviceWorker.ready;
  const existingSubscription = await readyRegistration.pushManager.getSubscription();
  const subscription =
    existingSubscription ||
    (await readyRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
    }));

  await apiClient.post('/api/notifications/push/subscribe', {
    userId,
    subscription: subscription.toJSON(),
  });

  return registration;
}

function NotificationsSection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const settingsQuery = useUserSettings();
  const updateUserSettings = useUpdateUserSettings();
  const [browserPermission, setBrowserPermission] = useState(() => getBrowserPermission());
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    setBrowserPermission(getBrowserPermission());
  }, []);

  useEffect(() => {
    const timezone = getBrowserTimezone();
    if (!timezone || !settingsQuery.data || settingsQuery.data.timezone === timezone) return;
    updateUserSettings.mutate({ timezone });
  }, [settingsQuery.data, updateUserSettings]);

  const preferencesQuery = useQuery({
    queryKey: ['notification-preferences', user?._id],
    enabled: Boolean(user?._id),
    queryFn: async () => {
      const { data } = await apiClient.get<{ preferences: NotificationPreferences }>(
        `/api/notifications/preferences/${user!._id}`
      );
      return data.preferences;
    },
  });

  const updatePreferences = useMutation({
    mutationFn: async (patch: Partial<NotificationPreferences>) => {
      const { data } = await apiClient.patch<{ preferences: NotificationPreferences }>(
        `/api/notifications/preferences/${user!._id}`,
        patch
      );
      return data.preferences;
    },
    onSuccess: (preferences) => {
      queryClient.setQueryData(['notification-preferences', user?._id], preferences);
    },
  });

  const preferences = preferencesQuery.data;

  const togglePreference = async (
    key:
      | 'messageNotificationsEnabled'
      | 'mentionNotificationsEnabled'
      | 'callNotificationsEnabled'
      | 'notificationPreviewsEnabled'
      | 'actionRemindersEnabled'
      | 'actionReminderDueTomorrowEnabled'
      | 'actionReminderDueTodayEnabled'
      | 'actionReminderOverdueEnabled'
      | 'actionReminderStaleEnabled'
      | 'eventRemindersEnabled'
      | 'eventReminderDayBeforeEnabled'
      | 'eventReminderHourBeforeEnabled'
      | 'momentUpdatesEnabled'
      | 'momentActivityEnabled'
      | 'postActivityEnabled'
  ) => {
    if (!user?._id || !preferences) return;
    setErrorMessage('');

    const nextValue = !preferences[key];

    try {
      if (
        nextValue &&
        (key === 'messageNotificationsEnabled' ||
          key === 'mentionNotificationsEnabled' ||
          key === 'callNotificationsEnabled' ||
          key === 'actionRemindersEnabled' ||
          key === 'eventRemindersEnabled' ||
          key === 'momentUpdatesEnabled' ||
          key === 'momentActivityEnabled' ||
          key === 'postActivityEnabled')
      ) {
        await ensurePushSubscription(user._id);
        setBrowserPermission(getBrowserPermission());
      }

      await updatePreferences.mutateAsync({ [key]: nextValue });
    } catch (error) {
      setBrowserPermission(getBrowserPermission());
      setErrorMessage(error instanceof Error ? error.message : 'Unable to update notification settings.');
    }
  };

  const [expandedGroup, setExpandedGroup] = useState<null | 'events' | 'actions'>(null);
  const requestBrowserPermission = async () => {
    if (!('Notification' in window)) return;
    try {
      await Notification.requestPermission();
    } finally {
      setBrowserPermission(getBrowserPermission());
    }
  };
  const reminderRows: {
    label: string;
    desc: string;
    key: keyof Pick<
      NotificationPreferences,
      | 'actionReminderDueTomorrowEnabled'
      | 'actionReminderDueTodayEnabled'
      | 'actionReminderOverdueEnabled'
      | 'actionReminderStaleEnabled'
    >;
  }[] = [
    {
      label: 'Due tomorrow',
      desc: 'Remind me the morning before an Action is due.',
      key: 'actionReminderDueTomorrowEnabled',
    },
    {
      label: 'Due today',
      desc: 'Remind me the morning an Action is due.',
      key: 'actionReminderDueTodayEnabled',
    },
    {
      label: 'Overdue',
      desc: 'Remind me about Actions that are past due.',
      key: 'actionReminderOverdueEnabled',
    },
    {
      label: 'Stale Actions',
      desc: 'Remind me when an Action has had no progress for a while.',
      key: 'actionReminderStaleEnabled',
    },
  ];
  const eventReminderRows: {
    label: string;
    desc: string;
    key: keyof Pick<
      NotificationPreferences,
      'eventReminderDayBeforeEnabled' | 'eventReminderHourBeforeEnabled'
    >;
  }[] = [
    {
      label: 'Day before',
      desc: 'Remind me roughly a day before events I RSVP to.',
      key: 'eventReminderDayBeforeEnabled',
    },
    {
      label: 'Hour before',
      desc: 'Remind me roughly one hour before events I RSVP to.',
      key: 'eventReminderHourBeforeEnabled',
    },
  ];
  const browserNotificationsUnavailable =
    browserPermission === 'unsupported' || browserPermission === 'denied';

  const categoryRow = (options: {
    icon: typeof Bell;
    label: string;
    desc: string;
    value: boolean;
    onToggle: () => void;
    group?: 'events' | 'actions';
    last?: boolean;
  }) => {
    const { icon: Icon, label, desc, value, onToggle, group, last } = options;
    const isExpanded = group !== undefined && expandedGroup === group;
    const subRows = group === 'events' ? eventReminderRows : group === 'actions' ? reminderRows : [];
    return (
      <div key={label} className={last && !isExpanded ? '' : 'border-b border-slate-100 dark:border-slate-700'}>
        <div className="flex items-center gap-3 px-5 py-3.5">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
            <Icon size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-slate-900 dark:text-white">{label}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{desc}</p>
          </div>
          <span className={`text-xs font-semibold ${value ? 'text-teal-600 dark:text-teal-300' : 'text-slate-400 dark:text-slate-500'}`}>
            {value ? 'On' : 'Off'}
          </span>
          <Toggle checked={value} onChange={updatePreferences.isPending ? noop : onToggle} label={label} />
          {group !== undefined && (
            <button
              type="button"
              onClick={() => setExpandedGroup(isExpanded ? null : group)}
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? 'Hide' : 'Show'} ${label} reminder options`}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              <ChevronDown size={15} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
        {isExpanded && preferences && (
          <div className="space-y-1 px-5 pb-3 pl-[68px]">
            {value ? (
              subRows.map((row) => (
                <div key={row.key} className="flex items-center justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-slate-800 dark:text-slate-200">{row.label}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{row.desc}</p>
                  </div>
                  <Toggle
                    checked={Boolean(preferences[row.key])}
                    onChange={updatePreferences.isPending ? noop : () => void togglePreference(row.key)}
                    label={row.label}
                  />
                </div>
              ))
            ) : (
              <p className="py-1.5 text-xs text-slate-500 dark:text-slate-400">Turn this on to configure reminder types.</p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Notifications</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Choose what you want to be notified about and how.
        </p>
      </div>

      {/* ── Browser permission status ── */}
      <section
        className={`rounded-2xl border p-4 ${
          browserPermission === 'granted'
            ? 'border-teal-500/30 bg-teal-50/50 dark:bg-teal-500/5'
            : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
            <ShieldCheck size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-slate-900 dark:text-white">Browser notifications</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Get notified on this browser for important activity.</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              browserPermission === 'granted'
                ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
                : browserPermission === 'denied'
                  ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
            }`}
          >
            {permissionLabel(browserPermission)}
          </span>
          {browserPermission === 'default' && (
            <button
              type="button"
              onClick={() => void requestBrowserPermission()}
              className="rounded-xl bg-teal-600 px-3.5 py-1.5 text-[13px] font-semibold text-white transition hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
            >
              Enable
            </button>
          )}
        </div>
        {browserPermission === 'denied' && (
          <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Notifications are blocked for Blabber. Allow them in your browser&apos;s site settings to receive alerts.
          </p>
        )}
        {browserPermission === 'unsupported' && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">This browser does not support notifications.</p>
        )}
      </section>

      {/* ── Notification categories ── */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Notification categories</h2>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          {preferencesQuery.isLoading ? (
            <p className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">Loading notification settings...</p>
          ) : preferencesQuery.isError || !preferences ? (
            <p className="px-5 py-4 text-sm text-rose-600 dark:text-rose-300">Unable to load notification settings.</p>
          ) : (
            <>
              {categoryRow({
                icon: MessageSquare,
                label: 'Messages',
                desc: 'New messages when you are not in that chat.',
                value: preferences.messageNotificationsEnabled,
                onToggle: () => void togglePreference('messageNotificationsEnabled'),
              })}
              {categoryRow({
                icon: AtSign,
                label: 'Mentions',
                desc: 'When someone mentions you in a group.',
                value: preferences.mentionNotificationsEnabled,
                onToggle: () => void togglePreference('mentionNotificationsEnabled'),
              })}
              {categoryRow({
                icon: Phone,
                label: 'Calls',
                desc: 'Incoming voice and video calls.',
                value: preferences.callNotificationsEnabled,
                onToggle: () => void togglePreference('callNotificationsEnabled'),
              })}
              {categoryRow({
                icon: CircleDashed,
                label: 'New Moments',
                desc: 'When contacts share new Moments.',
                value: preferences.momentUpdatesEnabled,
                onToggle: () => void togglePreference('momentUpdatesEnabled'),
              })}
              {categoryRow({
                icon: Heart,
                label: 'Moment activity',
                desc: 'Reactions on your Moments.',
                value: preferences.momentActivityEnabled,
                onToggle: () => void togglePreference('momentActivityEnabled'),
              })}
              {categoryRow({
                icon: Newspaper,
                label: 'Posts',
                desc: 'Comments and reactions on your posts.',
                value: preferences.postActivityEnabled,
                onToggle: () => void togglePreference('postActivityEnabled'),
              })}
              {categoryRow({
                icon: CalendarDays,
                label: 'Events & Reminders',
                desc: 'Reminders for chat events you RSVP to.',
                value: preferences.eventRemindersEnabled,
                onToggle: () => void togglePreference('eventRemindersEnabled'),
                group: 'events',
              })}
              {categoryRow({
                icon: ListChecks,
                label: 'Actions & Tasks',
                desc: 'Reminders for Actions assigned to you.',
                value: preferences.actionRemindersEnabled,
                onToggle: () => void togglePreference('actionRemindersEnabled'),
                group: 'actions',
                last: true,
              })}
            </>
          )}
        </section>
      </div>

      {/* ── Delivery preferences ── */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Delivery preferences</h2>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5 dark:border-slate-700">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
              <Eye size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-slate-900 dark:text-white">Show preview on notifications</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Show message content in push notifications.</p>
            </div>
            {preferences ? (
              <>
                <span className={`text-xs font-semibold ${preferences.notificationPreviewsEnabled ? 'text-teal-600 dark:text-teal-300' : 'text-slate-400 dark:text-slate-500'}`}>
                  {preferences.notificationPreviewsEnabled ? 'On' : 'Off'}
                </span>
                <Toggle
                  checked={preferences.notificationPreviewsEnabled}
                  onChange={updatePreferences.isPending ? noop : () => void togglePreference('notificationPreviewsEnabled')}
                  label="Show preview on notifications"
                />
              </>
            ) : (
              <span className="text-xs text-slate-400">…</span>
            )}
          </div>
          <div className="flex items-center gap-3 px-5 py-3.5">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
              <Moon size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-slate-900 dark:text-white">Quiet hours</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pause non-urgent notifications during selected hours. Calls always come through.
              </p>
            </div>
            <span className="flex items-center gap-2.5">
              <span
                className={`text-xs font-semibold ${
                  preferences?.quietHoursEnabled
                    ? 'text-teal-600 dark:text-teal-300'
                    : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {preferences?.quietHoursEnabled ? 'On' : 'Off'}
              </span>
              <Toggle
                checked={Boolean(preferences?.quietHoursEnabled)}
                onChange={() => {
                  if (!preferences || updatePreferences.isPending) return;
                  updatePreferences.mutate({
                    quietHoursEnabled: !preferences.quietHoursEnabled,
                    quietHoursTimezone: getBrowserTimezone() || '',
                  });
                }}
                label="Quiet hours"
              />
            </span>
          </div>
          {preferences?.quietHoursEnabled && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 pb-4 pl-[68px]">
              {(
                [
                  ['quietHoursStart', 'From', preferences.quietHoursStart || '22:00'],
                  ['quietHoursEnd', 'To', preferences.quietHoursEnd || '07:00'],
                ] as const
              ).map(([key, label, value]) => (
                <label key={key} className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                  {label}
                  <input
                    type="time"
                    value={value}
                    disabled={updatePreferences.isPending}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      updatePreferences.mutate({
                        [key]: e.target.value,
                        quietHoursTimezone: getBrowserTimezone() || '',
                      });
                    }}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700/60 dark:text-slate-100 dark:[color-scheme:dark]"
                  />
                </label>
              ))}
              <span className="text-xs text-slate-400 dark:text-slate-500">
                Uses your device's timezone.
              </span>
            </div>
          )}
        </section>
      </div>

      {/* ── Footer note ── */}
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
        <Lock size={13} className="flex-shrink-0 text-teal-600 dark:text-teal-300" />
        <p className="text-[13px] text-slate-600 dark:text-slate-300">
          Turning off alerts does not stop you from receiving messages in Blabber.
        </p>
      </div>
      {browserNotificationsUnavailable && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Reminders and alerts require browser notifications to be enabled for Blabber.
        </p>
      )}
      {errorMessage && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300" role="status">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

function noop() {}

// ── Section: Appearance ──────────────────────────────────────────────────────

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const settingsQuery = useUserSettings();
  const updateSettings = useUpdateUserSettings();

  useEffect(() => {
    if (settingsQuery.data?.themePreference && settingsQuery.data.themePreference !== theme) {
      setTheme(settingsQuery.data.themePreference);
    }
  }, [setTheme, settingsQuery.data?.themePreference, theme]);

  const options: Array<{ value: ThemePreference; label: string; desc: string; icon: typeof Sun }> = [
    { value: 'system', label: 'System', desc: 'Match this device automatically.', icon: Monitor },
    { value: 'light', label: 'Light', desc: 'Use Blabber in light mode.', icon: Sun },
    { value: 'dark', label: 'Dark', desc: 'Use Blabber in dark mode.', icon: Moon },
  ];

  const chooseTheme = (value: ThemePreference) => {
    setTheme(value);
    updateSettings.mutate({ themePreference: value });
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Appearance</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Customize how Blabber looks and feels.
        </p>
      </div>

      <div>
        <SecurityHeading>Theme</SecurityHeading>
        <SecurityCard>
          <div role="radiogroup" aria-label="Theme">
            {options.map((option, i) => {
              const selected = theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => chooseTheme(option.value)}
                  className={`flex w-full items-center gap-3 px-5 py-4 text-left transition ${
                    i < options.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : ''
                  } ${selected ? 'bg-teal-50/60 dark:bg-teal-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}
                >
                  <span
                    className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
                      selected
                        ? 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300'
                    }`}
                  >
                    <option.icon size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-slate-900 dark:text-white">{option.label}</p>
                    <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{option.desc}</p>
                  </div>
                  <span
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                      selected ? 'border-teal-500' : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    {selected && <span className="h-2.5 w-2.5 rounded-full bg-teal-500" />}
                  </span>
                </button>
              );
            })}
          </div>
        </SecurityCard>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Your theme choice is saved to your account and applies wherever you sign in.
      </p>
    </div>
  );
}

// ── Section: AI privacy ──────────────────────────────────────────────────────

function EnableFullAccessConfirmModal({ onCancel, onConfirm, isPending }: { onCancel: () => void; onConfirm: () => void; isPending: boolean }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="enable-full-access-title"
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
            <AlertTriangle size={18} />
          </span>
          <div className="min-w-0">
            <h2 id="enable-full-access-title" className="text-base font-semibold text-slate-900 dark:text-white">
              Give Veyra full access?
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Veyra will be able to search all Blabber spaces and content you can access. You can turn this off anytime.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
          >
            {isPending ? 'Enabling...' : 'Enable full access'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AISection() {
  const navigate = useNavigate();
  const settingsQuery = useUserSettings();
  const updateSettings = useUpdateUserSettings();
  const queryClient = useQueryClient();
  const [selectedScope, setSelectedScope] = useState('');
  const [showAddSpace, setShowAddSpace] = useState(false);
  const [showFullAccessConfirm, setShowFullAccessConfirm] = useState(false);
  const clearHistory = useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.delete('/api/intelligence/history/me');
      return data;
    },
  });
  const availabilityQuery = useQuery({
    queryKey: ['intelligence-availability'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ status: 'available' | 'not_configured' | 'temporarily_unavailable' }>(
        '/api/intelligence/availability'
      );
      return data.status;
    },
  });

  const enabled = settingsQuery.data?.chatIntelligenceEnabled ?? true;
  const veyraQuery = useQuery({
    queryKey: ['veyra-settings'],
    queryFn: fetchVeyraSettings,
  });
  const scopeCandidates = useQuery({
    queryKey: ['veyra-scope-candidates'],
    queryFn: fetchVeyraScopeCandidates,
    enabled: Boolean(veyraQuery.data?.settings.enabled),
  });
  const syncVeyraSettings = (settings: VeyraSettings) => {
    queryClient.setQueryData(['veyra-settings'], (current: any) =>
      current ? { ...current, settings } : { settings, globalAiEnabled: enabled }
    );
    void queryClient.invalidateQueries({ queryKey: ['veyra-settings'] });
    void queryClient.invalidateQueries({ queryKey: ['veyra-scope-candidates'] });
  };
  const updateVeyra = useMutation({
    mutationFn: updateVeyraSettings,
    onSuccess: syncVeyraSettings,
  });
  const grantScope = useMutation({
    mutationFn: () => {
      const candidate = scopeCandidates.data?.find((item) => `${item.type}:${item.targetId || ''}` === selectedScope);
      if (!candidate) throw new Error('Choose a space.');
      return grantVeyraScope({ type: candidate.type, targetId: candidate.targetId });
    },
	    onSuccess: (settings) => {
	      setSelectedScope('');
	      syncVeyraSettings(settings);
	    },
	  });
	  const revokeScope = useMutation({
	    mutationFn: revokeVeyraScope,
	    onSuccess: syncVeyraSettings,
	  });
  const veyra = veyraQuery.data?.settings;
  const availabilityLabel =
    availabilityQuery.data === 'available'
      ? 'Available'
      : availabilityQuery.data === 'not_configured'
        ? 'Not configured'
        : availabilityQuery.isError
          ? 'Temporarily unavailable'
          : 'Checking...';

  const scopeTypeMeta: Record<string, { label: string; icon: typeof Users }> = {
    chat: { label: 'Chat', icon: MessageSquare },
    community: { label: 'Community', icon: Users },
    my_actions: { label: 'My Actions', icon: Check },
    general: { label: 'General', icon: Globe },
  };

  const toggleStatus = (on: boolean) => (
    <span className="flex items-center gap-2">
      <span className={`text-xs font-semibold ${on ? 'text-teal-600 dark:text-teal-300' : 'text-slate-400 dark:text-slate-500'}`}>
        {on ? 'On' : 'Off'}
      </span>
    </span>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">AI Privacy / Veyra</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Manage how Veyra uses your data and the spaces you approve.
        </p>
      </div>

      {/* ── Trust banner ── */}
      <section
        className="relative overflow-hidden rounded-2xl border border-teal-500/30 p-5"
        style={{ boxShadow: 'var(--bl-glow-sm)' }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 dark:hidden"
          style={{ background: 'linear-gradient(120deg, #effffb 0%, #dcfcf2 55%, #e9fcff 100%)' }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 hidden dark:block"
          style={{ background: 'linear-gradient(120deg, #06251f 0%, #0a3a34 55%, #07293b 100%)' }}
        />
        <div className="relative flex items-center gap-4">
          <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-600 dark:text-teal-300">
            <ShieldCheck size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">Your privacy is our priority</h2>
            <p className="mt-0.5 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
              Veyra only accesses the spaces you approve. It does not read your other conversations or private content.
            </p>
          </div>
          <div className="hidden flex-shrink-0 sm:block">
            <VeyraMark size={52} alive />
          </div>
        </div>
      </section>

      {/* ── AI request controls ── */}
      <PrivacyCard icon={Sparkles} title="AI controls" right={
        <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200" title="Server-side provider status">
          {availabilityLabel}
        </span>
      }>
        <PrivacyRow
          label="AI requests"
          desc="Allow AI features and let Veyra answer your questions inside approved spaces."
          control={
            <span className="flex items-center gap-2.5">
              {toggleStatus(enabled)}
              <Toggle
                checked={enabled}
                onChange={() => updateSettings.mutate({ chatIntelligenceEnabled: !enabled })}
                label="AI requests"
              />
            </span>
          }
        />
        <PrivacyRow
          label="Veyra assistant"
          desc="Enable the Veyra assistant for your account. You choose exactly which spaces it can use."
          control={
            <span className="flex items-center gap-2.5">
              {toggleStatus(Boolean(veyra?.enabled))}
              <Toggle
                checked={Boolean(veyra?.enabled)}
                onChange={() => {
                  if (!veyra?.enabled && !enabled) {
                    window.alert('Turn on AI requests above to use Veyra.');
                    return;
                  }
                  if (!veyra?.enabled && !window.confirm('Enable Veyra for your account? You will choose exactly which spaces it can use.')) return;
                  updateVeyra.mutate({ enabled: !veyra?.enabled });
                }}
                label="Enable Veyra"
              />
            </span>
          }
        />
        <PrivacyRow
          label="Voice replies"
          desc="Let Veyra respond with voice when supported."
          control={
            <span className="flex items-center gap-2.5">
              {toggleStatus(veyra?.voiceRepliesEnabled ?? true)}
              <Toggle
                checked={veyra?.voiceRepliesEnabled ?? true}
                onChange={() => updateVeyra.mutate({ voiceRepliesEnabled: !(veyra?.voiceRepliesEnabled ?? true) })}
                label="Veyra voice replies"
              />
            </span>
          }
          last
        />
      </PrivacyCard>

      {/* ── Veyra access mode ── */}
      <PrivacyCard
        icon={veyra?.accessMode === 'full_access' ? Unlock : Lock}
        title="Veyra access"
        subtitle="Choose how much of Blabber Veyra is allowed to search."
      >
        <div className="space-y-2.5">
          {(
            [
              {
                value: 'approved_spaces' as const,
                label: 'Approved spaces only',
                desc: 'Veyra only searches spaces you’ve explicitly approved below. This is the default.',
              },
              {
                value: 'full_access' as const,
                label: 'Full access to my Blabber',
                desc: 'Veyra can search all chats, groups, files, links, posts, plans, and actions you can already access.',
              },
            ] as const
          ).map((option) => {
            const checked = (veyra?.accessMode || 'approved_spaces') === option.value;
            return (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                  checked
                    ? 'border-teal-500/50 bg-teal-50/70 dark:border-teal-400/40 dark:bg-teal-500/10'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60'
                }`}
              >
                <input
                  type="radio"
                  name="veyra-access-mode"
                  value={option.value}
                  checked={checked}
                  disabled={!veyra?.enabled || updateVeyra.isPending}
                  onChange={() => {
                    if (option.value === 'full_access') {
                      setShowFullAccessConfirm(true);
                      return;
                    }
                    updateVeyra.mutate({ accessMode: 'approved_spaces' });
                  }}
                  className="mt-0.5 h-4 w-4 border-slate-400 text-teal-600 focus:ring-teal-500"
                />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-slate-900 dark:text-white">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{option.desc}</span>
                </span>
              </label>
            );
          })}
        </div>
        {!veyra?.enabled && (
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">Enable the Veyra assistant above to change this.</p>
        )}
      </PrivacyCard>

      {showFullAccessConfirm && (
        <EnableFullAccessConfirmModal
          isPending={updateVeyra.isPending}
          onCancel={() => setShowFullAccessConfirm(false)}
          onConfirm={() => {
            updateVeyra.mutate(
              { accessMode: 'full_access' },
              { onSuccess: () => setShowFullAccessConfirm(false) }
            );
          }}
        />
      )}

      {/* ── Approved spaces ── */}
      <PrivacyCard
        icon={Lock}
        title="Approved spaces"
        subtitle="Veyra can read messages and files only in the spaces listed below."
        right={
          <button
            type="button"
            onClick={() => setShowAddSpace((value) => !value)}
            disabled={!veyra?.enabled}
            className="inline-flex items-center gap-1.5 rounded-xl border border-teal-500/40 px-3 py-1.5 text-[13px] font-semibold text-teal-700 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-500/10"
          >
            <Plus size={13} />
            Add space
          </button>
        }
      >
        {showAddSpace && veyra?.enabled && (
          <div className="mb-3 flex flex-col gap-2 rounded-xl border border-teal-500/30 bg-teal-50/50 p-3 dark:bg-teal-500/5 sm:flex-row">
            <select
              value={selectedScope}
              onChange={(event) => setSelectedScope(event.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            >
              <option value="">Choose a space</option>
              {(scopeCandidates.data || []).map((candidate) => (
                <option key={`${candidate.type}:${candidate.targetId || ''}`} value={`${candidate.type}:${candidate.targetId || ''}`}>
                  {candidate.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => grantScope.mutate()}
              disabled={!selectedScope || grantScope.isPending}
              className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
            >
              {grantScope.isPending ? 'Approving…' : 'Approve'}
            </button>
          </div>
        )}

        {(veyra?.scopes || []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">No spaces approved yet.</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Approve a chat or group when you want Veyra to help there.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {veyra!.scopes.map((scope) => {
              const meta = scopeTypeMeta[scope.type] || { label: scope.type, icon: Globe };
              return (
                <div key={scope.id} className="flex items-center gap-3 py-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
                    <meta.icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{scope.label || meta.label}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{meta.label}</p>
                  </div>
                  <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-[11px] font-semibold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
                    Approved
                  </span>
                  <button
                    type="button"
                    onClick={() => revokeScope.mutate(scope.id)}
                    disabled={revokeScope.isPending}
                    className="rounded-lg px-2 py-1 text-[13px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                  >
                    Revoke
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Review and remove any space to stop Veyra from accessing it.</span>
          <button
            type="button"
            onClick={() => navigate('/settings?s=help')}
            className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:underline dark:text-teal-300"
          >
            Learn more <ExternalLink size={11} />
          </button>
        </p>
      </PrivacyCard>

      {/* ── AI activity & history ── */}
      <PrivacyCard icon={History} title="AI activity & history" subtitle="Manage what Veyra has stored for you.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-slate-900 dark:text-white">Clear AI history</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Delete your past AI interactions and context.
            </p>
          </div>
          <button
            onClick={() => {
              if (!window.confirm('Delete your past AI interactions and context? This cannot be undone.')) return;
              clearHistory.mutate();
            }}
            disabled={clearHistory.isPending}
            className="rounded-xl border border-rose-300/70 px-3.5 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-500/40 dark:text-rose-400 dark:hover:bg-rose-500/10"
          >
            {clearHistory.isPending ? 'Clearing…' : 'Clear history'}
          </button>
        </div>
        {clearHistory.isSuccess && (
          <p className="mt-2 text-xs text-teal-700 dark:text-teal-300" role="status">AI history cleared.</p>
        )}
        {clearHistory.isError && (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-300" role="status">Unable to clear AI history. Try again.</p>
        )}
        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
          AI analysis runs only when you manually request it from a chat or open Veyra. Veyra is read-only in this version.
        </p>
      </PrivacyCard>

      {/* ── Privacy note ── */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
        <p className="flex min-w-0 items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
          <Lock size={13} className="flex-shrink-0 text-teal-600 dark:text-teal-300" />
          <span>
            AI never shares your data with anyone.{' '}
            <button
              type="button"
              onClick={() => navigate('/settings?s=help')}
              className="font-semibold text-teal-700 hover:underline dark:text-teal-300"
            >
              Learn more
            </button>{' '}
            about Blabber&apos;s AI privacy.
          </span>
        </p>
      </div>
    </div>
  );
}

// ── Section: Help ────────────────────────────────────────────────────────────

function HelpSection() {
  const navigate = useNavigate();
  const [openTopic, setOpenTopic] = useState<string | null>(null);

  const topics: Array<{
    key: string;
    icon: typeof Rocket;
    title: string;
    desc: string;
    body: string;
    link?: { label: string; to: string };
  }> = [
    {
      key: 'getting-started',
      icon: Rocket,
      title: 'Getting started',
      desc: 'Learn the basics of Blabber.',
      body: 'Use New Chat to start one-to-one conversations, browse Discover to find people and content, and share updates from the Feed, Reels, and Moments tabs. Your profile, privacy, and notifications are all managed from this Settings area.',
    },
    {
      key: 'chats-groups',
      icon: MessageSquare,
      title: 'Chats & groups',
      desc: 'Everything about messaging and group chats.',
      body: 'Use New Chat for one-to-one conversations, or create a group and add members. Start voice and video calls from a direct chat: if someone disabled incoming calls, Blabber will tell you cleanly. Open Intelligence from a chat for summaries, actions, decisions, and group memory.',
    },
    {
      key: 'content',
      icon: Clapperboard,
      title: 'Posts, Reels & Moments',
      desc: 'Share content and express yourself.',
      body: 'Share posts to your feed, publish short reels, and post short-lived Moments from the main navigation. Only content you choose to make discoverable can appear in Discover, and Moments always expire on their own.',
    },
    {
      key: 'privacy',
      icon: Shield,
      title: 'Privacy & Visibility',
      desc: 'Control who sees what you share.',
      body: 'Control read receipts, presence, last-seen visibility, incoming calls, who can message you, and who can add you to groups. Profile visibility decides whether people can see your posts without following you.',
      link: { label: 'Open Privacy settings', to: '/settings?s=privacy' },
    },
    {
      key: 'ai',
      icon: Sparkles,
      title: 'AI Privacy / Veyra',
      desc: 'Manage your AI interactions and data.',
      body: 'Veyra and Chat Intelligence only read the spaces you approve. You can review approved spaces, turn off AI requests, and clear your AI history at any time.',
      link: { label: 'Open AI Privacy settings', to: '/settings?s=ai' },
    },
    {
      key: 'account',
      icon: Lock,
      title: 'Account & Security',
      desc: 'Keep your account safe and secure.',
      body: 'Manage your email, review signed-in devices, and sign out sessions you don’t recognize. Use Forgot Password on the sign-in page if you ever get locked out.',
      link: { label: 'Open Account & Security', to: '/settings?s=account' },
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Help</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Resources and support for using Blabber.
        </p>
      </div>

      <SecurityCard>
        {topics.map((topic, i) => {
          const open = openTopic === topic.key;
          return (
            <div key={topic.key} className={i < topics.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : ''}>
              <button
                type="button"
                onClick={() => setOpenTopic(open ? null : topic.key)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-700/40"
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
                  <topic.icon size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-slate-900 dark:text-white">{topic.title}</p>
                  <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{topic.desc}</p>
                </div>
                <ChevronDown
                  size={16}
                  className={`flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </button>
              {open && (
                <div className="px-5 pb-5">
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                    <p className="text-[13px] leading-5 text-slate-600 dark:text-slate-300">{topic.body}</p>
                    {topic.link && (
                      <button
                        type="button"
                        onClick={() => navigate(topic.link!.to)}
                        className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-teal-700 transition hover:text-teal-800 dark:text-teal-300 dark:hover:text-teal-200"
                      >
                        {topic.link.label}
                        <ArrowRight size={13} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </SecurityCard>

      <a
        href="mailto:support@example.com?subject=Blabber%20support"
        className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 px-5 py-4 transition hover:bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/20 dark:hover:bg-rose-950/30"
      >
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
          <Bug size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-slate-900 dark:text-white">Report an issue</span>
          <span className="mt-0.5 block text-[13px] text-slate-500 dark:text-slate-400">
            Found a bug or need help? Let us know.
          </span>
        </span>
        <ExternalLink size={15} className="flex-shrink-0 text-slate-400" />
      </a>
    </div>
  );
}

function DiscoverySection() {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['my-profile'], queryFn: fetchMyProfile });
  const topics = useQuery({ queryKey: ['discovery-topics'], queryFn: fetchDiscoveryTopics });
  const prefs = useQuery({ queryKey: ['discovery-preferences'], queryFn: fetchDiscoveryPreferences });
  const [notice, setNotice] = useState('');
  const [noticeIsError, setNoticeIsError] = useState(false);

  const discovery = profile.data?.creatorDiscovery;
  const profileEnabled = Boolean(discovery?.enabled);
  const topicIds = discovery?.topicIds || [];
  const showPosts = discovery?.showPostsInDiscover !== false;
  const showReels = discovery?.showReelsInDiscover !== false;
  const suggestEnabled = discovery?.suggestMeToOthers !== false;
  const usernameFindability = discovery?.usernameFindability || 'everyone';
  const hideBlocked = discovery?.hideBlockedUsers !== false;
  const personalizedEnabled = prefs.data?.personalizedDiscoveryEnabled !== false;
  const loaded = Boolean(profile.data);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    queryClient.invalidateQueries({ queryKey: ['discovery-preferences'] });
    queryClient.invalidateQueries({ queryKey: ['discovery'] });
  };

  const showOk = (text: string) => {
    setNotice(text);
    setNoticeIsError(false);
  };
  const showErr = (text: string) => {
    setNotice(text);
    setNoticeIsError(true);
  };

  const saveDiscovery = useMutation({
    mutationFn: updateCreatorDiscovery,
    onSuccess: () => {
      showOk('Discovery settings saved.');
      refresh();
    },
    onError: (error) => {
      const err = error as { response?: { data?: { message?: string } } };
      showErr(err.response?.data?.message || 'Unable to save discovery settings.');
    },
  });

  const savePersonalization = useMutation({
    mutationFn: (enabled: boolean) => updateDiscoveryPreferences({ personalizedDiscoveryEnabled: enabled }),
    onSuccess: () => {
      showOk('Discovery settings saved.');
      refresh();
    },
    onError: () => showErr('Unable to save personalization settings.'),
  });

  const clearPersonalization = useMutation({
    mutationFn: clearDiscoveryPersonalization,
    onSuccess: () => {
      showOk('Personalized discovery activity cleared.');
      refresh();
    },
    onError: () => showErr('Unable to clear personalization data.'),
  });

  const toggleProfile = () => {
    if (!loaded || saveDiscovery.isPending) return;
    if (!profileEnabled && topicIds.length === 0) {
      showErr('Choose at least one creator topic below before turning this on.');
      return;
    }
    saveDiscovery.mutate({ creatorDiscoveryEnabled: !profileEnabled, creatorTopicIds: topicIds });
  };

  const toggleTopic = (topic: DiscoveryTopic) => {
    if (!loaded || saveDiscovery.isPending) return;
    const next = topicIds.includes(topic.id)
      ? topicIds.filter((id) => id !== topic.id)
      : topicIds.length >= 5
        ? topicIds
        : [...topicIds, topic.id];
    if (next.length === topicIds.length && !topicIds.includes(topic.id)) {
      showErr('You can choose up to five creator topics.');
      return;
    }
    if (profileEnabled && next.length === 0) {
      showErr('Keep at least one topic while your profile is shown in Discover.');
      return;
    }
    saveDiscovery.mutate({ creatorDiscoveryEnabled: profileEnabled, creatorTopicIds: next });
  };

  const toggleContent = (
    field: 'showPostsInDiscover' | 'showReelsInDiscover' | 'suggestMeToOthers' | 'hideBlockedUsers',
    current: boolean
  ) => {
    if (!loaded || saveDiscovery.isPending) return;
    saveDiscovery.mutate({
      creatorDiscoveryEnabled: profileEnabled,
      creatorTopicIds: topicIds,
      [field]: !current,
    });
  };

  const changeFindability = (value: string) => {
    if (!loaded || saveDiscovery.isPending) return;
    saveDiscovery.mutate({
      creatorDiscoveryEnabled: profileEnabled,
      creatorTopicIds: topicIds,
      usernameFindability: value as 'everyone' | 'followers' | 'contacts' | 'no_one',
    });
  };

  const toggleControl = (on: boolean, onToggle: () => void, label: string) => (
    <span className="flex items-center gap-2.5">
      <span
        className={`text-xs font-semibold ${on ? 'text-teal-600 dark:text-teal-300' : 'text-slate-400 dark:text-slate-500'}`}
      >
        {on ? 'On' : 'Off'}
      </span>
      <Toggle checked={on} onChange={onToggle} label={label} />
    </span>
  );

  const profileHint = !profile.data?.handle
    ? 'Choose a profile handle before showing your profile in Discover.'
    : profile.data?.visibility !== 'public'
      ? 'Make your profile public before showing it in Discover.'
      : topicIds.length === 0
        ? 'Choose at least one topic for your creator profile.'
        : 'Your public profile and eligible public content may appear in Discover.';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Discovery</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Control how you appear in Discover and who can find you.
        </p>
      </div>

      {notice && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            noticeIsError
              ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'
          }`}
        >
          {notice}
        </div>
      )}

      <div>
        <SecurityHeading>Profile visibility</SecurityHeading>
        <SecurityCard>
          <AccountRow
            icon={Globe}
            label="Show my profile in Discover"
            value="Allow others to find your profile in Blabber Discover."
            action={toggleControl(profileEnabled, toggleProfile, 'Show my profile in Discover')}
            expanded
            panel={
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Creator topics (choose 1–5)</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(topics.data || []).map((topic) => (
                    <button
                      key={topic.id}
                      onClick={() => toggleTopic(topic)}
                      disabled={saveDiscovery.isPending}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-60 ${
                        topicIds.includes(topic.id)
                          ? 'border-teal-500 bg-teal-50 text-teal-700 dark:border-teal-500/60 dark:bg-teal-500/15 dark:text-teal-300'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500'
                      }`}
                    >
                      {topic.label}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{profileHint}</p>
              </div>
            }
          />
          <AccountRow
            icon={UserPlus}
            label="Suggest me to others"
            value="Allow Blabber to suggest your profile in the Discover creators list."
            action={toggleControl(suggestEnabled, () => toggleContent('suggestMeToOthers', suggestEnabled), 'Suggest me to others')}
            last
          />
        </SecurityCard>
      </div>

      <div>
        <SecurityHeading>Content visibility</SecurityHeading>
        <SecurityCard>
          <AccountRow
            icon={Newspaper}
            label="Show my posts in Discover"
            value={
              <>
                Allow my public posts to appear in Blabber Discover.
                <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
                  Applies to posts you've marked discoverable. Private posts never appear.
                </span>
              </>
            }
            action={toggleControl(showPosts, () => toggleContent('showPostsInDiscover', showPosts), 'Show my posts in Discover')}
          />
          <AccountRow
            icon={Clapperboard}
            label="Show my reels in Discover"
            value={
              <>
                Allow my public reels to appear in Blabber Discover.
                <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
                  Applies to reels you've marked discoverable. Private reels never appear.
                </span>
              </>
            }
            action={toggleControl(showReels, () => toggleContent('showReelsInDiscover', showReels), 'Show my reels in Discover')}
            last
          />
        </SecurityCard>
      </div>

      <div>
        <SecurityHeading>Who can find you</SecurityHeading>
        <SecurityCard>
          <AccountRow
            icon={AtSign}
            label="Who can find me by username"
            value="Choose who can find you in search using your @username."
            action={
              <PrivacySelect
                value={usernameFindability}
                options={[
                  { value: 'everyone', label: 'Everyone' },
                  { value: 'followers', label: 'Followers' },
                  { value: 'contacts', label: 'Contacts' },
                  { value: 'no_one', label: 'No one' },
                ]}
                onChange={changeFindability}
                label="Who can find me by username"
              />
            }
            last
          />
        </SecurityCard>
      </div>

      <div>
        <SecurityHeading>Safe discovery</SecurityHeading>
        <SecurityCard>
          <AccountRow
            icon={EyeOff}
            label="Hide blocked users"
            value={
              <>
                Hide people you've blocked from your Discover and search results.
                <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
                  People who blocked you never appear, and blocked users can never see your content.
                </span>
              </>
            }
            action={toggleControl(hideBlocked, () => toggleContent('hideBlockedUsers', hideBlocked), 'Hide blocked users')}
            last
          />
        </SecurityCard>
      </div>

      <div>
        <SecurityHeading>Personalization</SecurityHeading>
        <SecurityCard>
          <AccountRow
            icon={Activity}
            label="Personalized discovery"
            value="Let your Discover activity improve future recommendations."
            action={toggleControl(
              personalizedEnabled,
              () => {
                if (prefs.data && !savePersonalization.isPending) savePersonalization.mutate(!personalizedEnabled);
              },
              'Personalized discovery'
            )}
            expanded
            panel={
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-3 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
                  {prefs.data?.followedTopics.length || 0} followed topics
                </div>
                <div className="rounded-xl bg-slate-50 p-3 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
                  {prefs.data?.mutedTopics.length || 0} muted topics
                </div>
                <div className="rounded-xl bg-slate-50 p-3 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
                  {prefs.data?.hiddenPostCount || 0} hidden posts
                </div>
              </div>
            }
          />
          <AccountRow
            icon={History}
            label="Clear personalization data"
            value="Remove the activity Blabber uses to personalize Discover. Your follows, posts, and messages are not deleted."
            action={
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      'Clear the activity Blabber uses for personalized discovery? Your follows, posts, Communities, and messages will not be deleted.'
                    )
                  ) {
                    clearPersonalization.mutate();
                  }
                }}
                disabled={clearPersonalization.isPending}
                className={CHANGE_BTN}
              >
                {clearPersonalization.isPending ? 'Clearing…' : 'Clear'}
              </button>
            }
            last
          />
        </SecurityCard>
      </div>

      <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 dark:border-slate-700 dark:bg-slate-800">
        <Lock size={14} className="flex-shrink-0 text-slate-400" />
        <p className="text-[13px] text-slate-500 dark:text-slate-400">
          Changes you make here help control your visibility across Blabber.
        </p>
      </div>
    </div>
  );
}

// ── Control Center (settings home dashboard) ────────────────────────────────

function StatusPill({ on, label }: { on?: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
        on
          ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
      }`}
    >
      {label}
    </span>
  );
}

function ControlRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[13px] text-slate-600 dark:text-slate-400">{label}</span>
      {value}
    </div>
  );
}

function ControlMetric({ icon: Icon, value, label }: { icon: typeof Users; value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 text-center">
      <Icon size={14} className="text-teal-600 dark:text-teal-300" />
      <span className="text-base font-bold leading-tight text-slate-900 dark:text-white">{value}</span>
      <span className="text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
    </div>
  );
}

function ControlCard({
  icon: Icon,
  title,
  cta,
  onCta,
  className = '',
  children,
}: {
  icon: typeof Users;
  title: string;
  cta?: string;
  onCta?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-[0_0_16px_rgba(45,212,191,0.12)] dark:border-slate-800 dark:bg-slate-900/70 dark:hover:shadow-[0_0_18px_rgba(45,212,191,0.14)] ${className}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
          <Icon size={16} />
        </span>
        <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">{title}</h2>
      </div>
      <div className="mt-3 flex-1">{children}</div>
      {cta && (
        <button
          onClick={onCta}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-[13px] font-semibold text-slate-700 transition hover:border-teal-500/40 hover:bg-teal-50 hover:text-teal-800 dark:border-slate-700 dark:text-slate-200 dark:hover:border-teal-400/40 dark:hover:bg-teal-500/10 dark:hover:text-teal-200"
        >
          {cta}
          <ArrowRight size={13} />
        </button>
      )}
    </section>
  );
}

function CompletionRing({ percent }: { percent: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative h-[76px] w-[76px] flex-shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="5" className="stroke-slate-200 dark:stroke-slate-700" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percent / 100)}
          className="stroke-teal-500 transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[13px] font-bold text-slate-900 dark:text-white">{percent}%</span>
      </div>
    </div>
  );
}

function ControlCenterSection({ onOpenSection }: { onOpenSection: (key: SectionKey) => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const profileUser = user as (typeof user & { avatarUrl?: string; avatar?: string; role?: string }) | null;
  const avatarUrl = profileUser?.avatarUrl || profileUser?.avatar;

  const settingsQuery = useUserSettings();
  const myProfileQuery = useQuery({ queryKey: ['profiles', 'me'], queryFn: fetchMyProfile });
  const profile = myProfileQuery.data;
  const handle = profile?.handle?.replace(/^@/, '') || '';

  const postsQuery = useQuery({
    queryKey: ['profile-posts', handle],
    queryFn: () => fetchProfilePosts(handle),
    enabled: Boolean(handle),
  });
  const reelsQuery = useQuery({
    queryKey: ['profile-reels', handle],
    queryFn: () => fetchProfileReels(handle),
    enabled: Boolean(handle),
  });
  const sessionsQuery = useQuery({ queryKey: ['account-sessions'], queryFn: fetchDeviceSessions });
  const veyraQuery = useQuery({ queryKey: ['veyra-settings'], queryFn: fetchVeyraSettings });
  const discoveryPrefsQuery = useQuery({ queryKey: ['discovery-preferences'], queryFn: fetchDiscoveryPreferences });
  const savedMessagesQuery = useSavedMessages();
  const savedPostsQuery = useQuery({ queryKey: ['saved-posts'], queryFn: () => fetchSavedPosts() });
  const preferencesQuery = useQuery({
    queryKey: ['notification-preferences', user?._id],
    enabled: Boolean(user?._id),
    queryFn: async () => {
      const { data } = await apiClient.get<{ preferences: NotificationPreferences }>(
        `/api/notifications/preferences/${user!._id}`
      );
      return data.preferences;
    },
  });
  const [browserPermission] = useState(() => getBrowserPermission());

  const settings = settingsQuery.data;
  const preferences = preferencesQuery.data;
  const sessions = sessionsQuery.data?.sessions || [];
  const { activeSessions, groups: deviceGroups } = groupActiveDeviceSessions(sessions);
  const currentSession = activeSessions.find((session) => session.current);
  const veyra = veyraQuery.data;

  // Client-side completion over the fields the product actually stores.
  const completionChecks = [
    Boolean(avatarUrl),
    Boolean(user?.name),
    Boolean(handle),
    Boolean(profile?.bio),
    Boolean(profile?.website),
    Boolean(profileUser?.role),
  ];
  const completion = Math.round((completionChecks.filter(Boolean).length / completionChecks.length) * 100);

  const openPublicProfile = () => {
    if (handle) navigate(`/p/${handle}`);
    else onOpenSection('profile');
  };

  const countWithMore = (loaded: number | undefined, hasMore: boolean) =>
    loaded === undefined ? '…' : hasMore ? `${loaded}+` : String(loaded);

  const lastLoginAt = currentSession?.lastActiveAt || currentSession?.createdAt;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Control Center</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Quickly review your account, privacy, activity, and creator presence.
          </p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap gap-2">
          <button
            onClick={openPublicProfile}
            className="inline-flex items-center gap-2 rounded-xl border border-teal-500/40 px-3.5 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-500/10"
          >
            <ExternalLink size={14} />
            View public profile
          </button>
          <button
            onClick={() => onOpenSection('profile')}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
          >
            <Pencil size={14} />
            Edit profile
          </button>
        </div>
      </div>

      {/* Row 1: profile status / public profile / privacy */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ControlCard icon={Check} title="Profile status">
          <div className="flex items-center gap-4">
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
              <Avatar src={avatarUrl} alt={user?.name || 'You'} size="lg" online={true} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{user?.name || user?.username}</p>
                <p className="truncate text-xs text-teal-600 dark:text-teal-300">{handle ? `@${handle}` : 'No handle yet'}</p>
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <CompletionRing percent={completion} />
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Complete</span>
            </div>
          </div>
          <button
            onClick={() => onOpenSection('profile')}
            className="mt-4 w-full rounded-xl bg-teal-600 py-2 text-[13px] font-semibold text-white transition hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
          >
            {completion < 100 ? 'Complete profile' : 'Edit profile'}
          </button>
        </ControlCard>

        <ControlCard icon={Globe} title="Public profile" cta="View public profile" onCta={openPublicProfile}>
          {profile ? (
            <>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                {profile.visibility === 'public' ? 'Public' : 'Private'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {profile.visibility === 'public' ? 'Visible to everyone' : 'Only approved followers see your content'}
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <ControlMetric icon={Users} value={String(profile.counts?.followers ?? 0)} label="Followers" />
                <ControlMetric
                  icon={Newspaper}
                  value={handle ? countWithMore(postsQuery.data?.posts.length, Boolean(postsQuery.data?.nextCursor)) : '0'}
                  label="Posts"
                />
                <ControlMetric
                  icon={Clapperboard}
                  value={handle ? countWithMore(reelsQuery.data?.reels.length, Boolean(reelsQuery.data?.nextCursor)) : '0'}
                  label="Reels"
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading profile…</p>
          )}
        </ControlCard>

        <ControlCard icon={Shield} title="Privacy snapshot" cta="Manage privacy" onCta={() => onOpenSection('privacy')}>
          {settings ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              <ControlRow label="Messages" value={<StatusPill on={settings.messagePrivacy === 'everyone'} label={CONTACT_PRIVACY_LABEL[settings.messagePrivacy]} />} />
              <ControlRow label="Group invites" value={<StatusPill on={settings.groupInvitePrivacy === 'everyone'} label={CONTACT_PRIVACY_LABEL[settings.groupInvitePrivacy]} />} />
              <ControlRow label="Read receipts" value={<StatusPill on={settings.readReceiptsEnabled} label={settings.readReceiptsEnabled ? 'On' : 'Off'} />} />
              <ControlRow label="Last seen" value={<StatusPill on={settings.lastSeenVisible} label={settings.lastSeenVisible ? 'On' : 'Off'} />} />
              <ControlRow label="Incoming calls" value={<StatusPill on={settings.incomingCallsEnabled} label={settings.incomingCallsEnabled ? 'On' : 'Off'} />} />
              <ControlRow label="Moment archive" value={<StatusPill on={settings.momentArchiveEnabled} label={settings.momentArchiveEnabled ? 'On' : 'Off'} />} />
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading privacy settings…</p>
          )}
        </ControlCard>
      </div>

      {/* Row 2: notifications / security / AI / discovery */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ControlCard icon={Bell} title="Notifications" cta="Manage notifications" onCta={() => onOpenSection('notifications')}>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            <ControlRow
              label="Browser alerts"
              value={
                <StatusPill
                  on={browserPermission === 'granted'}
                  label={
                    browserPermission === 'granted'
                      ? 'Allowed'
                      : browserPermission === 'denied'
                        ? 'Blocked'
                        : browserPermission === 'unsupported'
                          ? 'Unsupported'
                          : 'Not asked'
                  }
                />
              }
            />
            <ControlRow
              label="Message alerts"
              value={preferences ? <StatusPill on={preferences.messageNotificationsEnabled} label={preferences.messageNotificationsEnabled ? 'On' : 'Off'} /> : <StatusPill label="…" />}
            />
            <ControlRow
              label="Moment alerts"
              value={preferences ? <StatusPill on={preferences.momentUpdatesEnabled} label={preferences.momentUpdatesEnabled ? 'On' : 'Off'} /> : <StatusPill label="…" />}
            />
          </div>
        </ControlCard>

        <ControlCard icon={Laptop} title="Account security" cta="Review devices" onCta={() => onOpenSection('account')}>
          {sessionsQuery.isError ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Device details unavailable.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              <ControlRow
                label="Recognized devices"
                value={<span className="text-sm font-bold text-slate-900 dark:text-white">{sessionsQuery.data ? deviceGroups.length : '…'}</span>}
              />
              <div className="py-1.5">
                <p className="text-[13px] text-slate-600 dark:text-slate-400">Last active</p>
                {lastLoginAt ? (
                  <>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">
                      {new Date(lastLoginAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                    {currentSession?.label && (
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{currentSession.label}</p>
                    )}
                  </>
                ) : (
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                    {sessionsQuery.data ? 'Device details unavailable' : '…'}
                  </p>
                )}
              </div>
            </div>
          )}
        </ControlCard>

        <ControlCard icon={Sparkles} title="AI & VEYRA" cta="Manage AI access" onCta={() => onOpenSection('ai')}>
          {veyra ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              <ControlRow
                label="Approved spaces"
                value={<span className="text-sm font-bold text-slate-900 dark:text-white">{veyra.settings.scopes.length}</span>}
              />
              <ControlRow label="AI requests" value={<StatusPill on={veyra.settings.enabled && veyra.globalAiEnabled} label={veyra.settings.enabled && veyra.globalAiEnabled ? 'Enabled' : 'Disabled'} />} />
              <ControlRow label="Voice replies" value={<StatusPill on={veyra.settings.voiceRepliesEnabled} label={veyra.settings.voiceRepliesEnabled ? 'On' : 'Off'} />} />
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading VEYRA settings…</p>
          )}
          <p className="mt-2 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
            VEYRA only reads spaces you have approved.
          </p>
        </ControlCard>

        <ControlCard icon={Compass} title="Discovery" cta="Manage discovery" onCta={() => onOpenSection('discovery')}>
          {profile && discoveryPrefsQuery.data ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              <ControlRow
                label="Profile in Discover"
                value={<StatusPill on={profile.creatorDiscovery?.enabled} label={profile.creatorDiscovery?.enabled ? 'On' : 'Off'} />}
              />
              <ControlRow
                label="Posts in Discover"
                value={
                  <StatusPill
                    on={profile.creatorDiscovery?.showPostsInDiscover !== false}
                    label={profile.creatorDiscovery?.showPostsInDiscover !== false ? 'On' : 'Off'}
                  />
                }
              />
              <ControlRow
                label="Reels in Discover"
                value={
                  <StatusPill
                    on={profile.creatorDiscovery?.showReelsInDiscover !== false}
                    label={profile.creatorDiscovery?.showReelsInDiscover !== false ? 'On' : 'Off'}
                  />
                }
              />
              <ControlRow
                label="Personalization"
                value={<StatusPill on={discoveryPrefsQuery.data.personalizedDiscoveryEnabled} label={discoveryPrefsQuery.data.personalizedDiscoveryEnabled ? 'On' : 'Off'} />}
              />
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading discovery settings…</p>
          )}
        </ControlCard>
      </div>

      {/* Row 3: saved summary */}
      <ControlCard icon={Bookmark} title="Saved summary">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
                <MessageSquare size={17} />
              </span>
              <div>
                <p className="text-lg font-bold leading-tight text-slate-900 dark:text-white">
                  {savedMessagesQuery.data ? savedMessagesQuery.data.savedMessages.length : '…'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Saved messages · across all chats</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
                <Bookmark size={17} />
              </span>
              <div>
                <p className="text-lg font-bold leading-tight text-slate-900 dark:text-white">
                  {savedPostsQuery.data
                    ? countWithMore(savedPostsQuery.data.savedPosts.length, Boolean(savedPostsQuery.data.nextCursor))
                    : '…'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Saved posts · from your feed</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => onOpenSection('saved')}
            className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
          >
            Open saved
            <ArrowRight size={13} />
          </button>
        </div>
      </ControlCard>
    </div>
  );
}

// ── Main SettingsPage ────────────────────────────────────────────────────────

export default function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  // `s` is the canonical param; `section` is accepted as an alias. Unknown or
  // missing values land on the Control Center dashboard.
  const requestedKey = searchParams.get('s') || searchParams.get('section') || '';
  const activeKey: SectionKey = SECTION_KEYS.has(requestedKey) ? (requestedKey as SectionKey) : 'control-center';

  const setSection = (key: SectionKey) => {
    setSearchParams({ s: key }, { replace: true });
  };

  const sectionContent: Record<SectionKey, React.ReactNode> = {
    'control-center': <ControlCenterSection onOpenSection={setSection} />,
    profile:       <ProfileSection />,
    saved:         <SavedContentSection embedded />,
    account:       <AccountSection />,
    privacy:       <PrivacySection />,
    notifications: <NotificationsSection />,
    appearance:    <AppearanceSection />,
    ai:            <AISection />,
    discovery:     <DiscoverySection />,
    help:          <HelpSection />,
  };

  return (
    <div className="min-h-dvh bg-[#f4f5f7] p-2 dark:bg-slate-950 md:p-6">
      <div
        className="mx-auto flex min-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_40px_-25px_rgba(15,23,42,0.2)] dark:border-slate-800 dark:bg-slate-900 md:h-[calc(100dvh-3rem)] md:min-h-0 md:flex-row"
        style={{ maxWidth: '1100px' }}
      >
        {/* ── Left sub-nav ── */}
        <aside className="flex flex-shrink-0 flex-col border-b border-slate-200 bg-[#f8faf9] dark:border-slate-800 dark:bg-slate-900/60 md:w-[240px] md:border-b-0 md:border-r">
          {/* Back to chats */}
          <div className="border-b border-slate-200 p-3 dark:border-slate-800">
            <button
              onClick={() => navigate('/chats')}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <ArrowLeft size={15} />
              Back to chats
            </button>
          </div>

          {/* Section nav */}
          <nav className="flex gap-1 overflow-x-auto p-3 md:block md:flex-1 md:space-y-0.5 md:overflow-y-auto">
            <p className="hidden mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400 md:block">
              Settings
            </p>
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className={`flex flex-shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium transition md:w-full ${
                  activeKey === s.key
                    ? 'bg-teal-50 font-semibold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                <s.icon size={15} className="flex-shrink-0" />
                {s.label}
              </button>
            ))}
          </nav>

          {/* User card at bottom */}
          <div className="hidden border-t border-slate-200 p-3 dark:border-slate-800 md:block">
            <div className="flex items-center gap-2.5 rounded-xl p-2">
              <Avatar
                src={(user as typeof user & { avatarUrl?: string; avatar?: string })?.avatarUrl || user?.avatar}
                alt={user?.name || 'User'}
                size="sm"
                online={true}
              />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-200">
                  {user?.name || user?.username}
                </p>
                <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{user?.email}</p>
              </div>
            </div>
          </div>
        </aside>

        {/* ── Right content ── */}
        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8">
          {sectionContent[activeKey]}
        </main>
      </div>
    </div>
  );
}
