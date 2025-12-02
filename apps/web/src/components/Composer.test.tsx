import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from './Composer';
import { useSendMessage } from '@/hooks/useSendMessage';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useAppStore } from '@/store/app-store';

// Mock hooks
vi.mock('@/hooks/useSendMessage');
vi.mock('@/hooks/useFileUpload');
vi.mock('@/store/app-store');

describe('Composer', () => {
  const mockSendMessage = vi.fn();
  const mockUploadFile = vi.fn();
  const mockSocketEmit = vi.fn();
  const mockSocket = { emit: mockSocketEmit };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock useSendMessage
    vi.mocked(useSendMessage).mockReturnValue({
      sendMessage: mockSendMessage,
    });

    // Mock useFileUpload
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFile: mockUploadFile,
      isUploading: false,
      uploadProgress: null,
      error: null,
      reset: vi.fn(),
    });

    // Mock useAppStore
    vi.mocked(useAppStore).mockReturnValue(mockSocket as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders composer with input and buttons', () => {
    render(<Composer chatId="chat-1" />);

    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
    expect(screen.getByLabelText('Add emoji')).toBeInTheDocument();
    expect(screen.getByLabelText('Attach file')).toBeInTheDocument();
    expect(screen.getByLabelText('Send message')).toBeInTheDocument();
  });

  it('sends message when send button is clicked', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const input = screen.getByPlaceholderText('Type a message...');
    const sendButton = screen.getByLabelText('Send message');

    await user.type(input, 'Hello world');
    await user.click(sendButton);

    expect(mockSendMessage).toHaveBeenCalledWith({
      chatId: 'chat-1',
      body: 'Hello world',
      replyToId: undefined,
    });
  });

  it('sends message when Enter key is pressed', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const input = screen.getByPlaceholderText('Type a message...');

    await user.type(input, 'Hello world{Enter}');

    expect(mockSendMessage).toHaveBeenCalledWith({
      chatId: 'chat-1',
      body: 'Hello world',
      replyToId: undefined,
    });
  });

  it('does not send message when Shift+Enter is pressed', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const input = screen.getByPlaceholderText('Type a message...');

    await user.type(input, 'Line 1{Shift>}{Enter}{/Shift}Line 2');

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(input).toHaveValue('Line 1\nLine 2');
  });

  it('does not send empty messages', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const sendButton = screen.getByLabelText('Send message');

    await user.click(sendButton);

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('trims whitespace from messages', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const input = screen.getByPlaceholderText('Type a message...');
    const sendButton = screen.getByLabelText('Send message');

    await user.type(input, '  Hello world  ');
    await user.click(sendButton);

    expect(mockSendMessage).toHaveBeenCalledWith({
      chatId: 'chat-1',
      body: 'Hello world',
      replyToId: undefined,
    });
  });

  it('clears input after sending message', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const input = screen.getByPlaceholderText('Type a message...');

    await user.type(input, 'Hello world{Enter}');

    await waitFor(() => {
      expect(input).toHaveValue('');
    });
  });

  it('shows emoji picker when emoji button is clicked', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const emojiButton = screen.getByLabelText('Add emoji');
    await user.click(emojiButton);

    expect(screen.getByText('Smileys')).toBeInTheDocument();
    expect(screen.getByText('Hearts')).toBeInTheDocument();
  });

  it('inserts emoji into message', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const input = screen.getByPlaceholderText('Type a message...');
    const emojiButton = screen.getByLabelText('Add emoji');

    await user.type(input, 'Hello ');
    await user.click(emojiButton);

    // Click on an emoji (😀)
    const emoji = screen.getByText('😀');
    await user.click(emoji);

    expect(input).toHaveValue('Hello 😀');
  });

  it('closes emoji picker after selecting emoji', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const emojiButton = screen.getByLabelText('Add emoji');
    await user.click(emojiButton);

    const emoji = screen.getByText('😀');
    await user.click(emoji);

    await waitFor(() => {
      expect(screen.queryByText('Smileys')).not.toBeInTheDocument();
    });
  });

  it('shows reply preview when replyToId is provided', () => {
    render(<Composer chatId="chat-1" replyToId="msg-1" />);

    expect(screen.getByText('Replying to message')).toBeInTheDocument();
    expect(screen.getByLabelText('Cancel reply')).toBeInTheDocument();
  });

  it('calls onCancelReply when cancel button is clicked', async () => {
    const user = userEvent.setup();
    const mockOnCancelReply = vi.fn();

    render(<Composer chatId="chat-1" replyToId="msg-1" onCancelReply={mockOnCancelReply} />);

    const cancelButton = screen.getByLabelText('Cancel reply');
    await user.click(cancelButton);

    expect(mockOnCancelReply).toHaveBeenCalled();
  });

  it('includes replyToId when sending message', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" replyToId="msg-1" />);

    const input = screen.getByPlaceholderText('Type a message...');
    await user.type(input, 'Reply message{Enter}');

    expect(mockSendMessage).toHaveBeenCalledWith({
      chatId: 'chat-1',
      body: 'Reply message',
      replyToId: 'msg-1',
    });
  });

  it('triggers file upload when file is selected', async () => {
    const user = userEvent.setup();
    mockUploadFile.mockResolvedValue('media-123');

    render(<Composer chatId="chat-1" />);

    const fileInput = screen.getByLabelText('Attach file').nextElementSibling as HTMLInputElement;
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(file);
    });
  });

  it('sends message with mediaId after successful upload', async () => {
    const user = userEvent.setup();
    mockUploadFile.mockResolvedValue('media-123');

    render(<Composer chatId="chat-1" />);

    const input = screen.getByPlaceholderText('Type a message...');
    await user.type(input, 'Check this out');

    const fileInput = screen.getByLabelText('Attach file').nextElementSibling as HTMLInputElement;
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        chatId: 'chat-1',
        body: 'Check this out',
        mediaId: 'media-123',
        replyToId: undefined,
      });
    });
  });

  it('shows upload progress during file upload', () => {
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFile: mockUploadFile,
      isUploading: true,
      uploadProgress: { loaded: 50, total: 100, percentage: 50 },
      error: null,
      reset: vi.fn(),
    });

    render(<Composer chatId="chat-1" />);

    expect(screen.getByText('Uploading...')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('disables input during file upload', () => {
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFile: mockUploadFile,
      isUploading: true,
      uploadProgress: { loaded: 50, total: 100, percentage: 50 },
      error: null,
      reset: vi.fn(),
    });

    render(<Composer chatId="chat-1" />);

    const input = screen.getByPlaceholderText('Type a message...');
    const sendButton = screen.getByLabelText('Send message');

    expect(input).toBeDisabled();
    expect(sendButton).toBeDisabled();
  });

  it('emits typing:start when user starts typing', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const input = screen.getByPlaceholderText('Type a message...');
    await user.type(input, 'H');

    expect(mockSocketEmit).toHaveBeenCalledWith('typing:start', { chatId: 'chat-1' });
  });

  it('handles textarea value changes', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;

    await user.type(textarea, 'Test message');

    expect(textarea.value).toBe('Test message');
  });
});
