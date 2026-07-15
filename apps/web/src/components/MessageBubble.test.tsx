import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MessageBubble from './MessageBubble';
import type { Message } from '@repo/types';

const mockMessage: Message = {
  _id: '1',
  chatId: 'chat1',
  senderId: 'user1',
  body: 'Hello, world!',
  reactions: [],
  status: 'sent',
  deletedFor: [],
  createdAt: new Date('2024-01-15T10:30:00'),
};

describe('MessageBubble', () => {
  it('renders message body', () => {
    render(<MessageBubble message={mockMessage} isSentByMe={false} />);
    expect(screen.getByText('Hello, world!')).toBeInTheDocument();
  });

  it('renders with mint background when sent by me', () => {
    const { container } = render(<MessageBubble message={mockMessage} isSentByMe={true} />);
    const bubble = container.querySelector('.bg-teal-50');
    expect(bubble).toBeInTheDocument();
  });

  it('renders with white background when not sent by me', () => {
    const { container } = render(<MessageBubble message={mockMessage} isSentByMe={false} />);
    const bubble = container.querySelector('.bg-white');
    expect(bubble).toBeInTheDocument();
  });

  it('renders sender name when provided', () => {
    render(<MessageBubble message={mockMessage} isSentByMe={false} senderName="Alice" />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('does not render sender name for own messages', () => {
    render(<MessageBubble message={mockMessage} isSentByMe={true} senderName="Alice" />);
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('renders avatar when showAvatar is true', () => {
    const { container } = render(
      <MessageBubble
        message={mockMessage}
        isSentByMe={false}
        showAvatar={true}
        senderName="Alice"
      />
    );
    // Check that avatar container is rendered
    const avatar = container.querySelector('.relative.inline-flex');
    expect(avatar).toBeInTheDocument();
  });

  it('renders edited indicator when message is edited', () => {
    const editedMessage = { ...mockMessage, editedAt: new Date() };
    render(<MessageBubble message={editedMessage} isSentByMe={false} />);
    expect(screen.getByText('(edited)')).toBeInTheDocument();
  });

  it('renders reply preview when message has replyTo', () => {
    const messageWithReply: Message = {
      ...mockMessage,
      replyTo: {
        messageId: '0',
        body: 'Original message',
        senderId: 'user2',
      },
    };
    render(<MessageBubble message={messageWithReply} isSentByMe={false} />);
    expect(screen.getByText('Replying to')).toBeInTheDocument();
    expect(screen.getByText('Original message')).toBeInTheDocument();
  });

  it('renders reactions when present', () => {
    const messageWithReactions: Message = {
      ...mockMessage,
      reactions: [
        { userId: 'user2', emoji: '👍', createdAt: new Date() },
        { userId: 'user3', emoji: '👍', createdAt: new Date() },
        { userId: 'user4', emoji: '❤️', createdAt: new Date() },
      ],
    };
    render(<MessageBubble message={messageWithReactions} isSentByMe={false} />);
    expect(screen.getByText('👍')).toBeInTheDocument();
    expect(screen.getByText('❤️')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // Count for 👍
  });

  it('renders image media', () => {
    const messageWithImage: Message = {
      ...mockMessage,
      media: {
        type: 'image',
        url: 'https://example.com/image.jpg',
        thumbnailUrl: 'https://example.com/thumb.jpg',
      },
    };
    render(<MessageBubble message={messageWithImage} isSentByMe={false} />);
    const img = screen.getByAltText('Shared image');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/thumb.jpg');
  });

  it('renders audio media', () => {
    const messageWithAudio: Message = {
      ...mockMessage,
      media: {
        type: 'audio',
        url: 'https://example.com/audio.mp3',
        duration: 120,
      },
    };
    render(<MessageBubble message={messageWithAudio} isSentByMe={false} />);
    expect(screen.getByText('120s')).toBeInTheDocument();
  });

  it('renders document media', () => {
    const messageWithDoc: Message = {
      ...mockMessage,
      media: {
        type: 'document',
        url: 'https://example.com/doc.pdf',
      },
    };
    render(<MessageBubble message={messageWithDoc} isSentByMe={false} />);
    expect(screen.getAllByText('Document')).not.toHaveLength(0);
  });

  it('labels a PPTX document attachment with its specific type', () => {
    const messageWithPptx: Message = {
      ...mockMessage,
      media: {
        type: 'document',
        url: 'https://example.com/deck.pptx',
        fileName: 'deck.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      },
    };
    render(<MessageBubble message={messageWithPptx} isSentByMe={false} />);
    expect(screen.getByText(/PPTX/)).toBeInTheDocument();
  });

  it('renders a playable video element for video media', () => {
    const messageWithVideo: Message = {
      ...mockMessage,
      media: {
        type: 'video',
        url: 'https://example.com/clip.mp4',
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
      },
    };
    const { container } = render(<MessageBubble message={messageWithVideo} isSentByMe={false} />);
    const video = container.querySelector('video');
    expect(video).toBeInTheDocument();
    const source = container.querySelector('video source');
    expect(source).toHaveAttribute('src', 'https://example.com/clip.mp4');
    expect(source).toHaveAttribute('type', 'video/mp4');
  });

  it('shows a no-preview card instead of a broken image for HEIC media', () => {
    const messageWithHeic: Message = {
      ...mockMessage,
      media: {
        type: 'image',
        url: 'https://example.com/photo.heic',
        fileName: 'IMG_1234.heic',
        mimeType: 'image/heic',
      },
    };
    render(<MessageBubble message={messageWithHeic} isSentByMe={false} />);
    expect(screen.queryByAltText('Shared image')).not.toBeInTheDocument();
    expect(screen.getByText(/Preview not available for this format/)).toBeInTheDocument();
    expect(screen.getByText('IMG_1234.heic')).toBeInTheDocument();
  });

  it('renders formatted time', () => {
    render(<MessageBubble message={mockMessage} isSentByMe={false} />);
    // Time format will vary by locale, just check it exists
    const timeElement = screen.getByText(/\d{1,2}:\d{2}/);
    expect(timeElement).toBeInTheDocument();
  });

  it('shows poll voter names when show voters is enabled', () => {
    const pollMessage: Message = {
      ...mockMessage,
      type: 'poll',
      body: 'Lunch?',
      poll: {
        question: 'Lunch?',
        options: [
          { id: 'option-1', text: 'Pizza', votes: ['user2'], voteCount: 1 },
          { id: 'option-2', text: 'Sushi', votes: [], voteCount: 0 },
        ],
        allowMultiple: false,
        allowVoteChanges: true,
        showVoters: true,
        currentUserVote: [],
        votes: [
          {
            userId: 'user2',
            optionIds: ['option-1'],
            votedAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    };

    render(
      <MessageBubble
        message={pollMessage}
        isSentByMe={false}
        getUserName={(userId) => (userId === 'user2' ? 'Alice' : userId)}
      />
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('hides poll voter names when show voters is disabled', () => {
    const pollMessage: Message = {
      ...mockMessage,
      type: 'poll',
      body: 'Lunch?',
      poll: {
        question: 'Lunch?',
        options: [
          { id: 'option-1', text: 'Pizza', votes: ['user2'], voteCount: 1 },
          { id: 'option-2', text: 'Sushi', votes: [], voteCount: 0 },
        ],
        allowMultiple: false,
        allowVoteChanges: true,
        showVoters: false,
        currentUserVote: [],
      },
    };

    render(
      <MessageBubble
        message={pollMessage}
        isSentByMe={false}
        getUserName={(userId) => (userId === 'user2' ? 'Alice' : userId)}
      />
    );

    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('submits multiple poll options when multiple choice is enabled', () => {
    const onPollVote = vi.fn();
    const pollMessage: Message = {
      ...mockMessage,
      type: 'poll',
      body: 'Lunch?',
      poll: {
        question: 'Lunch?',
        options: [
          { id: 'option-1', text: 'Pizza', votes: [], voteCount: 1 },
          { id: 'option-2', text: 'Sushi', votes: [], voteCount: 0 },
        ],
        allowMultiple: true,
        allowVoteChanges: true,
        showVoters: false,
        currentUserVote: ['option-1'],
      },
    };

    render(<MessageBubble message={pollMessage} isSentByMe={false} onPollVote={onPollVote} />);
    fireEvent.click(screen.getByRole('button', { name: /Sushi/i }));

    expect(onPollVote).toHaveBeenCalledWith('1', ['option-1', 'option-2']);
  });

  it('does not allow a poll vote change when vote changes are disabled', () => {
    const onPollVote = vi.fn();
    const pollMessage: Message = {
      ...mockMessage,
      type: 'poll',
      body: 'Lunch?',
      poll: {
        question: 'Lunch?',
        options: [
          { id: 'option-1', text: 'Pizza', votes: [], voteCount: 1 },
          { id: 'option-2', text: 'Sushi', votes: [], voteCount: 0 },
        ],
        allowMultiple: false,
        allowVoteChanges: false,
        showVoters: false,
        currentUserVote: ['option-1'],
      },
    };

    render(<MessageBubble message={pollMessage} isSentByMe={false} onPollVote={onPollVote} />);
    fireEvent.click(screen.getByRole('button', { name: /Sushi/i }));

    expect(onPollVote).not.toHaveBeenCalled();
  });

  it('renders rich Moment reply context', () => {
    const momentReplyMessage: Message = {
      ...mockMessage,
      body: 'Looks good',
      momentReply: {
        isMomentReply: true,
        label: 'Replied to a Moment',
        momentId: 'moment-1',
        authorName: 'Deva',
        momentType: 'audio',
        text: 'Voice update from campus',
      },
    };

    render(<MessageBubble message={momentReplyMessage} isSentByMe={false} />);

    expect(screen.getByText('Replied to a Moment')).toBeInTheDocument();
    expect(screen.getByText('Deva · Audio Moment')).toBeInTheDocument();
    expect(screen.getByText('Voice update from campus')).toBeInTheDocument();
  });
});
