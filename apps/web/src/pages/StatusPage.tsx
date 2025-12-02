import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Camera, Image } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface Status {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  type: 'text' | 'image';
  content: string;
  backgroundColor?: string;
  createdAt: Date;
  viewed: boolean;
}

// Mock data for demo
const mockStatuses: Status[] = [
  {
    id: '1',
    userId: 'user1',
    userName: 'John Doe',
    type: 'text',
    content: 'Hello everyone! 👋',
    backgroundColor: '#00a884',
    createdAt: new Date(Date.now() - 3600000),
    viewed: false,
  },
  {
    id: '2',
    userId: 'user2',
    userName: 'Jane Smith',
    type: 'image',
    content: 'https://picsum.photos/400/600',
    createdAt: new Date(Date.now() - 7200000),
    viewed: true,
  },
];

export default function StatusPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newStatusText, setNewStatusText] = useState('');
  const [selectedColor, setSelectedColor] = useState('#00a884');

  const colors = ['#00a884', '#128c7e', '#075e54', '#25d366', '#dcf8c6', '#ece5dd'];

  const handleCreateTextStatus = () => {
    if (!newStatusText.trim()) return;
    // In a real app, this would call an API
    alert('Status created! (Demo only)');
    setShowCreateModal(false);
    setNewStatusText('');
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    return 'Yesterday';
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
          <h1 className="text-xl font-semibold">Status</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4">
        {/* My Status */}
        <div className="bg-white rounded-lg shadow-sm mb-4">
          <div
            className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50"
            onClick={() => setShowCreateModal(true)}
          >
            <div className="relative">
              <div className="w-14 h-14 rounded-full bg-[#00a884] flex items-center justify-center text-white text-xl font-semibold">
                {user?.name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-[#00a884] border-2 border-white flex items-center justify-center">
                <Plus size={14} className="text-white" />
              </div>
            </div>
            <div>
              <p className="font-semibold text-gray-900">My Status</p>
              <p className="text-sm text-gray-500">Tap to add status update</p>
            </div>
          </div>
        </div>

        {/* Recent Updates */}
        <div className="bg-white rounded-lg shadow-sm">
          <h3 className="text-sm text-gray-500 font-medium px-4 pt-4 pb-2">Recent updates</h3>
          {mockStatuses.map((status) => (
            <div
              key={status.id}
              className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50 border-t border-gray-100"
            >
              <div
                className={`w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-semibold ring-2 ${
                  status.viewed ? 'ring-gray-300' : 'ring-[#00a884]'
                }`}
                style={{ backgroundColor: status.backgroundColor || '#00a884' }}
              >
                {status.userName[0].toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900">{status.userName}</p>
                <p className="text-sm text-gray-500">{formatTime(status.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create Status Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">Create Status</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-full hover:bg-gray-100"
              >
                ✕
              </button>
            </div>

            <div className="p-4">
              {/* Color picker */}
              <div className="flex gap-2 mb-4">
                {colors.map((color) => (
                  <button
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    className={`w-8 h-8 rounded-full ${
                      selectedColor === color ? 'ring-2 ring-offset-2 ring-gray-400' : ''
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>

              {/* Text input */}
              <div
                className="rounded-lg p-4 min-h-[200px] mb-4"
                style={{ backgroundColor: selectedColor }}
              >
                <textarea
                  value={newStatusText}
                  onChange={(e) => setNewStatusText(e.target.value)}
                  placeholder="Type a status..."
                  className="w-full h-full bg-transparent text-white placeholder-white/70 text-xl text-center resize-none focus:outline-none"
                  rows={5}
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateTextStatus}
                  disabled={!newStatusText.trim()}
                  className="flex-1 px-4 py-2 bg-[#00a884] text-white rounded-lg hover:bg-[#008f72] disabled:bg-gray-300"
                >
                  Post Status
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
