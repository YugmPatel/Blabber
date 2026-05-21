import { normalizeMediaUrl } from '@/api/client';

// Deterministic color palette — same name always gets the same color
const PALETTE: [string, string][] = [
  ['#6366f1', '#4f46e5'], // indigo
  ['#8b5cf6', '#7c3aed'], // violet
  ['#a855f7', '#9333ea'], // purple
  ['#ec4899', '#db2777'], // pink
  ['#f97316', '#ea580c'], // orange
  ['#f59e0b', '#d97706'], // amber
  ['#10b981', '#059669'], // emerald
  ['#14b8a6', '#0d9488'], // teal
  ['#0ea5e9', '#0284c7'], // sky
  ['#ef4444', '#dc2626'], // red
];

function pickColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const [from, to] = PALETTE[Math.abs(hash) % PALETTE.length];
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
}

function getInitials(name: string): string {
  const cleaned = (name || '?').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE: Record<AvatarSize, { container: string; text: string; dot: string; dotPos: string }> = {
  xs: { container: 'h-6 w-6',  text: 'text-[9px]',  dot: 'h-2 w-2 border',   dotPos: '-bottom-0.5 -right-0.5' },
  sm: { container: 'h-8 w-8',  text: 'text-[11px]', dot: 'h-2.5 w-2.5 border-2', dotPos: 'bottom-0 right-0' },
  md: { container: 'h-10 w-10', text: 'text-[13px]', dot: 'h-3 w-3 border-2',  dotPos: 'bottom-0 right-0' },
  lg: { container: 'h-12 w-12', text: 'text-[15px]', dot: 'h-3.5 w-3.5 border-2', dotPos: 'bottom-0 right-0' },
  xl: { container: 'h-20 w-20', text: 'text-2xl',    dot: 'h-4 w-4 border-2',  dotPos: 'bottom-1 right-1' },
};

interface AvatarProps {
  /** Image URL — if falsy, initials are shown */
  src?: string | null;
  /** Name used to derive initials and deterministic color */
  alt: string;
  size?: AvatarSize;
  /** undefined = no indicator, true = online (green), false = offline (gray) */
  online?: boolean;
  className?: string;
}

export default function Avatar({ src, alt, size = 'md', online, className = '' }: AvatarProps) {
  const s = SIZE[size];
  const normalizedSrc = normalizeMediaUrl(src);

  return (
    <div className={`relative inline-flex flex-shrink-0 ${className}`}>
      <div
        className={`${s.container} overflow-hidden rounded-full flex items-center justify-center select-none`}
        style={!normalizedSrc ? { background: pickColor(alt || '?') } : undefined}
      >
        {normalizedSrc ? (
          <img
            src={normalizedSrc}
            alt={alt}
            className="h-full w-full object-cover"
            onError={(e) => {
              // Hide broken image; the underlying gradient will show
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <span className={`font-semibold leading-none text-white ${s.text}`}>
            {getInitials(alt)}
          </span>
        )}
      </div>

      {online !== undefined && (
        <span
          className={`absolute ${s.dotPos} ${s.dot} rounded-full border-white dark:border-slate-900 ${
            online ? 'bg-emerald-500' : 'bg-slate-400'
          }`}
          role="status"
          aria-label={online ? 'Online' : 'Offline'}
        />
      )}
    </div>
  );
}
