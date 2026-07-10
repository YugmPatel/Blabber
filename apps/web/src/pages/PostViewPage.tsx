import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { fetchAuthorizedObjectUrl, fetchPost, normalizeMediaUrl } from '@/api/client';

function PostImage({ src }: { src?: string }) {
  const [objectUrl, setObjectUrl] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    let createdUrl: string | undefined;
    setObjectUrl(undefined);
    fetchAuthorizedObjectUrl(src)
      .then((value) => {
        if (!alive) {
          if (value?.startsWith('blob:')) URL.revokeObjectURL(value);
          return;
        }
        createdUrl = value;
        setObjectUrl(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (createdUrl?.startsWith('blob:')) URL.revokeObjectURL(createdUrl);
    };
  }, [src]);

  if (!objectUrl) return null;
  return <img src={objectUrl} alt="" className="aspect-square w-full rounded-lg object-cover" />;
}

export default function PostViewPage() {
  const { postId = '' } = useParams();
  const navigate = useNavigate();
  const post = useQuery({
    queryKey: ['post-view', postId],
    queryFn: () => fetchPost(postId),
    enabled: Boolean(postId),
    retry: false,
  });

  return (
    <div className="min-h-screen bg-[#f4f5f7] text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:underline dark:text-slate-300"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        {post.isLoading ? (
          <p className="text-sm text-slate-500">Loading post...</p>
        ) : post.isError || !post.data ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            This post is no longer available.
          </div>
        ) : (
          <article className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <Avatar src={normalizeMediaUrl(post.data.author.avatarUrl)} alt={post.data.author.name} size="md" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{post.data.author.name}</p>
                <p className="truncate text-xs text-slate-500">{post.data.author.displayHandle || post.data.author.handle}</p>
              </div>
            </div>
            {post.data.media.length > 0 && (
              <div className={`mt-4 grid gap-2 ${post.data.media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {post.data.media.map((media) => (
                  <PostImage key={media.mediaId} src={normalizeMediaUrl(media.url)} />
                ))}
              </div>
            )}
            {post.data.body && (
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-800 dark:text-slate-100">{post.data.body}</p>
            )}
          </article>
        )}
      </div>
    </div>
  );
}
