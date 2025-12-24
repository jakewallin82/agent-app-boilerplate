import { useState } from 'react';
import { FileViewerTabs } from './FileViewerTabs';
import { DevModeMessageList } from './DevModeMessageList';
import { useDevMode } from '@/contexts/DevModeContext';
import { XIcon } from './Icons';

interface SubagentTab {
  id: string;
  label: string;
}

interface RightPanelProps {
  subagentTabs: SubagentTab[];
  onCloseSubagentTab: (id: string) => void;
  onSubagentClick?: (toolUseId: string, description: string) => void;
}

type TabType = 'files' | string;  // 'files' or subagent ID

export function RightPanel({ subagentTabs, onCloseSubagentTab, onSubagentClick }: RightPanelProps) {
  const { isDevMode, subagentRawMessages } = useDevMode();
  const [activeTab, setActiveTab] = useState<TabType>('files');

  // If not in dev mode, just show files
  if (!isDevMode) {
    return <FileViewerTabs />;
  }

  const activeSubagent = subagentTabs.find(t => t.id === activeTab);
  // Derive messages from the live Map - this ensures reactivity when new messages stream in
  const activeSubagentMessages = activeSubagent
    ? (subagentRawMessages.get(activeSubagent.id) || [])
    : [];

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Tab Bar */}
      <div className="flex border-b border-border overflow-x-auto bg-card">
        {/* Files Tab */}
        <div
          className={`flex items-center gap-2 px-3 py-2 border-r border-border cursor-pointer min-w-0 ${
            activeTab === 'files'
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:bg-accent'
          }`}
          onClick={() => setActiveTab('files')}
        >
          <span className="text-sm">Files</span>
        </div>

        {/* Subagent Tabs */}
        {subagentTabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex items-center gap-2 px-3 py-2 border-r border-border cursor-pointer min-w-0 max-w-[200px] ${
              activeTab === tab.id
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:bg-accent'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="text-purple-400 text-xs">Task</span>
            <span className="truncate text-sm">{tab.label}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseSubagentTab(tab.id);
                if (activeTab === tab.id) {
                  setActiveTab('files');
                }
              }}
              className="ml-auto text-muted-foreground hover:text-foreground flex-shrink-0 p-0.5 rounded hover:bg-accent"
            >
              <XIcon size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'files' ? (
          <FileViewerTabs />
        ) : activeSubagent ? (
          <div className="p-4">
            <DevModeMessageList
              messages={activeSubagentMessages}
              onSubagentClick={onSubagentClick}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
