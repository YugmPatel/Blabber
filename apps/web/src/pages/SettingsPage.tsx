import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Bell, Lock, Moon, HelpCircle, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [darkMode, setDarkMode] = useState(false);
  const [notifications, setNotifications] = useState(true);

  const handleLogout = async () => {
    if (window.confirm('Are you sure you want to logout?')) {
      await logout();
      navigate('/login');
    }
  };

  const settingsGroups = [
    {
      title: 'Account',
      items: [
        {
          icon: User,
          label: 'Profile',
          description: 'Name, about, email',
          onClick: () => navigate('/profile'),
        },
        {
          icon: Lock,
          label: 'Privacy',
          description: 'Last seen, profile photo, about',
          onClick: () => {},
        },
      ],
    },
    {
      title: 'Preferences',
      items: [
        {
          icon: Bell,
          label: 'Notifications',
          description: notifications ? 'On' : 'Off',
          toggle: true,
          value: notifications,
          onChange: () => setNotifications(!notifications),
        },
        {
          icon: Moon,
          label: 'Dark Mode',
          description: darkMode ? 'On' : 'Off',
          toggle: true,
          value: darkMode,
          onChange: () => setDarkMode(!darkMode),
        },
      ],
    },
    {
      title: 'Help',
      items: [
        {
          icon: HelpCircle,
          label: 'Help Center',
          description: 'FAQs, contact us',
          onClick: () => {},
        },
      ],
    },
  ];

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
          <h1 className="text-xl font-semibold">Settings</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4">
        {/* User Info Card */}
        <div
          className="bg-white rounded-lg shadow-sm p-4 mb-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50 transition-colors"
          onClick={() => navigate('/profile')}
        >
          <div className="w-16 h-16 rounded-full bg-[#00a884] flex items-center justify-center text-white text-2xl font-semibold">
            {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900">{user?.name || 'User'}</h2>
            <p className="text-sm text-gray-500">{user?.email}</p>
          </div>
        </div>

        {/* Settings Groups */}
        {settingsGroups.map((group) => (
          <div key={group.title} className="bg-white rounded-lg shadow-sm mb-4">
            <h3 className="text-sm text-[#00a884] font-medium px-4 pt-4 pb-2">{group.title}</h3>
            {group.items.map((item, index) => (
              <div
                key={item.label}
                className={`flex items-center gap-4 px-4 py-3 ${
                  item.toggle ? '' : 'cursor-pointer hover:bg-gray-50'
                } ${index < group.items.length - 1 ? 'border-b border-gray-100' : ''}`}
                onClick={item.toggle ? undefined : item.onClick}
              >
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                  <item.icon size={20} className="text-gray-600" />
                </div>
                <div className="flex-1">
                  <p className="text-gray-900">{item.label}</p>
                  <p className="text-sm text-gray-500">{item.description}</p>
                </div>
                {item.toggle && (
                  <button
                    onClick={item.onChange}
                    className={`w-12 h-6 rounded-full transition-colors ${
                      item.value ? 'bg-[#00a884]' : 'bg-gray-300'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                        item.value ? 'translate-x-6' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}

        {/* Logout Button */}
        <button
          onClick={handleLogout}
          className="w-full bg-white rounded-lg shadow-sm p-4 flex items-center gap-4 text-red-600 hover:bg-red-50 transition-colors"
        >
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <LogOut size={20} />
          </div>
          <span className="font-medium">Log out</span>
        </button>
      </div>
    </div>
  );
}
