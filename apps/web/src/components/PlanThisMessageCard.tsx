import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { CalendarClock, CheckCircle2, ClipboardList, ExternalLink, Loader2, MapPin, Pencil, RefreshCw, Users, X } from 'lucide-react';
import {
  cancelPlanThis,
  fetchAuthorizedObjectUrl,
  fetchPlanThisPlan,
  fetchPost,
  finalizePlanThis,
  normalizeMediaUrl,
  reelPosterUrl,
  respondPlanThisAssignment,
  updatePlanThis,
  votePlanThis,
  type PlanThisPlan,
  type PlanThisVoteStatus,
} from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';

export const planThisKeys = {
  detail: (planId: string) => ['plan-this-plan', planId] as const,
};

const voteLabels: Record<PlanThisVoteStatus, string> = {
  going: 'Going',
  maybe: 'Maybe',
  not_joining: 'Not joining',
};

const statusLabels: Record<PlanThisPlan['state'], string> = {
  draft: 'Draft',
  proposed: 'Voting open',
  voting: 'Voting open',
  ready_to_finalize: 'Ready to finalize',
  finalized: 'Finalized',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

const reminderOptions = [
  { value: '', label: 'No reminder' },
  { value: 5, label: '5 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
] as const;

function reminderLabel(offsetMinutes?: number) {
  return reminderOptions.find((option) => option.value === offsetMinutes)?.label || '';
}

function reminderTooSoonMessage(offsetMinutes: number) {
  if (offsetMinutes === 5) return 'For a 5-minute reminder, choose an event time at least 5 minutes in the future.';
  if (offsetMinutes === 60) return 'For a 1-hour reminder, choose an event time at least 1 hour in the future.';
  if (offsetMinutes === 1440) return 'For a 1-day reminder, choose an event time at least 1 day in the future.';
  return 'For a 15-minute reminder, choose an event time at least 15 minutes in the future.';
}

type DraftAssignment = {
  id: string;
  title: string;
  details: string;
  assigneeUserId: string;
  dueAt: string;
};

function createDraftAssignment(): DraftAssignment {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: '',
    details: '',
    assigneeUserId: '',
    dueAt: '',
  };
}

function localDateTime(value?: string | null, includeZone = false) {
  if (!value) return 'Time not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time not set';
  const parts = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: includeZone ? 'short' : undefined,
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('weekday')}, ${pick('month')} ${pick('day')} · ${pick('hour')}:${pick('minute')} ${pick('dayPeriod')}${includeZone ? ` ${pick('timeZoneName')}` : ''}`.replace(/\s+/g, ' ').trim();
}

function toDateTimeLocal(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError<{ message?: string }>(error)) return error.response?.data?.message || fallback;
  return fallback;
}

function voteSummary(plan?: PlanThisPlan | null) {
  const currentVotes = (plan?.votes || []).filter((vote) => vote.current !== false && vote.planVersion === (plan?.planVersion ?? 0));
  const counts = currentVotes.reduce<Record<PlanThisVoteStatus, number>>((acc, vote) => {
    acc[vote.status] += 1;
    return acc;
  }, { going: 0, maybe: 0, not_joining: 0 });
  return `${counts.going} Going · ${counts.maybe} Maybe · ${counts.not_joining} Not joining`;
}

function planStatus(plan?: PlanThisPlan | null) {
  if (!plan) return 'Plan is unavailable.';
  if (plan.state === 'draft') return 'Voting open';
  if (plan.state === 'voting' && plan.lastMaterialChangeAt) return 'Updated, vote again';
  if (plan.state === 'voting' && (plan.updateCount || 0) > 0) return 'Updated, review changes';
  return statusLabels[plan.state];
}

function sourceTypeLabel(type: PlanThisPlan['source']['type']) {
  return type === 'reel' ? 'From Blabber Reel' : 'From Blabber post';
}

// Fetches a thumbnail through the same authorized flows Reels/Feed already use (poster route for
// Reels, post media for posts) — no raw provider URLs or hotlinking are ever exposed to the client.
function PlanSourceThumbnail({ type, sourceId }: { type: 'reel' | 'post'; sourceId: string }) {
  const [url, setUrl] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    let createdUrl: string | undefined;
    setUrl(undefined);
    (async () => {
      try {
        if (type === 'reel') {
          const value = await fetchAuthorizedObjectUrl(reelPosterUrl(sourceId));
          if (!alive) {
            if (value?.startsWith('blob:')) URL.revokeObjectURL(value);
            return;
          }
          createdUrl = value;
          setUrl(value);
        } else {
          const post = await fetchPost(sourceId);
          const mediaUrl = post.media[0]?.url;
          if (!mediaUrl) return;
          const value = await fetchAuthorizedObjectUrl(normalizeMediaUrl(mediaUrl));
          if (!alive) {
            if (value?.startsWith('blob:')) URL.revokeObjectURL(value);
            return;
          }
          createdUrl = value;
          setUrl(value);
        }
      } catch {
        if (alive) setUrl(undefined);
      }
    })();
    return () => {
      alive = false;
      if (createdUrl?.startsWith('blob:')) URL.revokeObjectURL(createdUrl);
    };
  }, [type, sourceId]);

  if (!url) return null;
  return <img src={url} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />;
}

function PlanSourcePreview({ source }: { source: PlanThisPlan['source'] }) {
  const navigate = useNavigate();
  if (!source.available || !source.sourceId) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">Original content is no longer available.</p>;
  }
  const sourceId = source.sourceId;
  return (
    <div className="flex items-start gap-3">
      <PlanSourceThumbnail type={source.type} sourceId={sourceId} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-300">{sourceTypeLabel(source.type)}</p>
        {source.previewLabel && <p className="mt-0.5 line-clamp-2 text-sm text-slate-700 dark:text-slate-200">{source.previewLabel}</p>}
        {source.creatorLabel && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">By {source.creatorLabel}</p>}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            navigate(source.type === 'reel' ? `/reels/${sourceId}` : `/posts/${sourceId}`);
          }}
          className="mt-1 inline-flex items-center gap-1 rounded text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline dark:text-teal-300 dark:hover:text-teal-100"
        >
          <ExternalLink className="h-3 w-3" />
          {source.type === 'reel' ? 'Open Reel' : 'View original'}
        </button>
      </div>
    </div>
  );
}

function PlanVoteButtons({ plan, compact = false }: { plan: PlanThisPlan; compact?: boolean }) {
  const queryClient = useQueryClient();
  const vote = useMutation({
    mutationFn: (status: PlanThisVoteStatus) => votePlanThis(plan.id, status),
    onSuccess: (next) => {
      queryClient.setQueryData(planThisKeys.detail(next.id), next);
      queryClient.invalidateQueries({ queryKey: ['chat-actions', 'mine'] });
    },
  });
  if (!plan.permissions.canVote) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? 'mt-3' : ''}`} aria-label="Vote on plan">
      {(Object.keys(voteLabels) as PlanThisVoteStatus[]).map((status) => (
        <button
          key={status}
          type="button"
          disabled={vote.isPending}
          onClick={() => vote.mutate(status)}
          className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
            plan.myVote === status
              ? 'border-teal-400 bg-teal-50 text-teal-700 dark:border-teal-500 dark:bg-teal-500/20 dark:text-teal-100'
              : 'border-teal-100 bg-white text-slate-700 hover:border-teal-300 hover:bg-teal-50 dark:border-teal-800/50 dark:bg-transparent dark:text-slate-200 dark:hover:bg-teal-500/10'
          }`}
        >
          {vote.isPending ? 'Saving...' : voteLabels[status]}
        </button>
      ))}
    </div>
  );
}

export default function PlanThisMessageCard({ planId }: { planId: string }) {
  const [open, setOpen] = useState(false);
  const planQuery = useQuery({
    queryKey: planThisKeys.detail(planId),
    queryFn: () => fetchPlanThisPlan(planId),
    staleTime: 15_000,
  });
  const plan = planQuery.data;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-1 w-full max-w-[26rem] rounded-lg border border-teal-200 bg-teal-50/50 p-3 text-left text-slate-900 shadow-sm transition hover:border-teal-400 hover:bg-teal-100/60 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-teal-800/70 dark:bg-[#092c2a] dark:text-white dark:hover:bg-teal-950/60"
      >
        {planQuery.isLoading ? (
          <span className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading plan...</span>
        ) : !plan ? (
          <span className="text-sm text-slate-500">Plan is unavailable.</span>
        ) : (
          <span className="block">
            <span className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-teal-700 dark:text-teal-200">
                <ClipboardList className="h-4 w-4" /> Plan This
              </span>
              <span className="rounded-full border border-teal-200 bg-teal-100/70 px-2 py-0.5 text-[11px] font-semibold text-teal-800 dark:border-teal-700/60 dark:bg-teal-500/20 dark:text-teal-100">{planStatus(plan)}</span>
            </span>
            <span className="mt-2 block text-base font-semibold">{plan.title}</span>
            <span className="mt-1 line-clamp-2 block text-sm text-slate-600 dark:text-slate-300">{plan.description}</span>
            <span className="mt-3 grid gap-1 text-xs text-slate-500 dark:text-slate-400">
              <span>
                {sourceTypeLabel(plan.source.type)}
                {plan.source.available ? (plan.source.previewLabel ? `: ${plan.source.previewLabel}` : '') : ' (original content is no longer available)'}
              </span>
              <span className="inline-flex items-center gap-1 text-teal-700/80 dark:text-teal-300/80"><CalendarClock className="h-3.5 w-3.5" /> {localDateTime(plan.suggestedAt, true)}</span>
              {plan.suggestedLocation && <span className="inline-flex items-center gap-1 text-teal-700/80 dark:text-teal-300/80"><MapPin className="h-3.5 w-3.5" /> {plan.suggestedLocation}</span>}
              <span className="inline-flex items-center gap-1 text-teal-700/80 dark:text-teal-300/80"><Users className="h-3.5 w-3.5" /> {voteSummary(plan)}</span>
            </span>
            <span className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white dark:bg-teal-500 dark:text-slate-950">Open plan</span>
              {plan.permissions.canEdit && plan.state !== 'finalized' && <span className="rounded-md border border-teal-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-teal-700 dark:border-teal-700/60 dark:bg-transparent dark:text-teal-200">Edit proposal</span>}
            </span>
          </span>
        )}
      </button>
      {plan?.source.available && (
        <div className="mb-1 w-full max-w-[26rem] rounded-lg border border-teal-100 bg-teal-50/40 p-2 transition hover:bg-teal-50/70 dark:border-teal-800/50 dark:bg-teal-950/30 dark:hover:bg-teal-950/50">
          <PlanSourcePreview source={plan.source} />
        </div>
      )}
      {plan && <PlanVoteButtons plan={plan} compact />}
      {open && <PlanThisDetailDialog planId={planId} onClose={() => setOpen(false)} />}
    </>
  );
}

function PlanThisDetailDialog({ planId, onClose }: { planId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: plan, isLoading, isError } = useQuery({
    queryKey: planThisKeys.detail(planId),
    queryFn: () => fetchPlanThisPlan(planId),
  });
  const [mode, setMode] = useState<'details' | 'edit' | 'review'>('details');
  const [form, setForm] = useState({
    title: '',
    description: '',
    suggestedAt: '',
    suggestedLocation: '',
    budgetNotes: '',
    checklistText: '',
    participantUserIds: new Set<string>(),
  });
  const [createEvent, setCreateEvent] = useState(true);
  const [reminderOffsetMinutes, setReminderOffsetMinutes] = useState<number | ''>('');
  const [assignments, setAssignments] = useState<DraftAssignment[]>([]);
  const [finalizeNotice, setFinalizeNotice] = useState('');
  const [finalizeError, setFinalizeError] = useState('');

  useEffect(() => {
    if (!plan) return;
    setForm({
      title: plan.title,
      description: plan.description,
      suggestedAt: toDateTimeLocal(plan.suggestedAt),
      suggestedLocation: plan.suggestedLocation,
      budgetNotes: plan.budgetNotes,
      checklistText: plan.checklist.join('\n'),
      participantUserIds: new Set(plan.participants.map((participant) => participant.userId)),
    });
  }, [plan]);

  const saveEdit = useMutation({
    mutationFn: () => updatePlanThis(planId, {
      title: form.title,
      description: form.description,
      suggestedAt: fromDateTimeLocal(form.suggestedAt),
      suggestedLocation: form.suggestedLocation || null,
      budgetNotes: form.budgetNotes || null,
      checklist: form.checklistText.split('\n').map((item) => item.trim()).filter(Boolean),
      participantUserIds: Array.from(form.participantUserIds),
    }),
    onSuccess: (next) => {
      queryClient.setQueryData(planThisKeys.detail(next.id), next);
      queryClient.invalidateQueries({ queryKey: ['chat-actions', 'mine'] });
      setMode('details');
    },
  });
  const cancel = useMutation({
    mutationFn: () => cancelPlanThis(planId),
    onSuccess: (next) => {
      queryClient.setQueryData(planThisKeys.detail(next.id), next);
      queryClient.invalidateQueries({ queryKey: ['chat-actions', 'mine'] });
      setMode('details');
    },
  });
  const confirmCancel = () => {
    if (cancel.isPending) return;
    if (
      plan?.state === 'finalized' &&
      !window.confirm('Cancel this finalized plan? Its Event, future reminders, and pending task assignments will be cancelled. This cannot be undone.')
    ) {
      return;
    }
    cancel.mutate();
  };
  const finalize = useMutation({
    mutationFn: () => finalizePlanThis(planId, {
      createEvent,
      finalDateTime: createEvent ? fromDateTimeLocal(form.suggestedAt) || undefined : undefined,
      reminderEnabled: createEvent && Boolean(reminderOffsetMinutes),
      reminderOffsetMinutes: createEvent && reminderOffsetMinutes ? reminderOffsetMinutes : undefined,
      assignments: assignments
        .map((assignment) => ({
          title: assignment.title.trim(),
          details: assignment.details.trim() || undefined,
          assigneeUserId: assignment.assigneeUserId || undefined,
          dueAt: assignment.dueAt ? new Date(assignment.dueAt).toISOString() : undefined,
        }))
        .filter((assignment) => assignment.title),
    }),
    onSuccess: (next) => {
      queryClient.setQueryData(planThisKeys.detail(next.id), next);
      queryClient.invalidateQueries({ queryKey: ['chat-actions', 'mine'] });
      const selectedReminder = reminderLabel(next.eventReminderOffsetMinutes);
      setFinalizeError('');
      setFinalizeNotice(next.eventMessageId ? `Event created.${selectedReminder ? ` Reminder scheduled for ${selectedReminder}.` : ''}` : 'Plan finalized without creating a Blabber Event or reminder.');
      setMode('details');
    },
    onError: (error) => setFinalizeError(apiErrorMessage(error, 'Unable to finalize this plan.')),
  });
  const respondAssignment = useMutation({
    mutationFn: ({ assignmentId, status }: { assignmentId: string; status: 'accepted' | 'declined' }) => respondPlanThisAssignment(planId, assignmentId, status),
    onSuccess: (next) => {
      queryClient.setQueryData(planThisKeys.detail(next.id), next);
      queryClient.invalidateQueries({ queryKey: ['chat-actions', 'mine'] });
    },
  });

  const currentVotes = useMemo(() => {
    const version = plan?.planVersion ?? 0;
    return (plan?.votes || []).filter((vote) => vote.current !== false && (vote.planVersion ?? 0) === version);
  }, [plan]);
  const votesByUser = useMemo(() => new Map(currentVotes.map((vote) => [vote.userId, vote.status])), [currentVotes]);
  const participantsByUserId = useMemo(() => new Map((plan?.participants || []).map((participant) => [participant.userId, participant])), [plan?.participants]);
  const eventDate = useMemo(() => {
    if (!form.suggestedAt) return null;
    const date = new Date(form.suggestedAt);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [form.suggestedAt]);
  const finalizeBlockMessage = useMemo(() => {
    if (!createEvent) return '';
    if (!form.suggestedAt) return 'A date and time are required to create an Event.';
    if (!eventDate || eventDate.getTime() <= Date.now()) return 'Choose a future date and time for this Event.';
    if (reminderOffsetMinutes && eventDate.getTime() - Date.now() < reminderOffsetMinutes * 60_000) {
      return reminderTooSoonMessage(reminderOffsetMinutes);
    }
    return '';
  }, [createEvent, eventDate, form.suggestedAt, reminderOffsetMinutes]);
  const canChooseReminder = createEvent && eventDate ? eventDate.getTime() > Date.now() : false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6" role="dialog" aria-modal="true" aria-label="Plan details">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-teal-700 dark:text-teal-300">Plan This</p>
            <h2 className="text-lg font-semibold">{plan?.title || 'Plan'}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close plan details">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {isLoading ? (
            <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading plan...</p>
          ) : isError || !plan ? (
            <p className="text-sm text-slate-500">Plan is unavailable.</p>
          ) : mode === 'edit' ? (
            <div className="grid gap-3">
              <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" aria-label="Plan title" />
              <textarea value={form.description} rows={3} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" aria-label="Plan description" />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-500">Suggested date/time<input type="datetime-local" value={form.suggestedAt} onChange={(event) => setForm((current) => ({ ...current, suggestedAt: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
                <label className="text-xs font-semibold text-slate-500">Suggested location<input value={form.suggestedLocation} onChange={(event) => setForm((current) => ({ ...current, suggestedLocation: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
              </div>
              <textarea value={form.budgetNotes} rows={2} onChange={(event) => setForm((current) => ({ ...current, budgetNotes: event.target.value }))} className="rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Budget / notes" />
              <textarea value={form.checklistText} rows={4} onChange={(event) => setForm((current) => ({ ...current, checklistText: event.target.value }))} className="rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Checklist / task ideas" />
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-500">Decision participants</p>
                <div className="flex flex-wrap gap-2">
                  {plan.participants.map((participant) => (
                    <label key={participant.userId} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                      <input
                        type="checkbox"
                        checked={form.participantUserIds.has(participant.userId)}
                        onChange={(event) => {
                          const next = new Set(form.participantUserIds);
                          if (event.target.checked) next.add(participant.userId);
                          else next.delete(participant.userId);
                          setForm((current) => ({ ...current, participantUserIds: next }));
                        }}
                      />
                      {participant.displayName || 'Member'}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : mode === 'review' ? (
            <div className="space-y-4">
              <section className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                <h3 className="font-semibold">Review outcome</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{voteSummary(plan)}</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Final time: {localDateTime(plan.suggestedAt, true)}</p>
                {plan.suggestedLocation && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Final location: {plan.suggestedLocation}</p>}
              </section>
              <section className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={createEvent}
                    onChange={(event) => {
                      setCreateEvent(event.target.checked);
                      setFinalizeError('');
                      if (!event.target.checked) setReminderOffsetMinutes('');
                    }}
                  />
                  Create Blabber Event after finalization
                </label>
                <label className="mt-3 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Event date/time {createEvent && <span className="text-rose-600">*</span>}
                  <input
                    type="datetime-local"
                    value={form.suggestedAt}
                    onChange={(event) => {
                      setFinalizeError('');
                      setForm((current) => ({ ...current, suggestedAt: event.target.value }));
                    }}
                    disabled={!createEvent}
                    className={`mt-1 w-full rounded-md border px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400 dark:bg-slate-950 dark:disabled:bg-slate-800 ${finalizeBlockMessage ? 'border-rose-300 dark:border-rose-800' : 'border-slate-200 dark:border-slate-700'}`}
                  />
                </label>
                <label className="mt-3 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Event reminder
                  <select
                    value={reminderOffsetMinutes}
                    disabled={!canChooseReminder}
                    onChange={(event) => {
                      setFinalizeError('');
                      setReminderOffsetMinutes(event.target.value ? Number(event.target.value) : '');
                    }}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:disabled:bg-slate-800"
                  >
                    {reminderOptions.map((option) => <option key={String(option.value)} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                {!createEvent && <p className="mt-2 text-xs text-slate-500">This plan will finalize without creating a Blabber Event or reminder.</p>}
                {createEvent && finalizeBlockMessage && <p className="mt-2 text-sm font-semibold text-rose-600">{finalizeBlockMessage}</p>}
                {finalizeError && <p className="mt-2 text-sm font-semibold text-rose-600">{finalizeError}</p>}
              </section>
              <section className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Tasks</h3>
                  <button type="button" onClick={() => setAssignments((current) => [...current, createDraftAssignment()])} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">Add task</button>
                </div>
                {assignments.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No tasks added.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {assignments.map((assignment) => (
                      <div key={assignment.id} className="grid gap-2 rounded-md bg-slate-50 p-3 dark:bg-slate-950">
                        <div className="grid gap-2 sm:grid-cols-[1fr_12rem_auto]">
                          <input
                            value={assignment.title}
                            onChange={(event) => setAssignments((current) => current.map((item) => item.id === assignment.id ? { ...item, title: event.target.value } : item))}
                            className="rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                            placeholder="Task title"
                            aria-label="Task title"
                          />
                          <select
                            value={assignment.assigneeUserId}
                            onChange={(event) => setAssignments((current) => current.map((item) => item.id === assignment.id ? { ...item, assigneeUserId: event.target.value } : item))}
                            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                            aria-label="Task assignee"
                          >
                            <option value="">Unassigned</option>
                            {plan.participants.map((participant) => <option key={participant.userId} value={participant.userId}>{participant.displayName || 'Member'}</option>)}
                          </select>
                          <button type="button" onClick={() => setAssignments((current) => current.filter((item) => item.id !== assignment.id))} className="rounded-md border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">Remove</button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
                          <textarea
                            value={assignment.details}
                            onChange={(event) => setAssignments((current) => current.map((item) => item.id === assignment.id ? { ...item, details: event.target.value } : item))}
                            rows={2}
                            className="rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                            placeholder="Details"
                            aria-label="Task details"
                          />
                          <label className="text-xs font-semibold text-slate-500">
                            Due
                            <input
                              type="datetime-local"
                              value={assignment.dueAt}
                              onChange={(event) => setAssignments((current) => current.map((item) => item.id === assignment.id ? { ...item, dueAt: event.target.value } : item))}
                              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="space-y-4">
              {finalizeNotice && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">{finalizeNotice}</p>}
              <section className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">{planStatus(plan)}</span>
                  <span className="text-xs text-slate-500">Updated {localDateTime(plan.updatedAt)}</span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{plan.description}</p>
              </section>
              <section className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Source reference</h3>
                <div className="mt-2">
                  <PlanSourcePreview source={plan.source} />
                </div>
              </section>
              <section className="grid gap-3 sm:grid-cols-2">
                <Info label="Destination Conversation" value="This Conversation" />
                <Info label="Proposed timing" value={localDateTime(plan.suggestedAt, true)} />
                <Info label="Proposed location" value={plan.suggestedLocation || 'Location not set'} />
                <Info label="Budget / notes" value={plan.budgetNotes || 'No notes'} />
                <Info label="Voting status" value={voteSummary(plan)} />
              </section>
              <section className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                <h3 className="text-sm font-semibold">Decision participants</h3>
                <div className="mt-2 grid gap-2">
                  {plan.participants.map((participant) => (
                    <div key={participant.userId} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950">
                      <span>{participant.displayName || 'Member'}</span>
                      <span className="font-semibold text-slate-500">{votesByUser.get(participant.userId) ? voteLabels[votesByUser.get(participant.userId)!] : 'Needs vote'}</span>
                    </div>
                  ))}
                </div>
              </section>
              {plan.checklist.length > 0 && <Info label="Checklist / task ideas" value={plan.checklist.join('\n')} />}
              {plan.state === 'finalized' && (
                plan.eventMessageId ? (
                  <Info
                    label="Event created"
                    value={[localDateTime(plan.suggestedAt, true), plan.eventReminderOffsetMinutes ? `Reminder: ${reminderLabel(plan.eventReminderOffsetMinutes)}` : ''].filter(Boolean).join('\n')}
                  />
                ) : (
                  <section className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">No Event scheduled</h3>
                  </section>
                )
              )}
              {plan.assignments.length > 0 && (
                <section className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                  <h3 className="text-sm font-semibold">Assignment requests</h3>
                  <div className="mt-2 space-y-2">
                    {plan.assignments.map((assignment) => (
                      <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950">
                        <span>
                          <span className="block font-semibold">{assignment.title}</span>
                          {assignment.details && <span className="mt-0.5 block text-xs text-slate-500">{assignment.details}</span>}
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {assignment.assigneeUserId ? `Assigned to ${participantsByUserId.get(assignment.assigneeUserId)?.displayName || 'Member'}` : 'Unassigned'}
                            {assignment.dueAt ? ` · Due ${localDateTime(assignment.dueAt)}` : ''}
                          </span>
                        </span>
                        <span className="capitalize text-slate-500">{(assignment.taskStatus || assignment.status).replace(/_/g, ' ')}</span>
                        {assignment.taskStatus === 'pending_response' && assignment.assigneeUserId === user?._id && (
                          <span className="flex gap-2">
                            <button type="button" onClick={() => respondAssignment.mutate({ assignmentId: assignment.id, status: 'accepted' })} className="rounded-md border border-emerald-200 px-2 py-1 text-xs font-semibold text-emerald-700">Accept</button>
                            <button type="button" onClick={() => respondAssignment.mutate({ assignmentId: assignment.id, status: 'declined' })} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">Decline</button>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <PlanVoteButtons plan={plan} />
            </div>
          )}
        </div>
        {plan && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
            <button type="button" onClick={() => void queryClient.invalidateQueries({ queryKey: planThisKeys.detail(planId) })} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"><RefreshCw className="h-4 w-4" /> Refresh</button>
            <div className="flex flex-wrap gap-2">
              {mode !== 'details' && <button type="button" onClick={() => setMode('details')} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">Back</button>}
              {mode === 'details' && plan.permissions.canEdit && <button type="button" onClick={() => setMode('edit')} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"><Pencil className="h-4 w-4" /> Edit proposal</button>}
              {mode === 'edit' && <button type="button" disabled={saveEdit.isPending} onClick={() => saveEdit.mutate()} className="rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Save changes</button>}
              {mode === 'details' && plan.permissions.canFinalize && <button type="button" onClick={() => setMode('review')} className="rounded-md border border-teal-200 px-3 py-2 text-sm font-semibold text-teal-700 dark:border-teal-800 dark:text-teal-200">Review outcome</button>}
              {mode === 'review' && <button type="button" disabled={finalize.isPending || Boolean(finalizeBlockMessage)} onClick={() => finalize.mutate()} className="inline-flex items-center gap-2 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" /> Finalize plan</button>}
              {mode === 'details' && plan.permissions.canCancel && <button type="button" disabled={cancel.isPending} onClick={confirmCancel} className="rounded-md border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 dark:border-rose-900 dark:text-rose-300">Cancel plan</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <section className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{value}</p>
    </section>
  );
}
