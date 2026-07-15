import { useState } from 'react';
import {
  BarChart3,
  Calendar,
  ChevronDown,
  GripVertical,
  ListChecks,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  X,
} from 'lucide-react';

interface PollModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreatePoll: (
    question: string,
    options: string[],
    settings: {
      allowMultiple: boolean;
      allowVoteChanges: boolean;
      showVoters: boolean;
      closesAt?: string;
    }
  ) => void;
}

const DEFAULT_OPTIONS = ['', '', ''];

function SettingSwitch({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: typeof ListChecks;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-slate-100/70 dark:hover:bg-white/[0.04]"
      role="switch"
      aria-checked={checked}
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-950 dark:text-white">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</span>
      </span>
      <span
        className={`relative h-7 w-12 flex-shrink-0 rounded-full transition ${
          checked ? 'bg-teal-500 shadow-[0_0_12px_rgba(20,184,166,0.35)]' : 'bg-slate-200 dark:bg-slate-700'
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? 'left-6' : 'left-1'
          }`}
        />
      </span>
    </button>
  );
}

export default function PollModal({ isOpen, onClose, onCreatePoll }: PollModalProps) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [allowVoteChanges, setAllowVoteChanges] = useState(true);
  const [showVoters, setShowVoters] = useState(false);
  const [closesAt, setClosesAt] = useState('');

  const handleAddOption = () => {
    if (options.length < 10) {
      setOptions([...options, '']);
    }
  };

  const handleRemoveOption = (index: number) => {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index));
    }
  };

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  };

  const handleCreate = () => {
    const validOptions = options.filter((opt) => opt.trim());
    if (question.trim() && validOptions.length >= 2) {
      onCreatePoll(question.trim(), validOptions, {
        allowMultiple,
        allowVoteChanges,
        showVoters,
        closesAt: closesAt ? new Date(closesAt).toISOString() : undefined,
      });
      handleClose();
    }
  };

    const handleClose = () => {
      setQuestion('');
      setOptions(DEFAULT_OPTIONS);
      setAllowMultiple(false);
      setAllowVoteChanges(true);
      setShowVoters(false);
    setClosesAt('');
    onClose();
  };

  const isValid = question.trim() && options.filter((opt) => opt.trim()).length >= 2;

    if (!isOpen) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm dark:bg-black/65">
        <div
          className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-2xl dark:border-slate-700/80 dark:bg-[#0d1624]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-poll-title"
        >
          <div className="flex items-start gap-4 px-6 pb-4 pt-6">
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
              <BarChart3 size={23} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="create-poll-title" className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                Create Poll
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Ask the group and collect votes in one place.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
              aria-label="Close poll modal"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-5">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-950 dark:text-white">Question</span>
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What should we vote on?"
                className="h-12 w-full rounded-xl border border-teal-400 bg-white px-4 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-teal-500 dark:bg-slate-950/30 dark:text-white dark:placeholder:text-slate-500"
                autoFocus
              />
            </label>

            <section>
              <p className="mb-3 text-sm font-semibold text-slate-950 dark:text-white">Options</p>
              <div className="space-y-2.5">
                {options.map((option, index) => (
                  <div key={index} className="grid grid-cols-[22px_1fr_36px] items-center gap-3">
                    <span className="flex justify-center text-slate-400 dark:text-slate-500" aria-hidden="true">
                      <GripVertical size={18} />
                    </span>
                    <input
                      type="text"
                      value={option}
                      onChange={(e) => handleOptionChange(index, e.target.value)}
                      placeholder={`Option ${index + 1}`}
                      className="h-11 min-w-0 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-950/30 dark:text-white dark:placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveOption(index)}
                      disabled={options.length <= 2}
                      className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-45 dark:text-slate-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                      aria-label={`Remove option ${index + 1}`}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>

              {options.length < 10 && (
                <button
                  type="button"
                  onClick={handleAddOption}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-semibold text-teal-600 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-500/10"
                >
                  <Plus size={17} />
                  Add option
                </button>
              )}
            </section>

            <section>
              <p className="mb-3 text-sm font-semibold text-slate-950 dark:text-white">Poll settings</p>
              <div className="rounded-2xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-950/25">
                <SettingSwitch
                  icon={ListChecks}
                  title="Multiple choice"
                  description="Let members choose more than one option."
                  checked={allowMultiple}
                  onChange={setAllowMultiple}
                />
                <SettingSwitch
                  icon={RefreshCw}
                  title="Allow vote changes"
                  description="Voters can update their choice before the poll closes."
                  checked={allowVoteChanges}
                  onChange={setAllowVoteChanges}
                />
                <SettingSwitch
                  icon={Users}
                  title="Show voters"
                  description="Reveal who voted for each option."
                  checked={showVoters}
                  onChange={setShowVoters}
                />
              </div>
            </section>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-950 dark:text-white">Close time</span>
              <span className="relative block">
                <Calendar size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
                <input
                  type="datetime-local"
                  value={closesAt}
                  onChange={(e) => setClosesAt(e.target.value)}
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-10 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200"
                />
                <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
              </span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-slate-200 px-6 py-5 dark:border-slate-800">
            <button
              type="button"
              onClick={handleClose}
              className="h-12 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!isValid}
              className="h-12 rounded-xl bg-teal-600 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(20,184,166,0.22)] transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
            >
              Create Poll
            </button>
          </div>
        </div>
      </div>
    );
  }
