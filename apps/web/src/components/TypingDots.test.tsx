import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TypingDots from './TypingDots';

describe('TypingDots', () => {
  it('renders nothing when no users are typing', () => {
    const { container } = render(<TypingDots userNames={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders single user typing message', () => {
    render(<TypingDots userNames={['Alice']} />);
    expect(screen.getByText('Alice is typing')).toBeInTheDocument();
  });

  it('renders two users typing message', () => {
    render(<TypingDots userNames={['Alice', 'Bob']} />);
    expect(screen.getByText('Alice and Bob are typing')).toBeInTheDocument();
  });

  it('renders multiple users typing message', () => {
    render(<TypingDots userNames={['Alice', 'Bob', 'Charlie']} />);
    expect(screen.getByText('Alice and 2 others are typing')).toBeInTheDocument();
  });

  it('renders animated dots', () => {
    const { container } = render(<TypingDots userNames={['Alice']} />);
    const dots = container.querySelectorAll('.animate-bounce');
    expect(dots).toHaveLength(3);
  });
});
