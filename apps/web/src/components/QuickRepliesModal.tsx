import { useState, useEffect } from 'react';
import { X, Plus, Edit2, Trash2, MessageSquare, Save } from 'lucide-react';

interface QuickReply {
  id: string;
  title: string;
  message: string;
  category: string;
}

interface QuickRepliesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectReply: (message: string) => void;
}

const defaultReplies: QuickReply[] = [
  { id: '1', title: 'On my way', message: "I'm on my way! Be there soon 🚗", category: 'General' },
  {
    id: '2',
    title: 'In a meeting',
    message: "I'm in a meeting right now. I'll get back to you soon.",
    category: 'Work',
  },
  { id: '3', title: 'Thanks', message: 'Thank you so much! 🙏', category: 'General' },
  {
    id: '4',
    title: 'Call me',
    message: 'Can you give me a call when you get a chance?',
    category: 'General',
  },
  {
    id: '5',
    title: 'Running late',
    message: 'Running a bit late, sorry! Will be there in about 15 minutes.',
    category: 'General',
  },
  {
    id: '6',
    title: 'Good morning',
    message: 'Good morning! ☀️ Hope you have a great day!',
    category: 'Greetings',
  },
  {
    id: '7',
    title: 'Happy birthday',
    message: 'Happy Birthday! 🎂🎉 Wishing you all the best!',
    category: 'Greetings',
  },
];

const categories = ['All', 'General', 'Work', 'Greetings', 'Custom'];

export default function QuickRepliesModal({
  isOpen,
  onClose,
  onSelectReply,
}: QuickRepliesModalProps) {
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [isEditing, setIsEditing] = useState(false);
  const [editingReply, setEditingReply] = useState<QuickReply | null>(null);
  const [newReply, setNewReply] = useState({ title: '', message: '', category: 'Custom' });

  // Load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('quickReplies');
    if (saved) {
      setReplies(JSON.parse(saved));
    } else {
      setReplies(defaultReplies);
    }
  }, []);

  // Save to localStorage
  const saveReplies = (newReplies: QuickReply[]) => {
    setReplies(newReplies);
    localStorage.setItem('quickReplies', JSON.stringify(newReplies));
  };

  const filteredReplies =
    activeCategory === 'All' ? replies : replies.filter((r) => r.category === activeCategory);

  const handleAddReply = () => {
    if (!newReply.title.trim() || !newReply.message.trim()) return;
    const reply: QuickReply = {
      id: Date.now().toString(),
      ...newReply,
    };
    saveReplies([...replies, reply]);
    setNewReply({ title: '', message: '', category: 'Custom' });
    setIsEditing(false);
  };

  const handleUpdateReply = () => {
    if (!editingReply) return;
    saveReplies(replies.map((r) => (r.id === editingReply.id ? editingReply : r)));
    setEditingReply(null);
  };

  const handleDeleteReply = (id: string) => {
    saveReplies(replies.filter((r) => r.id !== id));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex h-[500px] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-[#00a884]" />
            <h2 className="text-lg font-semibold text-gray-900">Quick Replies</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={`rounded-lg px-3 py-1 text-sm ${
                isEditing
                  ? 'bg-[#00a884] text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {isEditing ? 'Done' : 'Edit'}
            </button>
            <button onClick={onClose} className="rounded-full p-1 text-gray-500 hover:bg-gray-100">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Categories */}
        <div className="flex gap-2 overflow-x-auto border-b border-gray-200 p-3">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-sm transition-colors ${
                activeCategory === cat
                  ? 'bg-[#00a884] text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Add new reply form */}
        {isEditing && !editingReply && (
          <div className="border-b border-gray-200 p-4 bg-gray-50">
            <p className="text-sm font-medium text-gray-700 mb-2">Add New Quick Reply</p>
            <div className="space-y-2">
              <input
                type="text"
                value={newReply.title}
                onChange={(e) => setNewReply({ ...newReply, title: e.target.value })}
                placeholder="Title (e.g., 'On my way')"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none"
              />
              <textarea
                value={newReply.message}
                onChange={(e) => setNewReply({ ...newReply, message: e.target.value })}
                placeholder="Message content..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none resize-none"
                rows={2}
              />
              <div className="flex gap-2">
                <select
                  value={newReply.category}
                  onChange={(e) => setNewReply({ ...newReply, category: e.target.value })}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#00a884] focus:outline-none"
                >
                  {categories
                    .filter((c) => c !== 'All')
                    .map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                </select>
                <button
                  onClick={handleAddReply}
                  disabled={!newReply.title.trim() || !newReply.message.trim()}
                  className="flex items-center gap-1 rounded-lg bg-[#00a884] px-4 py-2 text-sm text-white hover:bg-[#008f72] disabled:bg-gray-300"
                >
                  <Plus size={16} />
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit reply form */}
        {editingReply && (
          <div className="border-b border-gray-200 p-4 bg-blue-50">
            <p className="text-sm font-medium text-gray-700 mb-2">Edit Quick Reply</p>
            <div className="space-y-2">
              <input
                type="text"
                value={editingReply.title}
                onChange={(e) => setEditingReply({ ...editingReply, title: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              <textarea
                value={editingReply.message}
                onChange={(e) => setEditingReply({ ...editingReply, message: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none resize-none"
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingReply(null)}
                  className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateReply}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-500 py-2 text-sm text-white hover:bg-blue-600"
                >
                  <Save size={16} />
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Replies list */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredReplies.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <MessageSquare size={48} className="mb-2 text-gray-300" />
              <p>No quick replies in this category</p>
              {isEditing && <p className="text-sm">Add one above!</p>}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredReplies.map((reply) => (
                <div
                  key={reply.id}
                  className={`rounded-lg border border-gray-200 p-3 transition-colors ${
                    !isEditing ? 'cursor-pointer hover:bg-gray-50 hover:border-[#00a884]' : ''
                  }`}
                  onClick={() => !isEditing && onSelectReply(reply.message)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">{reply.title}</p>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          {reply.category}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-600 line-clamp-2">{reply.message}</p>
                    </div>
                    {isEditing && (
                      <div className="flex items-center gap-1 ml-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingReply(reply);
                          }}
                          className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-blue-600"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteReply(reply.id);
                          }}
                          className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-red-600"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!isEditing && (
          <div className="border-t border-gray-200 p-3 text-center text-sm text-gray-500">
            Tap a reply to insert it into your message
          </div>
        )}
      </div>
    </div>
  );
}
