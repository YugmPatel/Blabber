import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VeyraPage from './VeyraPage';
import { VeyraSessionProvider } from '@/contexts/VeyraSessionContext';
import { askVeyra, fetchVeyraSettings, updateVeyraSettings } from '@/api/client';

vi.mock('@/api/client', () => ({
  fetchVeyraSettings: vi.fn(),
  updateVeyraSettings: vi.fn(),
  askVeyra: vi.fn(),
  // Sidebar's profile footer renders Avatar, which calls this — not itself
  // under test here, so a passthrough keeps the mock module usable.
  normalizeMediaUrl: (url?: string | null) => url ?? undefined,
  // Sidebar's account menu lazily loads the viewer's social profile.
  fetchMyProfile: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'user1', username: 'testuser', email: 'test@example.com', name: 'Jordan Lee' },
  }),
}));

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockFetchVeyraSettings = vi.mocked(fetchVeyraSettings);
const mockUpdateVeyraSettings = vi.mocked(updateVeyraSettings);
const mockAskVeyra = vi.mocked(askVeyra);

const baseSettings = {
  settings: {
    enabled: true,
    voiceRepliesEnabled: true,
    scopes: [] as Array<{ id: string; type: 'general' | 'my_actions' | 'chat' | 'community'; targetId?: string; label?: string; grantedAt: string }>,
    updatedAt: new Date().toISOString(),
  },
  globalAiEnabled: true,
};

type ResultLike = { 0?: { transcript?: string }; isFinal?: boolean };

class MockSpeechRecognition {
  lang = '';
  interimResults = false;
  continuous = false;
  onstart: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onresult: ((event: { results: ResultLike[] }) => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
}

let lastRecognitionInstance: MockSpeechRecognition | null = null;
let speechSynthesisMock: { cancel: ReturnType<typeof vi.fn>; speak: ReturnType<typeof vi.fn> };

function renderVeyraPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <VeyraSessionProvider>
          <VeyraPage />
        </VeyraSessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

// Simulates client-side route navigation: VeyraSessionProvider stays mounted
// (as it does in the real app, one level above the router) while VeyraPage
// itself unmounts/remounts, exactly like leaving /veyra for /settings and
// coming back.
function renderVeyraPageWithNavigation() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Harness() {
    const [onVeyraRoute, setOnVeyraRoute] = useState(true);
    return (
      <VeyraSessionProvider>
        {onVeyraRoute ? <VeyraPage /> : <div>Settings placeholder</div>}
        <button type="button" onClick={() => setOnVeyraRoute((value) => !value)}>
          toggle-route
        </button>
      </VeyraSessionProvider>
    );
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Harness />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

describe('VeyraPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    // jsdom does not implement scrollIntoView; VeyraPage calls it to keep the
    // newest turn in view, which is not itself under test here.
    Element.prototype.scrollIntoView = vi.fn();
    mockFetchVeyraSettings.mockResolvedValue(structuredClone(baseSettings));
    mockUpdateVeyraSettings.mockResolvedValue(baseSettings.settings);

    window.SpeechRecognition = vi.fn(() => {
      lastRecognitionInstance = new MockSpeechRecognition();
      return lastRecognitionInstance;
    }) as unknown as typeof window.SpeechRecognition;

    speechSynthesisMock = { cancel: vi.fn(), speak: vi.fn() };
    Object.defineProperty(window, 'speechSynthesis', { value: speechSynthesisMock, writable: true, configurable: true });
    (global as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = vi.fn().mockImplementation(
      function (this: { text: string }, text: string) {
        this.text = text;
      }
    );
  });

  afterEach(() => {
    delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
    lastRecognitionInstance = null;
  });

  it('shows a local greeting immediately without calling the backend ask endpoint', async () => {
    renderVeyraPage();
    // Scoped to the heading (not *AllBy*) because the same greeting is also
    // mirrored into a visually-hidden aria-live region for screen readers.
    await waitFor(() => expect(screen.getByRole('heading', { name: /Hi, Jordan\. I.m Veyra\./ })).toBeInTheDocument());
    expect(mockAskVeyra).not.toHaveBeenCalled();
  });

  it('does not insert recognized speech into the text composer', async () => {
    renderVeyraPage();
    await waitFor(() => expect(screen.getByLabelText('Start listening')).toBeEnabled());
    mockAskVeyra.mockReturnValue(new Promise(() => {})); // never resolves during this assertion

    fireEvent.click(screen.getByLabelText('Start listening'));
    act(() => {
      lastRecognitionInstance!.onresult?.({
        results: [{ 0: { transcript: 'what can you help with' }, isFinal: false }],
      });
    });

    const textarea = screen.getByLabelText('Ask Veyra') as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
  });

  it('auto-submits the final recognized utterance exactly once, even if recognition ends twice', async () => {
    mockAskVeyra.mockResolvedValue({ answer: 'Here is what I found.', intent: 'general_help', scope: null });
    renderVeyraPage();
    await waitFor(() => expect(screen.getByLabelText('Start listening')).toBeEnabled());

    fireEvent.click(screen.getByLabelText('Start listening'));
    act(() => {
      lastRecognitionInstance!.onresult?.({
        results: [{ 0: { transcript: 'what can you help with' }, isFinal: true }],
      });
    });
    act(() => {
      lastRecognitionInstance!.onend?.();
      lastRecognitionInstance!.onend?.(); // duplicate end event must not duplicate the request
    });

    await waitFor(() => expect(mockAskVeyra).toHaveBeenCalledTimes(1));
    expect(mockAskVeyra).toHaveBeenCalledWith({ prompt: 'what can you help with', scopeId: undefined });
  });

  it('transitions Thinking → Speaking → ready after a real response, and reads it aloud', async () => {
    let resolveAnswer: (value: { answer: string; intent: string; scope: null }) => void = () => {};
    mockAskVeyra.mockReturnValue(
      new Promise((resolve) => {
        resolveAnswer = resolve;
      })
    );
    renderVeyraPage();
    await waitFor(() => expect(screen.getByLabelText('Ask Veyra')).toBeEnabled());

    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: 'what can you help with' } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));

    expect(await screen.findByText('Thinking…')).toBeInTheDocument();
    act(() => {
      resolveAnswer({ answer: 'Here is what I found.', intent: 'general_help', scope: null });
    });
    await waitFor(() => expect(speechSynthesisMock.speak).toHaveBeenCalled());
    expect(await screen.findByText('Here is what I found.')).toBeInTheDocument();
  });

  it('shows the specific privacy-management state for a scoped question with no approved scope', async () => {
    mockAskVeyra.mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: 'To answer that, Veyra needs access to an approved space.', code: 'scope_required' } },
    });
    renderVeyraPage();
    await waitFor(() => expect(screen.getByLabelText('Ask Veyra')).toBeEnabled());

    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: 'What did my group decide?' } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));

    expect(await screen.findByText('To answer that, Veyra needs access to an approved space.')).toBeInTheDocument();
    expect(screen.getByText('Manage AI privacy')).toBeInTheDocument();
  });

  it('stop listening calls recognition.stop() and returns to the ready state', async () => {
    renderVeyraPage();
    await waitFor(() => expect(screen.getByLabelText('Start listening')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Start listening'));
    await waitFor(() => expect(screen.getAllByLabelText('Stop listening').length).toBeGreaterThan(0));

    const stopButtons = screen.getAllByLabelText('Stop listening');
    fireEvent.click(stopButtons[stopButtons.length - 1]);
    expect(lastRecognitionInstance!.stop).toHaveBeenCalledTimes(1);
  });

  it('stop speaking calls speechSynthesis.cancel()', async () => {
    mockAskVeyra.mockResolvedValue({ answer: 'Here is what I found.', intent: 'general_help', scope: null });
    renderVeyraPage();
    await waitFor(() => expect(screen.getByLabelText('Ask Veyra')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));

    const stopSpeakingButton = await screen.findByLabelText('Stop speaking');
    fireEvent.click(stopSpeakingButton);
    expect(speechSynthesisMock.cancel).toHaveBeenCalled();
  });

  it('cancels recognition and speech on unmount', async () => {
    const { unmount } = renderVeyraPage();
    await waitFor(() => expect(screen.getByLabelText('Start listening')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Start listening'));
    const recognition = lastRecognitionInstance!;

    unmount();
    expect(recognition.stop).toHaveBeenCalled();
    expect(speechSynthesisMock.cancel).toHaveBeenCalled();
  });

  it('does not persist raw transcript text to storage', async () => {
    mockAskVeyra.mockResolvedValue({ answer: 'Here is what I found.', intent: 'general_help', scope: null });
    renderVeyraPage();
    await waitFor(() => expect(screen.getByLabelText('Ask Veyra')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: 'what can you help with' } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));
    await screen.findByText('Here is what I found.');

    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i)!;
      expect(sessionStorage.getItem(key)).not.toContain('what can you help with');
      expect(sessionStorage.getItem(key)).not.toContain('Here is what I found.');
    }
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)!;
      expect(localStorage.getItem(key)).not.toContain('what can you help with');
      expect(localStorage.getItem(key)).not.toContain('Here is what I found.');
    }
  });

  it('renders authorized result cards and reauthorizes via the normal chat route when opened', async () => {
    mockAskVeyra.mockResolvedValue({
      answer: 'I found 1 photo in Yugm.',
      intent: 'find_photos',
      scope: { id: 'chat:1', type: 'chat', label: 'Yugm' },
      resultType: 'attachment',
      results: [
        {
          resultType: 'attachment',
          id: 'msg1',
          title: 'trip.jpg',
          subtitle: 'Yugm',
          senderName: 'Yugm Patel',
          chatId: 'chat1',
          createdAt: new Date().toISOString(),
          deepLink: { kind: 'chat_message', chatId: 'chat1', messageId: 'msg1' },
        },
      ],
    });
    renderVeyraPage();
    await waitFor(() => expect(screen.getByLabelText('Ask Veyra')).toBeEnabled());

    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: "show me photos from Yugm's chat" } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));

    expect(await screen.findByText('trip.jpg')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Jump to message'));
    // The deep link only carries {chatId, messageId} — no raw storage path/token — and
    // navigates to the same route ChatView already reauthorizes on load.
    expect(mockNavigate).toHaveBeenCalledWith('/chats/chat1?message=msg1');
  });

  it('asks a clarifying question when results are ambiguous, and resolves it without guessing', async () => {
    mockAskVeyra
      .mockResolvedValueOnce({
        answer: 'I found matches in more than one space: Yugm Work and Yugm Personal. Which one should I open?',
        intent: 'find_photos',
        scope: null,
        resultType: 'empty',
        results: [],
        ambiguous: true,
        candidates: [
          { scopeId: 'chat:1', label: 'Yugm Work' },
          { scopeId: 'chat:2', label: 'Yugm Personal' },
        ],
      })
      .mockResolvedValueOnce({
        answer: 'I found 1 photo in Yugm Work.',
        intent: 'find_photos',
        scope: { id: 'chat:1', type: 'chat', label: 'Yugm Work' },
        resultType: 'attachment',
        results: [],
      });

    renderVeyraPage();
    await waitFor(() => expect(screen.getByLabelText('Ask Veyra')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: 'show me photos from Yugm' } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));

    expect(await screen.findByText('Yugm Work')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Yugm Work'));

    await waitFor(() => expect(mockAskVeyra).toHaveBeenCalledTimes(2));
    expect(mockAskVeyra).toHaveBeenLastCalledWith({ prompt: 'show me photos from Yugm', scopeId: 'chat:1', context: undefined });
  });

  it('appends each new turn to the conversation instead of replacing the previous answer', async () => {
    mockAskVeyra
      .mockResolvedValueOnce({ answer: 'First answer.', intent: 'general_help', scope: null, resultType: 'empty', results: [] })
      .mockResolvedValueOnce({ answer: 'Second answer.', intent: 'general_help', scope: null, resultType: 'empty', results: [] });
    renderVeyraPage();
    await waitFor(() => expect(screen.getByLabelText('Ask Veyra')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: 'first question' } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));
    await screen.findByText('First answer.');

    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: 'second question' } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));
    await screen.findByText('Second answer.');

    // Both turns remain visible — the second answer does not replace the first.
    expect(screen.getByText('First answer.')).toBeInTheDocument();
    expect(screen.getByText('first question')).toBeInTheDocument();
    expect(screen.getByText('second question')).toBeInTheDocument();
  });

  it('threads follow-up context between turns and clears it only via the local "New conversation" control', async () => {
    mockAskVeyra
      .mockResolvedValueOnce({
        answer: 'Someone started "Santa Cruz Trip" in AI QA Sandbox.',
        intent: 'plan_creator',
        scope: { id: 'chat:1', type: 'chat', label: 'AI QA Sandbox' },
        resultType: 'plan',
        results: [],
        context: { activePlanId: 'plan1', activePlanTitle: 'Santa Cruz Trip', activeSpaceId: 'chat:1', activeSpaceName: 'AI QA Sandbox' },
      })
      .mockResolvedValueOnce({ answer: 'Found 1 task.', intent: 'action_status', scope: null, resultType: 'task', results: [] });

    renderVeyraPage();
    await waitFor(() => expect(screen.getByLabelText('Ask Veyra')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: 'Who started it?' } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));
    await screen.findByText('Someone started "Santa Cruz Trip" in AI QA Sandbox.');

    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: 'What tasks do I have for this?' } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));
    await screen.findByText('Found 1 task.');

    // The second request echoes back the context returned by the first response.
    expect(mockAskVeyra).toHaveBeenLastCalledWith({
      prompt: 'What tasks do I have for this?',
      scopeId: undefined,
      context: { activePlanId: 'plan1', activePlanTitle: 'Santa Cruz Trip', activeSpaceId: 'chat:1', activeSpaceName: 'AI QA Sandbox' },
    });

    // Clearing the conversation requires confirmation via a real dialog, then
    // wipes both the visible thread and the in-memory context (never
    // persisted anywhere else).
    fireEvent.click(screen.getByLabelText('Start a new conversation'));
    expect(await screen.findByRole('dialog', { name: 'Start a new Veyra conversation?' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Start new conversation'));
    expect(screen.queryByText('Who started it?')).not.toBeInTheDocument();

    mockAskVeyra.mockResolvedValueOnce({ answer: 'Third answer.', intent: 'general_help', scope: null, resultType: 'empty', results: [] });
    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: 'third question' } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));
    await screen.findByText('Third answer.');
    expect(mockAskVeyra).toHaveBeenLastCalledWith({ prompt: 'third question', scopeId: undefined, context: undefined });
  });

  it('route navigation away from and back to /veyra preserves the in-memory thread and context', async () => {
    mockAskVeyra.mockResolvedValueOnce({
      answer: 'Someone started "Santa Cruz Trip" in AI QA Sandbox.',
      intent: 'plan_creator',
      scope: { id: 'chat:1', type: 'chat', label: 'AI QA Sandbox' },
      resultType: 'plan',
      results: [],
      context: { activePlanId: 'plan1', activePlanTitle: 'Santa Cruz Trip', activeSpaceId: 'chat:1', activeSpaceName: 'AI QA Sandbox' },
    });
    renderVeyraPageWithNavigation();
    await waitFor(() => expect(screen.getByLabelText('Ask Veyra')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: 'Who started it?' } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));
    await screen.findByText('Someone started "Santa Cruz Trip" in AI QA Sandbox.');

    // Navigate away (VeyraPage unmounts) and back (VeyraPage remounts).
    fireEvent.click(screen.getByText('toggle-route'));
    expect(screen.getByText('Settings placeholder')).toBeInTheDocument();
    fireEvent.click(screen.getByText('toggle-route'));

    // The full turn and the grounded context both survive the remount.
    expect(await screen.findByText('Who started it?')).toBeInTheDocument();
    expect(screen.getByText('Someone started "Santa Cruz Trip" in AI QA Sandbox.')).toBeInTheDocument();

    mockAskVeyra.mockResolvedValueOnce({ answer: 'Found 1 task.', intent: 'action_status', scope: null, resultType: 'task', results: [] });
    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: 'What tasks do I have for this?' } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));
    await screen.findByText('Found 1 task.');
    expect(mockAskVeyra).toHaveBeenLastCalledWith({
      prompt: 'What tasks do I have for this?',
      scopeId: undefined,
      context: { activePlanId: 'plan1', activePlanTitle: 'Santa Cruz Trip', activeSpaceId: 'chat:1', activeSpaceName: 'AI QA Sandbox' },
    });
  });

  it('New conversation Cancel keeps every turn and all context exactly unchanged', async () => {
    mockAskVeyra.mockResolvedValueOnce({ answer: 'First answer.', intent: 'general_help', scope: null, resultType: 'empty', results: [] });
    renderVeyraPage();
    await waitFor(() => expect(screen.getByLabelText('Ask Veyra')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: 'first question' } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));
    await screen.findByText('First answer.');

    fireEvent.click(screen.getByLabelText('Start a new conversation'));
    expect(await screen.findByRole('dialog', { name: 'Start a new Veyra conversation?' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('first question')).toBeInTheDocument();
    expect(screen.getByText('First answer.')).toBeInTheDocument();
  });

  it('after New conversation is confirmed, a follow-up like "Who started it?" cannot reuse the cleared context', async () => {
    mockAskVeyra.mockResolvedValueOnce({
      answer: 'Someone started "Santa Cruz Trip" in AI QA Sandbox.',
      intent: 'plan_creator',
      scope: { id: 'chat:1', type: 'chat', label: 'AI QA Sandbox' },
      resultType: 'plan',
      results: [],
      context: { activePlanId: 'plan1', activePlanTitle: 'Santa Cruz Trip', activeSpaceId: 'chat:1', activeSpaceName: 'AI QA Sandbox' },
    });
    renderVeyraPage();
    await waitFor(() => expect(screen.getByLabelText('Ask Veyra')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: 'Who started it?' } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));
    await screen.findByText('Someone started "Santa Cruz Trip" in AI QA Sandbox.');

    fireEvent.click(screen.getByLabelText('Start a new conversation'));
    fireEvent.click(screen.getByText('Start new conversation'));

    mockAskVeyra.mockResolvedValueOnce({
      answer: 'Which plan would you like to know about?',
      intent: 'plan_creator',
      scope: null,
      resultType: 'empty',
      results: [],
    });
    fireEvent.change(screen.getByLabelText('Ask Veyra'), { target: { value: 'Who started it?' } });
    fireEvent.click(screen.getByLabelText('Send to Veyra'));
    await screen.findByText('Which plan would you like to know about?');
    expect(mockAskVeyra).toHaveBeenLastCalledWith({ prompt: 'Who started it?', scopeId: undefined, context: undefined });
  });
});
