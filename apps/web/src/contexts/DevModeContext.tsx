import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { useAuth } from './AuthContext';
import {
  persistSessionState,
  loadSessionStateFromLocal,
  cleanupOldSessionStates,
  markSessionComplete,
} from '@/lib/sessionStorage';
import { getSessionState, reconnectToSession } from '@/lib/api';

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
  // Recovery state - true when reconnecting to server stream
  isReconnecting: boolean;
  stopReconnection: () => void;
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

  // Reconnection state
  const [isReconnecting, setIsReconnecting] = useState(false);
  const reconnectAbortRef = useRef<AbortController | null>(null);

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

  // Stop reconnection (called when user sends new message)
  const stopReconnection = useCallback(() => {
    if (reconnectAbortRef.current) {
      reconnectAbortRef.current.abort();
      reconnectAbortRef.current = null;
    }
    setIsReconnecting(false);
  }, []);

  // Reconnect to an active server stream
  const reconnectToActiveSession = useCallback(async (sessionId: string) => {
    if (isReconnecting) return;

    console.log('[RECONNECT] Attempting to reconnect to session:', sessionId);
    setIsReconnecting(true);

    // Create abort controller for cleanup
    reconnectAbortRef.current = new AbortController();

    try {
      let isFirstMessage = true;

      for await (const message of reconnectToSession(sessionId)) {
        // Check if we should stop (user sent new message, etc.)
        if (reconnectAbortRef.current?.signal.aborted) {
          console.log('[RECONNECT] Reconnection aborted');
          break;
        }

        // Handle sync signal - catch-up complete, hide banner
        const msgType = (message as { type?: string; subtype?: string }).type;
        const msgSubtype = (message as { type?: string; subtype?: string }).subtype;
        if (msgType === 'system' && msgSubtype === 'reconnect_synced') {
          console.log('[RECONNECT] Catch-up complete, now receiving live updates');
          setIsReconnecting(false);
          continue; // Don't add this to rawMessages
        }

        // On first real message, clear existing state (server has complete history)
        if (isFirstMessage) {
          console.log('[RECONNECT] Received first message, clearing localStorage state');
          setRawMessages([]);
          setSubagentRawMessages(new Map());
          isFirstMessage = false;
        }

        // Process message same as in ChatInterface
        const parentToolUseId = (message as { parent_tool_use_id?: string }).parent_tool_use_id;
        if (parentToolUseId) {
          setSubagentRawMessages(prev => {
            const updated = new Map(prev);
            const existing = updated.get(parentToolUseId) || [];
            updated.set(parentToolUseId, [...existing, message]);
            return updated;
          });
        } else {
          setRawMessages(prev => [...prev, message]);
        }
      }

      // Reconnection complete, mark session as complete
      markSessionComplete(sessionId);
      console.log('[RECONNECT] Reconnection completed successfully');
    } catch (error) {
      console.error('[RECONNECT] Reconnection failed:', error);
      // Fall back to trying Supabase
      try {
        const sessionState = await getSessionState(sessionId);
        if (sessionState) {
          console.log('[RECONNECT] Falling back to Supabase state');
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
          markSessionComplete(sessionId);
        }
      } catch (supabaseError) {
        console.error('[RECONNECT] Supabase fallback also failed:', supabaseError);
      }
    } finally {
      setIsReconnecting(false);
      reconnectAbortRef.current = null;
    }
  }, [isReconnecting]);

  // Load session state with fallback chain: localStorage -> Supabase -> false
  // Also detects interrupted sessions and attempts reconnection
  const loadSessionFromStorage = useCallback(async (sessionId: string): Promise<boolean> => {
    // 1. Try localStorage first (for mid-run refresh recovery)
    const localState = loadSessionStateFromLocal(sessionId);
    if (localState) {
      console.log('Loaded session from localStorage, isStreaming:', localState.isStreaming);
      setRawMessages(localState.rawMessages);
      setSubagentRawMessages(new Map(Object.entries(localState.subagentRawMessages)));
      setCurrentSessionId(sessionId);

      // If session was streaming when we left, try to reconnect
      if (localState.isStreaming) {
        console.log('[RECOVERY] Detected interrupted streaming session, attempting reconnection');
        // Don't await - let it run in background
        reconnectToActiveSession(sessionId);
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
  }, [reconnectToActiveSession]);


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

  // Cleanup reconnection on unmount
  useEffect(() => {
    return () => {
      if (reconnectAbortRef.current) {
        reconnectAbortRef.current.abort();
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
      isReconnecting,
      stopReconnection,
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
