import { useState } from 'react';
import { X, Bell, Clock, Calendar } from 'lucide-react';

interface MessageReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSetReminder: (reminderTime: Date, note?: string) => void;
  messagePreview: string;
}

export default function MessageReminderModal({
  isOpen,
  onClose,
  onSetReminder,
  messagePreview,
}: MessageReminderModalProps) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [quickOption, setQuickOption] = useState<string | null>(null);

  const quickOptions = [
    { label: 'In 30 min', minutes: 30 },
    { label: 'In 1 hour', minutes: 60 },
    { label: 'In 3 hours', minutes: 180 },
    { label: 'Tomorrow 9 AM', preset: 'tomorrow9am' },
    { label: 'This evening', preset: 'evening' },
  ];

  const getQuickOptionDate = (option: { minutes?: number; preset?: string }): Date => {
    const now = new Date();
    if (option.minutes) {
      return new Date(now.getTime() + option.minutes * 60 * 1000);
    }
    if (option.preset === 'tomorrow9am') {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      return tomorrow;
    }
    if (option.preset === 'evening') {
      const evening = new Date(now);
      evening.setHours(18, 0, 0, 0);
      if (evening <= now) {
        evening.setDate(evening.getDate() + 1);
      }
      return evening;
    }
    return now;
  };

  const handleSetReminder = () => {
    let reminderTime: Date;
    if (quickOption) {
      const option = quickOptions.find((o) => o.label === quickOption);
      reminderTime = option ? getQuickOptionDate(option) : new Date();
    } else if (date && time) {
      reminderTime = new Date(`${date}T${time}`);
    } else {
      return;
    }

    if (reminderTime <= new Date()) {
      alert('Please select a future time');
      return;
    }

    onSetReminder(reminderTime, note || undefined);
    onClose();
  };

  const today = new Date().toISOString().split('T')[0];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-[#00a884]" />
            <h2 className="text-lg font-semibold text-gray-900">Set Reminder</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-gray-500 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Message preview */}
          <div className="rounded-lg bg-gray-100 p-3">
            <p className="text-xs text-gray-500 mb-1">Remind me about:</p>
            <p className="text-sm text-gray-700 line-clamp-2">{messagePreview}</p>
          </div>

          {/* Quick options */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Quick Options</label>
            <div className="flex flex-wrap gap-2">
              {quickOptions.map((option) => (
                <button
                  key={option.label}
                  onClick={() => {
                    setQuickOption(option.label);
                    setDate('');
                    setTime('');
                  }}
                  className={`rounded-full px-3 py-1 text-sm transition-colors ${
                    quickOption === option.label
                      ? 'bg-[#00a884] text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom date/time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Or pick custom time
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="date"
                  value={date}
                  min={today}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setQuickOption(null);
                  }}
                  className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 focus:border-[#00a884] focus:outline-none"
                />
              </div>
              <div className="flex-1 relative">
                <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="time"
                  value={time}
                  onChange={(e) => {
                    setTime(e.target.value);
                    setQuickOption(null);
                  }}
                  className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 focus:border-[#00a884] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Optional note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Add a note (optional)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g., Reply to this message"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-[#00a884] focus:outline-none"
            />
          </div>
        </div>

        <div className="border-t border-gray-200 p-4">
          <button
            onClick={handleSetReminder}
            disabled={!quickOption && (!date || !time)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#00a884] py-3 font-medium text-white hover:bg-[#008f72] disabled:bg-gray-300"
          >
            <Bell size={18} />
            Set Reminder
          </button>
        </div>
      </div>
    </div>
  );
}
