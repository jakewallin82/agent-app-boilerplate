import { useState, type ReactNode, type MouseEvent } from 'react';
import { FileExplorer } from './FileExplorer';
import { RightPanel } from './RightPanel';
import { useFiles } from '@/contexts/FileContext';
import { useSessions } from '@/contexts/SessionContext';
import { useDevMode } from '@/contexts/DevModeContext';
import type { AgentFile } from '@/types';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { openFile, openTabs } = useFiles();
  const { currentSession } = useSessions();
  const { files } = useFiles();
  const { isDevMode, subagentTabs, openSubagentTab, closeSubagentTab } = useDevMode();

  const [leftPanelWidth, setLeftPanelWidth] = useState(240);
  const [rightPanelWidth, setRightPanelWidth] = useState(400);

  // Show right panel if:
  // 1. There are open tabs, OR
  // 2. An old session with files is selected, OR
  // 3. Dev mode with subagent tabs open
  const showRightPanel = openTabs.length > 0 || (currentSession && files.length > 0) || (isDevMode && subagentTabs.length > 0);

  const handleFileClick = async (file: AgentFile) => {
    await openFile(file);
  };

  const handleLeftResize = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftPanelWidth;

    const onMouseMove = (e: globalThis.MouseEvent) => {
      const newWidth = startWidth + e.clientX - startX;
      setLeftPanelWidth(Math.max(180, Math.min(400, newWidth)));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const handleRightResize = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidth;

    const onMouseMove = (e: globalThis.MouseEvent) => {
      const newWidth = startWidth - (e.clientX - startX);
      setRightPanelWidth(Math.max(300, Math.min(700, newWidth)));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left Panel - File Explorer */}
      <div
        className="flex-shrink-0 h-full border-r border-border"
        style={{ width: leftPanelWidth }}
      >
        <FileExplorer onFileClick={handleFileClick} />
      </div>

      {/* Left Resizer */}
      <div
        className="w-1 flex-shrink-0 bg-border cursor-col-resize hover:bg-primary active:bg-primary transition-colors"
        onMouseDown={handleLeftResize}
      />

      {/* Center Panel - Chat */}
      <div className="flex-1 min-w-0 h-full">
        {children}
      </div>

      {/* Right Resizer */}
      {showRightPanel && (
        <div
          className="w-1 flex-shrink-0 bg-border cursor-col-resize hover:bg-primary active:bg-primary transition-colors"
          onMouseDown={handleRightResize}
        />
      )}

      {/* Right Panel - Files and Subagent Tabs */}
      {showRightPanel && (
        <div
          className="flex-shrink-0 h-full border-l border-border"
          style={{ width: rightPanelWidth }}
        >
          <RightPanel
            subagentTabs={subagentTabs}
            onCloseSubagentTab={closeSubagentTab}
            onSubagentClick={openSubagentTab}
          />
        </div>
      )}
    </div>
  );
}
