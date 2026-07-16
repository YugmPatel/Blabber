import { useEffect, useState } from 'react';
import { Check, Palette, RotateCcw, X } from 'lucide-react';
import type { ChatThemeSettings } from '@/hooks/useChatTheme';
import { chatThemeScrollStyle, outgoingBubbleStyle } from '@/hooks/useChatTheme';

interface ChatThemeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: ChatThemeSettings;
  onSave: (theme: ChatThemeSettings) => void;
  onReset: () => void;
}

const bubblePresets = [
  { label: 'Default', value: null },
  { label: 'Mint', value: '#bbf7d0' },
  { label: 'Sky', value: '#bae6fd' },
  { label: 'Amber', value: '#fde68a' },
  { label: 'Rose', value: '#fecdd3' },
  { label: 'Lilac', value: '#ddd6fe' },
];

const wallpaperPresets = [
  { label: 'None', value: null },
  { label: 'Dots', value: 'dots' },
  { label: 'Grid', value: 'grid' },
  { label: 'Diagonal', value: 'diagonal' },
];

const solidPresets = [
  { label: 'Default', value: null },
  { label: 'Mist', value: '#eef7f4' },
  { label: 'Cloud', value: '#eff6ff' },
  { label: 'Blush', value: '#fff1f2' },
  { label: 'Linen', value: '#f8fafc' },
];

export default function ChatThemeModal({ isOpen, onClose, currentTheme, onSave, onReset }: ChatThemeModalProps) {
  const [draft, setDraft] = useState<ChatThemeSettings>(currentTheme);
  const [customSolid, setCustomSolid] = useState(currentTheme.solidColor || '#eef7f4');

  useEffect(() => {
    if (!isOpen) return;
    setDraft(currentTheme);
    setCustomSolid(currentTheme.solidColor || '#eef7f4');
  }, [currentTheme, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-theme-title"
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[color:var(--bl-border)] px-5 py-4">
          <div className="flex items-center gap-2">
            <Palette size={18} className="text-teal-600 dark:text-teal-300" />
            <h2 id="chat-theme-title" className="text-base font-semibold text-[color:var(--bl-text)]">Chat theme</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close theme" className="rounded-full p-2 text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)]">
            <X size={17} />
          </button>
        </header>

        <div className="space-y-5 overflow-y-auto p-5">
          <div className="rounded-2xl border border-[color:var(--bl-border)] p-4" style={chatThemeScrollStyle(draft)}>
            <div className="space-y-2">
              <div className="max-w-[72%] rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm">
                See you there.
              </div>
              <div className="ml-auto max-w-[72%] rounded-2xl border border-teal-100 bg-teal-50 px-3 py-2 text-sm text-slate-900 shadow-sm" style={outgoingBubbleStyle(draft)}>
                Perfect, I’ll bring the notes.
              </div>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--bl-text-muted)]">Bubble color</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {bubblePresets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setDraft((theme) => ({ ...theme, bubbleColor: preset.value }))}
                  className={`relative rounded-xl border px-2 py-2 text-xs font-semibold transition ${
                    draft.bubbleColor === preset.value ? 'border-teal-500 text-teal-700 dark:text-teal-200' : 'border-[color:var(--bl-border)] text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'
                  }`}
                >
                  <span className="mx-auto mb-1 block h-5 w-8 rounded-full border border-black/5" style={{ backgroundColor: preset.value || '#dcfce7' }} />
                  {preset.label}
                  {draft.bubbleColor === preset.value && <Check size={12} className="absolute right-1.5 top-1.5" />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--bl-text-muted)]">Wallpaper</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {wallpaperPresets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setDraft((theme) => ({ ...theme, wallpaper: preset.value }))}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    draft.wallpaper === preset.value ? 'border-teal-500 bg-teal-50 text-teal-800 dark:bg-teal-500/15 dark:text-teal-200' : 'border-[color:var(--bl-border)] text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--bl-text-muted)]">Background color</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {solidPresets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setDraft((theme) => ({ ...theme, solidColor: preset.value }))}
                  className={`rounded-xl border px-2 py-2 text-xs font-semibold transition ${
                    draft.solidColor === preset.value ? 'border-teal-500 text-teal-700 dark:text-teal-200' : 'border-[color:var(--bl-border)] text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'
                  }`}
                >
                  <span className="mx-auto mb-1 block h-5 w-8 rounded-full border border-black/5" style={{ backgroundColor: preset.value || '#f8faf9' }} />
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <input
                aria-label="Custom background color"
                type="color"
                value={customSolid}
                onChange={(event) => {
                  setCustomSolid(event.target.value);
                  setDraft((theme) => ({ ...theme, solidColor: event.target.value }));
                }}
                className="h-10 w-16 cursor-pointer rounded-lg border border-[color:var(--bl-border)] bg-transparent"
              />
              <span className="text-sm text-[color:var(--bl-text-muted)]">Custom solid color</span>
            </div>
          </div>
        </div>

        <footer className="flex flex-wrap gap-2 border-t border-[color:var(--bl-border)] px-5 py-4">
          <button
            type="button"
            onClick={() => {
              onReset();
              onClose();
            }}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[color:var(--bl-border)] px-4 py-2 text-sm font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
          >
            <RotateCcw size={15} />
            Reset
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="flex-1 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
          >
            Save
          </button>
        </footer>
      </section>
    </div>
  );
}
