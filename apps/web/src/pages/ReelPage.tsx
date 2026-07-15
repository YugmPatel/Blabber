import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bookmark, Flag, MessageCircle, Trash2 } from 'lucide-react';
import {
  createReelComment,
  createReelEventToken,
  createReelPlaybackSession,
  deleteReel,
  fetchAuthorizedObjectUrl,
  fetchReel,
  fetchReelComments,
  recordReelEvent,
  removeReelReaction,
  reportReel,
  saveReel,
  setReelReaction,
  unsaveReel,
} from '@/api/client';
import type { ReelItem } from '@/api/client';
import ShareToChat from '@/components/ShareToChat';

const reactions = ['❤️', '😂', '😮', '😢', '🙌'];

export default function ReelPage() {
  const { reelId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [playback, setPlayback] = useState<{ fallbackUrl: string; posterUrl: string } | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [posterUrl, setPosterUrl] = useState<string | undefined>();
  const [eventToken, setEventToken] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const reel = useQuery({ queryKey: ['reel', reelId], queryFn: () => fetchReel(reelId), enabled: Boolean(reelId) });
  const comments = useQuery({ queryKey: ['reel-comments', reelId], queryFn: () => fetchReelComments(reelId), enabled: Boolean(reelId) && commentsOpen });
  const session = useMutation({ mutationFn: () => createReelPlaybackSession(reelId), onSuccess: (value) => setPlayback(value) });
  const remove = useMutation({ mutationFn: () => deleteReel(reelId), onSuccess: () => navigate(-1) });
  const report = useMutation({ mutationFn: () => reportReel(reelId, { reason: 'Inappropriate Reel' }) });
  const updateReel = (patch: Partial<ReelItem>) => queryClient.setQueryData<ReelItem>(['reel', reelId], (old) => old ? { ...old, ...patch } : old);
  const react = useMutation({
    mutationFn: (emoji: string) => reel.data?.myReaction === emoji ? removeReelReaction(reelId) : setReelReaction(reelId, emoji),
    onSuccess: (value) => updateReel({ myReaction: value.myReaction, reactionCounts: value.reactionCounts }),
  });
  const save = useMutation({
    mutationFn: () => reel.data?.saved ? unsaveReel(reelId) : saveReel(reelId),
    onSuccess: (value) => updateReel({ saved: value.saved }),
  });
  const comment = useMutation({
    mutationFn: () => createReelComment(reelId, commentBody),
    onSuccess: (value) => {
      setCommentBody('');
      updateReel({ commentCount: value.commentCount });
      void comments.refetch();
    },
  });

  useEffect(() => {
    setPlayback(null);
    setVideoUrl(undefined);
    setPosterUrl(undefined);
    setEventToken('');
  }, [reelId]);

  useEffect(() => {
    if (reel.data?.processingStatus === 'ready' && !playback && !session.isPending) session.mutate();
  }, [reel.data?.processingStatus, playback, session.isPending]);

  useEffect(() => {
    if (!reel.data?.id) return;
    let alive = true;
    createReelEventToken(reel.data.id)
      .then((value) => {
        if (alive) setEventToken(value.eventToken);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [reel.data?.id]);

  useEffect(() => {
    if (eventToken && reelId) void recordReelEvent(reelId, { eventType: 'reel_open', eventToken });
  }, [eventToken, reelId]);

  useEffect(() => {
    if (!playback) return undefined;
    let alive = true;
    const objectUrls: string[] = [];
    const load = async () => {
      const [video, poster] = await Promise.all([
        fetchAuthorizedObjectUrl(playback.fallbackUrl),
        fetchAuthorizedObjectUrl(playback.posterUrl),
      ]);
      if (!alive) return;
      if (!video || !poster) return;
      objectUrls.push(video, poster);
      setVideoUrl(video);
      setPosterUrl(poster);
    };
    void load();
    return () => {
      alive = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [playback]);

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-6 text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className="mx-auto max-w-3xl">
        <button onClick={() => navigate(-1)} className="mb-5 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
          <ArrowLeft size={16} /> Back
        </button>
        {reel.isError && <p className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">This Reel is unavailable.</p>}
        {reel.data && (
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="bg-black">
              {playback ? (
                <video className="mx-auto max-h-[70vh] w-full bg-black" controls preload="metadata" poster={posterUrl} src={videoUrl} />
              ) : (
                <div className="flex aspect-video items-center justify-center text-sm text-slate-300">Loading video...</div>
              )}
            </div>
            <div className="p-5">
              {reel.data.caption && <p className="whitespace-pre-wrap text-sm leading-6">{reel.data.caption}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                {reactions.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => react.mutate(emoji)}
                    className={`rounded-md border px-2.5 py-1.5 text-sm ${reel.data?.myReaction === emoji ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/30' : 'border-slate-200 dark:border-slate-700'}`}
                    aria-label={`React ${emoji}`}
                  >
                    {emoji} {reel.data.reactionCounts?.[emoji] || 0}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => save.mutate()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"><Bookmark size={15} /> {reel.data.saved ? 'Saved' : 'Save'}</button>
                <button onClick={() => setCommentsOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"><MessageCircle size={15} /> {reel.data.commentCount || 0}</button>
                <button onClick={() => report.mutate()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"><Flag size={15} /> Report</button>
                <button onClick={() => remove.mutate()} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:text-red-300"><Trash2 size={15} /> Delete</button>
              </div>
              {reel.data.visibility === 'public' && (
                <div className="mt-3">
                  <ShareToChat item={{ type: 'reel', id: reelId }} />
                </div>
              )}
              {commentsOpen && (
                <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (commentBody.trim()) comment.mutate();
                    }}
                  >
                    <input value={commentBody} onChange={(event) => setCommentBody(event.target.value)} maxLength={500} className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Add a comment" />
                    <button disabled={!commentBody.trim() || comment.isPending} className="rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950">Post</button>
                  </form>
                  <div className="mt-3 space-y-2">
                    {(comments.data?.comments || []).map((item) => (
                      <div key={item.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950">
                        <p className="font-medium">{item.author?.name || item.author?.handle || 'Member'}</p>
                        <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-200">{item.body}</p>
                      </div>
                    ))}
                    {!comments.isLoading && comments.data?.comments.length === 0 && <p className="text-sm text-slate-500">No comments yet.</p>}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
