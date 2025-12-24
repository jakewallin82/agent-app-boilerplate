import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { SessionWithFiles } from '@/types';
import { getSessions, getSessionByName, restoreSession } from '@/lib/api';

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
  const { sessionName } = useParams<{ sessionName?: string }>();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<SessionWithFiles[]>([]);
  const [currentSession, setCurrentSessionState] = useState<SessionWithFiles | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load session from URL on mount or when URL changes
  useEffect(() => {
    const loadSessionFromUrl = async () => {
      if (sessionName) {
        try {
          const session = await getSessionByName(sessionName);
          if (session) {
            setCurrentSessionState(session);
            // Restore files to container in background
            restoreSession(session.id).catch((error) => {
              console.error('Failed to restore session:', error);
            });
          } else {
            // Session not found, redirect to home
            console.warn(`Session '${sessionName}' not found, redirecting to home`);
            navigate('/', { replace: true });
          }
        } catch (error) {
          console.error('Failed to load session from URL:', error);
          navigate('/', { replace: true });
        }
      } else {
        // No session in URL, clear current session
        setCurrentSessionState(null);
      }
      setIsInitialized(true);
    };

    loadSessionFromUrl();
  }, [sessionName, navigate]);

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
    // Navigate to session URL - this will trigger the effect above
    navigate(`/${session.session_name}`);
  }, [navigate]);

  const setCurrentSession = useCallback((session: SessionWithFiles | null) => {
    if (session) {
      // If setting a session (e.g., during creation), update state but don't navigate yet
      // (we'll navigate after we have the real session name/ID)
      setCurrentSessionState(session);
    } else {
      // Clearing session - navigate to root
      setCurrentSessionState(null);
      navigate('/');
    }
  }, [navigate]);

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
