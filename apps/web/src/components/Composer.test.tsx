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

// VoiceRecorder itself needs real browser MediaRecorder/getUserMedia APIs
// that jsdom doesn't provide — stand in with a button that immediately
// invokes onSend, so these tests exercise Composer's own upload+send
// handling (handleVoiceSend) rather than the recording UI.
vi.mock('./VoiceRecorder', () => ({
  default: ({ onSend }: { onSend: (blob: Blob, duration: number) => void | Promise<void> }) => (
    <button onClick={() => onSend(new Blob(['fake-audio'], { type: 'audio/webm' }), 5)}>
      Send test audio
    </button>
  ),
}));

describe('Composer', () => {
  const mockSendMessage = vi.fn();
  const mockUploadFile = vi.fn();
  const mockSocketEmit = vi.fn();
  const mockSocket = { emit: mockSocketEmit };
  const messagePlaceholder = /type a message/i;

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

    expect(screen.getByPlaceholderText(messagePlaceholder)).toBeInTheDocument();
    expect(screen.getByLabelText('Add emoji')).toBeInTheDocument();
    expect(screen.getByLabelText('Open composer actions')).toBeInTheDocument();
    expect(screen.getByLabelText('Voice message')).toBeInTheDocument();
  });

  it('sends message when send button is clicked', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const input = screen.getByPlaceholderText(messagePlaceholder);

    await user.type(input, 'Hello world');
    const sendButton = screen.getByLabelText('Send message');
    await user.click(sendButton);

    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-1',
      body: 'Hello world',
      replyToId: undefined,
    }));
  });

  it('sends message when Enter key is pressed', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const input = screen.getByPlaceholderText(messagePlaceholder);

    await user.type(input, 'Hello world{Enter}');

    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-1',
      body: 'Hello world',
      replyToId: undefined,
    }));
  });

  it('does not send message when Shift+Enter is pressed', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const input = screen.getByPlaceholderText(messagePlaceholder);

    await user.type(input, 'Line 1{Shift>}{Enter}{/Shift}Line 2');

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(input).toHaveValue('Line 1\nLine 2');
  });

  it('does not send empty messages', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    expect(screen.queryByLabelText('Send message')).not.toBeInTheDocument();

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('trims whitespace from messages', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const input = screen.getByPlaceholderText(messagePlaceholder);

    await user.type(input, '  Hello world  ');
    const sendButton = screen.getByLabelText('Send message');
    await user.click(sendButton);

    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-1',
      body: 'Hello world',
      replyToId: undefined,
    }));
  });

  it('clears input after sending message', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const input = screen.getByPlaceholderText(messagePlaceholder);

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

    const input = screen.getByPlaceholderText(messagePlaceholder);
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

    const input = screen.getByPlaceholderText(messagePlaceholder);
    await user.type(input, 'Reply message{Enter}');

    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-1',
      body: 'Reply message',
      replyToId: 'msg-1',
    }));
  });

  it('triggers file upload when file is selected', async () => {
    const user = userEvent.setup();
    mockUploadFile.mockResolvedValue('media-123');

    render(<Composer chatId="chat-1" />);

    const fileInput = document.querySelector('input[accept="image/*"]') as HTMLInputElement;
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

    const input = screen.getByPlaceholderText(messagePlaceholder);
    await user.type(input, 'Check this out');

    const fileInput = document.querySelector('input[accept="image/*"]') as HTMLInputElement;
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        chatId: 'chat-1',
        body: 'Check this out',
        mediaId: 'media-123',
        mediaKind: 'image',
        replyToId: undefined,
      }));
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

    expect(screen.getByText('Uploading…')).toBeInTheDocument();
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

    const input = screen.getByPlaceholderText(messagePlaceholder);

    expect(input).toBeDisabled();
    expect(screen.getByLabelText('Voice message')).toBeDisabled();
  });

  it('uploads and sends a voice message, then returns to the normal composer', async () => {
    const user = userEvent.setup();
    mockUploadFile.mockResolvedValueOnce('media-audio-1');

    render(<Composer chatId="chat-1" />);

    await user.click(screen.getByLabelText('Voice message'));
    await user.click(await screen.findByText('Send test audio'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: 'chat-1',
          mediaId: 'media-audio-1',
          mediaKind: 'audio',
          mediaDuration: 5,
        })
      );
    });

    // Success: back to the normal composer, no lingering error notice.
    expect(screen.getByPlaceholderText(messagePlaceholder)).toBeInTheDocument();
    expect(screen.queryByText(/audio upload failed/i)).not.toBeInTheDocument();
  });

  it('shows a clear failure notice and does not send when the audio upload fails', async () => {
    const user = userEvent.setup();
    mockUploadFile.mockResolvedValueOnce(null);
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFile: mockUploadFile,
      isUploading: false,
      uploadProgress: null,
      error: 'Upload rejected: mime_mismatch',
      reset: vi.fn(),
    });

    render(<Composer chatId="chat-1" />);

    await user.click(screen.getByLabelText('Voice message'));
    await user.click(await screen.findByText('Send test audio'));

    await waitFor(() => {
      expect(screen.getByText(/audio upload failed/i)).toBeInTheDocument();
    });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('emits typing:start when user starts typing', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const input = screen.getByPlaceholderText(messagePlaceholder);
    await user.type(input, 'H');

    expect(mockSocketEmit).toHaveBeenCalledWith('typing:start', { chatId: 'chat-1' });
  });

  it('handles textarea value changes', async () => {
    const user = userEvent.setup();
    render(<Composer chatId="chat-1" />);

    const textarea = screen.getByPlaceholderText(messagePlaceholder) as HTMLTextAreaElement;

    await user.type(textarea, 'Test message');

    expect(textarea.value).toBe('Test message');
  });
});
