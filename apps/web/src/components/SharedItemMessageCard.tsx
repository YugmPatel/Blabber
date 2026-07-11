import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clapperboard, ExternalLink, Newspaper } from 'lucide-react';
import { fetchAuthorizedObjectUrl } from '@/api/client';
import type { Message } from '@repo/types';

type SharedItem = NonNullable<Message['sharedItem']>;

function typeLabel(type: SharedItem['type']) {
  return type === 'reel' ? 'Shared Blabber Reel' : 'Shared Blabber Post';
}

// Fetches the thumbnail through the same authorized routes Reels/Feed use
// (poster route for Reels, post media route for posts) — both re-check the
// current viewer's access every time, so a card shared before the source
// went private (or was deleted) simply shows no image for viewers who can no
// longer see it, without any separate "unavailable" flag to keep in sync.
function SharedItemThumbnail({ thumbnailUrl }: { thumbnailUrl?: string }) {
  const [url, setUrl] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    let createdUrl: string | undefined;
    setUrl(undefined);
    if (!thumbnailUrl) return;
    (async () => {
      try {
        const value = await fetchAuthorizedObjectUrl(thumbnailUrl);
        if (!alive) {
          if (value?.startsWith('blob:')) URL.revokeObjectURL(value);
          return;
        }
        createdUrl = value;
        setUrl(value);
      } catch {
        if (alive) setUrl(undefined);
      }
    })();
    return () => {
      alive = false;
      if (createdUrl?.startsWith('blob:')) URL.revokeObjectURL(createdUrl);
    };
  }, [thumbnailUrl]);

  if (!url) return null;
  return <img src={url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />;
}

export default function SharedItemMessageCard({ sharedItem }: { sharedItem: SharedItem }) {
  const navigate = useNavigate();
  const Icon = sharedItem.type === 'reel' ? Clapperboard : Newspaper;

  return (
    <div className="w-64 max-w-full rounded-xl border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-500/25 dark:bg-teal-500/10">
      <div className="flex items-center gap-1.5">
        <Icon size={13} className="text-teal-700 dark:text-teal-300" />
        <p className="text-[11px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-300">
          {typeLabel(sharedItem.type)}
        </p>
      </div>
      <div className="mt-2 flex items-start gap-3">
        <SharedItemThumbnail thumbnailUrl={sharedItem.thumbnailUrl} />
        <div className="min-w-0 flex-1">
          {sharedItem.text && (
            <p className="line-clamp-3 text-sm text-slate-700 dark:text-slate-200">{sharedItem.text}</p>
          )}
          {sharedItem.authorName && (
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">By {sharedItem.authorName}</p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          navigate(sharedItem.url);
        }}
        className="mt-2 inline-flex items-center gap-1 rounded text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline dark:text-teal-300 dark:hover:text-teal-100"
      >
        <ExternalLink className="h-3 w-3" />
        {sharedItem.type === 'reel' ? 'Open reel' : 'Open post'}
      </button>
    </div>
  );
}
