import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { useAuth } from './AuthContext';
import {
  persistSessionState,
  loadSessionStateFromLocal,
  cleanupOldSessionStates,
  markSessionComplete,
  wasSessionStreaming,
} from '@/lib/sessionStorage';
import { getSessionState } from '@/lib/api';

interface SubagentTab {
  id: string;
  label: string;
  // NOTE: messages are NOT stored here - they're derived from subagentRawMessages
  // to ensure reactivity when new messages stream in
}

interface DevModeContextType {
  isDevMode: boolean;
  setDevMode: (enabled: boolean) => void;
  isAdmin: boolean;
  // Raw messages for dev mode display
  rawMessages: unknown[];
  setRawMessages: Dispatch<SetStateAction<unknown[]>>;
  subagentRawMessages: Map<string, unknown[]>;
  setSubagentRawMessages: Dispatch<SetStateAction<Map<string, unknown[]>>>;
  // Subagent tab management
  subagentTabs: SubagentTab[];
  openSubagentTab: (toolUseId: string, description: string) => void;
  closeSubagentTab: (id: string) => void;
  // Session state loading (from localStorage or Supabase)
  loadSessionFromStorage: (sessionId: string) => Promise<boolean>;
  // Persistence
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  persistCurrentSession: (isStreaming?: boolean) => void;
  markCurrentSessionComplete: () => void;
  // Recovery state - true when we detected an interrupted session and are polling for completion
  isWaitingForServerCompletion: boolean;
  startPollingForCompletion: (sessionId: string) => void;
  stopPolling: () => void;
}

const DevModeContext = createContext<DevModeContextType | undefined>(undefined);

const DEV_MODE_KEY = 'agent-app-dev-mode';

export function DevModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin ?? false;

  const [isDevMode, setIsDevMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(DEV_MODE_KEY) === 'true';
  });

  // Raw messages state for dev mode display
  const [rawMessages, setRawMessages] = useState<unknown[]>([]);
  const [subagentRawMessages, setSubagentRawMessages] = useState<Map<string, unknown[]>>(new Map());

  // Subagent tab state
  const [subagentTabs, setSubagentTabs] = useState<SubagentTab[]>([]);

  // Current session ID for persistence
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Recovery polling state
  const [isWaitingForServerCompletion, setIsWaitingForServerCompletion] = useState(false);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingSessionIdRef = useRef<string | null>(null);

  const openSubagentTab = (toolUseId: string, description: string) => {
    // Check if tab already exists
    if (subagentTabs.some(t => t.id === toolUseId)) {
      return;
    }

    // Only store id and label - messages are derived from subagentRawMessages
    setSubagentTabs(prev => [...prev, {
      id: toolUseId,
      label: description,
    }]);
  };

  const closeSubagentTab = (id: string) => {
    setSubagentTabs(prev => prev.filter(t => t.id !== id));
  };

  // Persist to localStorage after every message update
  const persistCurrentSession = useCallback((isStreaming: boolean = false) => {
    if (!currentSessionId || currentSessionId === 'pending') return;
    persistSessionState(currentSessionId, rawMessages, subagentRawMessages, isStreaming);
  }, [currentSessionId, rawMessages, subagentRawMessages]);

  // Mark session as complete in localStorage
  const markCurrentSessionComplete = useCallback(() => {
    if (!currentSessionId || currentSessionId === 'pending') return;
    markSessionComplete(currentSessionId);
  }, [currentSessionId]);

  // Stop any active polling
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    pollingSessionIdRef.current = null;
    setIsWaitingForServerCompletion(false);
  }, []);

  // Start polling Supabase for completed session state
  const startPollingForCompletion = useCallback((sessionId: string) => {
    // Don't start if already polling
    if (pollingIntervalRef.current) {
      return;
    }

    console.log('[RECOVERY] Starting to poll for session completion:', sessionId);
    setIsWaitingForServerCompletion(true);
    pollingSessionIdRef.current = sessionId;

    const poll = async () => {
      if (pollingSessionIdRef.current !== sessionId) {
        // Session changed, stop polling
        stopPolling();
        return;
      }

      try {
        const sessionState = await getSessionState(sessionId);
        if (sessionState) {
          console.log('[RECOVERY] Found completed session in Supabase');
          const localState = loadSessionStateFromLocal(sessionId);
          const supabaseTimestamp = sessionState.endTime
            ? new Date(sessionState.endTime as string).getTime()
            : Date.now();
          const localTimestamp = localState?.lastUpdated || 0;

          // Use Supabase state if it's newer (completed)
          if (supabaseTimestamp > localTimestamp || sessionState.endTime) {
            console.log('[RECOVERY] Supabase state is newer, loading it');
            const mainMessages: unknown[] = [];
            const subagentMessages = new Map<string, unknown[]>();

            for (const msg of sessionState.messages) {
              const parentId = (msg as { parent_tool_use_id?: string }).parent_tool_use_id;
              if (parentId) {
                const existing = subagentMessages.get(parentId) || [];
                subagentMessages.set(parentId, [...existing, msg]);
              } else {
                mainMessages.push(msg);
              }
            }

            setRawMessages(mainMessages);
            setSubagentRawMessages(subagentMessages);
            // Mark as complete now that we have the final state
            markSessionComplete(sessionId);
          }
          stopPolling();
        }
      } catch (error) {
        // Still waiting, continue polling
        console.log('[RECOVERY] Session not yet complete, continuing to poll...');
      }
    };

    // Poll immediately, then every 3 seconds
    poll();
    pollingIntervalRef.current = setInterval(poll, 3000);

    // Stop polling after 2 minutes max (server should be done by then)
    setTimeout(() => {
      if (pollingSessionIdRef.current === sessionId) {
        console.log('[RECOVERY] Polling timeout, stopping');
        stopPolling();
      }
    }, 120000);
  }, [stopPolling]);

  // Load session state with fallback chain: localStorage -> Supabase -> false
  // Also detects interrupted sessions and starts polling for completion
  const loadSessionFromStorage = useCallback(async (sessionId: string): Promise<boolean> => {
    // 1. Try localStorage first (for mid-run refresh recovery)
    const localState = loadSessionStateFromLocal(sessionId);
    if (localState) {
      console.log('Loaded session from localStorage, isStreaming:', localState.isStreaming);
      setRawMessages(localState.rawMessages);
      setSubagentRawMessages(new Map(Object.entries(localState.subagentRawMessages)));
      setCurrentSessionId(sessionId);

      // If session was streaming when we left, start polling for completion
      if (localState.isStreaming) {
        console.log('[RECOVERY] Detected interrupted streaming session, starting to poll');
        startPollingForCompletion(sessionId);
      }

      return true;
    }

    // 2. Try Supabase Storage (for completed sessions)
    try {
      const sessionState = await getSessionState(sessionId);
      if (sessionState) {
        console.log('Loaded session from Supabase Storage');
        const mainMessages: unknown[] = [];
        const subagentMessages = new Map<string, unknown[]>();

        for (const msg of sessionState.messages) {
          const parentId = (msg as { parent_tool_use_id?: string }).parent_tool_use_id;
          if (parentId) {
            const existing = subagentMessages.get(parentId) || [];
            subagentMessages.set(parentId, [...existing, msg]);
          } else {
            mainMessages.push(msg);
          }
        }

        setRawMessages(mainMessages);
        setSubagentRawMessages(subagentMessages);
        setCurrentSessionId(sessionId);
        return true;
      }
    } catch (error) {
      console.warn('Failed to load from Supabase Storage:', error);
    }

    // 3. Neither found
    return false;
  }, [startPollingForCompletion]);


  // Persist to localStorage on changes
  useEffect(() => {
    localStorage.setItem(DEV_MODE_KEY, String(isDevMode));
  }, [isDevMode]);

  // Disable dev mode if user is not admin
  useEffect(() => {
    if (!isAdmin && isDevMode) {
      setIsDevMode(false);
    }
  }, [isAdmin, isDevMode]);

  // Cleanup old localStorage entries on mount
  useEffect(() => {
    cleanupOldSessionStates(10); // Keep 10 most recent
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const setDevMode = (enabled: boolean) => {
    if (!isAdmin) return; // Only admins can enable
    setIsDevMode(enabled);
  };

  return (
    <DevModeContext.Provider value={{
      isDevMode,
      setDevMode,
      isAdmin,
      rawMessages,
      setRawMessages,
      subagentRawMessages,
      setSubagentRawMessages,
      subagentTabs,
      openSubagentTab,
      closeSubagentTab,
      // Session state loading
      loadSessionFromStorage,
      // Persistence
      currentSessionId,
      setCurrentSessionId,
      persistCurrentSession,
      markCurrentSessionComplete,
      // Recovery state
      isWaitingForServerCompletion,
      startPollingForCompletion,
      stopPolling,
    }}>
      {children}
    </DevModeContext.Provider>
  );
}

export function useDevMode() {
  const context = useContext(DevModeContext);
  if (!context) {
    throw new Error('useDevMode must be used within DevModeProvider');
  }
  return context;
}
