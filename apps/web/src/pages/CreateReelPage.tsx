import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Tags, Upload } from 'lucide-react';
import {
  fetchDiscoveryTopics,
  fetchReelStatus,
  initiateReelUpload,
  publishReel,
  updateReelDiscovery,
  uploadReelSource,
} from '@/api/client';
import type { DiscoveryTopic } from '@/api/client';

export default function CreateReelPage() {
  const navigate = useNavigate();
  const [reelId, setReelId] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<'followers' | 'public'>('followers');
  const [includeInReels, setIncludeInReels] = useState(false);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const topics = useQuery({ queryKey: ['discovery-topics'], queryFn: fetchDiscoveryTopics, enabled: includeInReels });

  const status = useQuery({
    queryKey: ['reel-status', reelId],
    queryFn: () => fetchReelStatus(reelId!),
    enabled: Boolean(reelId),
    refetchInterval: (query) => {
      const state = query.state.data?.reel.processingStatus;
      return state && !['ready', 'rejected', 'failed', 'deleted'].includes(state) ? 2500 : false;
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setError(null);
      const init = await initiateReelUpload({ fileName: file.name, fileType: file.type || 'video/mp4', fileSize: file.size });
      setReelId(init.reelId);
      await uploadReelSource(init.uploadUrl, file);
      return init.reelId;
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'This video cannot be processed. Upload an MP4 video that is 3 to 90 seconds long.'),
  });

  const publish = useMutation({
    mutationFn: async () => {
      const reel = await publishReel({ reelId: reelId!, caption, visibility, topicIds: [] });
      if (includeInReels) {
        return updateReelDiscovery(reel.id, { reelDiscoverable: true, reelTopicIds: topicIds.slice(0, 3) });
      }
      return reel;
    },
    onSuccess: (reel) => navigate(`/reels/${reel.id}`),
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not publish this Reel.'),
  });

  useEffect(() => {
    if (status.data?.message) setError(status.data.message);
  }, [status.data?.message]);

  const processingStatus = status.data?.reel.processingStatus || (upload.isPending ? 'uploading' : null);
  const ready = status.data?.reel.processingStatus === 'ready';
  const canPublish = ready && (!includeInReels || (visibility === 'public' && topicIds.length > 0));

  const toggleTopic = (topic: DiscoveryTopic) => {
    setTopicIds((current) => {
      if (current.includes(topic.id)) return current.filter((id) => id !== topic.id);
      if (current.length >= 3) return current;
      return [...current, topic.id];
    });
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className="mx-auto max-w-2xl">
        <button onClick={() => navigate(-1)} className="mb-5 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
          <ArrowLeft size={16} /> Back
        </button>
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-xl font-semibold">Create Reel</h1>
          <p className="mt-2 text-sm text-slate-500">Upload an MP4 video between 3 and 90 seconds.</p>
          <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
            {upload.isPending ? <Loader2 className="animate-spin" size={22} /> : <Upload size={22} />}
            <span className="mt-2 text-sm font-medium">Choose MP4 video</span>
            <input
              className="hidden"
              type="file"
              accept="video/mp4"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload.mutate(file);
              }}
            />
          </label>
          {processingStatus && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
              {processingStatus === 'ready' ? 'Ready' : processingStatus === 'rejected' || processingStatus === 'failed' ? 'Could not process' : 'Processing'}
            </div>
          )}
          {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
          {reelId && (
            <div className="mt-5 space-y-4">
              <textarea
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                maxLength={2000}
                className="min-h-32 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                placeholder="Caption"
              />
              <select value={visibility} onChange={(event) => setVisibility(event.target.value as any)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                <option value="followers">Followers</option>
                <option value="public">Public</option>
              </select>
              <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <label className="flex items-center justify-between gap-3 text-sm font-medium">
                  <span className="inline-flex items-center gap-2"><Tags size={16} /> Include in Reels</span>
                  <input
                    type="checkbox"
                    checked={includeInReels}
                    onChange={(event) => {
                      setIncludeInReels(event.target.checked);
                      if (event.target.checked) setVisibility('public');
                    }}
                    aria-label="Include in Reels"
                  />
                </label>
                <p className="mt-2 text-xs text-slate-500">Only public, ready Reels with 1 to 3 topics can appear in the Reels browse viewer.</p>
                {includeInReels && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(topics.data || []).map((topic) => {
                      const active = topicIds.includes(topic.id);
                      return (
                        <button
                          key={topic.id}
                          type="button"
                          onClick={() => toggleTopic(topic)}
                          className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                            active
                              ? 'border-teal-500 bg-teal-50 text-teal-800 dark:border-teal-700 dark:bg-teal-900/30 dark:text-teal-100'
                              : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {topic.label}
                        </button>
                      );
                    })}
                    {!topics.isLoading && topics.data?.length === 0 && <span className="text-xs text-slate-500">No topics available.</span>}
                  </div>
                )}
              </div>
              <button
                disabled={!canPublish || publish.isPending}
                onClick={() => publish.mutate()}
                className="ml-3 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950"
              >
                {publish.isPending ? 'Publishing...' : 'Publish'}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
