import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import type { VeyraConversationContext, VeyraResultCard } from '@/api/client';

// One turn of the visible Veyra conversation thread. Turns are appended, never
// replaced — a new question adds a new turn, and a pending turn resolves in
// place once the answer arrives.
export type VeyraTurn = {
  id: string;
  question: string;
  origin: 'voice' | 'typed';
  status: 'pending' | 'done' | 'error';
  answer?: string;
  results?: VeyraResultCard[];
  ambiguousCandidates?: Array<{ scopeId: string; label: string }>;
  errorMessage?: string;
  errorCode?: string;
  suggestManageAiPrivacy?: boolean;
};

interface VeyraSessionValue {
  turns: VeyraTurn[];
  context: VeyraConversationContext | undefined;
  greetingSpoken: boolean;
  appendTurn: (turn: VeyraTurn) => void;
  updateTurn: (id: string, patch: Partial<VeyraTurn>) => void;
  setContext: (context: VeyraConversationContext | undefined) => void;
  setGreetingSpoken: (value: boolean) => void;
  clear: () => void;
}

const VeyraSessionContext = createContext<VeyraSessionValue | null>(null);

/**
 * App-level, in-memory-only Veyra conversation store. Mounted once above the
 * router (see App.tsx) so normal client-side navigation — e.g. /veyra ->
 * /settings?s=ai -> /veyra — does not unmount it and does not lose the
 * visible thread or grounded plan/space context, unlike page-local React
 * state which is destroyed whenever the route (and therefore the page
 * component) unmounts.
 *
 * Nothing here is ever written to localStorage/sessionStorage/IndexedDB or
 * any server API — it lives only for the lifetime of this tab, and is
 * intentionally cleared on hard reload (the whole app remounts) and whenever
 * the authenticated user changes, so one account's conversation can never
 * bleed into another's in the same tab.
 */
export function VeyraSessionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [turns, setTurns] = useState<VeyraTurn[]>([]);
  const [context, setContext] = useState<VeyraConversationContext | undefined>(undefined);
  const [greetingSpoken, setGreetingSpoken] = useState(false);
  const lastUserIdRef = useRef<string | undefined>(user?._id);

  useEffect(() => {
    const currentUserId = user?._id;
    if (lastUserIdRef.current !== currentUserId) {
      lastUserIdRef.current = currentUserId;
      setTurns([]);
      setContext(undefined);
      setGreetingSpoken(false);
    }
  }, [user?._id]);

  const value = useMemo<VeyraSessionValue>(
    () => ({
      turns,
      context,
      greetingSpoken,
      appendTurn: (turn) => setTurns((items) => [...items, turn]),
      updateTurn: (id, patch) => setTurns((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item))),
      setContext,
      setGreetingSpoken,
      clear: () => {
        setTurns([]);
        setContext(undefined);
      },
    }),
    [turns, context, greetingSpoken]
  );

  return <VeyraSessionContext.Provider value={value}>{children}</VeyraSessionContext.Provider>;
}

export function useVeyraSession() {
  const context = useContext(VeyraSessionContext);
  if (!context) {
    throw new Error('useVeyraSession must be used within a VeyraSessionProvider');
  }
  return context;
}
