import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Image as ImageIcon, Loader2, Type, Video, Volume2, X } from 'lucide-react';
import { apiClient, createMomentVideoPlaybackSession, fetchAuthorizedObjectUrl } from '@/api/client';
import type { Message } from '@repo/types';

type MomentPreview = {
  _id: string;
  author: { _id: string; name: string; avatarUrl?: string | null };
  type: 'text' | 'image' | 'audio' | 'video';
  textBody?: string;
  caption?: string;
  mediaUrl?: string | null;
  style?: { backgroundKey?: string; textStyleKey?: string };
  createdAt: string;
  expiresAt?: string;
  archiveState?: 'active' | 'archived' | 'deleted';
};

type LoadedMedia = {
  objectUrl?: string;
  posterUrl?: string;
  unavailable: boolean;
};

const STYLE_BACKGROUNDS: Record<string, string> = {
  teal: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
  sky: 'linear-gradient(135deg, #0369a1 0%, #38bdf8 100%)',
  violet: 'linear-gradient(135deg, #6d28d9 0%, #a78bfa 100%)',
  rose: 'linear-gradient(135deg, #be123c 0%, #fb7185 100%)',
  amber: 'linear-gradient(135deg, #b45309 0%, #f59e0b 100%)',
  slate: 'linear-gradient(135deg, #334155 0%, #0f172a 100%)',
};

function momentTypeLabel(type?: string) {
  if (!type) return 'Moment';
  return `${type[0].toUpperCase()}${type.slice(1)} Moment`;
}

export default function MomentPreviewModal({
  momentId,
  snapshot,
  onClose,
}: {
  momentId: string | null;
  snapshot?: Message['momentReply'];
  onClose: () => void;
}) {
  const [mediaObjectUrl, setMediaObjectUrl] = useState<string | undefined>();
  const [loadedMedia, setLoadedMedia] = useState<LoadedMedia>({ unavailable: false });
  const query = useQuery({
    queryKey: ['moment-preview', momentId],
    queryFn: async () => {
      const { data } = await apiClient.get<{ moment: MomentPreview }>(`/api/moments/${momentId}`);
      return data.moment;
    },
    enabled: Boolean(momentId),
    retry: false,
  });

  const moment = query.data;
  const type = moment?.type || snapshot?.momentType;
  const text = moment?.textBody || moment?.caption || snapshot?.text || '';
  const mediaUrl = moment?.mediaUrl || snapshot?.mediaUrl;
  const authorName = moment?.author?.name || snapshot?.authorName || 'Someone';
  const title = momentTypeLabel(type);
  const unavailable = query.isError || snapshot?.unavailable;
  const Icon = type === 'image' ? ImageIcon : type === 'audio' ? Volume2 : type === 'video' ? Video : Type;
  const background = useMemo(
    () => STYLE_BACKGROUNDS[moment?.style?.backgroundKey || 'teal'] || STYLE_BACKGROUNDS.teal,
    [moment?.style?.backgroundKey]
  );

  useEffect(() => {
    if (!momentId) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [momentId, onClose]);

  useEffect(() => {
    setLoadedMedia({ unavailable: false });
    setMediaObjectUrl(undefined);
    if (!type || type === 'text') {
      return undefined;
    }

    if (type === 'video') {
      let active = true;
      let objectUrl: string | undefined;
      let posterUrl: string | undefined;
      createMomentVideoPlaybackSession(momentId)
        .then(() => Promise.all([
          apiClient.get<Blob>(`/api/moments/${momentId}/video/fallback`, { responseType: 'blob' }),
          apiClient.get<Blob>(`/api/moments/${momentId}/video/poster`, { responseType: 'blob' }),
        ]))
        .then(([videoResponse, posterResponse]) => {
          if (!active) return;
          objectUrl = URL.createObjectURL(videoResponse.data);
          posterUrl = URL.createObjectURL(posterResponse.data);
          setLoadedMedia({ objectUrl, posterUrl, unavailable: false });
        })
        .catch(() => {
          if (active) setLoadedMedia({ unavailable: true });
        });
      return () => {
        active = false;
        if (objectUrl?.startsWith('blob:')) URL.revokeObjectURL(objectUrl);
        if (posterUrl?.startsWith('blob:')) URL.revokeObjectURL(posterUrl);
      };
    }

    if (!mediaUrl || (type !== 'image' && type !== 'audio')) {
      setLoadedMedia({ unavailable: true });
      return undefined;
    }

    let active = true;
    let objectUrl: string | undefined;
    fetchAuthorizedObjectUrl(mediaUrl)
      .then((url) => {
        if (!active) {
          if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setMediaObjectUrl(url);
        setLoadedMedia({ objectUrl: url, unavailable: false });
      })
      .catch(() => {
        if (active) setLoadedMedia({ unavailable: true });
      });
    return () => {
      active = false;
      if (objectUrl?.startsWith('blob:')) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaUrl, momentId, type]);

  if (!momentId) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="moment-preview-title"
        className="max-h-[88vh] w-full max-w-md overflow-hidden rounded-3xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[color:var(--bl-border)] px-4 py-3">
          <div className="min-w-0">
            <h2 id="moment-preview-title" className="truncate text-sm font-semibold text-[color:var(--bl-text)]">
              {snapshot?.label || 'Replied to a Moment'}
            </h2>
            <p className="truncate text-xs text-[color:var(--bl-text-muted)]">{authorName} · {title}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Moment" className="rounded-full p-2 text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)]">
            <X size={17} />
          </button>
        </header>

        <div className="p-4">
          {query.isLoading ? (
            <div className="flex h-64 items-center justify-center gap-2 text-sm text-[color:var(--bl-text-muted)]">
              <Loader2 size={17} className="animate-spin" /> Loading Moment...
            </div>
          ) : unavailable ? (
            <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] text-center">
              <Icon size={28} className="text-[color:var(--bl-text-muted)]" />
              <p className="mt-3 text-sm font-semibold text-[color:var(--bl-text)]">This Moment is no longer available.</p>
              {text && <p className="mt-2 max-w-xs text-sm text-[color:var(--bl-text-muted)]">{text}</p>}
            </div>
          ) : loadedMedia.unavailable ? (
            <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-[color:var(--bl-border)] bg-[color:var(--bl-hover)] text-center">
              <Icon size={28} className="text-[color:var(--bl-text-muted)]" />
              <p className="mt-3 text-sm font-semibold text-[color:var(--bl-text)]">This Moment media is unavailable.</p>
              {text && <p className="mt-2 max-w-xs text-sm text-[color:var(--bl-text-muted)]">{text}</p>}
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl">
              {type === 'image' && mediaObjectUrl ? (
                <img src={mediaObjectUrl} alt={text || 'Moment photo'} className="max-h-[58vh] w-full object-contain bg-slate-950" />
              ) : type === 'audio' && loadedMedia.objectUrl ? (
                <div className="bg-[color:var(--bl-hover)] px-4 py-8">
                  <div className="mb-4 flex items-center justify-center">
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-600 dark:text-teal-300">
                      <Volume2 size={26} />
                    </span>
                  </div>
                  <audio src={loadedMedia.objectUrl} controls preload="metadata" className="w-full" aria-label="Play or pause audio Moment" />
                </div>
              ) : type === 'video' && loadedMedia.objectUrl ? (
                <video
                  src={loadedMedia.objectUrl}
                  poster={loadedMedia.posterUrl}
                  controls
                  preload="metadata"
                  className="max-h-[58vh] w-full bg-black object-contain"
                  aria-label="Play or pause video Moment"
                />
              ) : (
                <div className="flex min-h-72 flex-col items-center justify-center px-6 py-10 text-center text-white" style={{ background }}>
                  <Icon size={30} className="mb-4 opacity-85" />
                  <p className="whitespace-pre-wrap text-xl font-semibold leading-snug">{text || title}</p>
                </div>
              )}
              {text && (mediaObjectUrl || loadedMedia.objectUrl) && (
                <div className="bg-[color:var(--bl-hover)] px-4 py-3 text-sm text-[color:var(--bl-text-secondary)]">
                  {text}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
