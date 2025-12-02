import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from './ToastContainer';

// Test component that uses the toast hook
function TestComponent() {
  const toast = useToast();

  return (
    <div>
      <button onClick={() => toast.success('Success!')}>Show Success</button>
      <button onClick={() => toast.error('Error!')}>Show Error</button>
      <button onClick={() => toast.info('Info!')}>Show Info</button>
      <button onClick={() => toast.warning('Warning!')}>Show Warning</button>
    </div>
  );
}

describe('ToastContainer', () => {
  it('throws error when useToast is used outside provider', () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useToast must be used within ToastProvider');

    consoleSpy.mockRestore();
  });

  it('provides toast context to children', () => {
    const { getByText } = render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    // Verify buttons are rendered (context is working)
    expect(getByText('Show Success')).toBeInTheDocument();
    expect(getByText('Show Error')).toBeInTheDocument();
    expect(getByText('Show Info')).toBeInTheDocument();
    expect(getByText('Show Warning')).toBeInTheDocument();
  });

  it('renders toast container with proper ARIA attributes', () => {
    const { container } = render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    const toastContainer = container.querySelector('[aria-live="polite"]');
    expect(toastContainer).toBeInTheDocument();
    expect(toastContainer).toHaveAttribute('aria-atomic', 'false');
  });
});
