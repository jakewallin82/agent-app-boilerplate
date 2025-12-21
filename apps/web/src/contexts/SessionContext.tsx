import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { SessionWithFiles } from '@/types';
import { getSessions, restoreSession } from '@/lib/api';

interface SessionContextType {
  sessions: SessionWithFiles[];
  currentSession: SessionWithFiles | null;
  isLoadingSessions: boolean;
  loadSessions: () => Promise<void>;
  selectSession: (session: SessionWithFiles) => Promise<void>;
  setCurrentSession: (session: SessionWithFiles | null) => void;
  updateCurrentSession: (updates: Partial<SessionWithFiles>) => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionWithFiles[]>([]);
  const [currentSession, setCurrentSessionState] = useState<SessionWithFiles | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const data = await getSessions();
      setSessions(data);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  const selectSession = useCallback(async (session: SessionWithFiles) => {
    // Set current session immediately so UI updates right away
    setCurrentSessionState(session);

    // Restore files to container in background (for resuming work)
    restoreSession(session.id).catch((error) => {
      console.error('Failed to restore session:', error);
    });
  }, []);

  const setCurrentSession = useCallback((session: SessionWithFiles | null) => {
    setCurrentSessionState(session);
  }, []);

  const updateCurrentSession = useCallback((updates: Partial<SessionWithFiles>) => {
    setCurrentSessionState(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };

      // Also update in sessions list
      setSessions(sessions =>
        sessions.map(s => s.id === updated.id ? updated : s)
      );

      return updated;
    });
  }, []);

  return (
    <SessionContext.Provider
      value={{
        sessions,
        currentSession,
        isLoadingSessions,
        loadSessions,
        selectSession,
        setCurrentSession,
        updateCurrentSession,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSessions() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSessions must be used within a SessionProvider');
  }
  return context;
}
