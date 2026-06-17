import type { ChatDecision, DecisionExtractionResult } from '@repo/types';
import type {
  DecisionExtractionContext,
  DecisionExtractionProvider,
} from '../decision-extraction-service';

const DECISION_PATTERNS = [
  /\bdecided to\s+([^.!?]+)/i,
  /\bagreed to\s+([^.!?]+)/i,
  /\bchose\s+([^.!?]+)/i,
  /\bpicked\s+([^.!?]+)/i,
  /\bfinal(?:ized)?\s+(?:on\s+)?([^.!?]+)/i,
  /\bgo with\s+([^.!?]+)/i,
];

function actorForMessage(context: DecisionExtractionContext, senderId: string, senderName?: string | null) {
  return {
    userId: senderId,
    name:
      senderName ||
      context.participants.find((participant) => participant.userId === senderId)?.name ||
      undefined,
  };
}

function titleFromMatch(text: string, matched: string): string {
  const trimmed = matched.trim().replace(/^the\s+/i, '').replace(/\s+/g, ' ');
  if (/react/i.test(text) && /front/i.test(text)) return 'Use React for frontend';
  if (/luigi/i.test(text)) return "Dinner at Luigi's";
  if (/airbnb/i.test(text) && /option\s*2/i.test(text)) return 'Choose Airbnb option 2';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function categoryForText(text: string): ChatDecision['category'] {
  if (/\breact\b|\bfrontend\b|\bapi\b|\btech/i.test(text)) return 'technical';
  if (/\brent\b|\bbudget\b|\bcost\b|\bprice\b/i.test(text)) return 'financial';
  if (/\bdinner\b|\bhoodie\b|\blogo\b|\bparty\b/i.test(text)) return 'social';
  if (/\bleave\b|\bmeet\b|\bairbnb\b|\bflight\b|\btable\b/i.test(text)) return 'logistics';
  return 'other';
}

export function createMockDecisionProvider(): DecisionExtractionProvider {
  return {
    async extractDecisions(context: DecisionExtractionContext): Promise<DecisionExtractionResult> {
      const sourceMessageIds = context.messages.map((message) => message._id);
      const decisions: ChatDecision[] = [];

      for (const message of context.messages) {
        for (const pattern of DECISION_PATTERNS) {
          const match = message.body.match(pattern);
          if (!match) continue;

          const title = titleFromMatch(message.body, match[1]);
          decisions.push({
            chatId: context.chatId,
            title,
            description: message.body,
            status: /\bfinal\b|\bfinalized\b|\bdecided\b|\bagreed\b/i.test(message.body)
              ? 'final'
              : 'proposed',
            decidedBy: [actorForMessage(context, message.senderId, message.senderName)],
            decidedAt: message.createdAt,
            confidence: 0.82,
            sourceMessageIds: [message._id],
            sourceText: message.body.slice(0, 240),
            category: categoryForText(message.body),
          });
          break;
        }
      }

      return {
        chatId: context.chatId,
        summary:
          decisions.length > 0
            ? 'The chat contains decisions or finalized choices.'
            : 'No decisions found.',
        decisions,
        generatedAt: new Date().toISOString(),
        sourceMessageIds,
      };
    },
  };
}
