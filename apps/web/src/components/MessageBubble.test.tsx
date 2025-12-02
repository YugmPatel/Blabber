import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('renders with blue background when sent by me', () => {
    const { container } = render(<MessageBubble message={mockMessage} isSentByMe={true} />);
    const bubble = container.querySelector('.bg-blue-500');
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
    const avatar = container.querySelector('.relative.inline-block');
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
    expect(screen.getByText('Document')).toBeInTheDocument();
  });

  it('renders formatted time', () => {
    render(<MessageBubble message={mockMessage} isSentByMe={false} />);
    // Time format will vary by locale, just check it exists
    const timeElement = screen.getByText(/\d{1,2}:\d{2}/);
    expect(timeElement).toBeInTheDocument();
  });
});
