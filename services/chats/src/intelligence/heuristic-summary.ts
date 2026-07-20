import type { ChatIntelligenceSummary } from '@repo/types';
import type { AISummaryContext, AISummaryProvider, SummaryInputMessage } from './ai-summary-service';

// Deterministic, fully grounded Catch Me Up extractor. This is the safety net
// behind the OpenRouter provider: it must NEVER invent decisions, tasks,
// owners, links, or dates — every item it emits quotes a real message and
// carries that message's id as its source. It intentionally favors precision
// over recall: a missed item is acceptable, a fabricated one is not.

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;

const CASUAL_REGEX =
  /^(hi+|hello+|hey+|yo|sup|thanks?|thank you|thx|ok(ay)?|sounds good|all good|good|great|perfect|cool|nice|awesome|got it|sure|yep|yes|no|nah|lol|haha+|hmm+|see you( later| soon)?|bye+|good (morning|night|evening)|how are you|i'?m (good|fine|great)|and you)[!,. ?]*$/i;

const DUE_PHRASE_REGEX =
  /\b(tomorrow|tonight|today|end of day|eod|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

const QUESTION_SIGNAL_REGEX = /\?/;

const MAX_ITEMS_PER_SECTION = 10;

interface ExtractedTask {
  title: string;
  assignedTo: string | null;
  assignedToUserId: string | null;
  dueDate: string | null;
  sourceMessageId: string;
  isOpenRequest: boolean;
}

function cleanTitle(raw: string): string {
  const collapsed = raw
    .replace(/\s+/g, ' ')
    .replace(/[?.!,;\s]+$/, '')
    // A nested actor prefix inside a captured phrase ("Reminder: everyone
    // should bring ID") reads better as the bare action ("Bring ID").
    .replace(/^(?:everyone\s+(?:should|must|needs?\s+to|has\s+to)\s+|please\s+)/i, '')
    .trim();
  if (!collapsed) return '';
  return collapsed.charAt(0).toUpperCase() + collapsed.slice(1);
}

function duePhraseFrom(text: string): string | null {
  const match = DUE_PHRASE_REGEX.exec(text);
  return match ? match[1].toLowerCase() : null;
}

function mediaLabel(message: SummaryInputMessage): string | null {
  const media = message.media;
  if (!media) return null;
  const kind = media.type === 'document' ? 'document' : media.type || message.type || 'attachment';
  return media.fileName ? `${kind} ${media.fileName}` : kind;
}

function enhanceTaskTitleWithMedia(title: string, message: SummaryInputMessage): string {
  const label = mediaLabel(message);
  if (!label || /image|photo|video|audio|document|file|pdf|doc|attachment/i.test(title)) return title;
  if (/^review\b/i.test(title)) return title.replace(/^review\b/i, `Review ${label}`);
  if (/^upload\b/i.test(title)) return title.replace(/^upload\b/i, `Upload ${label}`);
  return title;
}

function optionVoteCount(option: { voteCount?: number; votes?: string[] }): number {
  return option.voteCount ?? option.votes?.length ?? 0;
}

function pollDecision(message: SummaryInputMessage): ChatIntelligenceSummary['decisions'][number] | null {
  const poll = message.poll;
  if (!poll?.question) return null;
  const options = (poll.options || [])
    .map((option) => option.text)
    .filter((option): option is string => Boolean(option?.trim()));
  const voteSummary = (poll.options || [])
    .map((option) => {
      const text = option.text?.trim();
      if (!text) return null;
      const count = optionVoteCount(option);
      return `${text}: ${count} vote${count === 1 ? '' : 's'}`;
    })
    .filter((value): value is string => Boolean(value));
  const closed = Boolean(poll.closed || poll.closedAt);
  const titleParts = [
    `Poll: ${poll.question.trim()}`,
    options.length > 0 ? `Options: ${options.join(', ')}` : null,
    voteSummary.length > 0 ? `Votes: ${voteSummary.join(', ')}` : 'No votes recorded',
    closed ? 'Closed' : 'Open',
  ].filter(Boolean);
  return {
    title: titleParts.join('. '),
    status: closed ? 'final' : 'proposed',
    sourceMessageIds: [message._id],
  };
}

function eventTask(message: SummaryInputMessage): ChatIntelligenceSummary['tasks'][number] | null {
  const event = message.event;
  if (!event?.title) return null;
  const titleParts = [
    `Event: ${event.title.trim()}`,
    event.startAt ? `at ${event.startAt}` : null,
    event.timezone ? `(${event.timezone})` : null,
    event.location ? `at ${event.location}` : null,
    event.cancelledAt ? 'cancelled' : null,
  ].filter(Boolean);
  return {
    title: titleParts.join(' '),
    assignedTo: null,
    assignedToUserId: null,
    dueDate: event.startAt?.slice(0, 10) || null,
    status: event.cancelledAt ? 'done' : 'pending',
    sourceMessageId: message._id,
  };
}

function planDecision(message: SummaryInputMessage): ChatIntelligenceSummary['decisions'][number] | null {
  const plan = message.planThis;
  if (!plan?.planId) return null;
  const title = plan.title || message.body.replace(/\s+/g, ' ').trim() || 'Plan This card';
  const status = plan.kind === 'cancelled' || plan.status === 'cancelled'
    ? 'reverted'
    : plan.kind === 'finalized' || plan.status === 'finalized'
      ? 'final'
      : 'proposed';
  const stateLabel = status === 'reverted' ? 'cancelled' : status === 'final' ? 'finalized' : plan.status || plan.kind || 'active';
  return {
    title: `Plan This ${stateLabel}: ${title}`,
    status,
    sourceMessageIds: [message._id],
  };
}

function normalizeName(value?: string | null): string {
  return (value || '').trim().toLowerCase().replace(/^@/, '').replace(/\s+/g, ' ');
}

/**
 * Task patterns, tried in order; the first match wins for a given message.
 * Every pattern requires an explicit action phrase in the message itself, so
 * casual chatter can never produce a task.
 */
const TASK_PATTERNS: Array<{
  regex: RegExp;
  openRequest?: boolean;
  ownerFromSender?: boolean;
}> = [
  { regex: /^reminder\b[:\-]?\s*(.+)/i },
  { regex: /\bwe need to\s+(.+)/i },
  { regex: /\b(?:someone|somebody)\s+(?:needs?\s+to|should|must|has\s+to)\s+(.+)/i, openRequest: true },
  { regex: /\bcan\s+(?:someone|somebody|anyone|anybody)\s+(?:please\s+)?(.+)/i, openRequest: true },
  { regex: /\beveryone\s+(?:should|must|needs?\s+to|has\s+to)\s+(.+)/i },
  { regex: /\bi\s*(?:will|'ll)\s+(.+)/i, ownerFromSender: true },
  { regex: /^please\s+(.+)/i, openRequest: true },
  { regex: /\blet'?s\s+(.+)/i },
];

/** "<Participant name> will <do something>" — owner only when the name is a real participant. */
function namedOwnerTask(
  body: string,
  participantsByName: Map<string, { userId: string; name: string }>
): { title: string; owner: { userId: string; name: string } } | null {
  const match = /^\s*@?([A-Za-z][\w'.-]*(?:\s+[A-Za-z][\w'.-]*)?)\s+(?:will|is going to)\s+(.+)/i.exec(body);
  if (!match) return null;
  const candidate = normalizeName(match[1]);
  if (!candidate || candidate === 'i') return null;
  const direct = participantsByName.get(candidate);
  const byFirstWord = participantsByName.get(candidate.split(' ')[0]);
  const owner =
    direct ||
    byFirstWord ||
    Array.from(participantsByName.values()).find((participant) => normalizeName(participant.name).startsWith(candidate));
  if (!owner) return null;
  const title = cleanTitle(match[2]);
  return title ? { title, owner } : null;
}

function extractTask(
  message: SummaryInputMessage,
  participantsByName: Map<string, { userId: string; name: string }>
): ExtractedTask | null {
  const body = (message.body || '').replace(/\s+/g, ' ').trim();
  if (!body || CASUAL_REGEX.test(body)) return null;

  const named = namedOwnerTask(body, participantsByName);
  if (named) {
    return {
      title: named.title,
      assignedTo: named.owner.name,
      assignedToUserId: named.owner.userId,
      dueDate: duePhraseFrom(named.title),
      sourceMessageId: message._id,
      isOpenRequest: false,
    };
  }

  for (const pattern of TASK_PATTERNS) {
    const match = pattern.regex.exec(body);
    if (!match) continue;
    const title = enhanceTaskTitleWithMedia(cleanTitle(match[1]), message);
    if (!title || title.length < 3) continue;
    if (pattern.ownerFromSender) {
      return {
        title,
        assignedTo: message.senderName || null,
        assignedToUserId: message.senderId,
        dueDate: duePhraseFrom(title),
        sourceMessageId: message._id,
        isOpenRequest: false,
      };
    }
    return {
      title,
      assignedTo: null,
      assignedToUserId: null,
      dueDate: duePhraseFrom(title),
      sourceMessageId: message._id,
      isOpenRequest: Boolean(pattern.openRequest),
    };
  }

  return null;
}

function extractDecision(message: SummaryInputMessage): { title: string; sourceMessageId: string } | null {
  const body = (message.body || '').replace(/\s+/g, ' ').trim();
  if (!body) return null;
  const match =
    /^(?:final\s+)?decision\b[:\-]?\s*(.+)/i.exec(body) ||
    /\b(?:final decision|we (?:have\s+)?(?:decided|agreed))\b[:\-]?\s*(?:to\s+|on\s+|is\s+)?(.+)/i.exec(body);
  if (!match) return null;
  const title = cleanTitle(match[1]);
  if (!title || title.length < 3) return null;
  return { title, sourceMessageId: message._id };
}

export function buildHeuristicSummary(context: AISummaryContext): ChatIntelligenceSummary {
  const messages = context.messages || [];
  const sourceMessageIds = messages.map((message) => message._id);
  const latestPlanMessageByPlanId = new Map<string, string>();
  for (const message of messages) {
    if (message.planThis?.planId) latestPlanMessageByPlanId.set(message.planThis.planId, message._id);
  }

  const participantsByName = new Map<string, { userId: string; name: string }>();
  for (const participant of context.participants || []) {
    const name = (participant.name || '').trim();
    if (!name) continue;
    const entry = { userId: participant.userId, name };
    participantsByName.set(normalizeName(name), entry);
    const firstWord = normalizeName(name).split(' ')[0];
    if (firstWord && !participantsByName.has(firstWord)) participantsByName.set(firstWord, entry);
  }

  const tasks: ChatIntelligenceSummary['tasks'] = [];
  const decisions: ChatIntelligenceSummary['decisions'] = [];
  let latestExplicitDecision: ChatIntelligenceSummary['decisions'][number] | null = null;
  const questions: ChatIntelligenceSummary['questionsForMe'] = [];
  const links: ChatIntelligenceSummary['importantLinks'] = [];
  const waitingOn: ChatIntelligenceSummary['waitingOn'] = [];
  const noise: ChatIntelligenceSummary['noise'] = [];

  const seenTaskTitles = new Set<string>();
  const seenLinks = new Set<string>();
  const seenQuestions = new Set<string>();
  let attachmentCount = 0;
  let eventCount = 0;
  let pollCount = 0;

  for (const message of messages) {
    const body = (message.body || '').replace(/\s+/g, ' ').trim();
    if (message.media) attachmentCount += 1;

    if (message.event?.meetingUrl && !seenLinks.has(message.event.meetingUrl)) {
      seenLinks.add(message.event.meetingUrl);
      if (links.length < MAX_ITEMS_PER_SECTION) {
        links.push({ url: message.event.meetingUrl, label: message.event.title || 'Event link', sourceMessageId: message._id });
      }
    }

    const event = eventTask(message);
    if (event) {
      eventCount += 1;
      const key = event.title.toLowerCase();
      if (!seenTaskTitles.has(key) && tasks.length < MAX_ITEMS_PER_SECTION) {
        seenTaskTitles.add(key);
        tasks.push(event);
        if (event.status !== 'done') {
          waitingOn.push({
            title: event.title,
            owner: null,
            dueDate: event.dueDate,
            status: 'waiting',
            sourceMessageId: event.sourceMessageId,
          });
        }
      }
    }

    const poll = pollDecision(message);
    if (poll) {
      pollCount += 1;
      decisions.push(poll);
    }

    const plan = planDecision(message);
    if (plan && (!message.planThis?.planId || latestPlanMessageByPlanId.get(message.planThis.planId) === message._id)) {
      decisions.push(plan);
    }

    if (!body) continue;

    for (const rawUrl of body.match(URL_REGEX) || []) {
      const url = rawUrl.replace(/[),.!?;]+$/, '');
      if (seenLinks.has(url)) continue;
      seenLinks.add(url);
      if (links.length < MAX_ITEMS_PER_SECTION) {
        links.push({ url, label: null, sourceMessageId: message._id });
      }
    }

    if (CASUAL_REGEX.test(body)) {
      if (noise.length < MAX_ITEMS_PER_SECTION) noise.push({ text: body, sourceMessageId: message._id });
      continue;
    }

    const decision = extractDecision(message);
    if (decision) {
      latestExplicitDecision = { title: decision.title, status: 'final', sourceMessageIds: [decision.sourceMessageId] };
      continue;
    }

    const task = extractTask(message, participantsByName);
    if (task) {
      const key = task.title.toLowerCase();
      if (!seenTaskTitles.has(key) && tasks.length < MAX_ITEMS_PER_SECTION) {
        seenTaskTitles.add(key);
        tasks.push({
          title: task.title,
          assignedTo: task.assignedTo,
          assignedToUserId: task.assignedToUserId,
          dueDate: task.dueDate,
          status: 'pending',
          sourceMessageId: task.sourceMessageId,
        });
        waitingOn.push({
          title: task.title,
          owner: task.assignedTo,
          dueDate: task.dueDate,
          status: 'waiting',
          sourceMessageId: task.sourceMessageId,
        });
      }
    }

    if (
      QUESTION_SIGNAL_REGEX.test(body) &&
      body.length <= 240 &&
      message.senderId !== context.currentUserId
    ) {
      const question = cleanTitle(body.slice(0, 200));
      const key = question.toLowerCase();
      if (question && !seenQuestions.has(key) && questions.length < MAX_ITEMS_PER_SECTION) {
        seenQuestions.add(key);
        questions.push({ question: body.trim(), sourceMessageId: message._id });
      }
    }
  }

  // Contradictory explicit decisions: the latest decision-marked message wins,
  // while structured poll/Plan This statuses remain independently represented.
  const finalDecisions = latestExplicitDecision ? [...decisions, latestExplicitDecision] : decisions;

  const parts: string[] = [];
  if (tasks.length > 0) parts.push(`${tasks.length} action item${tasks.length === 1 ? '' : 's'}`);
  if (finalDecisions.length > 0) parts.push(`${finalDecisions.length} decision${finalDecisions.length === 1 ? '' : 's'}`);
  if (questions.length > 0) parts.push(`${questions.length} open question${questions.length === 1 ? '' : 's'}`);
  if (links.length > 0) parts.push(`${links.length} link${links.length === 1 ? '' : 's'} shared`);
  if (pollCount > 0) parts.push(`${pollCount} poll${pollCount === 1 ? '' : 's'}`);
  if (eventCount > 0) parts.push(`${eventCount} event${eventCount === 1 ? '' : 's'}`);
  if (attachmentCount > 0) parts.push(`${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`);

  const where = context.chatTitle ? `in "${context.chatTitle}"` : 'in this conversation';
  const summaryText =
    parts.length > 0
      ? `Recent activity ${where}: ${parts.join(', ')}.`
      : `Mostly casual conversation ${where} with no clear decisions or action items.`;

  return {
    summary: summaryText,
    overview: summaryText,
    decisions: finalDecisions,
    tasks,
    questionsForMe: questions,
    importantLinks: links,
    waitingOn: waitingOn.slice(0, MAX_ITEMS_PER_SECTION),
    noise,
    sourceMessageIds,
    generatedAt: new Date().toISOString(),
  };
}

export function createHeuristicSummaryProvider(): AISummaryProvider {
  return {
    async generateSummary(context: AISummaryContext): Promise<ChatIntelligenceSummary> {
      return buildHeuristicSummary(context);
    },
  };
}
