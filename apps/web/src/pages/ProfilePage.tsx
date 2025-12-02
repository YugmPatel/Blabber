import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, Check, X, Loader2, Trash2, Image } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUpdateProfile } from '@/hooks/useUsers';
import { useFileUpload } from '@/hooks/useFileUpload';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const updateProfile = useUpdateProfile();
  const { uploadFile, isUploading } = useFileUpload();

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [about, setAbout] = useState(user?.about || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    try {
      await updateProfile.mutateAsync({ name, about, avatarUrl });
      setIsEditing(false);
      if (refreshUser) refreshUser();
    } catch (error) {
      console.error('Failed to update profile:', error);
    }
  };

  const handleCancel = () => {
    setName(user?.name || '');
    setAbout(user?.about || '');
    setAvatarUrl(user?.avatarUrl || '');
    setIsEditing(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
        setAvatarUrl(event.target?.result as string);
      };
      reader.readAsDataURL(file);

      // Upload to server
      const mediaId = await uploadFile(file);
      if (mediaId) {
        // In production, this would be the actual URL from the media service
        // For now, we'll use the local preview
        setIsEditing(true);
      }
    } catch (error) {
      console.error('Failed to upload image:', error);
      alert('Failed to upload image. Please try again.');
    }

    setShowAvatarMenu(false);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleRemovePhoto = () => {
    setAvatarUrl('');
    setIsEditing(true);
    setShowAvatarMenu(false);
  };

  return (
    <div className="min-h-screen bg-[#f0f2f5]">
      {/* Header */}
      <div className="bg-[#00a884] text-white px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate('/chats')}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-xl font-semibold">Profile</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4">
        {/* Profile Picture */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <div className="flex flex-col items-center">
            <div className="relative">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Profile"
                  className="w-32 h-32 rounded-full object-cover border-4 border-[#00a884]"
                />
              ) : (
                <div className="w-32 h-32 rounded-full bg-[#00a884] flex items-center justify-center text-white text-5xl font-semibold">
                  {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
                </div>
              )}

              {/* Upload button */}
              <button
                onClick={() => setShowAvatarMenu(!showAvatarMenu)}
                disabled={isUploading}
                className="absolute bottom-0 right-0 p-2 bg-[#00a884] rounded-full text-white hover:bg-[#008f72] transition-colors disabled:bg-gray-400"
              >
                {isUploading ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Camera size={20} />
                )}
              </button>

              {/* Avatar menu dropdown */}
              {showAvatarMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowAvatarMenu(false)} />
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
                    >
                      <Image size={18} className="text-gray-500" />
                      Choose from gallery
                    </button>
                    <button
                      onClick={() => cameraInputRef.current?.click()}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
                    >
                      <Camera size={18} className="text-gray-500" />
                      Take photo
                    </button>
                    {avatarUrl && (
                      <button
                        onClick={handleRemovePhoto}
                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"
                      >
                        <Trash2 size={18} />
                        Remove photo
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Hidden file inputs */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="user"
              onChange={handleFileSelect}
              className="hidden"
            />

            <p className="text-sm text-gray-500 mt-4">
              Tap the camera icon to change your profile photo
            </p>
          </div>
        </div>

        {/* Name */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#00a884] font-medium">Your name</span>
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="text-[#00a884] hover:underline text-sm"
              >
                Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={handleCancel} className="p-1 text-gray-500 hover:text-gray-700">
                  <X size={18} />
                </button>
                <button
                  onClick={handleSave}
                  disabled={updateProfile.isPending}
                  className="p-1 text-[#00a884] hover:text-[#008f72]"
                >
                  <Check size={18} />
                </button>
              </div>
            )}
          </div>
          {isEditing ? (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border-b-2 border-[#00a884] py-1 focus:outline-none"
              autoFocus
            />
          ) : (
            <p className="text-gray-900">{user?.name || 'Not set'}</p>
          )}
          <p className="text-xs text-gray-500 mt-2">
            This is not your username or pin. This name will be visible to your contacts.
          </p>
        </div>

        {/* About */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#00a884] font-medium">About</span>
            {!isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="text-[#00a884] hover:underline text-sm"
              >
                Edit
              </button>
            )}
          </div>
          {isEditing ? (
            <textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="Write something about yourself..."
              className="w-full border-b-2 border-[#00a884] py-1 focus:outline-none resize-none"
              rows={2}
              maxLength={140}
            />
          ) : (
            <p className="text-gray-900">{about || 'Hey there! I am using this chat app.'}</p>
          )}
          {isEditing && <p className="text-xs text-gray-500 mt-1 text-right">{about.length}/140</p>}
        </div>

        {/* Email */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
          <span className="text-sm text-[#00a884] font-medium block mb-2">Email</span>
          <p className="text-gray-900">{user?.email}</p>
        </div>

        {/* Username */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
          <span className="text-sm text-[#00a884] font-medium block mb-2">Username</span>
          <p className="text-gray-900">@{user?.username}</p>
        </div>

        {/* Save/Cancel buttons when editing */}
        {isEditing && (
          <div className="flex gap-3">
            <button
              onClick={handleCancel}
              className="flex-1 py-3 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={updateProfile.isPending}
              className="flex-1 py-3 rounded-lg bg-[#00a884] text-white font-medium hover:bg-[#008f72] transition-colors disabled:bg-gray-400 flex items-center justify-center gap-2"
            >
              {updateProfile.isPending ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check size={18} />
                  Save Changes
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
