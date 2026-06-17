import type { ChatActionExtractionResult, ChatActionItem } from '@repo/types';
import type { ActionExtractionContext, ActionExtractionProvider } from '../action-extraction-service';

function findParticipantByName(context: ActionExtractionContext, name: string) {
  const normalized = name.toLowerCase();
  return context.participants.find((participant) => participant.name?.toLowerCase().includes(normalized));
}

function actorForMessage(context: ActionExtractionContext, senderId: string, senderName?: string | null) {
  return {
    userId: senderId,
    name: senderName || context.participants.find((participant) => participant.userId === senderId)?.name || undefined,
  };
}

export function createMockActionProvider(): ActionExtractionProvider {
  return {
    async extractActions(context: ActionExtractionContext): Promise<ChatActionExtractionResult> {
      const sourceMessageIds = context.messages.map((message) => message._id);
      const actions: ChatActionItem[] = [];

      for (const message of context.messages) {
        const text = message.body;
        const lower = text.toLowerCase();
        const createdBy = actorForMessage(context, message.senderId, message.senderName);

        if (/\bmeet\b|\bmeeting\b|\bat\s+\d{1,2}/i.test(text)) {
          actions.push({
            chatId: context.chatId,
            type: 'event',
            title: lower.includes('friday') ? 'Meet Friday at 7' : 'Meeting from chat',
            eventStart: lower.includes('friday') ? 'Friday at 7' : undefined,
            status: 'pending',
            priority: 'medium',
            confidence: 0.78,
            sourceMessageIds: [message._id],
            createdBy,
          });
        }

        if (/\bi('|’)ll\b|\bi will\b/i.test(text) && /\bbook\b/i.test(text)) {
          actions.push({
            chatId: context.chatId,
            type: 'task',
            title: 'Book the table',
            assignedTo: createdBy,
            createdBy,
            dueDate: lower.includes('friday') ? 'Friday' : undefined,
            status: 'pending',
            priority: 'medium',
            confidence: 0.84,
            sourceMessageIds: [message._id],
          });
        }

        const bringMatch = text.match(/\b([A-Z][a-zA-Z0-9_-]+)\s+can\s+bring\s+(?:the\s+)?([^.!?]+)/);
        if (bringMatch) {
          const participant = findParticipantByName(context, bringMatch[1]);
          actions.push({
            chatId: context.chatId,
            type: 'task',
            title: `Bring ${bringMatch[2].trim()}`,
            assignedTo: participant
              ? { userId: participant.userId, name: participant.name || bringMatch[1] }
              : { name: bringMatch[1] },
            createdBy,
            dueDate: lower.includes('friday') ? 'Friday' : undefined,
            status: 'pending',
            priority: 'medium',
            confidence: 0.82,
            sourceMessageIds: [message._id],
          });
        }

        if (/\bplease\b|\bcan you\b|\bcould you\b/i.test(text)) {
          actions.push({
            chatId: context.chatId,
            type: 'request',
            title: text.replace(/[.!?]+$/, '').slice(0, 80),
            createdBy,
            status: 'pending',
            priority: 'medium',
            confidence: 0.72,
            sourceMessageIds: [message._id],
          });
        }
      }

      return {
        chatId: context.chatId,
        summary:
          actions.length > 0
            ? 'The chat contains plans, responsibilities, or follow-ups.'
            : 'No actionable items found.',
        actions,
        generatedAt: new Date().toISOString(),
        sourceMessageIds,
      };
    },
  };
}
