import type { ChatIntelligenceSummary } from '@repo/types';
import type { AISummaryContext, AISummaryProvider } from '../ai-summary-service';

function firstMessageId(messages: AISummaryContext['messages']): string {
  return messages[0]?._id || '';
}

function findUrl(messages: AISummaryContext['messages']): { url: string; sourceMessageId: string } | null {
  const urlRegex = /https?:\/\/\S+/i;

  for (const message of messages) {
    const match = message.body.match(urlRegex);
    if (match) {
      return {
        url: match[0],
        sourceMessageId: message._id,
      };
    }
  }

  return null;
}

export function createMockSummaryProvider(): AISummaryProvider {
  return {
    async generateSummary(context: AISummaryContext): Promise<ChatIntelligenceSummary> {
      const sourceMessageIds = context.messages.map((message) => message._id);
      const primaryMessageId = firstMessageId(context.messages);
      const link = findUrl(context.messages);

      const summaryText =
        context.messages.length > 0
          ? 'The group aligned on near-term plans and shared next actions.'
          : 'No recent messages to summarize yet.';

      const lastMessageId = context.messages.at(-1)?._id || '';

      return {
        summary: summaryText,
        overview: summaryText,
        decisions:
          context.messages.length > 0
            ? [
                {
                  title: 'Proceed with the latest discussed plan',
                  status: 'final',
                  sourceMessageIds: primaryMessageId ? [primaryMessageId] : [],
                },
              ]
            : [],
        tasks:
          context.messages.length > 0
            ? [
                {
                  title: 'Follow up on the agreed next step',
                  assignedTo: null,
                  dueDate: null,
                  status: 'pending',
                  sourceMessageId: primaryMessageId,
                },
              ]
            : [],
        questionsForMe: [],
        importantLinks: link
          ? [
              {
                url: link.url,
                label: 'Shared in chat',
                sourceMessageId: link.sourceMessageId,
              },
            ]
          : [],
        waitingOn:
          context.messages.length > 0
            ? [
                {
                  title: 'Confirmation from participants',
                  owner: null,
                  dueDate: null,
                  status: 'waiting',
                  sourceMessageId: primaryMessageId,
                },
              ]
            : [],
        noise:
          context.messages.length >= 2 && lastMessageId
            ? [
                {
                  text: 'Brief side banter unrelated to the main thread.',
                  sourceMessageId: lastMessageId,
                },
              ]
            : [],
        sourceMessageIds,
        generatedAt: new Date().toISOString(),
      };
    },
  };
}
