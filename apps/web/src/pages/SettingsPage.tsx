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
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUpdateProfile } from '@/hooks/useUsers';
import { useTheme } from '@/hooks/useTheme';
import Avatar from '@/components/Avatar';
import CameraModal from '@/components/CameraModal';
import { apiClient, getAccessToken, normalizeMediaUrl } from '@/api/client';

// ── Section registry ────────────────────────────────────────────────────────

type SectionKey = 'profile' | 'privacy' | 'notifications' | 'appearance' | 'ai' | 'help';

const SECTIONS: { key: SectionKey; label: string; icon: typeof User }[] = [
  { key: 'profile',       label: 'Profile',        icon: User       },
  { key: 'privacy',       label: 'Privacy',         icon: Shield     },
  { key: 'notifications', label: 'Notifications',   icon: Bell       },
  { key: 'appearance',    label: 'Appearance',      icon: Moon       },
  { key: 'ai',            label: 'AI Engine',       icon: Sparkles   },
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayedAvatar = normalizeMediaUrl(localPreview || savedAvatarUrl);

  useEffect(() => {
    setName(user?.name || '');
    setAbout(profileUser?.about || '');
    setRole(profileUser?.role || '');
    setDepartment(profileUser?.department || '');
    setSavedAvatarUrl(persistedAvatarUrl);
  }, [user?._id, user?.name, profileUser?.about, profileUser?.role, profileUser?.department, persistedAvatarUrl]);

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
              Status Message
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

// ── Section: Privacy ─────────────────────────────────────────────────────────

function PrivacySection() {
  const settingsQuery = useUserSettings();
  const updateSettings = useUpdateUserSettings();
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
    </div>
  );
}

// ── Section: Notifications ───────────────────────────────────────────────────

interface NotificationPreferences {
  userId: string;
  messageNotificationsEnabled: boolean;
  callNotificationsEnabled: boolean;
  notificationPreviewsEnabled: boolean;
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
  const [browserPermission, setBrowserPermission] = useState(() => getBrowserPermission());
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    setBrowserPermission(getBrowserPermission());
  }, []);

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
      | 'callNotificationsEnabled'
      | 'notificationPreviewsEnabled'
  ) => {
    if (!user?._id || !preferences) return;
    setErrorMessage('');

    const nextValue = !preferences[key];

    try {
      if (
        nextValue &&
        (key === 'messageNotificationsEnabled' || key === 'callNotificationsEnabled')
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

// eslint-disable-next-line @typescript-eslint/no-empty-function
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

// ── Section: AI Engine ───────────────────────────────────────────────────────

function AISection() {
  const settingsQuery = useUserSettings();
  const updateSettings = useUpdateUserSettings();
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
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">AI Engine</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Configure AI intelligence features for your chats.
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
            <p className="text-[14px] font-medium text-slate-900 dark:text-white">Chat Intelligence</p>
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
      label: 'Status',
      desc: 'Share short-lived workspace updates from the Status item in the main navigation.',
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
              <Avatar src={(user as any)?.avatarUrl || user?.avatar} alt={user?.name || 'User'} size="sm" online={true} />
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
