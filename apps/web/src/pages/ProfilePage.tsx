import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Camera, Check, Loader2, Trash2, Image, User, Bell, Sparkles, Palette } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUpdateProfile } from '@/hooks/useUsers';
import { apiClient, getAccessToken, normalizeMediaUrl } from '@/api/client';
import CameraModal from '@/components/CameraModal';

interface AvatarPresignResponse {
  uploadUrl: string;
  mediaId: string;
  mediaUrl?: string;
  publicUrl?: string;
  url?: string;
  uploadAuthRequired?: boolean;
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const updateProfile = useUpdateProfile();
  const profileUser =
    user as (typeof user & { about?: string; avatarUrl?: string; role?: string; department?: string }) | null;

  const [name, setName] = useState(user?.name || '');
  const [about, setAbout] = useState(profileUser?.about || '');
  const [avatarUrl, setAvatarUrl] = useState(profileUser?.avatarUrl || profileUser?.avatar || '');
  const [localPreview, setLocalPreview] = useState('');
  const [role, setRole] = useState(profileUser?.role || '');
  const [department, setDepartment] = useState(profileUser?.department || '');
  const [isUploading, setIsUploading] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [showCameraCapture, setShowCameraCapture] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const displayedAvatar = normalizeMediaUrl(localPreview || avatarUrl);

  useEffect(() => {
    setName(user?.name || '');
    setAbout(profileUser?.about || '');
    setRole(profileUser?.role || '');
    setDepartment(profileUser?.department || '');
    setAvatarUrl(profileUser?.avatarUrl || profileUser?.avatar || '');
  }, [user?._id, user?.name, profileUser?.about, profileUser?.role, profileUser?.department, profileUser?.avatarUrl, profileUser?.avatar]);

  const uploadAvatar = async (file: File): Promise<string | null> => {
    setIsUploading(true);
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

      return (
        presignData.mediaUrl ||
        presignData.publicUrl ||
        presignData.url ||
        presignData.uploadUrl.split('?')[0] ||
        null
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = async () => {
    try {
      await updateProfile.mutateAsync({ name, about, role, department, avatarUrl });
      if (refreshUser) refreshUser();
    } catch (error) {
      console.error('Failed to update profile:', error);
    }
  };

  const handleCancel = () => {
    setName(user?.name || '');
    setAbout(profileUser?.about || '');
    setRole(profileUser?.role || '');
    setDepartment(profileUser?.department || '');
    setAvatarUrl(profileUser?.avatarUrl || profileUser?.avatar || '');
    setLocalPreview('');
  };

  const handleAvatarFile = async (file: File) => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be less than 5MB');
      return;
    }

    try {
      // Create preview immediately
      const reader = new FileReader();
      reader.onload = (event) => {
        setLocalPreview(event.target?.result as string);
      };
      reader.readAsDataURL(file);

      const mediaUrl = await uploadAvatar(file);
      if (mediaUrl) {
        setAvatarUrl(mediaUrl);
        setLocalPreview('');
        await updateProfile.mutateAsync({ name, about, role, department, avatarUrl: mediaUrl });
        if (refreshUser) refreshUser();
      } else {
        alert('Avatar upload failed. Changes to your photo will not be saved.');
      }
    } catch (error) {
    console.error('Failed to upload image:', error);
      alert('Avatar upload failed. Changes to your photo will not be saved.');
    }

    setShowAvatarMenu(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleAvatarFile(file);
  };

  const handleRemovePhoto = () => {
    setAvatarUrl('');
    setLocalPreview('');
    setShowAvatarMenu(false);
  };

  return (
    <div className="min-h-screen bg-[#f4f5f7] p-4 md:p-6">
      <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_40px_-25px_rgba(15,23,42,0.25)] md:h-[calc(100vh-3rem)]">
        <aside className="hidden w-[260px] flex-col border-r border-slate-200 bg-[#f8faf9] p-4 md:flex">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Settings</p>
          <button className="flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            <User size={16} />
            Profile
          </button>
          <button className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            <Bell size={16} />
            Notifications
          </button>
          <button className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            <Sparkles size={16} />
            AI Engine
          </button>
          <button className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            <Palette size={16} />
            Appearance
          </button>
          <div className="mt-auto rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold text-slate-700">Pro Plan</p>
            <p className="mt-1 text-xs text-slate-500">Unlock advanced memory and AI workflows.</p>
            <button className="mt-3 w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
              Upgrade Now
            </button>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto p-5 md:p-8">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Account Profile</h1>
              <p className="mt-1 text-sm text-slate-500">
                Manage your public identity and account security settings.
              </p>
            </div>
            <button
              onClick={() => navigate('/chats')}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Back to chats
            </button>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="grid gap-6 md:grid-cols-[200px_1fr]">
              <div className="flex flex-col items-center">
                <div className="relative">
                  {displayedAvatar ? (
                    <img
                      src={displayedAvatar}
                      alt="Profile"
                      className="h-28 w-28 rounded-full object-cover border-4 border-[#0f766e]"
                    />
                  ) : (
                    <div className="flex h-28 w-28 items-center justify-center rounded-full bg-[#0f766e] text-4xl font-semibold text-white">
                      {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}

                  <button
                    onClick={() => setShowAvatarMenu(!showAvatarMenu)}
                    disabled={isUploading}
                    className="absolute bottom-0 right-0 rounded-full bg-slate-900 p-2 text-white transition hover:bg-slate-800 disabled:bg-slate-400"
                  >
                    {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                  </button>
                </div>
                <span className="mt-2 h-2.5 w-2.5 rounded-full bg-green-500" />
                <p className="mt-2 text-xs text-slate-500">Online</p>
              </div>

              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Display Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-[#0ea5a1] focus:bg-white focus:ring-2 focus:ring-[#99f6e4]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Handle</label>
                    <input
                      type="text"
                      value={`@${user?.username || ''}`}
                      disabled
                      className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-sm text-slate-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Email Address</label>
                  <input
                    type="email"
                    value={user?.email || ''}
                    disabled
                    className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-sm text-slate-500"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold text-slate-900">About You</h2>
            <p className="text-sm text-slate-500">Tell your team a bit about your role.</p>
            <div className="mt-4 grid gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Role / Department</label>
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    type="text"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="Senior Product Designer"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-[#0ea5a1] focus:bg-white focus:ring-2 focus:ring-[#99f6e4]"
                    maxLength={120}
                  />
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="Design"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-[#0ea5a1] focus:bg-white focus:ring-2 focus:ring-[#99f6e4]"
                    maxLength={120}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Profile note</label>
                <textarea
                  value={about}
                  onChange={(e) => setAbout(e.target.value)}
                  placeholder="Focusing on Blabber V2 launch 🚀"
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-[#0ea5a1] focus:bg-white focus:ring-2 focus:ring-[#99f6e4]"
                  rows={3}
                  maxLength={140}
                />
                <p className="mt-1 text-right text-xs text-slate-400">{about.length}/140</p>
              </div>
            </div>
          </section>

          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={handleCancel}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={updateProfile.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {updateProfile.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              Save Changes
            </button>
          </div>
        </main>
      </div>

      {showAvatarMenu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowAvatarMenu(false)} />
          <div className="absolute left-1/2 top-28 z-20 w-52 -translate-x-1/2 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <Image size={16} className="text-slate-500" />
              Choose from gallery
            </button>
            <button
              onClick={() => {
                setShowAvatarMenu(false);
                setShowCameraCapture(true);
              }}
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <Camera size={16} className="text-slate-500" />
              Take photo
            </button>
            {displayedAvatar ? (
              <button
                onClick={handleRemovePhoto}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-rose-500 hover:bg-rose-50"
              >
                <Trash2 size={16} />
                Remove photo
              </button>
            ) : null}
          </div>
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
      <CameraModal
        isOpen={showCameraCapture}
        onClose={() => setShowCameraCapture(false)}
        onCapture={handleAvatarFile}
        confirmLabel="Use Photo"
      />
    </div>
  );
}
