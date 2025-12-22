import { useEffect } from 'react';
import { useSessions } from '@/contexts/SessionContext';
import { useFiles } from '@/contexts/FileContext';
import type { AgentFile } from '@/types';
import {
  FolderIcon,
  FolderOpenIcon,
  LoaderIcon,
  ArrowLeftIcon,
  getFileIcon,
} from './Icons';

interface FileExplorerProps {
  onFileClick: (file: AgentFile) => void;
}

export function FileExplorer({ onFileClick }: FileExplorerProps) {
  const {
    sessions,
    currentSession,
    isLoadingSessions,
    loadSessions,
    selectSession,
    setCurrentSession,
  } = useSessions();

  const { files, isLoadingFiles, loadSessionFiles, clearFiles } = useFiles();

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Load files when session changes
  useEffect(() => {
    if (currentSession && currentSession.id !== 'pending') {
      loadSessionFiles(currentSession.id);
    } else if (!currentSession) {
      clearFiles();
    }
  }, [currentSession, loadSessionFiles, clearFiles]);

  // Handle back button click
  const handleBackToSessions = () => {
    setCurrentSession(null);
    clearFiles();
  };

  // Render sessions list view
  const renderSessionsList = () => (
    <>
      {isLoadingSessions ? (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <LoaderIcon size={14} />
          <span>Loading sessions...</span>
        </div>
      ) : sessions.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">
          No sessions yet. Start one in the chat.
        </div>
      ) : (
        <div className="py-1">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => selectSession(session)}
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent transition-colors group"
            >
              <div className="flex items-center gap-2.5">
                <FolderIcon size={14} className="text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
                <span className="truncate font-medium">
                  {session.session_name || session.title || 'Untitled'}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1 ml-[22px]">
                {session.file_count} {session.file_count === 1 ? 'file' : 'files'}
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );

  // Render files view (when a session is selected)
  const renderFilesView = () => (
    <>
      {/* Back button and session name */}
      <div className="px-3 py-2 border-b border-border">
        <button
          onClick={handleBackToSessions}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon size={14} />
          <span>Back to sessions</span>
        </button>
        <div className="flex items-center gap-2 mt-2">
          <FolderOpenIcon size={14} className="text-primary flex-shrink-0" />
          <span className="text-sm font-medium truncate">
            {currentSession?.session_name || currentSession?.title}
          </span>
        </div>
      </div>

      {/* Files list */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingFiles ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <LoaderIcon size={14} />
            <span>Loading files...</span>
          </div>
        ) : files.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No files in this session yet.
          </div>
        ) : (
          <div className="py-1">
            {files.map((file) => (
              <button
                key={file.id}
                onClick={() => onFileClick(file)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-2.5 group"
              >
                {getFileIcon(file.fileType)}
                <span className="truncate group-hover:text-foreground transition-colors">
                  {file.filePath}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">
          {currentSession ? 'Files' : 'Sessions'}
        </h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {currentSession ? renderFilesView() : renderSessionsList()}
      </div>
    </div>
  );
}
