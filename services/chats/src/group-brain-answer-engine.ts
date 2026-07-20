export type GroupBrainAnswerState = 'grounded' | 'insufficient_evidence' | 'conflicting_evidence';
export type GroupBrainAnswerCategory =
  | 'decision'
  | 'ownership'
  | 'pending'
  | 'link'
  | 'change_summary'
  | 'factual_lookup'
  | 'unknown';

export interface GroupBrainEvidenceMessage {
  id: string;
  body: string;
  senderId: string;
  senderName?: string | null;
  createdAt: Date;
}

export interface GroupBrainEngineAnswer {
  question: string;
  answer: string;
  answerState: GroupBrainAnswerState;
  answerCategory: GroupBrainAnswerCategory;
  confidence: 'grounded' | 'uncertain';
  sourceMessageIds: string[];
  sourceDates: string[];
  relevantDateRange?: { start?: string; end?: string; label?: string };
  caveat?: string;
}

const STOPWORDS = new Set([
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'did', 'does', 'about', 'decide',
  'decided', 'decision', 'group', 'brain', 'tell', 'show', 'there', 'were', 'have', 'has',
  'the', 'and', 'are', 'was', 'for', 'with', 'that', 'this', 'from', 'into', 'onto', 'still',
  'current', 'everyone', 'anything', 'something', 'week', 'today', 'yesterday', 'last', 'since',
  'is', 'are', 'to', 'of', 'in', 'on', 'at', 'we', 'our', 'you', 'they', 'it', 'tasks', 'task',
]);

const EXPANSIONS: Record<string, string[]> = {
  transportation: ['transportation', 'ride', 'rides', 'driving', 'driver', 'carpool', 'pickup', 'travel', 'meeting point', 'parking'],
  transport: ['transportation', 'ride', 'rides', 'driving', 'driver', 'carpool', 'pickup', 'travel', 'parking'],
  cake: ['cake', 'dessert', 'bakery'],
  decorations: ['decorations', 'decor', 'decorate'],
  decoration: ['decorations', 'decor', 'decorate'],
  links: ['link', 'links', 'url', 'document', 'doc', 'notion', 'sheet'],
  document: ['link', 'url', 'document', 'doc', 'notion', 'sheet', 'lease'],
  pending: ['waiting', 'pending', 'blocked', 'confirm', 'confirmation', 'need', 'needs', 'finalize', 'check'],
  move: ['move', 'move-in', 'id', 'parking', 'mailbox', 'lease', 'utilities', 'wifi', 'xfinity', 'insurance'],
  'move-in': ['move-in', 'id', 'parking', 'mailbox', 'lease', 'utilities', 'wifi', 'xfinity', 'insurance'],
  apartment: ['apartment', 'lease', 'utilities', 'wifi', 'xfinity', 'insurance', 'parking', 'mailbox'],
  internet: ['internet', 'provider', 'wifi', 'xfinity', 'sonic', 'verizon'],
  provider: ['provider', 'internet', 'wifi', 'xfinity', 'sonic', 'verizon'],
  wifi: ['wifi', 'internet', 'provider', 'xfinity', 'sonic', 'verizon'],
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s:/.-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string) {
  return normalize(value).split(/\s+/).filter((term) => term.length > 2 && !STOPWORDS.has(term));
}

export function classifyQuestion(question: string): GroupBrainAnswerCategory {
  const text = normalize(question);
  if (/\b(who|owner|owns|responsible|bringing|arranging|handling)\b/.test(text)) return 'ownership';
  if (/\b(waiting|pending|blocked|not confirmed|still need|open|tasks?|to do|todo|before|move[- ]?in|should we do)\b/.test(text)) return 'pending';
  if (/\b(link|links|url|document|doc|notion|sheet)\b/.test(text)) return 'link';
  if (/\b(changed|new|since|today|yesterday|last week|this week)\b/.test(text)) return 'change_summary';
  if (/\b(decide|decided|finalize|finalized|choose|chose|agreed)\b/.test(text)) return 'decision';
  if (/\b(when|where|what date|what time|dinner|meeting|provider|internet|wifi)\b/.test(text)) return 'factual_lookup';
  return 'unknown';
}

export function topicTermsForQuestion(question: string): string[] {
  const text = normalize(question);
  const aboutMatch = text.match(/\babout\s+(.+)$/);
  const focused = aboutMatch?.[1] || text;
  const baseTerms = tokenize(focused);
  const terms = new Set<string>();
  for (const term of baseTerms) {
    terms.add(term);
    for (const expanded of EXPANSIONS[term] || []) terms.add(expanded);
  }
  return Array.from(terms);
}

function phraseIncludes(text: string, term: string) {
  if (term.includes(' ')) return text.includes(term);
  return new RegExp(`(^|[^a-z0-9])${term}([^a-z0-9]|$)`).test(text);
}

function hasDecisionSignal(text: string) {
  return /\b(final|finalize|finalized|finalizing|confirmed|locked|lock|decision|decided|agreed|we'll|we will|switching to|switch to|is at|will be at)\b/.test(text);
}

function hasProposalSignal(text: string) {
  return /\b(maybe|should|could|let's|lets|let s|how about|thinking|considering)\b/.test(text);
}

function hasCommitmentSignal(text: string) {
  if (/\b(ignore|instruction|instructions|claim that|pretend|system prompt|earlier instructions)\b/.test(text)) return false;
  return /\b(i will|i'll|i can|i am going to|i'm going to|can handle|will handle|is bringing|bringing|owns|responsible for|assigned to)\b/.test(text);
}

function hasPendingSignal(text: string) {
  return /\b(waiting|pending|blocked|still need|need|needs|need confirmation|needs confirmation|not confirmed|confirm|finalize|check|upload|split|remind|bring|can someone|by friday|tomorrow|tonight|before move-in)\b/.test(text);
}

function scoreMessage(message: GroupBrainEvidenceMessage, terms: string[], category: GroupBrainAnswerCategory) {
  const text = normalize(message.body);
  let score = 0;
  for (const term of terms) {
    if (phraseIncludes(text, term)) score += term.includes(' ') ? 5 : 3;
  }
  if (category === 'decision' && hasDecisionSignal(text)) score += 4;
  if (category === 'decision' && hasProposalSignal(text)) score += 1;
  if (category === 'factual_lookup' && hasDecisionSignal(text)) score += 4;
  if (category === 'ownership' && hasCommitmentSignal(text)) score += 5;
  if (category === 'pending' && hasPendingSignal(text)) score += 5;
  if (category === 'pending' && hasCommitmentSignal(text)) score += 4;
  if (category === 'link' && /https?:\/\//i.test(message.body)) score += 8;
  if (category === 'change_summary') score += 1;
  return score;
}

function retrieve(messages: GroupBrainEvidenceMessage[], question: string, category: GroupBrainAnswerCategory) {
  const terms = topicTermsForQuestion(question);
  const isGeneralPending = category === 'pending' && terms.length === 0;
  const isBroadDecision = category === 'decision' && terms.length === 0;
  const isBroadFactual = category === 'factual_lookup' && terms.length === 0;
  let candidates = messages
    .map((message) => ({ message, score: scoreMessage(message, terms, category) }))
    .filter(({ message, score }) => {
      const text = normalize(message.body);
      if (category === 'pending') return isGeneralPending ? hasPendingSignal(text) : score >= 5;
      if (category === 'link') return score >= 8 && /https?:\/\//i.test(message.body);
      if (category === 'change_summary') return true;
      if (category === 'decision' && isBroadDecision) return hasDecisionSignal(text) || hasProposalSignal(text);
      if (category === 'factual_lookup' && isBroadFactual) return hasDecisionSignal(text) || /\b(dinner|meeting|date|time|where|at)\b/.test(text);
      if (category === 'factual_lookup') return score >= 4;
      return score >= 5;
    })
    .sort((a, b) => b.score - a.score || b.message.createdAt.getTime() - a.message.createdAt.getTime())
    .slice(0, 6);

  if (category === 'decision') {
    const proposalTerms = new Set(
      candidates
        .filter((entry) => hasProposalSignal(normalize(entry.message.body)))
        .flatMap((entry) => tokenize(entry.message.body))
    );
    if (proposalTerms.size > 0) {
      const extraConfirmations = messages
        .filter((message) => {
          const text = normalize(message.body);
          if (!hasDecisionSignal(text)) return false;
          if (candidates.some((entry) => entry.message.id === message.id)) return false;
          return tokenize(message.body).some((term) => proposalTerms.has(term));
        })
        .map((message) => ({ message, score: 6 }));
      candidates = [...candidates, ...extraConfirmations]
        .sort((a, b) => b.score - a.score || b.message.createdAt.getTime() - a.message.createdAt.getTime())
        .slice(0, 6);
    }
  }
  return { terms, candidates };
}

function noEvidence(question: string, category: GroupBrainAnswerCategory, topic?: string): GroupBrainEngineAnswer {
  return {
    question,
    answer: topic
      ? `I couldn't find enough evidence about ${topic} in this group.`
      : "I couldn't find enough evidence in this group to answer that.",
    answerState: 'insufficient_evidence',
    answerCategory: category,
    confidence: 'uncertain',
    sourceMessageIds: [],
    sourceDates: [],
  };
}

function sourceIds(entries: Array<{ message: GroupBrainEvidenceMessage }>) {
  return Array.from(new Set(entries.map((entry) => entry.message.id)));
}

function sourceDates(entries: Array<{ message: GroupBrainEvidenceMessage }>) {
  return entries.map((entry) => entry.message.createdAt.toISOString());
}

function answerDecision(question: string, entries: Array<{ message: GroupBrainEvidenceMessage; score: number }>) {
  const proposalEntries = entries.filter((entry) => hasProposalSignal(normalize(entry.message.body)));
  const proposalTerms = new Set(proposalEntries.flatMap((entry) => tokenize(entry.message.body)));
  const confirmed = entries.filter((entry) => {
    const text = normalize(entry.message.body);
    if (!hasDecisionSignal(text)) return false;
    if (proposalTerms.size === 0) return true;
    return tokenize(entry.message.body).some((term) => proposalTerms.has(term));
  });
  if (confirmed.length > 0) {
    const latest = [...confirmed].sort((a, b) => b.message.createdAt.getTime() - a.message.createdAt.getTime())[0];
    const supporting = [latest, ...confirmed.filter((entry) => entry.message.id !== latest.message.id)].slice(0, 3);
    return {
      question,
      answer: `The latest confirmed discussion says: ${latest.message.body}`,
      answerState: 'grounded' as const,
      answerCategory: 'decision' as const,
      confidence: 'grounded' as const,
      sourceMessageIds: sourceIds(supporting),
      sourceDates: sourceDates(supporting),
    };
  }

  if (entries.length > 0) {
    return {
      question,
      answer: `The group appears to be considering this, but I could not find a clear final confirmation. Relevant message: ${entries[0].message.body}`,
      answerState: 'grounded' as const,
      answerCategory: 'decision' as const,
      confidence: 'grounded' as const,
      sourceMessageIds: sourceIds(entries.slice(0, 2)),
      sourceDates: sourceDates(entries.slice(0, 2)),
      caveat: 'No explicit final confirmation found.',
    };
  }

  return noEvidence(question, 'decision');
}

function answerOwnership(question: string, entries: Array<{ message: GroupBrainEvidenceMessage; score: number }>) {
  const commitments = entries
    .filter((entry) => hasCommitmentSignal(normalize(entry.message.body)))
    .sort((a, b) => b.score - a.score || b.message.createdAt.getTime() - a.message.createdAt.getTime())
    .slice(0, 6);
  if (commitments.length === 0) return noEvidence(question, 'ownership');
  return {
    question,
    answer: `Responsibilities I found:\n${commitments.map((entry) => `- ${entry.message.senderName || 'Someone'}: ${entry.message.body}`).join('\n')}`,
    answerState: 'grounded' as const,
    answerCategory: 'ownership' as const,
    confidence: 'grounded' as const,
    sourceMessageIds: sourceIds(commitments),
    sourceDates: sourceDates(commitments),
  };
}

function answerPending(question: string, entries: Array<{ message: GroupBrainEvidenceMessage; score: number }>) {
  if (entries.length === 0) return noEvidence(question, 'pending', 'pending items');
  const ranked = [...entries]
    .sort((a, b) => b.score - a.score || b.message.createdAt.getTime() - a.message.createdAt.getTime())
    .slice(0, 6);
  return {
    question,
    answer: `Pending items I found:\n${ranked.map((entry) => `- ${entry.message.body}`).join('\n')}`,
    answerState: 'grounded' as const,
    answerCategory: 'pending' as const,
    confidence: 'grounded' as const,
    sourceMessageIds: sourceIds(ranked),
    sourceDates: sourceDates(ranked),
  };
}

function answerLink(question: string, entries: Array<{ message: GroupBrainEvidenceMessage; score: number }>) {
  if (entries.length === 0) return noEvidence(question, 'link', 'links');
  return {
    question,
    answer: `I found these relevant shared links: ${entries.map((entry) => entry.message.body).join(' ')}`,
    answerState: 'grounded' as const,
    answerCategory: 'link' as const,
    confidence: 'grounded' as const,
    sourceMessageIds: sourceIds(entries.slice(0, 3)),
    sourceDates: sourceDates(entries.slice(0, 3)),
  };
}

function answerFactual(question: string, entries: Array<{ message: GroupBrainEvidenceMessage; score: number }>, category: GroupBrainAnswerCategory) {
  if (entries.length === 0) return noEvidence(question, category);
  const latest = entries.sort((a, b) => b.message.createdAt.getTime() - a.message.createdAt.getTime())[0];
  return {
    question,
    answer: `The relevant group message says: ${latest.message.body}`,
    answerState: 'grounded' as const,
    answerCategory: category,
    confidence: 'grounded' as const,
    sourceMessageIds: sourceIds(entries.slice(0, 3)),
    sourceDates: sourceDates(entries.slice(0, 3)),
  };
}

export function answerGroupBrainQuestion(
  question: string,
  messages: GroupBrainEvidenceMessage[],
  now = new Date()
): GroupBrainEngineAnswer {
  const category = classifyQuestion(question);
  const { candidates } = retrieve(messages, question, category);

  if (category === 'decision') return answerDecision(question, candidates);
  if (category === 'ownership') return answerOwnership(question, candidates);
  if (category === 'pending') return answerPending(question, candidates);
  if (category === 'link') return answerLink(question, candidates);
  if (category === 'change_summary') {
    const sinceLastWeek = /\blast week\b|\bsince last week\b/i.test(question);
    const start = new Date(now);
    if (sinceLastWeek) start.setDate(now.getDate() - 7);
    const inRange = messages
      .filter((message) => !sinceLastWeek || message.createdAt >= start)
      .slice(0, 5)
      .map((message) => ({ message, score: 1 }));
    if (inRange.length === 0) {
      return {
        ...noEvidence(question, 'change_summary', 'meaningful group changes in that time range'),
        relevantDateRange: sinceLastWeek ? { start: start.toISOString(), end: now.toISOString(), label: 'since last week' } : undefined,
      };
    }
    return {
      question,
      answer: `Meaningful recent changes I found:\n${inRange.map((entry) => `- ${entry.message.body}`).join('\n')}`,
      answerState: 'grounded',
      answerCategory: 'change_summary',
      confidence: 'grounded',
      sourceMessageIds: sourceIds(inRange),
      sourceDates: sourceDates(inRange),
      relevantDateRange: sinceLastWeek ? { start: start.toISOString(), end: now.toISOString(), label: 'since last week' } : undefined,
    };
  }
  return answerFactual(question, candidates, category);
}
