import type { NavigateFunction } from 'react-router-dom';
import type { SourceReference } from '@repo/types';

type SourceJumpTarget = Pick<SourceReference, 'chatId' | 'messageId'>;

export function canJumpToSource(source?: Partial<SourceJumpTarget> | null): source is SourceJumpTarget {
  return Boolean(source?.chatId && source?.messageId);
}

export function sourceJumpPath(source: SourceJumpTarget): string {
  return `/chats/${source.chatId}?message=${encodeURIComponent(source.messageId)}`;
}

export function navigateToSource(navigate: NavigateFunction, source: SourceJumpTarget): void {
  navigate(sourceJumpPath(source));
}
