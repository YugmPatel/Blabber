import { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
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
  ChevronRight,
  ArrowLeft,
  Sun,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUpdateProfile } from '@/hooks/useUsers';
import { useTheme } from '@/hooks/useTheme';
import Avatar from '@/components/Avatar';
import { apiClient, getAccessToken } from '@/api/client';

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
  const profileUser = user as (typeof user & { about?: string; avatarUrl?: string }) | null;

  const persistedAvatarUrl = profileUser?.avatarUrl || profileUser?.avatar || '';
  const [name, setName] = useState(user?.name || '');
  const [about, setAbout] = useState(profileUser?.about || '');
  // savedAvatarUrl is the real server URL — never a base64 blob
  const [savedAvatarUrl, setSavedAvatarUrl] = useState(persistedAvatarUrl);
  // localPreview is base64 only for display while upload is in-progress or failed
  const [localPreview, setLocalPreview] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const displayedAvatar = localPreview || savedAvatarUrl;

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
      await updateProfile.mutateAsync({ name, about, avatarUrl: savedAvatarUrl });
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
    setSavedAvatarUrl(persistedAvatarUrl);
    setLocalPreview('');
    setUploadError('');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
    } else {
      // Upload failed — keep the local preview for display but warn the user
      setUploadError(
        uploadResult.errorMessage ||
          'Avatar upload failed. Changes to your photo will not be saved. Other profile fields can still be saved.'
      );
    }

    setShowAvatarMenu(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
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
                      onClick={() => cameraInputRef.current?.click()}
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
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">
              Role / Department
            </label>
            <input
              type="text"
              placeholder="Senior Product Designer"
              className={INPUT}
            />
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
      <input ref={cameraInputRef} type="file" accept="image/*" capture="user" onChange={handleFileSelect} className="hidden" />
    </div>
  );
}

// ── Section: Privacy ─────────────────────────────────────────────────────────

function PrivacySection() {
  const rows = [
    { label: 'Last seen & online', desc: 'Who can see when you were last online' },
    { label: 'Profile photo', desc: 'Who can see your profile photo' },
    { label: 'About', desc: 'Who can see your about info' },
    { label: 'Read receipts', desc: 'Let others know when you\'ve read messages' },
    { label: 'Groups', desc: 'Who can add you to groups' },
  ];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Privacy</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Control who can see your information.
        </p>
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={`flex cursor-pointer items-center justify-between px-5 py-3.5 transition hover:bg-slate-50 dark:hover:bg-slate-700/40 ${
              i < rows.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : ''
            }`}
          >
            <div>
              <p className="text-[14px] font-medium text-slate-900 dark:text-white">{row.label}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{row.desc}</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              Everyone <ChevronRight size={14} />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

// ── Section: Notifications ───────────────────────────────────────────────────

function NotificationsSection() {
  const [push, setPush] = useState(true);
  const [sounds, setSounds] = useState(true);
  const [mentions, setMentions] = useState(true);
  const [previews, setPreviews] = useState(false);

  const rows: { label: string; desc: string; value: boolean; toggle: () => void }[] = [
    { label: 'Push notifications', desc: 'Receive alerts when the app is closed', value: push, toggle: () => setPush(v => !v) },
    { label: 'Message sounds', desc: 'Play a sound for new messages', value: sounds, toggle: () => setSounds(v => !v) },
    { label: 'Mentions', desc: 'Notify when someone @mentions you', value: mentions, toggle: () => setMentions(v => !v) },
    { label: 'Message preview', desc: 'Show message content in notifications', value: previews, toggle: () => setPreviews(v => !v) },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Notifications</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Control how and when you receive notifications.
        </p>
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={`flex items-center justify-between px-5 py-3.5 ${
              i < rows.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : ''
            }`}
          >
            <div>
              <p className="text-[14px] font-medium text-slate-900 dark:text-white">{row.label}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{row.desc}</p>
            </div>
            <Toggle checked={row.value} onChange={row.toggle} label={row.label} />
          </div>
        ))}
      </section>
    </div>
  );
}

// ── Section: Appearance ──────────────────────────────────────────────────────

function AppearanceSection() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Appearance</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Customize how Blabber looks for you.
        </p>
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            {theme === 'dark' ? (
              <Moon size={18} className="text-slate-500 dark:text-slate-400" />
            ) : (
              <Sun size={18} className="text-slate-500" />
            )}
            <div>
              <p className="text-[14px] font-medium text-slate-900 dark:text-white">Dark mode</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Currently {theme === 'dark' ? 'on' : 'off'}
              </p>
            </div>
          </div>
          <Toggle
            checked={theme === 'dark'}
            onChange={toggleTheme}
            label="Toggle dark mode"
          />
        </div>
      </section>
    </div>
  );
}

// ── Section: AI Engine ───────────────────────────────────────────────────────

function AISection() {
  const rows = [
    { label: 'Smart Summaries', desc: 'Auto-summarize long chat threads' },
    { label: 'Task Extraction', desc: 'Detect and surface action items' },
    { label: 'Shared Memory', desc: 'Remember decisions across chats' },
    { label: 'Waiting On', desc: 'Track who you\'re waiting on for responses' },
  ];
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    'Smart Summaries': true,
    'Task Extraction': true,
    'Shared Memory': false,
    'Waiting On': false,
  });
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">AI Engine</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Configure AI intelligence features for your chats.
        </p>
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={`flex items-center justify-between px-5 py-3.5 ${
              i < rows.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : ''
            }`}
          >
            <div>
              <p className="text-[14px] font-medium text-slate-900 dark:text-white">{row.label}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{row.desc}</p>
            </div>
            <Toggle
              checked={enabled[row.label] ?? false}
              onChange={() => setEnabled((p) => ({ ...p, [row.label]: !p[row.label] }))}
              label={row.label}
            />
          </div>
        ))}
      </section>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        AI features are processed securely and do not share your data externally.
      </p>
    </div>
  );
}

// ── Section: Help ────────────────────────────────────────────────────────────

function HelpSection() {
  const links = [
    { label: 'Help Center', desc: 'FAQs and guides' },
    { label: 'Contact Support', desc: 'Reach out to our team' },
    { label: 'Privacy Policy', desc: 'How we handle your data' },
    { label: 'Terms of Service', desc: 'Usage terms and conditions' },
    { label: 'About Blabber', desc: 'Version 0.1.0 — Early Access' },
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
        {links.map((link, i) => (
          <button
            key={link.label}
            className={`flex w-full items-center justify-between px-5 py-3.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-700/40 ${
              i < links.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : ''
            }`}
          >
            <div>
              <p className="text-[14px] font-medium text-slate-900 dark:text-white">{link.label}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{link.desc}</p>
            </div>
            <ExternalLink size={14} className="text-slate-400" />
          </button>
        ))}
      </section>
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
