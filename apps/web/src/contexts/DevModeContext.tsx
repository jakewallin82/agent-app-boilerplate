import { createContext, useContext, useState, useEffect, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { useAuth } from './AuthContext';

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

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(DEV_MODE_KEY, String(isDevMode));
  }, [isDevMode]);

  // Disable dev mode if user is not admin
  useEffect(() => {
    if (!isAdmin && isDevMode) {
      setIsDevMode(false);
    }
  }, [isAdmin, isDevMode]);

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
