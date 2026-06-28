import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Avatar from './Avatar';

describe('Avatar', () => {
  it('renders with image when src is provided', () => {
    render(<Avatar src="https://example.com/avatar.jpg" alt="User Avatar" />);
    const img = screen.getByAltText('User Avatar');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg');
  });

  it('renders default icon when no src is provided', () => {
    render(<Avatar alt="User Avatar" />);
    expect(screen.getByText('UA')).toBeInTheDocument();
  });

  it('renders online indicator when online is true', () => {
    const { container } = render(<Avatar alt="User Avatar" online={true} />);
    const indicator = container.querySelector('.bg-emerald-500');
    expect(indicator).toBeInTheDocument();
  });

  it('renders offline indicator when online is false', () => {
    const { container } = render(<Avatar alt="User Avatar" online={false} />);
    const indicator = container.querySelector('.bg-slate-400');
    expect(indicator).toBeInTheDocument();
  });

  it('does not render indicator when online is undefined', () => {
    const { container } = render(<Avatar alt="User Avatar" />);
    const indicator = container.querySelector('.absolute.bottom-0.right-0');
    expect(indicator).not.toBeInTheDocument();
  });

  it('applies correct size classes', () => {
    const { container, rerender } = render(<Avatar alt="User Avatar" size="sm" />);
    expect(container.querySelector('.h-8.w-8')).toBeInTheDocument();

    rerender(<Avatar alt="User Avatar" size="md" />);
    expect(container.querySelector('.h-10.w-10')).toBeInTheDocument();

    rerender(<Avatar alt="User Avatar" size="lg" />);
    expect(container.querySelector('.h-12.w-12')).toBeInTheDocument();
  });
});
