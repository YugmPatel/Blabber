import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GroupBrainPanel from './GroupBrainPanel';
import type { GroupBrainAnswer } from '@repo/types';

function answer(overrides: Partial<GroupBrainAnswer> = {}): GroupBrainAnswer {
  return {
    question: 'What did we decide?',
    answer: 'Decision: use Xfinity if the price is under $80.',
    answerState: 'grounded',
    answerCategory: 'decision',
    confidence: 'grounded',
    sourceMessageIds: ['m1'],
    sources: [{
      messageId: 'm1',
      chatId: 'chat-1',
      senderId: 'u1',
      senderDisplayName: 'Yugm',
      createdAt: new Date('2026-07-20T10:00:00.000Z').toISOString(),
      snippet: 'Decision: use Xfinity if the price is under $80.',
    }],
    sourceDates: [new Date('2026-07-20T10:00:00.000Z').toISOString()],
    ...overrides,
  };
}

describe('GroupBrainPanel', () => {
  it('shows loading state and clears it after a grounded answer', async () => {
    const onAsk = vi.fn(async () => answer());
    render(<GroupBrainPanel isAsking={false} onAsk={onAsk} />);

    fireEvent.change(screen.getByPlaceholderText('Ask Group Brain anything...'), {
      target: { value: 'What did we decide?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Group Brain' }));

    expect(screen.getByText('Looking for relevant group evidence...')).toBeInTheDocument();
    expect(await screen.findByText('Decision: use Xfinity if the price is under $80.')).toBeInTheDocument();
    expect(screen.queryByText('Looking for relevant group evidence...')).not.toBeInTheDocument();
    expect(onAsk).toHaveBeenCalledWith('What did we decide?');
  });

  it('retries a failed question in place and clears the old error', async () => {
    const onAsk = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(answer({ answer: 'Recovered answer from group messages.' }));
    render(<GroupBrainPanel isAsking={false} onAsk={onAsk} />);

    fireEvent.change(screen.getByPlaceholderText('Ask Group Brain anything...'), {
      target: { value: 'What is pending?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Group Brain' }));

    expect(await screen.findByText('Group Brain could not answer that right now. Try again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Recovered answer from group messages.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Group Brain could not answer that right now. Try again.')).not.toBeInTheDocument();
    });
    expect(screen.getAllByText('What is pending?')).toHaveLength(1);
    expect(onAsk).toHaveBeenCalledTimes(2);
  });

  it('renders malicious HTML from an answer as text, not executable markup', async () => {
    render(
      <GroupBrainPanel
        isAsking={false}
        onAsk={async () => answer({ answer: '<img src=x onerror=alert(1)> Decision: use Xfinity' })}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Ask Group Brain anything...'), {
      target: { value: 'What did we decide?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Group Brain' }));

    expect(await screen.findByText('<img src=x onerror=alert(1)> Decision: use Xfinity')).toBeInTheDocument();
    expect(document.body.querySelector('img')).toBeNull();
  });
});
