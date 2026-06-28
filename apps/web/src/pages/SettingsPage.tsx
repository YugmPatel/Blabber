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
  Image,
  Trash2,
  ArrowLeft,
  Sun,
  ExternalLink,
  Mail,
  Laptop,
  Download,
  LogOut,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUpdateProfile } from '@/hooks/useUsers';
import { useTheme } from '@/hooks/useTheme';
import Avatar from '@/components/Avatar';
import CameraModal from '@/components/CameraModal';
import {
  apiClient,
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
  getAccessToken,
  logoutOtherDeviceSessions,
  normalizeMediaUrl,
  requestAccountDeletion,
  requestDataExport,
  requestEmailChange,
  resendEmailVerification,
  revokeDeviceSession,
  unblockUser,
  updateProfileHandle,
  updateSocialProfile,
} from '@/api/client';

// ── Section registry ────────────────────────────────────────────────────────

type SectionKey = 'profile' | 'account' | 'privacy' | 'notifications' | 'appearance' | 'ai' | 'help';

const SECTIONS: { key: SectionKey; label: string; icon: typeof User }[] = [
  { key: 'profile',       label: 'Profile',        icon: User       },
  { key: 'account',       label: 'Account',        icon: Shield     },
  { key: 'privacy',       label: 'Privacy',         icon: Shield     },
  { key: 'notifications', label: 'Notifications',   icon: Bell       },
  { key: 'appearance',    label: 'Appearance',      icon: Moon       },
  { key: 'ai',            label: 'AI privacy',      icon: Sparkles   },
  { key: 'help',          label: 'Help',            icon: HelpCircle },
];

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

interface UserSettings {
  readReceiptsEnabled: boolean;
  presenceVisible: boolean;
  lastSeenVisible: boolean;
  incomingCallsEnabled: boolean;
  themePreference: ThemePreference;
  chatIntelligenceEnabled: boolean;
  momentArchiveEnabled: boolean;
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
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [showCameraCapture, setShowCameraCapture] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileHandle, setProfileHandle] = useState('');
  const [profileBio, setProfileBio] = useState('');
  const [profileWebsite, setProfileWebsite] = useState('');
  const [profileVisibility, setProfileVisibility] = useState<'private' | 'public'>('private');
  const [profileNotice, setProfileNotice] = useState('');
  const [profileError, setProfileError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayedAvatar = normalizeMediaUrl(localPreview || savedAvatarUrl);
  const socialProfileQuery = useQuery({
    queryKey: ['profiles', 'me'],
    queryFn: fetchMyProfile,
  });
  const followRequestsQuery = useQuery({
    queryKey: ['profiles', 'requests', 'incoming'],
    queryFn: fetchIncomingFollowRequests,
  });
  const saveSocialProfile = useMutation({
    mutationFn: updateSocialProfile,
    onSuccess: async (profile) => {
      setProfileBio(profile.bio || '');
      setProfileWebsite(profile.website || '');
      setProfileVisibility(profile.visibility || 'private');
      setProfileNotice('Profile saved.');
      setProfileError('');
      await socialProfileQuery.refetch();
      if (refreshUser) refreshUser();
    },
    onError: (err) => {
      const message = axios.isAxiosError(err) ? err.response?.data?.message || 'Unable to save profile.' : 'Unable to save profile.';
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
      await socialProfileQuery.refetch();
    },
    onError: (err) => {
      const message = axios.isAxiosError(err) ? err.response?.data?.message || 'Unable to save handle.' : 'Unable to save handle.';
      setProfileError(message);
      setProfileNotice('');
    },
  });
  const approveRequest = useMutation({
    mutationFn: approveFollowRequest,
    onSuccess: async () => {
      await followRequestsQuery.refetch();
      await socialProfileQuery.refetch();
    },
  });
  const declineRequest = useMutation({
    mutationFn: declineFollowRequest,
    onSuccess: async () => {
      await followRequestsQuery.refetch();
      await socialProfileQuery.refetch();
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

  const handleSave = async () => {
    try {
      // Only send the real server URL (string), never a base64 blob
      await updateProfile.mutateAsync({ name, about, role, department, avatarUrl: savedAvatarUrl });
      if (refreshUser) refreshUser();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to update profile:', err);
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
  };

  const handleSocialSave = async () => {
    await saveSocialProfile.mutateAsync({
      name,
      bio: profileBio,
      website: profileWebsite,
      visibility: profileVisibility,
    });
  };

  const handleHandleSave = async () => {
    await saveHandle.mutateAsync(profileHandle);
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

    setShowAvatarMenu(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleAvatarFile(file);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Account Profile</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Manage your public identity and account settings.
        </p>
      </div>

      {/* Avatar + basic info */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="grid gap-6 md:grid-cols-[160px_1fr]">
          {/* Avatar column */}
          <div className="flex flex-col items-center gap-2">
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
                onClick={() => setShowAvatarMenu(!showAvatarMenu)}
                disabled={isUploadingAvatar}
                className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-white shadow transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900"
                aria-label="Change profile photo"
              >
                {isUploadingAvatar ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              </button>

              {/* Avatar menu */}
              {showAvatarMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowAvatarMenu(false)} />
                  <div className="absolute bottom-10 left-1/2 z-20 w-48 -translate-x-1/2 rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                    >
                      <Image size={15} /> Choose from gallery
                    </button>
                    <button
                      onClick={() => {
                        setShowAvatarMenu(false);
                        setShowCameraCapture(true);
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                    >
                      <Camera size={15} /> Take photo
                    </button>
                    {(savedAvatarUrl || localPreview) && (
                      <button
                        onClick={() => { setSavedAvatarUrl(''); setLocalPreview(''); setUploadError(''); setShowAvatarMenu(false); }}
                        className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                      >
                        <Trash2 size={15} /> Remove photo
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Online
            </span>
            {uploadError && (
              <p className="mt-1 max-w-[160px] text-center text-[10px] leading-tight text-rose-500">
                {uploadError}
              </p>
            )}
          </div>

          {/* Fields */}
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  Display Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={INPUT}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  Handle
                </label>
                <input
                  type="text"
                  value={`@${user?.username || ''}`}
                  disabled
                  className={DISABLED_INPUT}
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                Email Address
              </label>
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className={DISABLED_INPUT}
              />
            </div>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">About You</h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Tell your team a bit about your role.
        </p>
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                Role
              </label>
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
            <label className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">
              Profile note
            </label>
            <textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="Focusing on Blabber V2 launch 🚀"
              className={`${INPUT} resize-none`}
              rows={3}
              maxLength={140}
            />
            <p className="mt-1 text-right text-xs text-slate-400">{about.length}/140</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Social Profile</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Control your handle, profile details, and follow requests.
            </p>
          </div>
          <div className="flex gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{socialProfileQuery.data?.counts?.followers ?? 0} followers</span>
            <span>{socialProfileQuery.data?.counts?.following ?? 0} following</span>
          </div>
        </div>

        {(profileNotice || profileError) && (
          <div
            className={`mt-4 rounded-xl border px-3 py-2 text-sm ${
              profileError
                ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'
            }`}
          >
            {profileError || profileNotice}
          </div>
        )}

        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">
              Profile handle
            </label>
            <div className="flex rounded-xl border border-slate-200 bg-slate-50 focus-within:border-teal-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-100 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-teal-500">
              <span className="px-3.5 py-2.5 text-sm text-slate-400">@</span>
              <input
                type="text"
                value={profileHandle}
                onChange={(e) => setProfileHandle(e.target.value.replace(/^@/, '').toLowerCase())}
                placeholder="your_handle"
                className="min-w-0 flex-1 bg-transparent py-2.5 pr-3.5 text-sm text-slate-900 outline-none dark:text-white"
                maxLength={30}
              />
            </div>
          </div>
          <button
            onClick={handleHandleSave}
            disabled={saveHandle.isPending || !profileHandle}
            className="self-end rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-slate-950"
          >
            {saveHandle.isPending ? 'Saving...' : 'Save handle'}
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">Website</label>
            <input
              type="url"
              value={profileWebsite}
              onChange={(e) => setProfileWebsite(e.target.value)}
              placeholder="https://example.com"
              className={INPUT}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">Visibility</label>
            <div className="grid grid-cols-2 gap-2">
              {(['private', 'public'] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setProfileVisibility(value)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold capitalize ${
                    profileVisibility === value
                      ? 'border-teal-400 bg-teal-50 text-teal-700 dark:border-teal-500 dark:bg-teal-950/40 dark:text-teal-200'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">Bio</label>
          <textarea
            value={profileBio}
            onChange={(e) => setProfileBio(e.target.value)}
            className={`${INPUT} resize-none`}
            rows={3}
            maxLength={160}
          />
          <p className="mt-1 text-right text-xs text-slate-400">{profileBio.length}/160</p>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSocialSave}
            disabled={saveSocialProfile.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-slate-950"
          >
            {saveSocialProfile.isPending && <Loader2 size={15} className="animate-spin" />}
            Save social profile
          </button>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Follow requests ({followRequestsQuery.data?.requests.length ?? 0})
          </h3>
          <div className="mt-3 space-y-2">
            {(followRequestsQuery.data?.requests || []).map((request) => (
              <div key={request.requester.handle || request.requestedAt} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-900/50">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{request.requester.name}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{request.requester.displayHandle}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => request.requester.handle && approveRequest.mutate(request.requester.handle)}
                    className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-slate-950"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => request.requester.handle && declineRequest.mutate(request.requester.handle)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
            {followRequestsQuery.data?.requests.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400">No pending requests.</p>
            )}
          </div>
        </div>
      </section>

      {/* Save / Cancel */}
      <div className="flex justify-end gap-3">
        <button
          onClick={handleCancel}
          className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={updateProfile.isPending}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
        >
          {updateProfile.isPending ? (
            <Loader2 size={15} className="animate-spin" />
          ) : saved ? (
            <Check size={15} />
          ) : (
            <Check size={15} />
          )}
          {saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
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

function AccountSection() {
  const { user, refreshUser, logout } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
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

  const accountUser = statusQuery.data?.user || user;
  const latestExport = exportsQuery.data?.exports[0] || statusQuery.data?.export;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Account</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Manage sign-in, devices, exports, and account deletion.
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

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
              <Mail size={17} />
              Email
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{accountUser?.email}</p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              accountUser?.emailVerified
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
            }`}
          >
            {accountUser?.emailVerified ? 'Verified' : 'Unverified'}
          </span>
        </div>
        {!accountUser?.emailVerified && (
          <button
            onClick={() => verification.mutate()}
            disabled={verification.isPending}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-slate-950"
          >
            {verification.isPending && <Loader2 size={15} className="animate-spin" />}
            Resend verification
          </button>
        )}
        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
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
            disabled={emailChange.isPending || !newEmail || !emailPassword || !accountUser?.emailVerified}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700/60"
          >
            Change email
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
              <Laptop size={17} />
              Devices
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Active browser sessions on your account.</p>
          </div>
          <button
            onClick={() => logoutOthers.mutate()}
            disabled={logoutOthers.isPending}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
          >
            <LogOut size={15} />
            Logout others
          </button>
        </div>
        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-700">
          {sessionsQuery.isLoading ? (
            <p className="py-3 text-sm text-slate-500">Loading devices...</p>
          ) : (
            (sessionsQuery.data?.sessions || []).map((session) => (
              <div key={session.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                    {session.label}
                    {session.current && <span className="ml-2 text-xs text-teal-600 dark:text-teal-300">Current</span>}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Last active {formatDateTime(session.lastActiveAt || session.createdAt)}
                  </p>
                </div>
                <button
                  onClick={() => revokeSession.mutate(session.id)}
                  disabled={revokeSession.isPending}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
                >
                  Revoke
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
          <Download size={17} />
          Data Export
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Export your profile, settings, messages authored by you, saved references, and eligible actions.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <input
            type="password"
            value={exportPassword}
            onChange={(e) => setExportPassword(e.target.value)}
            placeholder="Current password"
            className={INPUT}
          />
          <button
            onClick={() => dataExport.mutate(exportPassword)}
            disabled={dataExport.isPending || !exportPassword || !accountUser?.emailVerified}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
          >
            Request export
          </button>
          <button
            onClick={() => latestExport?.id && downloadDataExport(latestExport.id)}
            disabled={latestExport?.status !== 'ready'}
            className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950"
          >
            Download
          </button>
        </div>
        {latestExport && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Latest export: {latestExport.status}
            {latestExport.expiresAt ? `, expires ${formatDateTime(latestExport.expiresAt)}` : ''}
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-rose-200 bg-white p-5 dark:border-rose-900/60 dark:bg-slate-800">
        <h2 className="flex items-center gap-2 text-base font-semibold text-rose-700 dark:text-rose-300">
          <AlertTriangle size={17} />
          Delete Account
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Deletion disables sign-in immediately and can be cancelled from the email link before final removal.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
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
            disabled={deletion.isPending || deleteConfirmation !== 'DELETE' || !deletePassword || !accountUser?.emailVerified}
            className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            Delete account
          </button>
        </div>
      </section>
    </div>
  );
}

// ── Section: Privacy ─────────────────────────────────────────────────────────

function PrivacySection() {
  const settingsQuery = useUserSettings();
  const updateSettings = useUpdateUserSettings();
  const queryClient = useQueryClient();
  const [blockUserId, setBlockUserId] = useState('');
  const [blockNotice, setBlockNotice] = useState('');
  const blockedUsers = useQuery({
    queryKey: ['blocked-users'],
    queryFn: fetchBlockedUsers,
  });
  const myReports = useQuery({
    queryKey: ['my-reports'],
    queryFn: fetchMyReports,
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
  const rows = settings
    ? [
        {
          key: 'readReceiptsEnabled' as const,
          label: 'Read receipts',
          desc: 'Let others know when you have read their messages.',
          value: settings.readReceiptsEnabled,
        },
        {
          key: 'presenceVisible' as const,
          label: 'Online presence',
          desc: 'Allow others to see when you are online.',
          value: settings.presenceVisible,
        },
        {
          key: 'lastSeenVisible' as const,
          label: 'Last seen',
          desc: 'Allow others to see your last active time.',
          value: settings.lastSeenVisible,
        },
        {
          key: 'incomingCallsEnabled' as const,
          label: 'Incoming calls',
          desc: 'Allow direct voice and video call invites to reach you.',
          value: settings.incomingCallsEnabled,
        },
        {
          key: 'momentArchiveEnabled' as const,
          label: 'Moment archive',
          desc: 'Save your expired Moments in your private archive.',
          value: settings.momentArchiveEnabled,
        },
      ]
    : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Privacy</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Control who can see your information.
        </p>
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        {settingsQuery.isLoading ? (
          <p className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">Loading privacy settings...</p>
        ) : settingsQuery.isError ? (
          <p className="px-5 py-4 text-sm text-rose-600 dark:text-rose-300">
            Unable to load privacy settings.
          </p>
        ) : (
          rows.map((row, i) => (
            <div
              key={row.key}
              className={`flex items-center justify-between gap-4 px-5 py-3.5 ${
                i < rows.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : ''
              }`}
            >
              <div>
                <p className="text-[14px] font-medium text-slate-900 dark:text-white">{row.label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{row.desc}</p>
              </div>
              <Toggle
                checked={row.value}
                onChange={() => updateSettings.mutate({ [row.key]: !row.value })}
                label={row.label}
              />
            </div>
          ))
        )}
      </section>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Turning off read receipts does not affect message delivery or unread counts.
      </p>
      <CloseFriendsSettings />
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Blocked Users</h2>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={blockUserId}
            onChange={(event) => setBlockUserId(event.target.value)}
            placeholder="User ID"
            className={INPUT}
          />
          <button
            onClick={() => blockMutation.mutate(blockUserId.trim())}
            disabled={!blockUserId.trim() || blockMutation.isPending}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-950"
          >
            Block
          </button>
        </div>
        {blockNotice && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{blockNotice}</p>}
        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-700">
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
            <p className="py-3 text-sm text-slate-500 dark:text-slate-400">No blocked users.</p>
          )}
        </div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Report History</h2>
        <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-700">
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
            <p className="py-3 text-sm text-slate-500 dark:text-slate-400">No reports submitted.</p>
          )}
        </div>
      </section>
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
          key === 'momentActivityEnabled')
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

  const rows: {
    label: string;
    desc: string;
    value: boolean;
    disabled?: boolean;
    toggle: () => void;
  }[] = preferences
    ? [
        {
          label: 'Message alerts',
          desc: 'Browser alerts for new messages when you are not focused on that chat',
          value: preferences.messageNotificationsEnabled,
          toggle: () => void togglePreference('messageNotificationsEnabled'),
        },
        {
          label: 'Mention alerts',
          desc: 'Browser alerts when someone mentions you in a group',
          value: preferences.mentionNotificationsEnabled,
          toggle: () => void togglePreference('mentionNotificationsEnabled'),
        },
        {
          label: 'Call alerts',
          desc: 'Browser alerts for incoming calls',
          value: preferences.callNotificationsEnabled,
          toggle: () => void togglePreference('callNotificationsEnabled'),
        },
        {
          label: 'Show message previews',
          desc: 'Include message text in browser alerts',
          value: preferences.notificationPreviewsEnabled,
          toggle: () => void togglePreference('notificationPreviewsEnabled'),
        },
      ]
    : [];
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Notifications</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Control how and when you receive notifications.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[14px] font-medium text-slate-900 dark:text-white">Browser permission</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Browser permission controls whether this browser may show desktop alerts.
            </p>
          </div>
          <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            {permissionLabel(browserPermission)}
          </span>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        {preferencesQuery.isLoading ? (
          <p className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">Loading notification settings...</p>
        ) : preferencesQuery.isError ? (
          <p className="px-5 py-4 text-sm text-rose-600 dark:text-rose-300">
            Unable to load notification settings.
          </p>
        ) : (
          <>
            {rows.map((row, i) => (
              <div
                key={row.label}
                className={`flex items-center justify-between gap-4 px-5 py-3.5 ${
                  i < rows.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : ''
                } ${row.disabled ? 'opacity-60' : ''}`}
              >
                <div>
                  <p className="text-[14px] font-medium text-slate-900 dark:text-white">{row.label}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{row.desc}</p>
                </div>
                <Toggle
                  checked={row.value}
                  onChange={row.disabled || updatePreferences.isPending ? noop : row.toggle}
                  label={row.label}
                />
              </div>
            ))}
          </>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-700">
          <p className="text-[14px] font-semibold text-slate-900 dark:text-white">Moments</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Choose how Blabber notifies you about Moment updates and activity.
          </p>
        </div>
        {preferencesQuery.isLoading ? (
          <p className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">Loading Moment notification settings...</p>
        ) : preferencesQuery.isError || !preferences ? (
          <p className="px-5 py-4 text-sm text-rose-600 dark:text-rose-300">
            Unable to load Moment notification settings.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-3.5 dark:border-slate-700">
              <div>
                <p className="text-[14px] font-medium text-slate-900 dark:text-white">New Moment updates</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Browser alerts when contacts share new Moments.</p>
              </div>
              <Toggle
                checked={preferences.momentUpdatesEnabled}
                onChange={updatePreferences.isPending ? noop : () => void togglePreference('momentUpdatesEnabled')}
                label="New Moment updates"
              />
            </div>
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <p className="text-[14px] font-medium text-slate-900 dark:text-white">Activity on my Moments</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Browser alerts when someone reacts to your Moment.</p>
              </div>
              <Toggle
                checked={preferences.momentActivityEnabled}
                onChange={updatePreferences.isPending ? noop : () => void togglePreference('momentActivityEnabled')}
                label="Activity on my Moments"
              />
            </div>
          </>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-700">
          <p className="text-[14px] font-semibold text-slate-900 dark:text-white">Event Reminders</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Choose which reminders Blabber can send for chat events you RSVP to.
          </p>
        </div>
        {preferencesQuery.isLoading ? (
          <p className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">Loading event reminder settings...</p>
        ) : preferencesQuery.isError || !preferences ? (
          <p className="px-5 py-4 text-sm text-rose-600 dark:text-rose-300">
            Unable to load event reminder settings.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-3.5 dark:border-slate-700">
              <div>
                <p className="text-[14px] font-medium text-slate-900 dark:text-white">Event reminders</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Allow Blabber to remind you about chat events.</p>
              </div>
              <Toggle
                checked={preferences.eventRemindersEnabled}
                onChange={updatePreferences.isPending ? noop : () => void togglePreference('eventRemindersEnabled')}
                label="Event reminders"
              />
            </div>
            {preferences.eventRemindersEnabled && eventReminderRows.map((row, index) => (
              <div
                key={row.key}
                className={`flex items-center justify-between gap-4 px-5 py-3.5 ${
                  index < eventReminderRows.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : ''
                }`}
              >
                <div>
                  <p className="text-[14px] font-medium text-slate-900 dark:text-white">{row.label}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{row.desc}</p>
                </div>
                <Toggle
                  checked={Boolean(preferences[row.key])}
                  onChange={updatePreferences.isPending ? noop : () => void togglePreference(row.key)}
                  label={row.label}
                />
              </div>
            ))}
          </>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-700">
          <p className="text-[14px] font-semibold text-slate-900 dark:text-white">Action Reminders</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Choose which reminders Blabber can send for Actions assigned to you.
          </p>
          {browserNotificationsUnavailable && (
            <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              Browser notifications are currently unavailable. Enable notifications for Blabber in your browser settings to receive reminders.
            </p>
          )}
        </div>
        {preferencesQuery.isLoading ? (
          <p className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">Loading Action reminder settings...</p>
        ) : preferencesQuery.isError || !preferences ? (
          <p className="px-5 py-4 text-sm text-rose-600 dark:text-rose-300">
            Unable to load Action reminder settings.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-3.5 dark:border-slate-700">
              <div>
                <p className="text-[14px] font-medium text-slate-900 dark:text-white">Action reminders</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Allow Blabber to remind you about assigned Actions.</p>
              </div>
              <Toggle
                checked={preferences.actionRemindersEnabled}
                onChange={updatePreferences.isPending ? noop : () => void togglePreference('actionRemindersEnabled')}
                label="Action reminders"
              />
            </div>
            {preferences.actionRemindersEnabled && reminderRows.map((row, index) => (
              <div
                key={row.key}
                className={`flex items-center justify-between gap-4 px-5 py-3.5 ${
                  index < reminderRows.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : ''
                }`}
              >
                <div>
                  <p className="text-[14px] font-medium text-slate-900 dark:text-white">{row.label}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{row.desc}</p>
                </div>
                <Toggle
                  checked={Boolean(preferences[row.key])}
                  onChange={updatePreferences.isPending ? noop : () => void togglePreference(row.key)}
                  label={row.label}
                />
              </div>
            ))}
          </>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Turning off alerts does not stop you from receiving messages in Blabber.
        </p>
        {errorMessage && (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
            {errorMessage}
          </p>
        )}
      </section>
    </div>
  );
}

function noop() {}

// ── Section: Appearance ──────────────────────────────────────────────────────

function AppearanceSection() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const settingsQuery = useUserSettings();
  const updateSettings = useUpdateUserSettings();

  useEffect(() => {
    if (settingsQuery.data?.themePreference && settingsQuery.data.themePreference !== theme) {
      setTheme(settingsQuery.data.themePreference);
    }
  }, [setTheme, settingsQuery.data?.themePreference, theme]);

  const options: Array<{ value: ThemePreference; label: string; desc: string }> = [
    { value: 'system', label: 'System', desc: 'Match this device automatically' },
    { value: 'light', label: 'Light', desc: 'Use Blabber in light mode' },
    { value: 'dark', label: 'Dark', desc: 'Use Blabber in dark mode' },
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
          Customize how Blabber looks for you.
        </p>
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        {options.map((option, i) => (
          <button
            key={option.value}
            type="button"
            onClick={() => chooseTheme(option.value)}
            className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-700/40 ${
              i < options.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : ''
            }`}
          >
            <div className="flex items-center gap-3">
              {option.value === 'dark' ? (
                <Moon size={18} className="text-slate-500 dark:text-slate-400" />
              ) : (
                <Sun size={18} className="text-slate-500 dark:text-slate-400" />
              )}
              <div>
                <p className="text-[14px] font-medium text-slate-900 dark:text-white">{option.label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{option.desc}</p>
              </div>
            </div>
            {theme === option.value && <Check size={18} className="text-teal-600 dark:text-teal-300" />}
          </button>
        ))}
      </section>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Current resolved theme: {resolvedTheme}.
      </p>
    </div>
  );
}

// ── Section: AI privacy ──────────────────────────────────────────────────────

function AISection() {
  const settingsQuery = useUserSettings();
  const updateSettings = useUpdateUserSettings();
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
  const availabilityLabel =
    availabilityQuery.data === 'available'
      ? 'Available'
      : availabilityQuery.data === 'not_configured'
        ? 'Not configured'
        : availabilityQuery.isError
          ? 'Temporarily unavailable'
          : 'Checking...';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">AI privacy</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Control whether your account can request AI intelligence features.
        </p>
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-700">
          <div>
            <p className="text-[14px] font-medium text-slate-900 dark:text-white">AI availability</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Server-side provider status for Chat Intelligence.
            </p>
          </div>
          <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            {availabilityLabel}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-[14px] font-medium text-slate-900 dark:text-white">Allow AI requests</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Show the intelligence drawer and allow your AI requests.
            </p>
          </div>
          <Toggle
            checked={enabled}
            onChange={() => updateSettings.mutate({ chatIntelligenceEnabled: !enabled })}
            label="Chat Intelligence"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-slate-100 px-5 py-4 dark:border-slate-700">
          <div>
            <p className="text-[14px] font-medium text-slate-900 dark:text-white">Clear my AI history</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Remove private generated AI artifacts tied to your account.
            </p>
          </div>
          <button
            onClick={() => clearHistory.mutate()}
            disabled={clearHistory.isPending}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {clearHistory.isPending ? 'Clearing...' : 'Clear'}
          </button>
        </div>
      </section>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        AI analysis runs only when you manually request it from a chat.
      </p>
    </div>
  );
}

// ── Section: Help ────────────────────────────────────────────────────────────

function HelpSection() {
  const topics = [
    {
      label: 'Direct and group chats',
      desc: 'Use New Chat for one-to-one conversations, or create a group and add workspace members.',
    },
    {
      label: 'Chat Intelligence',
      desc: 'Open Intelligence from a chat when you want summaries, actions, decisions, waiting-on items, or group memory.',
    },
    {
      label: 'Moments',
      desc: 'Share short-lived text or photo updates from the Moments item in the main navigation.',
    },
    {
      label: 'Voice and video calls',
      desc: 'Start calls from a direct chat. If someone disabled incoming calls, Blabber will tell you cleanly.',
    },
    {
      label: 'Notifications',
      desc: 'Browser alerts are controlled in Notifications. Turning them off never stops messages or unread counts.',
    },
    {
      label: 'Password reset',
      desc: 'Use Forgot Password on the sign-in page to request a reset email when SMTP is configured.',
    },
    {
      label: 'Privacy controls',
      desc: 'Use Privacy settings to control read receipts, presence, last-seen visibility, and incoming calls.',
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
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        {topics.map((topic, i) => (
          <div
            key={topic.label}
            className={`px-5 py-3.5 ${
              i < topics.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : ''
            }`}
          >
            <div>
              <p className="text-[14px] font-medium text-slate-900 dark:text-white">{topic.label}</p>
              <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{topic.desc}</p>
            </div>
          </div>
        ))}
      </section>
      <a
        href="mailto:support@example.com?subject=Blabber%20support"
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/60"
      >
        <ExternalLink size={15} />
        Report an issue
      </a>
    </div>
  );
}

// ── Main SettingsPage ────────────────────────────────────────────────────────

export default function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const activeKey = (searchParams.get('s') as SectionKey) || 'profile';

  const setSection = (key: SectionKey) => {
    setSearchParams({ s: key }, { replace: true });
  };

  const sectionContent: Record<SectionKey, React.ReactNode> = {
    profile:       <ProfileSection />,
    account:       <AccountSection />,
    privacy:       <PrivacySection />,
    notifications: <NotificationsSection />,
    appearance:    <AppearanceSection />,
    ai:            <AISection />,
    help:          <HelpSection />,
  };

  return (
    <div className="min-h-screen bg-[#f4f5f7] p-4 dark:bg-slate-950 md:p-6">
      <div
        className="mx-auto flex overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_40px_-25px_rgba(15,23,42,0.2)] dark:border-slate-800 dark:bg-slate-900"
        style={{ height: 'calc(100vh - 3rem)', maxWidth: '1100px' }}
      >
        {/* ── Left sub-nav ── */}
        <aside className="flex w-[240px] flex-shrink-0 flex-col border-r border-slate-200 bg-[#f8faf9] dark:border-slate-800 dark:bg-slate-900/60">
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
          <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">
              Settings
            </p>
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium transition ${
                  activeKey === s.key
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                <s.icon size={15} className="flex-shrink-0" />
                {s.label}
              </button>
            ))}
          </nav>

          {/* User card at bottom */}
          <div className="border-t border-slate-200 p-3 dark:border-slate-800">
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
        <main className="min-w-0 flex-1 overflow-y-auto p-6 md:p-8">
          {sectionContent[activeKey]}
        </main>
      </div>
    </div>
  );
}
