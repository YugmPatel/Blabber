import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  ExternalLink,
  FileText,
  HelpCircle,
  Info,
  Link2,
  Mic,
  MicOff,
  Plus,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import BrandGlow from '@/components/brand/BrandGlow';
import VeyraMark from '@/components/brand/VeyraMark';
import AmbientOrb, { type AmbientOrbState } from '@/components/brand/AmbientOrb';
import { useAuth } from '@/contexts/AuthContext';
import { useVeyraSession } from '@/contexts/VeyraSessionContext';
import { navigateToSource } from '@/lib/source-jump';
import { askVeyra, fetchVeyraSettings, updateVeyraSettings, type VeyraResultCard, type VeyraSettings } from '@/api/client';

type SpeechRecognitionResultLike = { 0?: { transcript?: string }; isFinal?: boolean };
type SpeechRecognitionEventLike = { results: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionErrorEventLike = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  }
}

// Every state the page can be in. `greeting_blocked` and `scope_required` have no
// direct AmbientOrb equivalent — they're mapped down to the orb's existing visual
// states in `orbStateFor`, below, without touching the orb component itself.
type VeyraState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'permission'
  | 'unsupported'
  | 'no_speech'
  | 'scope_required'
  | 'disabled'
  | 'error';

function resultActionLabel(card: VeyraResultCard) {
  return card.deepLink?.kind === 'action' ? 'Open' : 'Jump to message';
}

function resultMeta(card: VeyraResultCard) {
  return [card.senderName, card.createdAt ? new Date(card.createdAt).toLocaleDateString() : undefined].filter(Boolean).join(' · ');
}

const GREETED_SESSION_KEY = 'veyra-greeted-session';

function makeTurnId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function orbStateFor(state: VeyraState): AmbientOrbState {
  switch (state) {
    case 'listening':
    case 'thinking':
    case 'speaking':
      return state;
    case 'permission':
      return 'permission';
    case 'unsupported':
      return 'unsupported';
    case 'scope_required':
    case 'disabled':
      return 'privacy_required';
    default:
      return state === 'no_speech' || state === 'error' ? 'error' : 'idle';
  }
}

function firstName(user: { name?: string; username?: string } | null) {
  const source = user?.name || user?.username || '';
  return source.trim().split(/\s+/)[0] || 'there';
}

function apiErrorMessage(error: unknown, fallback: string): { message: string; code?: string } {
  if (axios.isAxiosError<{ message?: string; code?: string }>(error)) {
    return { message: error.response?.data?.message || fallback, code: error.response?.data?.code };
  }
  return { message: fallback };
}

function suggestedPrompts(scopeType?: VeyraSettings['scopes'][number]['type']): string[] {
  if (scopeType === 'my_actions') return ["What's my action status?"];
  if (scopeType === 'chat') return ['Recap our decisions', "What's my action status?", 'What was the last file shared?'];
  if (scopeType === 'community') return ['Recap our decisions'];
  return ['What can you help with?', 'Where can I find my chats?'];
}

function stateCaption(state: VeyraState, greetingTitle: string, greetingSubtitle: string): { title: string; subtitle?: string } {
  switch (state) {
    case 'disabled':
      return { title: 'Turn on Veyra in AI Privacy to begin.' };
    case 'listening':
      return { title: 'Listening…' };
    case 'thinking':
      return { title: 'Thinking…' };
    case 'speaking':
      return { title: 'Speaking…' };
    case 'permission':
      return { title: 'Microphone access was not allowed.', subtitle: 'You can try again or type your question.' };
    case 'unsupported':
      return { title: 'Voice input is not supported in this browser.', subtitle: 'You can still type to Veyra.' };
    case 'no_speech':
      return { title: 'I didn’t catch that.', subtitle: 'Try again when you’re ready.' };
    case 'scope_required':
      return { title: 'To answer that, Veyra needs access to an approved space.' };
    case 'error':
      return { title: 'Veyra is temporarily unavailable.', subtitle: 'Please try again.' };
    default:
      return { title: greetingTitle, subtitle: greetingSubtitle };
  }
}

export default function VeyraPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { turns: conversation, context, appendTurn, updateTurn, setContext, clear: clearSession } = useVeyraSession();
  const [state, setState] = useState<VeyraState>('idle');
  const [prompt, setPrompt] = useState('');
  const [scopeId, setScopeId] = useState('');
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const [greetingBlocked, setGreetingBlocked] = useState(false);
  const [greetingSpoken, setGreetingSpoken] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef('');
  const userStoppedRef = useRef(false);
  const submittedRef = useRef(false);
  const greetingAttemptedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const clearDialogRef = useRef<HTMLDivElement | null>(null);
  const newConversationButtonRef = useRef<HTMLButtonElement | null>(null);

  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const speechSupported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  const settingsQuery = useQuery({ queryKey: ['veyra-settings'], queryFn: fetchVeyraSettings });
  const settings = settingsQuery.data?.settings;
  const enabled = Boolean(settings?.enabled);

  const selectedScope = useMemo(
    () => settings?.scopes.find((scope) => scope.id === scopeId) || settings?.scopes[0],
    [scopeId, settings?.scopes]
  );

  // Title and subtitle are shown separately in the hero and combined for the
  // spoken greeting. The subtitle intentionally names only Veyra's real,
  // currently-supported capabilities — no "I can do anything" framing.
  const greetingTitle = `Hi, ${firstName(user)}. I’m Veyra.`;
  const greetingSubtitle = 'I can help you find links, PDFs, plans, and answer simple questions from your approved spaces.';
  const greetingSpokenText = `${greetingTitle} ${greetingSubtitle}`;

  const voiceToggle = useMutation({
    mutationFn: (voiceRepliesEnabled: boolean) => updateVeyraSettings({ voiceRepliesEnabled }),
    onSuccess: (next) =>
      queryClient.setQueryData(['veyra-settings'], (current: { settings: VeyraSettings; globalAiEnabled: boolean } | undefined) =>
        current ? { ...current, settings: next } : current
      ),
  });

  const speak = (text: string, onDone: () => void) => {
    if (reducedMotion || !('speechSynthesis' in window) || !(settings?.voiceRepliesEnabled ?? true)) {
      onDone();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = onDone;
    utterance.onerror = onDone;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  // Scroll to the newest turn whenever one is appended — but never force
  // scroll on every render, so a user reading back through the thread isn't
  // yanked to the bottom.
  useEffect(() => {
    if (conversation.length > 0) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation.length]);

  const ask = useMutation({
    mutationFn: ({ turnId, text, scopeIdOverride }: { turnId: string; text: string; origin: 'voice' | 'typed'; scopeIdOverride?: string }) =>
      askVeyra({ prompt: text, scopeId: scopeIdOverride ?? selectedScope?.id, context }).then((result) => ({ turnId, result })),
    onMutate: () => {
      setState('thinking');
    },
    onSuccess: ({ turnId, result }) => {
      setContext(result.context);
      updateTurn(turnId, {
        status: 'done',
        answer: result.answer,
        results: result.results,
        ambiguousCandidates: result.ambiguous ? result.candidates || [] : undefined,
        suggestManageAiPrivacy: result.suggestManageAiPrivacy,
      });
      setState('speaking');
      speak(result.answer, () => setState('idle'));
    },
    onError: (error, variables) => {
      const { message, code } = apiErrorMessage(error, 'Veyra is temporarily unavailable. Please try again.');
      updateTurn(variables.turnId, { status: 'error', errorMessage: message, errorCode: code });
      setState(code === 'scope_required' ? 'scope_required' : 'error');
    },
  });

  const submitToVeyra = (text: string, origin: 'voice' | 'typed', scopeIdOverride?: string) => {
    const trimmed = text.trim();
    if (!trimmed || !enabled || ask.isPending) return;
    if (origin === 'typed') setPrompt('');
    const turnId = makeTurnId();
    appendTurn({ id: turnId, question: trimmed, origin, status: 'pending' });
    ask.mutate({ turnId, text: trimmed, origin, scopeIdOverride });
  };

  const resolveAmbiguous = (candidate: { scopeId: string; label: string }, question: string, origin: 'voice' | 'typed') => {
    setScopeId(candidate.scopeId);
    submitToVeyra(question, origin, candidate.scopeId);
  };

  const openResultCard = (card: VeyraResultCard) => {
    if (card.deepLink?.kind === 'chat_message') {
      navigateToSource(navigate, { chatId: card.deepLink.chatId, messageId: card.deepLink.messageId });
    } else if (card.deepLink?.kind === 'action') {
      navigate(`/actions?actionId=${card.deepLink.actionId}`);
    }
  };

  const requestClearConversation = () => setClearDialogOpen(true);
  const cancelClearConversation = () => setClearDialogOpen(false);
  const confirmClearConversation = () => {
    clearSession();
    setClearDialogOpen(false);
    setState('idle');
  };

  // Focus the dialog on open (returning focus to the trigger on close), and
  // let Escape cancel — matching the modal conventions used elsewhere (e.g.
  // NewChatModal) in this app.
  useEffect(() => {
    if (clearDialogOpen) {
      setTimeout(() => clearDialogRef.current?.focus(), 0);
    } else {
      newConversationButtonRef.current?.focus();
    }
  }, [clearDialogOpen]);

  useEffect(() => {
    if (!clearDialogOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelClearConversation();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [clearDialogOpen]);

  // Greeting: shown immediately and locally (no backend call). Speech is attempted
  // once per browser session, only as a consequence of the gesture that brought the
  // user to this page (sidebar click) or a direct tap on the orb — never on its own.
  useEffect(() => {
    if (!enabled || settingsQuery.isLoading || greetingAttemptedRef.current) return;
    greetingAttemptedRef.current = true;
    if (sessionStorage.getItem(GREETED_SESSION_KEY) === '1') {
      setGreetingSpoken(true);
      return;
    }
    sessionStorage.setItem(GREETED_SESSION_KEY, '1');
    if (reducedMotion || !('speechSynthesis' in window) || !(settings?.voiceRepliesEnabled ?? true)) return;
    let started = false;
    const utterance = new SpeechSynthesisUtterance(greetingSpokenText);
    utterance.onstart = () => {
      started = true;
      setGreetingSpoken(true);
      setState('speaking');
    };
    utterance.onend = () => setState((current) => (current === 'speaking' ? 'idle' : current));
    utterance.onerror = () => setGreetingBlocked(true);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    const timeout = window.setTimeout(() => {
      if (!started) setGreetingBlocked(true);
    }, 1200);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, settingsQuery.isLoading]);

  const speakGreetingNow = () => {
    setGreetingBlocked(false);
    setGreetingSpoken(true);
    if (reducedMotion || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(greetingSpokenText);
    utterance.onstart = () => setState('speaking');
    utterance.onend = () => setState((current) => (current === 'speaking' ? 'idle' : current));
    utterance.onerror = () => setState('idle');
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if (!settings?.scopes.length || scopeId) return;
    setScopeId(settings.scopes[0].id);
  }, [scopeId, settings?.scopes]);

  const stopAll = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    window.speechSynthesis?.cancel();
  };

  // Route change / unmount always stops recognition + speech cleanly.
  useEffect(() => () => stopAll(), []);

  // If Veyra gets disabled while this page is open (e.g. from another tab), stop
  // any in-flight capture/speech immediately rather than leaving it running.
  useEffect(() => {
    if (!enabled && !settingsQuery.isLoading) {
      stopAll();
      setState('disabled');
    }
  }, [enabled, settingsQuery.isLoading]);

  const startListening = () => {
    if (!speechSupported) {
      setState('unsupported');
      return;
    }
    if (state === 'listening' || ask.isPending) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    finalTranscriptRef.current = '';
    userStoppedRef.current = false;
    submittedRef.current = false;
    const recognition = new Recognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => setState('listening');
    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setState('permission');
      } else if (event.error === 'no-speech') {
        setState('no_speech');
      } else {
        setState('error');
      }
    };
    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      // Only final segments are kept — interim words are never shown or stored.
      const finals = Array.from(event.results)
        .filter((result) => result.isFinal)
        .map((result) => result[0]?.transcript || '')
        .join(' ')
        .trim();
      if (finals) finalTranscriptRef.current = finals;
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      const finalText = finalTranscriptRef.current.trim();
      const wasUserStopped = userStoppedRef.current;
      userStoppedRef.current = false;
      if (finalText && !submittedRef.current) {
        submittedRef.current = true;
        submitToVeyra(finalText, 'voice');
        return;
      }
      if (!wasUserStopped) {
        setState((current) => (current === 'listening' ? 'no_speech' : current));
      } else {
        setState((current) => (current === 'listening' ? 'idle' : current));
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopListening = () => {
    userStoppedRef.current = true;
    recognitionRef.current?.stop();
  };

  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
    setState('idle');
  };

  const handleOrbClick = () => {
    if (greetingBlocked && !greetingSpoken) {
      speakGreetingNow();
      return;
    }
    if (state === 'listening') stopListening();
    else if (state === 'speaking') stopSpeaking();
    else if (enabled && !ask.isPending && state !== 'thinking') startListening();
  };

  const submitTyped = () => submitToVeyra(prompt, 'typed');

  const orbState = orbStateFor(state);
  const caption = stateCaption(state, greetingTitle, greetingSubtitle);
  const liveRegionText =
    settingsQuery.isLoading || state === 'idle' || state === 'disabled'
      ? caption.title
      : `Veyra is ${caption.title.toLowerCase().replace(/[.…]+$/, '')}`;
  const hasConversation = conversation.length > 0;

  // Safe, generic prefill phrases — describe real capabilities without
  // referencing any specific (possibly fabricated) file/plan/link name.
  const capabilityCards = [
    { icon: Link2, title: 'Find links', copy: 'Find links shared in your approved spaces.', prompt: 'Find a link shared in my approved spaces' },
    { icon: FileText, title: 'Find PDFs', copy: 'Locate PDFs shared in your approved spaces.', prompt: 'Find a PDF shared in my approved spaces' },
    { icon: Calendar, title: 'Find plans', copy: 'Find trip or project plans shared in your spaces.', prompt: 'Show me a plan shared in my approved spaces' },
    { icon: HelpCircle, title: 'Ask simple questions', copy: 'Get quick answers from your approved spaces.', prompt: 'What can you help me with?' },
  ] as const;

  return (
    <div className="flex h-dvh bg-[color:var(--bl-bg)] text-[color:var(--bl-text)]">
      <Sidebar onNewConversation={() => navigate('/chats')} onChatFilterChange={() => navigate('/chats')} />

      <main className="relative min-w-0 flex-1 overflow-hidden">
        <BrandGlow variant="hero" />

        <div className="relative flex h-full flex-col">
          {/* Header */}
          <header className="flex items-center justify-between gap-3 px-5 py-4 sm:px-8">
            <div className="flex items-center gap-2.5">
              {hasConversation ? <AmbientOrb state={orbState} size={28} /> : <VeyraMark size={28} />}
              <div className="leading-tight">
                <p className="text-[15px] font-semibold tracking-wide text-[color:var(--bl-text)]">VEYRA</p>
                <p className="text-[11px] text-[color:var(--bl-text-muted)]">AI assistant for approved spaces</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hasConversation && (
                <button
                  type="button"
                  ref={newConversationButtonRef}
                  onClick={requestClearConversation}
                  aria-label="Start a new conversation"
                  className="brand-focus-ring flex items-center gap-1.5 rounded-xl border border-[color:var(--blabber-border)] px-3 py-2 text-xs font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)] hover:text-[color:var(--bl-text)]"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  New conversation
                </button>
              )}
              <button
                type="button"
                onClick={() => setHowItWorksOpen(true)}
                aria-label="How VEYRA works"
                className="brand-focus-ring flex items-center gap-1.5 rounded-xl border border-[color:var(--blabber-border)] px-3 py-2 text-xs font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)] hover:text-[color:var(--bl-text)]"
              >
                <Info className="h-3.5 w-3.5" />
                How VEYRA works
              </button>
              <button
                type="button"
                onClick={() => navigate('/settings?s=ai')}
                aria-label="Veyra AI privacy settings"
                className="brand-focus-ring rounded-xl border border-[color:var(--blabber-border)] p-2.5 text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)] hover:text-[color:var(--bl-text)]"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </header>

          {howItWorksOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="veyra-how-it-works-title">
              <div className="brand-glass w-full max-w-sm rounded-2xl p-5 text-left text-[color:var(--bl-text)] outline-none">
                <h2 id="veyra-how-it-works-title" className="text-base font-semibold">How VEYRA works</h2>
                <ul className="mt-3 space-y-2.5 text-sm text-[color:var(--bl-text-secondary)]">
                  <li className="flex gap-2"><Link2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-500" /> Finds links shared in your approved spaces.</li>
                  <li className="flex gap-2"><FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-500" /> Locates PDFs shared in your approved spaces.</li>
                  <li className="flex gap-2"><Calendar className="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-500" /> Finds trip or project plans shared in your spaces.</li>
                  <li className="flex gap-2"><HelpCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-500" /> Answers simple questions from your approved spaces.</li>
                  <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-500" /> Only ever searches spaces you've explicitly approved.</li>
                </ul>
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setHowItWorksOpen(false)}
                    className="brand-focus-ring rounded-xl px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                    style={{ background: 'var(--brand-gradient-ai)' }}
                  >
                    Got it
                  </button>
                </div>
              </div>
            </div>
          )}

          {clearDialogOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
              <div
                ref={clearDialogRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby="veyra-clear-dialog-title"
                aria-describedby="veyra-clear-dialog-body"
                className="brand-glass w-full max-w-sm rounded-2xl p-5 text-left text-[color:var(--bl-text)] outline-none"
              >
                <h2 id="veyra-clear-dialog-title" className="text-base font-semibold">
                  Start a new Veyra conversation?
                </h2>
                <p id="veyra-clear-dialog-body" className="mt-2 text-sm text-[color:var(--bl-text-secondary)]">
                  Your current Veyra conversation and its temporary context will be cleared from this browser tab.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancelClearConversation}
                    className="brand-focus-ring rounded-xl border border-[color:var(--blabber-border)] px-3.5 py-2 text-sm font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmClearConversation}
                    className="brand-focus-ring rounded-xl px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                    style={{ background: 'var(--brand-gradient-ai)' }}
                  >
                    Start new conversation
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Live region for screen readers */}
          <p className="sr-only" role="status" aria-live="polite">
            {liveRegionText}
          </p>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-2 sm:px-8">
            {/* Empty-state hero — greeting/orb only, before the first turn. */}
            {!hasConversation && (
              <div className="mx-auto w-full max-w-5xl flex-1 py-2">
                <div className="relative overflow-hidden rounded-3xl border border-[color:var(--blabber-border)] bg-[color:var(--blabber-surface)] p-6 shadow-sm sm:p-8">
                  {/* Subtle low-opacity dotted particle backdrop — purely decorative. */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 opacity-[0.4] dark:opacity-[0.25]"
                    style={{ backgroundImage: 'radial-gradient(rgba(19,200,177,0.35) 1px, transparent 1px)', backgroundSize: '20px 20px' }}
                  />
                  <div className="relative flex flex-col gap-8 text-center lg:flex-row lg:items-center lg:text-left">
                    <button
                      type="button"
                      onClick={handleOrbClick}
                      disabled={!enabled && !settingsQuery.isLoading}
                      aria-label={
                        greetingBlocked && !greetingSpoken
                          ? 'Tap the orb to hear Veyra'
                          : state === 'listening'
                            ? 'Stop listening'
                            : state === 'speaking'
                              ? 'Stop speaking'
                              : 'Start talking to Veyra'
                      }
                      className="brand-focus-ring mx-auto flex-shrink-0 rounded-full disabled:cursor-not-allowed lg:mx-0"
                    >
                      <AmbientOrb state={orbState} size={180} />
                    </button>

                    <div className="min-w-0 flex-1">
                      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{caption.title}</h1>
                      {caption.subtitle && <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[color:var(--bl-text-secondary)] lg:mx-0">{caption.subtitle}</p>}

                      {greetingBlocked && !greetingSpoken && state === 'idle' && (
                        <button
                          type="button"
                          onClick={speakGreetingNow}
                          className="brand-focus-ring mt-4 rounded-xl border border-[color:var(--blabber-border)] px-4 py-2 text-sm font-semibold transition hover:bg-[color:var(--bl-hover)]"
                        >
                          Tap the orb to hear Veyra
                        </button>
                      )}

                      {state === 'scope_required' && (
                        <button
                          type="button"
                          onClick={() => navigate('/settings?s=ai')}
                          className="brand-focus-ring mt-4 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
                          style={{ background: 'var(--brand-gradient-ai)' }}
                        >
                          Manage AI privacy
                        </button>
                      )}

                      {state === 'disabled' && (
                        <button
                          type="button"
                          onClick={() => navigate('/settings?s=ai')}
                          className="brand-focus-ring mt-4 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
                          style={{ background: 'var(--brand-gradient-ai)' }}
                        >
                          Turn on Veyra in Settings
                        </button>
                      )}

                      {(state === 'unsupported' || state === 'permission' || state === 'no_speech' || state === 'error') && (
                        <button
                          type="button"
                          onClick={startListening}
                          disabled={state === 'unsupported' || !enabled}
                          className="brand-focus-ring mt-4 rounded-xl border border-[color:var(--blabber-border)] px-3 py-1.5 text-xs font-semibold transition hover:bg-[color:var(--bl-hover)] disabled:opacity-40"
                        >
                          Try again
                        </button>
                      )}
                    </div>

                    {/* Approved-space privacy card — read-only status; change spaces via the composer's + button. */}
                    <div className="w-full flex-shrink-0 rounded-2xl border border-[color:var(--blabber-border)] bg-[color:var(--bl-hover)] p-4 text-left lg:w-64">
                      <div className="flex items-center gap-2 text-sm font-semibold text-teal-600 dark:text-teal-300">
                        <ShieldCheck size={16} className="flex-shrink-0" />
                        Only searches approved spaces
                      </div>
                      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--bl-text-muted)]">Approved space</p>
                      {settings?.scopes.length ? (
                        <div className="mt-1.5 flex items-center justify-between gap-2 rounded-xl border border-[color:var(--blabber-border)] bg-[color:var(--blabber-surface)] px-3 py-2">
                          <span className="flex min-w-0 items-center gap-2 text-sm">
                            <Users size={14} className="flex-shrink-0 text-[color:var(--bl-text-muted)]" />
                            <span className="truncate">{selectedScope?.label || selectedScope?.type}</span>
                          </span>
                          <CheckCircle2 size={16} className="flex-shrink-0 text-teal-500" />
                        </div>
                      ) : (
                        <>
                          <p className="mt-1.5 text-sm text-[color:var(--bl-text-secondary)]">No approved spaces yet</p>
                          <button
                            type="button"
                            onClick={() => navigate('/settings?s=ai')}
                            className="brand-focus-ring mt-2 rounded-lg text-xs font-semibold text-teal-600 underline-offset-2 hover:underline dark:text-teal-300"
                          >
                            Manage AI privacy
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Capability cards — describe only Veyra's real, current capabilities. */}
                {enabled && (
                  <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {capabilityCards.map((card) => (
                      <button
                        key={card.title}
                        type="button"
                        onClick={() => setPrompt(card.prompt)}
                        className="group rounded-2xl border border-[color:var(--blabber-border)] bg-[color:var(--blabber-surface)] p-4 text-left shadow-sm transition hover:shadow-md hover:[box-shadow:var(--bl-glow-sm)]"
                      >
                        <div className="flex items-center justify-between">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
                            <card.icon size={17} />
                          </span>
                          <ArrowRight size={15} className="text-teal-500 opacity-0 transition group-hover:opacity-100" />
                        </div>
                        <p className="mt-3 text-sm font-semibold text-[color:var(--bl-text)]">{card.title}</p>
                        <p className="mt-1 text-xs leading-5 text-[color:var(--bl-text-muted)]">{card.copy}</p>
                      </button>
                    ))}
                  </div>
                )}

                {/* Try asking VEYRA — same real, scope-aware suggestions as before, just restyled. */}
                {enabled && state === 'idle' && (
                  <div className="mt-6">
                    <h2 className="text-sm font-semibold text-[color:var(--bl-text-secondary)]">Try asking VEYRA</h2>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {suggestedPrompts(selectedScope?.type).map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => setPrompt(suggestion)}
                          className="brand-focus-ring rounded-full border border-[color:var(--blabber-border)] bg-[color:var(--blabber-surface)] px-3.5 py-1.5 text-xs text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Threaded conversation — every turn is appended and stays visible. */}
            {hasConversation && (
              <div className="mx-auto w-full max-w-2xl space-y-4 pb-2">
                {conversation.map((turn) => (
                  <div key={turn.id} className="space-y-2">
                    <div className="ml-auto max-w-[85%] rounded-2xl border border-[color:var(--blabber-border)] bg-[color:var(--blabber-surface-soft)] px-4 py-2.5 text-left text-sm text-[color:var(--bl-text)]">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--bl-text-muted)]">
                        {turn.origin === 'voice' ? 'You said' : 'You asked'}
                      </p>
                      <p className="mt-0.5">{turn.question}</p>
                    </div>

                    <div className="brand-glass max-w-[92%] rounded-2xl px-4 py-3 text-left text-sm leading-relaxed text-[color:var(--bl-text)]">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-600 dark:text-teal-300">Veyra</p>
                      {turn.status === 'pending' ? (
                        <p className="mt-1 text-[color:var(--bl-text-muted)]">Thinking…</p>
                      ) : turn.status === 'error' ? (
                        <>
                          <p className="mt-1 text-rose-600 dark:text-rose-300">{turn.errorMessage || 'Veyra is temporarily unavailable. Please try again.'}</p>
                          {turn.errorCode === 'scope_required' && (
                            <button
                              type="button"
                              onClick={() => navigate('/settings?s=ai')}
                              className="brand-focus-ring mt-2 rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
                              style={{ background: 'var(--brand-gradient-ai)' }}
                            >
                              Manage AI privacy
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <p className="mt-1">{turn.answer}</p>
                          {turn.suggestManageAiPrivacy && (
                            <button
                              type="button"
                              onClick={() => navigate('/settings?s=ai')}
                              className="brand-focus-ring mt-2 rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
                              style={{ background: 'var(--brand-gradient-ai)' }}
                            >
                              Manage AI privacy
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    {turn.ambiguousCandidates && turn.ambiguousCandidates.length > 0 && (
                      <div className="ml-1 flex flex-wrap gap-2" role="group" aria-label="Choose which space to search">
                        {turn.ambiguousCandidates.map((candidate) => (
                          <button
                            key={candidate.scopeId}
                            type="button"
                            onClick={() => resolveAmbiguous(candidate, turn.question, turn.origin)}
                            className="brand-focus-ring rounded-full border border-[color:var(--blabber-border)] px-3 py-1.5 text-xs font-semibold text-[color:var(--bl-text)] transition hover:bg-[color:var(--bl-hover)]"
                          >
                            {candidate.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {turn.results && turn.results.length > 0 && (
                      <div className="ml-1 grid gap-2">
                        {turn.results.map((card) => (
                          <div
                            key={`${card.resultType}-${card.id}`}
                            className="brand-glass flex items-start justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium text-[color:var(--bl-text)]">{card.title}</p>
                              {card.subtitle && <p className="truncate text-xs text-[color:var(--bl-text-muted)]">{card.subtitle}</p>}
                              {resultMeta(card) && <p className="mt-1 text-[11px] text-[color:var(--bl-text-muted)]">{resultMeta(card)}</p>}
                            </div>
                            {card.deepLink && (
                              <button
                                type="button"
                                onClick={() => openResultCard(card)}
                                className="brand-focus-ring inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-[color:var(--blabber-border)] px-2.5 py-1 text-xs font-semibold text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)]"
                              >
                                <ExternalLink className="h-3 w-3" />
                                {resultActionLabel(card)}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-[color:var(--blabber-border)] px-4 py-4 sm:px-8" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            <div className="mx-auto flex w-full max-w-2xl items-end gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setScopePickerOpen((open) => !open)}
                  disabled={!enabled}
                  aria-label="Change Veyra space"
                  aria-expanded={scopePickerOpen}
                  className="brand-focus-ring flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-[color:var(--blabber-border)] text-teal-600 transition hover:bg-[color:var(--bl-hover)] disabled:opacity-40 dark:text-teal-300"
                >
                  <Plus className="h-4 w-4" />
                </button>
                {scopePickerOpen && (
                  <div className="brand-glass absolute bottom-full left-0 z-10 mb-2 w-64 rounded-xl p-2 shadow-2xl">
                    <div className="flex items-center justify-between px-1 pb-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--bl-text-muted)]">Space</p>
                      <button
                        type="button"
                        onClick={() => setScopePickerOpen(false)}
                        aria-label="Close space picker"
                        className="rounded p-1 text-[color:var(--bl-text-muted)] hover:text-[color:var(--bl-text)]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {(settings?.scopes || []).length === 0 ? (
                      <p className="px-1 py-1.5 text-xs text-[color:var(--bl-text-muted)]">No approved spaces yet.</p>
                    ) : (
                      settings!.scopes.map((scope) => (
                        <button
                          key={scope.id}
                          type="button"
                          onClick={() => {
                            setScopeId(scope.id);
                            setScopePickerOpen(false);
                          }}
                          className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-sm ${
                            selectedScope?.id === scope.id ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'
                          }`}
                        >
                          {scope.label || scope.type}
                        </button>
                      ))
                    )}
                    <button
                      type="button"
                      onClick={() => navigate('/settings?s=ai')}
                      className="mt-1 block w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-teal-600 hover:bg-[color:var(--bl-hover)] dark:text-teal-300"
                    >
                      Manage spaces in Settings
                    </button>
                  </div>
                )}
              </div>

              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submitTyped();
                  }
                }}
                placeholder="Ask VEYRA about approved spaces…"
                rows={1}
                disabled={!enabled}
                aria-label="Ask Veyra"
                className="brand-focus-ring min-h-[44px] flex-1 resize-none rounded-xl border border-[color:var(--blabber-border)] bg-[color:var(--blabber-surface)] px-3.5 py-2.5 text-sm text-[color:var(--bl-text)] placeholder:text-[color:var(--bl-text-muted)] disabled:opacity-40"
              />

              {state === 'listening' ? (
                <button
                  type="button"
                  onClick={stopListening}
                  aria-label="Stop listening"
                  className="brand-focus-ring flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-[color:var(--blabber-border)] text-teal-600 transition hover:bg-[color:var(--bl-hover)] dark:text-teal-300"
                >
                  <MicOff className="h-4 w-4" />
                </button>
              ) : state === 'speaking' ? (
                <button
                  type="button"
                  onClick={stopSpeaking}
                  aria-label="Stop speaking"
                  className="brand-focus-ring flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-[color:var(--blabber-border)] text-teal-600 transition hover:bg-[color:var(--bl-hover)] dark:text-teal-300"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startListening}
                  disabled={!enabled || !speechSupported || state === 'thinking'}
                  aria-label={speechSupported ? 'Start listening' : 'Voice input is not supported in this browser'}
                  title={speechSupported ? undefined : 'Voice input is not supported in this browser'}
                  className="brand-focus-ring flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-[color:var(--blabber-border)] text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)] disabled:opacity-40"
                >
                  <Mic className="h-4 w-4" />
                </button>
              )}

              <button
                type="button"
                onClick={() => voiceToggle.mutate(!(settings?.voiceRepliesEnabled ?? true))}
                disabled={!enabled}
                aria-label={(settings?.voiceRepliesEnabled ?? true) ? 'Turn off voice replies' : 'Turn on voice replies'}
                className="brand-focus-ring flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-[color:var(--blabber-border)] text-[color:var(--bl-text-secondary)] transition hover:bg-[color:var(--bl-hover)] disabled:opacity-40"
              >
                {(settings?.voiceRepliesEnabled ?? true) ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={submitTyped}
                disabled={!enabled || !prompt.trim() || ask.isPending}
                aria-label="Send to Veyra"
                className="brand-focus-ring flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-white transition hover:brightness-110 disabled:opacity-40"
                style={{ background: 'var(--brand-gradient-ai)', boxShadow: 'var(--blabber-glow-cyan)' }}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mx-auto mt-3 max-w-2xl text-center text-xs text-[color:var(--bl-text-muted)]">
              VEYRA only searches in your approved spaces.{' '}
              <button type="button" onClick={() => navigate('/settings?s=ai')} className="font-semibold text-teal-600 underline-offset-2 hover:underline dark:text-teal-300">
                Learn more
              </button>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
