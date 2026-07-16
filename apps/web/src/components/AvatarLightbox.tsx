import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { normalizeMediaUrl } from '@/api/client';
import Avatar from './Avatar';

interface AvatarLightboxProps {
  isOpen: boolean;
  src?: string | null;
  alt: string;
  onClose: () => void;
}

export default function AvatarLightbox({ isOpen, src, alt, onClose }: AvatarLightboxProps) {
  const [failed, setFailed] = useState(false);
  const normalizedSrc = normalizeMediaUrl(src);

  useEffect(() => {
    setFailed(false);
  }, [normalizedSrc, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const showImage = Boolean(normalizedSrc) && !failed;

  return (
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} photo`}
      onMouseDown={onClose}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="relative flex max-h-[88vh] w-full max-w-2xl items-center justify-center" onMouseDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close photo"
          className="absolute right-0 top-0 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white transition hover:bg-black/60"
        >
          <X size={18} />
        </button>
        {showImage ? (
          <img
            src={normalizedSrc}
            alt={alt}
            onError={() => setFailed(true)}
            className="max-h-[82vh] max-w-full rounded-2xl object-contain shadow-2xl"
          />
        ) : (
          <div className="flex h-60 w-60 items-center justify-center rounded-full bg-[color:var(--bl-panel)] p-2 shadow-2xl sm:h-80 sm:w-80">
            <Avatar alt={alt} size="xl" className="[&>div:first-child]:!h-full [&>div:first-child]:!w-full [&_span]:!text-6xl" />
          </div>
        )}
      </div>
    </div>
  );
}
