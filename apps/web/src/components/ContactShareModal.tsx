import { useState, useEffect } from 'react';
import { X, Search, Check, User, Phone, Mail } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import Avatar from './Avatar';

interface Contact {
  _id: string;
  displayName: string;
  phone?: string;
  email?: string;
  avatarUrl?: string;
}

interface ContactShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShareContacts: (contacts: Contact[]) => void;
}

export default function ContactShareModal({
  isOpen,
  onClose,
  onShareContacts,
}: ContactShareModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<Contact[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualContact, setManualContact] = useState({ name: '', phone: '', email: '' });

  const users = useAppStore((state) => state.users);

  // Convert users to contacts format
  useEffect(() => {
    if (!users) return;
    const userContacts: Contact[] = Object.values(users).map((user) => ({
      _id: user._id,
      displayName: user.displayName,
      phone: user.phone,
      email: user.email,
      avatarUrl: user.avatarUrl,
    }));
    setContacts(userContacts);
  }, [users]);

  // Filter contacts based on search
  const filteredContacts = contacts.filter(
    (contact) =>
      contact.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contact.phone?.includes(searchQuery) ||
      contact.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleContact = (contact: Contact) => {
    setSelectedContacts((prev) => {
      const isSelected = prev.some((c) => c._id === contact._id);
      if (isSelected) {
        return prev.filter((c) => c._id !== contact._id);
      }
      return [...prev, contact];
    });
  };

  const handleShare = () => {
    if (selectedContacts.length > 0) {
      onShareContacts(selectedContacts);
      setSelectedContacts([]);
      onClose();
    }
  };

  const handleAddManualContact = () => {
    if (manualContact.name.trim()) {
      const newContact: Contact = {
        _id: `manual-${Date.now()}`,
        displayName: manualContact.name.trim(),
        phone: manualContact.phone.trim() || undefined,
        email: manualContact.email.trim() || undefined,
      };
      setSelectedContacts((prev) => [...prev, newContact]);
      setManualContact({ name: '', phone: '', email: '' });
      setShowManualEntry(false);
    }
  };

  // Request device contacts (if supported)
  const requestDeviceContacts = async () => {
    if ('contacts' in navigator && 'ContactsManager' in window) {
      try {
        setIsLoading(true);
        // @ts-expect-error - Contacts API not fully typed
        const props = ['name', 'tel', 'email'];
        // @ts-expect-error - Contacts API not fully typed
        const opts = { multiple: true };
        // @ts-expect-error - Contacts API not fully typed
        const deviceContacts = await navigator.contacts.select(props, opts);

        const formattedContacts: Contact[] = deviceContacts.map(
          (c: { name?: string[]; tel?: string[]; email?: string[] }, index: number) => ({
            _id: `device-${index}`,
            displayName: c.name?.[0] || 'Unknown',
            phone: c.tel?.[0],
            email: c.email?.[0],
          })
        );

        setContacts((prev) => [...prev, ...formattedContacts]);
      } catch (err) {
        console.log('Contact picker cancelled or not supported');
      } finally {
        setIsLoading(false);
      }
    } else {
      setShowManualEntry(true);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h2 className="text-lg font-semibold text-gray-900">Share Contact</h2>
          <button onClick={onClose} className="rounded-full p-1 text-gray-500 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-gray-200 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search contacts..."
              className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 focus:border-[#00a884] focus:outline-none focus:ring-1 focus:ring-[#00a884]"
            />
          </div>
        </div>

        {/* Selected contacts */}
        {selectedContacts.length > 0 && (
          <div className="border-b border-gray-200 p-4">
            <p className="mb-2 text-sm text-gray-600">
              {selectedContacts.length} contact{selectedContacts.length > 1 ? 's' : ''} selected
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedContacts.map((contact) => (
                <span
                  key={contact._id}
                  className="flex items-center gap-1 rounded-full bg-[#00a884]/10 px-3 py-1 text-sm text-[#00a884]"
                >
                  {contact.displayName}
                  <button
                    onClick={() => toggleContact(contact)}
                    className="ml-1 rounded-full hover:bg-[#00a884]/20"
                  >
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Manual entry form */}
        {showManualEntry && (
          <div className="border-b border-gray-200 p-4">
            <h3 className="mb-3 text-sm font-medium text-gray-700">Add Contact Manually</h3>
            <div className="space-y-3">
              <input
                type="text"
                value={manualContact.name}
                onChange={(e) => setManualContact((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Name *"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-[#00a884] focus:outline-none"
              />
              <input
                type="tel"
                value={manualContact.phone}
                onChange={(e) => setManualContact((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="Phone number"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-[#00a884] focus:outline-none"
              />
              <input
                type="email"
                value={manualContact.email}
                onChange={(e) => setManualContact((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="Email"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-[#00a884] focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setShowManualEntry(false)}
                  className="flex-1 rounded-lg border border-gray-300 py-2 text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddManualContact}
                  disabled={!manualContact.name.trim()}
                  className="flex-1 rounded-lg bg-[#00a884] py-2 text-white hover:bg-[#008f72] disabled:bg-gray-300"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Contact list */}
        <div className="max-h-80 overflow-y-auto">
          {/* Add from device button */}
          <button
            onClick={requestDeviceContacts}
            disabled={isLoading}
            className="flex w-full items-center gap-3 border-b border-gray-100 p-4 hover:bg-gray-50"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#00a884]">
              <User size={24} className="text-white" />
            </div>
            <div className="text-left">
              <p className="font-medium text-gray-900">
                {isLoading ? 'Loading...' : 'Add from device'}
              </p>
              <p className="text-sm text-gray-500">Select from your contacts</p>
            </div>
          </button>

          {/* Manual entry button */}
          {!showManualEntry && (
            <button
              onClick={() => setShowManualEntry(true)}
              className="flex w-full items-center gap-3 border-b border-gray-100 p-4 hover:bg-gray-50"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500">
                <Phone size={24} className="text-white" />
              </div>
              <div className="text-left">
                <p className="font-medium text-gray-900">Enter manually</p>
                <p className="text-sm text-gray-500">Type contact details</p>
              </div>
            </button>
          )}

          {/* Contacts from app */}
          {filteredContacts.length > 0 && (
            <div className="p-2">
              <p className="px-2 py-1 text-xs font-semibold uppercase text-gray-500">
                App Contacts
              </p>
              {filteredContacts.map((contact) => {
                const isSelected = selectedContacts.some((c) => c._id === contact._id);
                return (
                  <button
                    key={contact._id}
                    onClick={() => toggleContact(contact)}
                    className={`flex w-full items-center gap-3 rounded-lg p-2 ${
                      isSelected ? 'bg-[#00a884]/10' : 'hover:bg-gray-50'
                    }`}
                  >
                    <Avatar src={contact.avatarUrl} alt={contact.displayName} size="md" />
                    <div className="flex-1 text-left">
                      <p className="font-medium text-gray-900">{contact.displayName}</p>
                      {contact.phone && (
                        <p className="flex items-center gap-1 text-sm text-gray-500">
                          <Phone size={12} /> {contact.phone}
                        </p>
                      )}
                      {contact.email && (
                        <p className="flex items-center gap-1 text-sm text-gray-500">
                          <Mail size={12} /> {contact.email}
                        </p>
                      )}
                    </div>
                    {isSelected && (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#00a884]">
                        <Check size={14} className="text-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {filteredContacts.length === 0 && searchQuery && (
            <div className="p-8 text-center text-gray-500">
              No contacts found for "{searchQuery}"
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4">
          <button
            onClick={handleShare}
            disabled={selectedContacts.length === 0}
            className="w-full rounded-lg bg-[#00a884] py-3 font-medium text-white hover:bg-[#008f72] disabled:bg-gray-300"
          >
            Share {selectedContacts.length > 0 ? `(${selectedContacts.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
