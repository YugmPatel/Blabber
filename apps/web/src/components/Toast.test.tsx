import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Toast from './Toast';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders success toast with message', () => {
    const onClose = vi.fn();
    render(<Toast id="1" type="success" message="Success message" onClose={onClose} />);

    expect(screen.getByText('Success message')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders error toast with message', () => {
    const onClose = vi.fn();
    render(<Toast id="1" type="error" message="Error message" onClose={onClose} />);

    expect(screen.getByText('Error message')).toBeInTheDocument();
  });

  it('renders info toast with message', () => {
    const onClose = vi.fn();
    render(<Toast id="1" type="info" message="Info message" onClose={onClose} />);

    expect(screen.getByText('Info message')).toBeInTheDocument();
  });

  it('renders warning toast with message', () => {
    const onClose = vi.fn();
    render(<Toast id="1" type="warning" message="Warning message" onClose={onClose} />);

    expect(screen.getByText('Warning message')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<Toast id="1" type="success" message="Test message" onClose={onClose} />);

    const closeButton = screen.getByLabelText('Close notification');
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledWith('1');
  });

  it('auto-closes after duration', () => {
    const onClose = vi.fn();
    render(
      <Toast id="1" type="success" message="Test message" duration={3000} onClose={onClose} />
    );

    expect(onClose).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3000);

    expect(onClose).toHaveBeenCalledWith('1');
  });

  it('does not auto-close when duration is 0', () => {
    const onClose = vi.fn();
    render(<Toast id="1" type="success" message="Test message" duration={0} onClose={onClose} />);

    vi.advanceTimersByTime(10000);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('has proper ARIA attributes', () => {
    const onClose = vi.fn();
    render(<Toast id="1" type="success" message="Test message" onClose={onClose} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'polite');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
  });

  it('displays correct icon for each type', () => {
    const onClose = vi.fn();
    const { rerender, container } = render(
      <Toast id="1" type="success" message="Test" onClose={onClose} />
    );

    expect(container.querySelector('.text-green-500')).toBeInTheDocument();

    rerender(<Toast id="1" type="error" message="Test" onClose={onClose} />);
    expect(container.querySelector('.text-red-500')).toBeInTheDocument();

    rerender(<Toast id="1" type="info" message="Test" onClose={onClose} />);
    expect(container.querySelector('.text-blue-500')).toBeInTheDocument();

    rerender(<Toast id="1" type="warning" message="Test" onClose={onClose} />);
    expect(container.querySelector('.text-yellow-500')).toBeInTheDocument();
  });
});
