import { useFiles } from '@/contexts/FileContext';
import { MarkdownViewer } from './MarkdownViewer';
import { JsonViewer } from './JsonViewer';
import { XIcon, getFileIcon, LoaderIcon } from './Icons';

export function FileViewerTabs() {
  const { openTabs, activeTabId, closeTab, setActiveTab } = useFiles();

  if (openTabs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-background text-muted-foreground">
        <div className="text-center">
          <p className="text-sm">No files open</p>
          <p className="text-xs mt-1">Click a file to view it here</p>
        </div>
      </div>
    );
  }

  const activeTab = openTabs.find(t => t.file.id === activeTabId);

  // Render content based on file type
  const renderContent = () => {
    if (!activeTab) return null;

    if (activeTab.isLoading) {
      return (
        <div className="flex items-center gap-2 text-muted-foreground p-4">
          <LoaderIcon size={14} />
          <span>Loading file...</span>
        </div>
      );
    }

    switch (activeTab.file.fileType) {
      case 'md':
        return <MarkdownViewer content={activeTab.content} />;
      case 'json':
        return <JsonViewer content={activeTab.content} />;
      default:
        return (
          <pre className="text-sm font-mono whitespace-pre-wrap text-foreground">
            {activeTab.content}
          </pre>
        );
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Tab Bar */}
      <div className="flex border-b border-border overflow-x-auto bg-card">
        {openTabs.map((tab) => (
          <div
            key={tab.file.id}
            className={`flex items-center gap-2 px-3 py-2 border-r border-border cursor-pointer min-w-0 max-w-[200px] ${
              tab.file.id === activeTabId
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:bg-accent'
            }`}
            onClick={() => setActiveTab(tab.file.id)}
          >
            <span className="flex-shrink-0">{getFileIcon(tab.file.fileType, 12)}</span>
            <span className="truncate text-sm">{tab.file.filePath}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.file.id);
              }}
              className="ml-auto text-muted-foreground hover:text-foreground flex-shrink-0 p-0.5 rounded hover:bg-accent"
            >
              <XIcon size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {renderContent()}
      </div>
    </div>
  );
}
