import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Menu, Phone, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Users, Video } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import Avatar from '@/components/Avatar';
import NewCallModal, { type CallMode } from '@/components/NewCallModal';
import { fetchCallHistory, type CallHistoryItem } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';

type Filter = 'all' | 'missed' | 'audio' | 'video';

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All Calls',
  missed: 'Missed',
  audio: 'Audio',
  video: 'Video',
};

function duration(seconds?: number) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function outcomeLabel(call: CallHistoryItem) {
  if (call.outcome === 'ended') return 'Answered';
  return call.outcome.charAt(0).toUpperCase() + call.outcome.slice(1);
}

export default function CallsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [callPicker, setCallPicker] = useState<CallMode | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['calls'],
    queryFn: fetchCallHistory,
  });

  const allCalls = useMemo(() => data?.calls || [], [data?.calls]);

  // Unseen missed-call tracking. The backend keeps no per-user "seen" flag on
  // call history yet, so the last-seen marker is stored per user in this
  // browser; cross-device clearing would need backend persistence.
  const missedSeenKey = user?._id ? `blabber:calls:missed-seen:${user._id}` : null;
  const [missedSeenAt, setMissedSeenAt] = useState(0);
  useEffect(() => {
    if (!missedSeenKey) return;
    const stored = localStorage.getItem(missedSeenKey);
    const parsed = stored ? Date.parse(stored) : NaN;
    setMissedSeenAt(Number.isNaN(parsed) ? 0 : parsed);
  }, [missedSeenKey]);

  // Badge counts only incoming missed/declined calls newer than the marker.
  const unseenMissedCount = useMemo(
    () =>
      allCalls.filter(
        (call) =>
          (call.outcome === 'missed' || call.outcome === 'declined') &&
          call.callerId !== user?._id &&
          new Date(call.startedAt).getTime() > missedSeenAt
      ).length,
    [allCalls, missedSeenAt, user?._id]
  );

  const markMissedSeen = () => {
    if (!missedSeenKey) return;
    const now = new Date().toISOString();
    localStorage.setItem(missedSeenKey, now);
    setMissedSeenAt(Date.parse(now));
  };

  const calls = useMemo(() => {
    return allCalls.filter((call) => {
      if (filter === 'missed') return call.outcome === 'missed' || call.outcome === 'declined';
      if (filter === 'audio') return call.callType === 'audio';
      if (filter === 'video') return call.callType === 'video';
      return true;
    });
  }, [allCalls, filter]);

  const goToConversations = () => navigate('/chats');

  return (
    <div className="flex h-dvh overflow-hidden bg-[color:var(--bl-bg)] text-[color:var(--bl-text)]">
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${sidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />
      <div className={`fixed inset-y-0 left-0 z-50 transition-transform md:static md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((value) => !value)}
          onNewConversation={goToConversations}
          onChatFilterChange={goToConversations}
          onNavigateMobile={() => setSidebarOpen(false)}
        />
      </div>

      <main className="min-w-0 flex-1 overflow-y-auto bg-[color:var(--bl-bg)]">
        <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg border border-[color:var(--bl-border)] p-2 text-[color:var(--bl-text-muted)] transition hover:bg-[color:var(--bl-hover)] md:hidden"
            aria-label="Open navigation"
          >
            <Menu size={16} />
          </button>

          {/* ── Header ───────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-[color:var(--bl-text)]">Calls</h1>
              <p className="mt-2 text-[15px] leading-6 text-[color:var(--bl-text-secondary)]">Connect face-to-face or with voice. Anytime, anywhere.</p>
              <p className="mt-1 text-xs text-[color:var(--bl-text-muted)]">Notes and transcripts are not generated automatically.</p>
            </div>
            <button
              onClick={() => setCallPicker('video')}
              className="bl-focus-ring inline-flex flex-shrink-0 items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 hover:shadow dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
            >
              <Phone size={16} /> New Call
            </button>
          </div>

          {/* ── Segmented filter tabs (real: all/missed/audio/video) ───────── */}
          <div className="inline-flex rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-1">
            {(['all', 'missed', 'audio', 'video'] as Filter[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setFilter(item);
                  if (item === 'missed') markMissedSeen();
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
                  filter === item
                    ? 'bg-teal-600 text-white shadow-sm dark:bg-teal-500 dark:text-slate-950'
                    : 'text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'
                }`}
              >
                {FILTER_LABEL[item]}
                {item === 'missed' && unseenMissedCount > 0 && (
                  <span className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${filter === item ? 'bg-white/25 text-white' : 'bg-rose-500 text-white'}`}>
                    {unseenMissedCount > 99 ? '99+' : unseenMissedCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Start a new call — real fallback to Conversations ──────────── */}
          <div className="flex flex-col gap-4 rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
                <Video size={20} />
              </span>
              <div>
                <p className="text-sm font-semibold text-[color:var(--bl-text)]">Start a new call</p>
                <p className="text-xs text-[color:var(--bl-text-muted)]">Connect instantly with anyone.</p>
              </div>
            </div>
            <div className="flex flex-shrink-0 gap-2">
              <button
                onClick={() => setCallPicker('video')}
                className="bl-focus-ring inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
              >
                <Video size={15} /> Video Call
              </button>
              <button
                onClick={() => setCallPicker('audio')}
                className="bl-focus-ring inline-flex items-center gap-2 rounded-lg border border-teal-500/40 px-3.5 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-500/10"
              >
                <Phone size={15} /> Voice Call
              </button>
            </div>
          </div>

          {/* ── Recent Calls ─────────────────────────────────────────────── */}
          <div>
            <h2 className="mb-3 text-base font-semibold text-[color:var(--bl-text)]">Recent Calls</h2>

            {isLoading ? (
              <div className="rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] py-10 text-center text-sm text-[color:var(--bl-text-muted)]">
                Loading calls...
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 py-10 text-center text-sm text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                Unable to load call history.
              </div>
            ) : calls.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-8 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
                  <Phone size={22} />
                </span>
                <p className="mt-3 font-semibold text-[color:var(--bl-text)]">No calls yet</p>
                <p className="mt-1 text-sm text-[color:var(--bl-text-muted)]">Calls will appear here after audio or video conversations.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {calls.map((call) => {
                  const outgoing = call.callerId === user?._id;
                  const peers = call.participantProfiles.filter((profile) => profile._id !== user?._id);
                  const primary = call.chatType === 'group' ? call.chatTitle || 'Group call' : peers[0]?.name || 'Call';
                  const missed = call.outcome === 'missed' || call.outcome === 'declined';
                  return (
                    <div
                      key={call.id}
                      className="group flex items-center gap-3 rounded-2xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-4 shadow-sm transition hover:[box-shadow:var(--bl-glow-sm)]"
                    >
                      {call.chatType === 'group' && !peers[0]?.avatarUrl ? (
                        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-teal-600 text-white">
                          <Users size={18} />
                        </div>
                      ) : (
                        <Avatar src={peers[0]?.avatarUrl} alt={primary} size="md" />
                      )}
                      <button
                        type="button"
                        onClick={() => navigate(`/chats/${call.chatId}`)}
                        className="bl-focus-ring min-w-0 flex-1 rounded-lg text-left"
                      >
                        <div className="flex items-center gap-2">
                          <p className={`truncate text-sm font-semibold ${missed ? 'text-rose-600 dark:text-rose-300' : 'text-[color:var(--bl-text)]'}`}>
                            {primary}
                          </p>
                          {call.callType === 'video' ? (
                            <Video size={13} className="flex-shrink-0 text-teal-600 dark:text-teal-300" />
                          ) : (
                            <Phone size={13} className="flex-shrink-0 text-teal-600 dark:text-teal-300" />
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[color:var(--bl-text-muted)]">
                          {outgoing ? (
                            <PhoneOutgoing size={12} className="text-teal-600 dark:text-teal-300" />
                          ) : missed ? (
                            <PhoneMissed size={12} className="text-rose-500" />
                          ) : (
                            <PhoneIncoming size={12} className="text-teal-600 dark:text-teal-300" />
                          )}
                          <span>{outgoing ? 'Outgoing' : 'Incoming'} {call.callType} call</span>
                          <span aria-hidden="true">&middot;</span>
                          <span>{outcomeLabel(call)}</span>
                          {duration(call.durationSeconds) && (
                            <>
                              <span aria-hidden="true">&middot;</span>
                              <span>{duration(call.durationSeconds)}</span>
                            </>
                          )}
                        </div>
                      </button>
                      <div className="flex flex-shrink-0 flex-col items-end gap-2">
                        <time className="text-xs text-[color:var(--bl-text-muted)]">
                          {new Date(call.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </time>
                        <button
                          type="button"
                          onClick={() => navigate(`/chats/${call.chatId}`)}
                          aria-label="Open conversation"
                          title="Open conversation"
                          className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--bl-text-muted)] transition hover:bg-teal-50 hover:text-teal-700 dark:hover:bg-teal-500/15 dark:hover:text-teal-300"
                        >
                          {call.callType === 'video' ? <Video size={15} /> : <PhoneCall size={15} />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      <NewCallModal
        isOpen={callPicker !== null}
        initialMode={callPicker ?? 'video'}
        onClose={() => setCallPicker(null)}
      />
    </div>
  );
}
