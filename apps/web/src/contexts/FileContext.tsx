import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { AgentFile } from '@/types';
import { getSessionFiles, getFileContent } from '@/lib/api';
import { isHiddenFile } from '@agent-app/shared';

interface OpenTab {
  file: AgentFile;
  content: string;
  isLoading: boolean;
}

interface FileContextType {
  // Current session files
  files: AgentFile[];
  setFiles: (files: AgentFile[]) => void;
  addOrUpdateFile: (file: AgentFile) => void;

  // Open tabs
  openTabs: OpenTab[];
  activeTabId: string | null;
  openFile: (file: AgentFile) => Promise<void>;
  closeTab: (fileId: string) => void;
  setActiveTab: (fileId: string) => void;

  // Loading state
  isLoadingFiles: boolean;
  loadSessionFiles: (sessionId: string) => Promise<void>;
  clearFiles: () => void;
}

const FileContext = createContext<FileContextType | undefined>(undefined);

export function FileProvider({ children }: { children: ReactNode }) {
  const [files, setFilesState] = useState<AgentFile[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  const setFiles = useCallback((newFiles: AgentFile[]) => {
    setFilesState(newFiles);
  }, []);

  const addOrUpdateFile = useCallback((file: AgentFile) => {
    // Skip hidden files (CLAUDE.md, .claude/, shared/)
    // TODO: Pass canWriteShared from agent config for admin users
    if (isHiddenFile(file.filePath, false)) {
      return;
    }

    setFilesState(prev => {
      const existing = prev.findIndex(f => f.id === file.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = file;
        return updated;
      }
      return [...prev, file];
    });

    // Update open tab if file is open - mark as needing reload
    setOpenTabs(prev =>
      prev.map(tab =>
        tab.file.id === file.id
          ? { ...tab, file, isLoading: true }
          : tab
      )
    );

    // Reload content for updated file if it's open
    setOpenTabs(prev => {
      const tab = prev.find(t => t.file.id === file.id);
      if (tab && file.signedUrl) {
        // Async reload content
        getFileContent(file.signedUrl).then(content => {
          setOpenTabs(current =>
            current.map(t =>
              t.file.id === file.id ? { ...t, content, isLoading: false } : t
            )
          );
        });
      }
      return prev;
    });
  }, []);

  const loadSessionFiles = useCallback(async (sessionId: string) => {
    setIsLoadingFiles(true);
    try {
      const sessionFiles = await getSessionFiles(sessionId);
      // Filter out hidden files (CLAUDE.md, .claude/, shared/)
      // TODO: Pass canWriteShared from agent config for admin users
      const visibleFiles = sessionFiles.filter(
        (file) => !isHiddenFile(file.filePath, false)
      );
      setFilesState(visibleFiles);
    } catch (error) {
      console.error('Failed to load files:', error);
      setFilesState([]);
    } finally {
      setIsLoadingFiles(false);
    }
  }, []);

  const clearFiles = useCallback(() => {
    setFilesState([]);
    setOpenTabs([]);
    setActiveTabId(null);
  }, []);

  const openFile = useCallback(async (file: AgentFile) => {
    // Check if already open
    const existing = openTabs.find(t => t.file.id === file.id);
    if (existing) {
      setActiveTabId(file.id);
      return;
    }

    // Add tab with loading state
    setOpenTabs(prev => [...prev, { file, content: '', isLoading: true }]);
    setActiveTabId(file.id);

    // Fetch content
    try {
      if (file.signedUrl) {
        const content = await getFileContent(file.signedUrl);
        setOpenTabs(prev =>
          prev.map(t =>
            t.file.id === file.id ? { ...t, content, isLoading: false } : t
          )
        );
      }
    } catch (error) {
      console.error('Failed to load file content:', error);
      setOpenTabs(prev =>
        prev.map(t =>
          t.file.id === file.id
            ? { ...t, content: 'Error loading file', isLoading: false }
            : t
        )
      );
    }
  }, [openTabs]);

  const closeTab = useCallback((fileId: string) => {
    setOpenTabs(prev => {
      const remaining = prev.filter(t => t.file.id !== fileId);

      // If closing active tab, switch to another
      if (activeTabId === fileId) {
        const newActiveId = remaining.length > 0
          ? remaining[remaining.length - 1].file.id
          : null;
        setActiveTabId(newActiveId);
      }

      return remaining;
    });
  }, [activeTabId]);

  const setActiveTab = useCallback((fileId: string) => {
    setActiveTabId(fileId);
  }, []);

  return (
    <FileContext.Provider
      value={{
        files,
        setFiles,
        addOrUpdateFile,
        openTabs,
        activeTabId,
        openFile,
        closeTab,
        setActiveTab,
        isLoadingFiles,
        loadSessionFiles,
        clearFiles,
      }}
    >
      {children}
    </FileContext.Provider>
  );
}

export function useFiles() {
  const context = useContext(FileContext);
  if (!context) {
    throw new Error('useFiles must be used within a FileProvider');
  }
  return context;
}
