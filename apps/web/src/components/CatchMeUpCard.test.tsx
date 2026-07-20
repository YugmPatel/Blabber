import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CatchMeUpCard from './CatchMeUpCard';
import type { ChatIntelligenceSummary } from '@repo/types';

// Catch Me Up panel rendering: low-content/fallback summaries must render as
// clean sections (never raw JSON), errors must offer a retry, and repeated
// refreshes must not duplicate items (the summary prop is replaced wholesale).

function fallbackSummary(overrides: Partial<ChatIntelligenceSummary> = {}): ChatIntelligenceSummary {
  return {
    summary: 'Recent activity in "Apartment Move-in": 2 action items, 1 decision.',
    overview: 'Recent activity in "Apartment Move-in": 2 action items, 1 decision.',
    scope: { label: 'Last 8 messages', messageCount: 8, mode: 'recent' },
    decisions: [
      { title: 'We will use Xfinity 1Gbps if the price is under $80', status: 'final', sourceMessageIds: ['m7'] },
    ],
    tasks: [
      { title: 'Finalize WiFi by tomorrow', assignedTo: null, assignedToUserId: null, dueDate: '2026-07-20', status: 'pending', sourceMessageId: 'm1' },
      { title: 'Check renters insurance', assignedTo: null, assignedToUserId: null, dueDate: null, status: 'pending', sourceMessageId: 'm2' },
    ],
    questionsForMe: [{ question: 'Can someone confirm parking and mailbox access?', sourceMessageId: 'm5' }],
    importantLinks: [{ url: 'https://example.com/renters', label: null, sourceMessageId: 'm6' }],
    waitingOn: [{ title: 'Finalize WiFi by tomorrow', owner: null, dueDate: null, status: 'waiting', sourceMessageId: 'm1' }],
    noise: [],
    sourceMessageIds: ['m1', 'm2', 'm5', 'm6', 'm7'],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CatchMeUpCard', () => {
  it('renders a grounded fallback summary as clean sections, never raw JSON', () => {
    render(
      <CatchMeUpCard summary={fallbackSummary()} isLoading={false} isGenerating={false} onCatchMeUp={() => {}} />
    );

    expect(screen.getByText(/Recent activity in "Apartment Move-in"/)).toBeInTheDocument();
    expect(screen.getByText('We will use Xfinity 1Gbps if the price is under $80')).toBeInTheDocument();
    // The task title renders in both Tasks and Waiting On — that mirroring is expected.
    expect(screen.getAllByText('Finalize WiFi by tomorrow', { selector: 'p' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Can someone confirm parking and mailbox access?')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText(/Due 2026-07-20/)).toBeInTheDocument();
    // No raw JSON artifacts anywhere in the rendered panel.
    expect(document.body.textContent).not.toContain('{"');
    expect(document.body.textContent).not.toContain('sourceMessageId');
    expect(document.body.textContent).not.toContain('generatedAt');
  });

  it('renders an empty low-content summary cleanly with per-section empty states', () => {
    const empty = fallbackSummary({
      summary: 'Mostly casual conversation with no clear decisions or action items.',
      overview: 'Mostly casual conversation with no clear decisions or action items.',
      decisions: [],
      tasks: [],
      questionsForMe: [],
      importantLinks: [],
      waitingOn: [],
      noise: [],
    });
    render(<CatchMeUpCard summary={empty} isLoading={false} isGenerating={false} onCatchMeUp={() => {}} />);

    expect(screen.getByText(/Mostly casual conversation/)).toBeInTheDocument();
    // Empty sections are collapsed by default; expanding them shows the
    // per-section empty state instead of raw/blank content.
    fireEvent.click(screen.getByRole('button', { name: /Decisions Captured/ }));
    expect(screen.getByText('No decisions captured in this range.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tasks Captured/ }));
    expect(screen.getByText('No tasks captured in this range.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Waiting On/ }));
    expect(screen.getByText('Nothing is clearly waiting on someone in this range.')).toBeInTheDocument();
  });

  it('handles malformed summary sections (null arrays) without crashing', () => {
    const malformed = fallbackSummary();
    (malformed as any).tasks = null;
    (malformed as any).waitingOn = undefined;
    render(<CatchMeUpCard summary={malformed} isLoading={false} isGenerating={false} onCatchMeUp={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Tasks Captured/ }));
    expect(screen.getByText('No tasks captured in this range.')).toBeInTheDocument();
  });

  it('shows the error message with a working Retry button', () => {
    const onRetry = vi.fn();
    render(
      <CatchMeUpCard
        summary={null}
        isLoading={false}
        isGenerating={false}
        errorMessage="Summary is temporarily unavailable."
        onRetry={onRetry}
        onCatchMeUp={() => {}}
      />
    );
    expect(screen.getByText('Summary is temporarily unavailable.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables the generate button and shows progress while generating', () => {
    render(<CatchMeUpCard summary={null} isLoading={false} isGenerating onCatchMeUp={() => {}} />);
    const button = screen.getByRole('button', { name: /Generating/ });
    expect(button).toBeDisabled();
  });

  it('refreshing with a replacement summary does not duplicate items', () => {
    const { rerender } = render(
      <CatchMeUpCard summary={fallbackSummary()} isLoading={false} isGenerating={false} onCatchMeUp={() => {}} />
    );
    rerender(
      <CatchMeUpCard summary={fallbackSummary()} isLoading={false} isGenerating={false} onCatchMeUp={() => {}} />
    );
    expect(screen.getAllByText('We will use Xfinity 1Gbps if the price is under $80')).toHaveLength(1);
    // Exactly one Tasks entry and one Waiting On mirror — a refresh replaces
    // the summary rather than appending to it.
    expect(screen.getAllByText('Finalize WiFi by tomorrow', { selector: 'p' })).toHaveLength(2);
  });
});
