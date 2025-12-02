import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReadReceipts from './ReadReceipts';

describe('ReadReceipts', () => {
  it('renders nothing when message is not sent by me', () => {
    const { container } = render(<ReadReceipts status="sent" isSentByMe={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders single checkmark for sent status', () => {
    render(<ReadReceipts status="sent" isSentByMe={true} />);
    const checkmark = screen.getByLabelText('Sent');
    expect(checkmark).toBeInTheDocument();
    expect(checkmark).toHaveClass('text-gray-400');
  });

  it('renders double checkmark for delivered status', () => {
    render(<ReadReceipts status="delivered" isSentByMe={true} />);
    const checkmark = screen.getByLabelText('Delivered');
    expect(checkmark).toBeInTheDocument();
    expect(checkmark).toHaveClass('text-gray-400');
  });

  it('renders blue double checkmark for read status', () => {
    render(<ReadReceipts status="read" isSentByMe={true} />);
    const checkmark = screen.getByLabelText('Read');
    expect(checkmark).toBeInTheDocument();
    expect(checkmark).toHaveClass('text-blue-500');
  });
});
