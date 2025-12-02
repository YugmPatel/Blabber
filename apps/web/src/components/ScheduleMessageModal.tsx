import { useState } from 'react';
import { X, Clock, Calendar, Send } from 'lucide-react';

interface ScheduleMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSchedule: (message: string, scheduledTime: Date) => void;
  initialMessage?: string;
}

export default function ScheduleMessageModal({
  isOpen,
  onClose,
  onSchedule,
  initialMessage = '',
}: ScheduleMessageModalProps) {
  const [message, setMessage] = useState(initialMessage);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [quickOption, setQuickOption] = useState<string | null>(null);

  const quickOptions = [
    { label: 'In 1 hour', hours: 1 },
    { label: 'In 3 hours', hours: 3 },
    { label: 'Tomorrow 9 AM', preset: 'tomorrow9am' },
    { label: 'Tomorrow 6 PM', preset: 'tomorrow6pm' },
    { label: 'Monday 9 AM', preset: 'monday9am' },
  ];

  const getQuickOptionDate = (option: { hours?: number; preset?: string }): Date => {
    const now = new Date();
    if (option.hours) {
      return new Date(now.getTime() + option.hours * 60 * 60 * 1000);
    }
    if (option.preset === 'tomorrow9am') {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      return tomorrow;
    }
    if (option.preset === 'tomorrow6pm') {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(18, 0, 0, 0);
      return tomorrow;
    }
    if (option.preset === 'monday9am') {
      const monday = new Date(now);
      const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
      monday.setDate(monday.getDate() + daysUntilMonday);
      monday.setHours(9, 0, 0, 0);
      return monday;
    }
    return now;
  };

  const handleSchedule = () => {
    if (!message.trim()) return;

    let scheduledTime: Date;
    if (quickOption) {
      const option = quickOptions.find((o) => o.label === quickOption);
      scheduledTime = option ? getQuickOptionDate(option) : new Date();
    } else if (date && time) {
      scheduledTime = new Date(`${date}T${time}`);
    } else {
      return;
    }

    if (scheduledTime <= new Date()) {
      alert('Please select a future time');
      return;
    }

    onSchedule(message, scheduledTime);
    setMessage('');
    setDate('');
    setTime('');
    setQuickOption(null);
    onClose();
  };

  const formatDateTime = (d: Date) => {
    return d.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Get min date (today)
  const today = new Date().toISOString().split('T')[0];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-[#00a884]" />
            <h2 className="text-lg font-semibold text-gray-900">Schedule Message</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-gray-500 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Message input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message..."
              className="w-full rounded-lg border border-gray-300 p-3 focus:border-[#00a884] focus:outline-none focus:ring-1 focus:ring-[#00a884] resize-none"
              rows={3}
            />
          </div>

          {/* Quick options */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Quick Schedule</label>
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
              <div className="flex-1">
                <div className="relative">
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
              </div>
              <div className="flex-1">
                <div className="relative">
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
          </div>

          {/* Preview */}
          {(quickOption || (date && time)) && (
            <div className="rounded-lg bg-[#00a884]/10 p-3">
              <p className="text-sm text-[#00a884]">
                <span className="font-medium">Will be sent:</span>{' '}
                {quickOption
                  ? formatDateTime(
                      getQuickOptionDate(quickOptions.find((o) => o.label === quickOption)!)
                    )
                  : formatDateTime(new Date(`${date}T${time}`))}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4">
          <button
            onClick={handleSchedule}
            disabled={!message.trim() || (!quickOption && (!date || !time))}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#00a884] py-3 font-medium text-white hover:bg-[#008f72] disabled:bg-gray-300"
          >
            <Send size={18} />
            Schedule Message
          </button>
        </div>
      </div>
    </div>
  );
}
