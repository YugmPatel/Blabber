import type { WaitingOnExtractionResult, WaitingOnItem } from '@repo/types';
import type {
  WaitingOnExtractionContext,
  WaitingOnExtractionProvider,
  WaitingOnParticipant,
} from '../waiting-on-extraction-service';

function participantByName(context: WaitingOnExtractionContext, name: string): WaitingOnParticipant | undefined {
  const normalized = name.toLowerCase();
  return context.participants.find((participant) =>
    participant.name?.toLowerCase().includes(normalized)
  );
}

function actorForMessage(context: WaitingOnExtractionContext, senderId: string, senderName?: string | null) {
  const participant = context.participants.find((item) => item.userId === senderId);
  return {
    userId: senderId,
    name: senderName || participant?.name || undefined,
  };
}

function currentUser(context: WaitingOnExtractionContext) {
  return {
    userId: context.currentUserId,
    name: context.currentUserName || undefined,
  };
}

function titleFromRequest(text: string, addressedName?: string): string {
  const cleaned = text
    .replace(/^[A-Z][a-zA-Z0-9_-]+,\s*/, '')
    .replace(/[?!.]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (/resume feedback/i.test(cleaned)) return `${addressedName || 'Someone'} needs to send resume feedback`;
  if (/backend code/i.test(cleaned)) return `${addressedName || 'Someone'} needs to upload backend code`;
  if (/airbnb payment/i.test(cleaned)) return 'Confirm Airbnb payment';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function dueDateFrom(text: string): string | undefined {
  if (/\bfriday\b/i.test(text)) return 'Friday';
  if (/\btonight\b/i.test(text)) return 'tonight';
  if (/\btomorrow\b/i.test(text)) return 'tomorrow';
  return undefined;
}

export function createMockWaitingOnProvider(): WaitingOnExtractionProvider {
  return {
    async extractWaitingOn(context: WaitingOnExtractionContext): Promise<WaitingOnExtractionResult> {
      const sourceMessageIds = context.messages.map((message) => message._id);
      const waitingOn: WaitingOnItem[] = [];

      for (const message of context.messages) {
        const text = message.body;
        const requester = actorForMessage(context, message.senderId, message.senderName);
        const addressedMatch = text.match(/^([A-Z][a-zA-Z0-9_-]+),\s*(can you|could you|please)\b/i);
        const addressedName = addressedMatch?.[1];
        const addressedParticipant = addressedName ? participantByName(context, addressedName) : undefined;
        const isRequest = /\b(can you|could you|please|send me|upload|confirm|feedback|payment)\b/i.test(text);

        if (!isRequest) continue;

        const addressedCurrentUser =
          addressedParticipant?.userId === context.currentUserId ||
          Boolean(addressedName && context.currentUserName?.toLowerCase().includes(addressedName.toLowerCase()));
        const direction =
          message.senderId !== context.currentUserId && addressedCurrentUser
            ? 'waiting_on_me'
            : 'waiting_on_them';
        const person = addressedParticipant
          ? { userId: addressedParticipant.userId, name: addressedParticipant.name || addressedName }
          : addressedName
            ? { name: addressedName }
            : { name: 'Someone' };
        const owner = direction === 'waiting_on_me' ? currentUser(context) : person;

        waitingOn.push({
          chatId: context.chatId,
          direction,
          title: titleFromRequest(text, addressedName),
          description: text,
          person,
          requester,
          owner,
          status: 'open',
          priority: /\btonight\b|\bfriday\b|\bpayment\b/i.test(text) ? 'medium' : 'low',
          dueDate: dueDateFrom(text),
          confidence: 0.78,
          sourceMessageIds: [message._id],
          sourceText: text.slice(0, 240),
        });
      }

      return {
        chatId: context.chatId,
        summary:
          waitingOn.length > 0
            ? 'The chat contains unresolved requests or follow-ups.'
            : 'No open loops found.',
        waitingOn,
        generatedAt: new Date().toISOString(),
        sourceMessageIds,
      };
    },
  };
}
