import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarClock, Loader2, Sparkles, Users, X } from 'lucide-react';
import {
  checkPlanThisEligibility,
  createPlanThisProposal,
  fetchPlanThisDestinations,
  generatePlanThisDraft,
  type PlanThisDestination,
  type PlanThisSourceType,
} from '@/api/client';
import { useToast } from '@/components/ToastContainer';

interface PlanThisDialogProps {
  source: { type: PlanThisSourceType; id: string };
  open: boolean;
  onClose: () => void;
}

function generateRequestId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `plan-this-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const DEFAULT_CHECKLIST = 'Confirm who is joining\nPick a time';

export default function PlanThisDialog({ source, open, onClose }: PlanThisDialogProps) {
  const toast = useToast();
  const [destination, setDestination] = useState<PlanThisDestination | null>(null);
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [suggestedAt, setSuggestedAt] = useState('');
  const [suggestedLocation, setSuggestedLocation] = useState('');
  const [budgetNotes, setBudgetNotes] = useState('');
  const [checklistText, setChecklistText] = useState(DEFAULT_CHECKLIST);
  const [sendError, setSendError] = useState('');
  const [clientRequestId, setClientRequestId] = useState(generateRequestId);

  const eligibility = useQuery({
    queryKey: ['plan-this-eligibility', source.type, source.id],
    queryFn: () => checkPlanThisEligibility(source),
    enabled: open,
  });
  const destinations = useQuery({
    queryKey: ['plan-this-destinations'],
    queryFn: fetchPlanThisDestinations,
    enabled: open,
  });
  const aiDraft = useMutation({
    mutationFn: () => generatePlanThisDraft({ source, note: note || undefined }),
    onSuccess: (draft) => {
      setTitle(draft.title);
      setDescription(draft.description);
      setSuggestedLocation(draft.suggestedLocation);
      setBudgetNotes(draft.budgetNotes);
      setChecklistText(draft.checklist.join('\n'));
    },
  });
  const resetForm = () => {
    setDestination(null);
    setSelectedParticipants(new Set());
    setNote('');
    setTitle('');
    setDescription('');
    setSuggestedAt('');
    setSuggestedLocation('');
    setBudgetNotes('');
    setChecklistText(DEFAULT_CHECKLIST);
    setSendError('');
    setClientRequestId(generateRequestId());
  };
  const createProposal = useMutation({
    mutationFn: () => createPlanThisProposal({
      source,
      chatId: destination!.id,
      participantUserIds: Array.from(selectedParticipants),
      title,
      description,
      suggestedAt: suggestedAt ? new Date(suggestedAt).toISOString() : undefined,
      suggestedLocation: suggestedLocation || undefined,
      budgetNotes: budgetNotes || undefined,
      checklist: checklistText.split('\n').map((item) => item.trim()).filter(Boolean),
      clientRequestId,
    }),
    onSuccess: () => {
      const destinationName = destination?.name || 'this Conversation';
      resetForm();
      onClose();
      toast.success(`Proposal sent to ${destinationName}.`);
    },
    onError: () => {
      setSendError('We could not send this proposal. Your details are still here—please try again.');
    },
  });

  const canSend = Boolean(destination && selectedParticipants.size > 0 && title.trim() && description.trim());
  const preview = eligibility.data?.source;

  const participants = useMemo(() => destination?.participants || [], [destination]);

  if (!open) return null;

  const chooseDestination = (item: PlanThisDestination) => {
    setDestination(item);
    setSelectedParticipants(new Set(item.participants.map((participant) => participant.userId)));
  };

  const handleSend = () => {
    if (createProposal.isPending || !canSend) return;
    setSendError('');
    createProposal.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Plan this</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Review the proposal before anything is sent.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close Plan This">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {eligibility.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Checking source...</div>
          ) : !eligibility.data?.eligible ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              This content is not available for Plan This.
            </div>
          ) : (
            <div className="space-y-5">
              <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source preview</p>
                <p className="mt-2 text-sm font-medium text-slate-900 dark:text-white">{preview?.previewLabel}</p>
                {preview?.creatorLabel && <p className="mt-1 text-xs text-slate-500">By {preview.creatorLabel}</p>}
              </section>

              <section>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                  <Users className="h-4 w-4" /> Destination Conversation
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(destinations.data || []).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => chooseDestination(item)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${destination?.id === item.id ? 'border-teal-500 bg-teal-50 text-teal-800 dark:bg-teal-950/30 dark:text-teal-100' : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800'}`}
                    >
                      <span className="block font-semibold">{item.name}</span>
                      {item.type === 'group' && <span className="text-xs text-slate-500">{item.memberCount} members</span>}
                    </button>
                  ))}
                </div>
              </section>

              {destination && (
                <section>
                  <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Decision participants</p>
                  <div className="flex flex-wrap gap-2">
                    {participants.map((participant) => (
                      <label key={participant.userId} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                        <input
                          type="checkbox"
                          checked={selectedParticipants.has(participant.userId)}
                          onChange={(event) => {
                            const next = new Set(selectedParticipants);
                            if (event.target.checked) next.add(participant.userId);
                            else next.delete(participant.userId);
                            setSelectedParticipants(next);
                          }}
                        />
                        {participant.displayName}
                      </label>
                    ))}
                  </div>
                </section>
              )}

              <section className="grid gap-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note for draft generation" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950" />
                  <button type="button" onClick={() => aiDraft.mutate()} disabled={aiDraft.isPending} className="inline-flex items-center justify-center gap-2 rounded-lg border border-teal-200 px-3 py-2 text-sm font-semibold text-teal-700 disabled:opacity-60 dark:border-teal-800 dark:text-teal-200">
                    {aiDraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Generate draft
                  </button>
                </div>
                {aiDraft.isError && <p className="text-sm text-amber-600">We could not generate a draft. You can still create this plan manually.</p>}
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Plan title" className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950" />
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Short description" rows={3} className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-slate-500">
                    Suggested date/time
                    <input type="datetime-local" value={suggestedAt} onChange={(event) => setSuggestedAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950" />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">
                    Suggested location
                    <input value={suggestedLocation} onChange={(event) => setSuggestedLocation(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950" />
                  </label>
                </div>
                <textarea value={budgetNotes} onChange={(event) => setBudgetNotes(event.target.value)} placeholder="Budget/notes" rows={2} className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950" />
                <textarea value={checklistText} onChange={(event) => setChecklistText(event.target.value)} placeholder="Checklist/action ideas, one per line" rows={3} className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950" />
              </section>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0 text-sm">
            {sendError ? (
              <span className="font-semibold text-rose-600 dark:text-rose-400">{sendError}</span>
            ) : (
              <span className="text-slate-500">No event, task, reminder, or vote is created until you send.</span>
            )}
          </div>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend || createProposal.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:bg-slate-300"
          >
            {createProposal.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            Send proposal
          </button>
        </div>
      </div>
    </div>
  );
}
