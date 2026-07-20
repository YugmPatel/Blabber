import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActionForm } from './ChatActionsPanel';

describe('ActionForm', () => {
  it('allows an evidence-backed group Action to remain unassigned when owner is optional', () => {
    const onUpdate = vi.fn();
    const onCancel = vi.fn();

    render(
      <ActionForm
        action={{
          id: 'pending-summary-task',
          chatId: 'chat-1',
          type: 'task',
          title: 'Check parking',
          status: 'open',
          sourceMessageIds: ['message-1'],
        }}
        ownerOptions={[{ userId: 'user-1', name: 'Yugm' }]}
        isSaving={false}
        ownerOptional
        onCancel={onCancel}
        onUpdate={onUpdate}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onUpdate).toHaveBeenCalledWith('pending-summary-task', expect.objectContaining({
      title: 'Check parking',
      ownerUserId: undefined,
      ownerName: undefined,
    }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps normal manual Actions owner-required', () => {
    const onCreate = vi.fn();

    render(
      <ActionForm
        ownerOptions={[{ userId: 'user-1', name: 'Yugm' }]}
        isSaving={false}
        onCancel={() => {}}
        onCreate={onCreate}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Action title'), {
      target: { value: 'Upload lease document tonight' },
    });

    expect(screen.getByText('Choose an owner before creating this Action.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });
});
