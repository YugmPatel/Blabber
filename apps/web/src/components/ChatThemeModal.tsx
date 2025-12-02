import { useState } from 'react';
import { X, Palette, Check, Image } from 'lucide-react';

interface ChatTheme {
  id: string;
  name: string;
  backgroundColor: string;
  bubbleColor: string;
  textColor: string;
  backgroundImage?: string;
}

interface ChatThemeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTheme: (theme: ChatTheme) => void;
  currentTheme?: ChatTheme;
}

const defaultThemes: ChatTheme[] = [
  {
    id: 'default',
    name: 'Default',
    backgroundColor: '#efeae2',
    bubbleColor: '#dcf8c6',
    textColor: '#111b21',
  },
  {
    id: 'dark',
    name: 'Dark Mode',
    backgroundColor: '#0b141a',
    bubbleColor: '#005c4b',
    textColor: '#e9edef',
  },
  {
    id: 'ocean',
    name: 'Ocean Blue',
    backgroundColor: '#e3f2fd',
    bubbleColor: '#90caf9',
    textColor: '#0d47a1',
  },
  {
    id: 'sunset',
    name: 'Sunset',
    backgroundColor: '#fff3e0',
    bubbleColor: '#ffcc80',
    textColor: '#e65100',
  },
  {
    id: 'forest',
    name: 'Forest',
    backgroundColor: '#e8f5e9',
    bubbleColor: '#a5d6a7',
    textColor: '#1b5e20',
  },
  {
    id: 'lavender',
    name: 'Lavender',
    backgroundColor: '#f3e5f5',
    bubbleColor: '#ce93d8',
    textColor: '#4a148c',
  },
  {
    id: 'rose',
    name: 'Rose',
    backgroundColor: '#fce4ec',
    bubbleColor: '#f48fb1',
    textColor: '#880e4f',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    backgroundColor: '#1a1a2e',
    bubbleColor: '#16213e',
    textColor: '#eaeaea',
  },
  {
    id: 'coral',
    name: 'Coral',
    backgroundColor: '#fff5f5',
    bubbleColor: '#feb2b2',
    textColor: '#c53030',
  },
  {
    id: 'mint',
    name: 'Mint Fresh',
    backgroundColor: '#f0fff4',
    bubbleColor: '#9ae6b4',
    textColor: '#22543d',
  },
];

const backgroundPatterns = [
  { id: 'none', name: 'None', pattern: '' },
  { id: 'dots', name: 'Dots', pattern: 'radial-gradient(circle, #00000010 1px, transparent 1px)' },
  {
    id: 'grid',
    name: 'Grid',
    pattern:
      'linear-gradient(#00000008 1px, transparent 1px), linear-gradient(90deg, #00000008 1px, transparent 1px)',
  },
  {
    id: 'diagonal',
    name: 'Diagonal',
    pattern:
      'repeating-linear-gradient(45deg, #00000008, #00000008 1px, transparent 1px, transparent 10px)',
  },
];

export default function ChatThemeModal({
  isOpen,
  onClose,
  onSelectTheme,
  currentTheme,
}: ChatThemeModalProps) {
  const [selectedTheme, setSelectedTheme] = useState<ChatTheme>(currentTheme || defaultThemes[0]);
  const [selectedPattern, setSelectedPattern] = useState(backgroundPatterns[0]);
  const [customColor, setCustomColor] = useState('#dcf8c6');

  const handleApply = () => {
    onSelectTheme(selectedTheme);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-[#00a884]" />
            <h2 className="text-lg font-semibold text-gray-900">Chat Theme</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-gray-500 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Preview */}
          <div
            className="rounded-lg p-4 h-40 relative overflow-hidden"
            style={{
              backgroundColor: selectedTheme.backgroundColor,
              backgroundImage: selectedPattern.pattern,
              backgroundSize:
                selectedPattern.id === 'dots'
                  ? '20px 20px'
                  : selectedPattern.id === 'grid'
                    ? '20px 20px'
                    : undefined,
            }}
          >
            <p className="text-xs text-gray-500 mb-2">Preview</p>
            <div className="space-y-2">
              <div className="flex justify-start">
                <div
                  className="rounded-lg px-3 py-2 max-w-[70%]"
                  style={{ backgroundColor: '#ffffff', color: selectedTheme.textColor }}
                >
                  <p className="text-sm">Hey! How are you?</p>
                </div>
              </div>
              <div className="flex justify-end">
                <div
                  className="rounded-lg px-3 py-2 max-w-[70%]"
                  style={{
                    backgroundColor: selectedTheme.bubbleColor,
                    color: selectedTheme.textColor,
                  }}
                >
                  <p className="text-sm">I'm doing great! Thanks for asking 😊</p>
                </div>
              </div>
            </div>
          </div>

          {/* Theme colors */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Choose Theme</p>
            <div className="grid grid-cols-5 gap-2">
              {defaultThemes.map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => setSelectedTheme(theme)}
                  className={`relative rounded-lg p-1 transition-all ${
                    selectedTheme.id === theme.id ? 'ring-2 ring-[#00a884] ring-offset-2' : ''
                  }`}
                >
                  <div
                    className="h-12 rounded-md flex items-end justify-center pb-1"
                    style={{ backgroundColor: theme.backgroundColor }}
                  >
                    <div
                      className="w-8 h-4 rounded"
                      style={{ backgroundColor: theme.bubbleColor }}
                    />
                  </div>
                  <p className="text-xs text-center mt-1 text-gray-600 truncate">{theme.name}</p>
                  {selectedTheme.id === theme.id && (
                    <div className="absolute -top-1 -right-1 bg-[#00a884] rounded-full p-0.5">
                      <Check size={12} className="text-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Background patterns */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Background Pattern</p>
            <div className="flex gap-2">
              {backgroundPatterns.map((pattern) => (
                <button
                  key={pattern.id}
                  onClick={() => setSelectedPattern(pattern)}
                  className={`flex-1 rounded-lg border-2 p-2 transition-colors ${
                    selectedPattern.id === pattern.id
                      ? 'border-[#00a884] bg-[#00a884]/10'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div
                    className="h-8 rounded bg-gray-100 mb-1"
                    style={{
                      backgroundImage: pattern.pattern,
                      backgroundSize:
                        pattern.id === 'dots'
                          ? '10px 10px'
                          : pattern.id === 'grid'
                            ? '10px 10px'
                            : undefined,
                    }}
                  />
                  <p className="text-xs text-center text-gray-600">{pattern.name}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Custom bubble color */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Custom Bubble Color</p>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={customColor}
                onChange={(e) => {
                  setCustomColor(e.target.value);
                  setSelectedTheme({
                    ...selectedTheme,
                    id: 'custom',
                    name: 'Custom',
                    bubbleColor: e.target.value,
                  });
                }}
                className="h-10 w-20 cursor-pointer rounded border border-gray-300"
              />
              <span className="text-sm text-gray-500">Pick your own color</span>
            </div>
          </div>

          {/* Wallpaper upload */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Custom Wallpaper</p>
            <button className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 py-4 text-gray-500 hover:border-[#00a884] hover:text-[#00a884] transition-colors">
              <Image size={20} />
              <span className="text-sm">Upload wallpaper image</span>
            </button>
          </div>
        </div>

        <div className="flex gap-2 border-t border-gray-200 p-4">
          <button
            onClick={() => {
              setSelectedTheme(defaultThemes[0]);
              setSelectedPattern(backgroundPatterns[0]);
            }}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-gray-700 hover:bg-gray-50"
          >
            Reset to Default
          </button>
          <button
            onClick={handleApply}
            className="flex-1 rounded-lg bg-[#00a884] py-2 font-medium text-white hover:bg-[#008f72]"
          >
            Apply Theme
          </button>
        </div>
      </div>
    </div>
  );
}
