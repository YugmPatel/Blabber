import type { AISummaryProvider } from '../ai-summary-service';
import { createHeuristicSummaryProvider } from '../heuristic-summary';

// The mock/no-API-key provider used to fabricate a canned decision, task, and
// waiting-on item for any non-empty chat — which meant a casual "hey / how are
// you" conversation got a fake "Proceed with the latest discussed plan"
// decision. Catch Me Up must never hallucinate, even in mock mode, so this now
// delegates to the same deterministic, fully grounded heuristic extractor
// used as the production fallback when OpenRouter fails.
export function createMockSummaryProvider(): AISummaryProvider {
  return createHeuristicSummaryProvider();
}
