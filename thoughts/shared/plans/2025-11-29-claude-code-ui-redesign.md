# Claude Sports App UI Redesign Implementation Plan

## Overview

Migrate the current Excel-style agent UI (`claude-sports-app/src/renderer`) to a Claude Code-inspired dark mode interface with subagent tracking, tool call visualization, and a tasks sidebar panel.

## Current State Analysis

### Existing Components
- `App.tsx` - Simple router wrapper
- `ChatInterface.tsx` - Main chat component with IPC listeners for claude-code:response/error
- `MessageList.tsx` - Renders messages with inline TodoListDisplay
- `Message.tsx` - Message bubbles with left/right positioning based on sender
- `MessageInput.tsx` - Textarea with file upload (Excel/PDF/Word)
- `ToolUseDisplay.tsx` - Expandable tool parameters with emoji icons
- `ThinkingDisplay.tsx` - Purple-themed thinking block display
- `TodoListDisplay.tsx` - Inline todo list with priority colors
- `App.css` - Light theme with white background, JetBrains Mono font

### Current Styling Issues
- Light theme (white background)
- Excel green accent color (#217346)
- Message bubbles positioned left (assistant) / right (user)
- Uses emojis for tool icons
- Todo list appears inline with messages (not sidebar)
- Purple theme for thinking display (conflicts with "no purple" requirement)

## Desired End State

A Claude Code-style interface featuring:
1. **Dark mode** with black/gray background, white text
2. **Orange + pastel green** accent colors (no purple anywhere)
3. **Same-side messages** with no bubbling
4. **Subagent viewer** component with expandable tool call traces
5. **TASKS sidebar** on the right side showing todos with progress
6. **Custom SVG icons** instead of emojis
7. **AppWithTabs** parent component (single Chat tab for now)
8. **Monospace font** throughout (JetBrains Mono already configured)

### Color Palette
```css
--bg-primary: #0d0d0d;        /* Main background - black */
--bg-secondary: #1a1a1a;      /* Card/panel background - dark gray */
--bg-tertiary: #252525;       /* Elevated surfaces */
--bg-hover: #2a2a2a;          /* Hover states */
--text-primary: #ffffff;      /* Primary text - white */
--text-secondary: #a0a0a0;    /* Secondary text - gray */
--text-muted: #666666;        /* Muted text */
--border-color: #2a2a2a;      /* Borders */
--accent-orange: #f97316;     /* Claude Code orange - primary accent */
--accent-green: #9aeb94;      /* Pastel green - success/completed */
--accent-green-dark: #22c55e; /* Darker green for contrast */
--error-red: #ef4444;         /* Error states */
```

## What We're NOT Doing

- Artifacts view/tab (ignore for now)
- CommandCards component
- Multiple chat tabs (single tab only)
- Artifact file watcher/detection system
- Command registry system
- Video upload triggers

## Implementation Approach

The redesign follows a bottom-up approach: update styling foundation first, then restructure components, then add new features.

---

## Phase 1: Styling Foundation

### Overview
Establish the dark theme foundation with CSS variables and update Tailwind configuration.

### Changes Required:

#### 1. Update App.css
**File**: `claude-sports-app/src/renderer/App.css`
**Changes**: Replace with dark theme CSS variables

```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap');
@import "tailwindcss";

:root {
  --bg-primary: #0d0d0d;
  --bg-secondary: #1a1a1a;
  --bg-tertiary: #252525;
  --bg-hover: #2a2a2a;
  --text-primary: #ffffff;
  --text-secondary: #a0a0a0;
  --text-muted: #666666;
  --border-color: #2a2a2a;
  --accent-orange: #f97316;
  --accent-green: #9aeb94;
  --accent-green-dark: #22c55e;
  --error-red: #ef4444;
}

body {
  position: relative;
  height: 100vh;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 14px;
  overflow: hidden;
  margin: 0;
  padding: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
}

#root {
  height: 100vh;
}

/* Prose styles for markdown content - dark mode */
.prose {
  color: var(--text-primary);
  max-width: none;
}

.prose p {
  margin-bottom: 0.5rem;
}

.prose p:last-child {
  margin-bottom: 0;
}

.prose pre {
  margin: 0.5rem 0;
  background: var(--bg-tertiary);
}

.prose code {
  font-size: 0.875rem;
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.prose ul, .prose ol {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
}

.prose li {
  margin: 0.25rem 0;
}

.prose a {
  color: var(--accent-orange);
}

.prose a:hover {
  text-decoration: underline;
}

/* Scrollbar styling - dark mode */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--bg-secondary);
}

::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #444;
}

/* Status colors */
.status-running {
  color: var(--accent-orange);
}

.status-completed {
  color: var(--accent-green);
}

.status-failed {
  color: var(--error-red);
}

.status-pending {
  color: var(--text-muted);
}
```

### Success Criteria:

#### Automated Verification:
- [ ] App compiles without errors: `npm run build`
- [ ] No TypeScript errors: `npm run typecheck` (if configured)
- [ ] CSS loads correctly (check in dev tools)

#### Manual Verification:
- [ ] Background is dark (#0d0d0d)
- [ ] Text is white by default
- [ ] Scrollbars match dark theme
- [ ] No purple colors visible anywhere

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding.

---

## Phase 2: Create Icon Components

### Overview
Replace emoji icons with custom SVG icons for a more professional look.

### Changes Required:

#### 1. Create Icons.tsx
**File**: `claude-sports-app/src/renderer/components/icons/Icons.tsx`
**Changes**: New file with SVG icon components

```tsx
import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

// Tool Icons
export const ReadIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

export const WriteIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

export const EditIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

export const BashIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

export const SearchIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

export const GlobIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
  </svg>
);

export const TaskIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);

export const WebIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

export const TodoIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

export const ThinkingIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

// Status Icons
export const CheckIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const SpinnerIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`animate-spin ${className}`}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

export const ErrorIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

export const ChevronDownIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const ChevronRightIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// User/Assistant Icons
export const UserIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const AssistantIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  </svg>
);

export const SubagentIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
);

// Utility function to get icon by tool name
export const getToolIcon = (toolName: string): React.FC<IconProps> => {
  const iconMap: Record<string, React.FC<IconProps>> = {
    Read: ReadIcon,
    Write: WriteIcon,
    Edit: EditIcon,
    Bash: BashIcon,
    BashOutput: BashIcon,
    Grep: SearchIcon,
    Glob: GlobIcon,
    Task: SubagentIcon,
    WebFetch: WebIcon,
    WebSearch: WebIcon,
    TodoWrite: TodoIcon,
  };

  return iconMap[toolName] || TaskIcon;
};
```

#### 2. Create icons directory index
**File**: `claude-sports-app/src/renderer/components/icons/index.ts`
**Changes**: Export all icons

```ts
export * from './Icons';
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles without errors
- [ ] Icons can be imported from './icons'

#### Manual Verification:
- [ ] Icons render correctly in browser
- [ ] Icons scale properly with size prop
- [ ] No emojis visible in tool displays

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding.

---

## Phase 3: Update Core Components for Dark Theme

### Overview
Update existing components to use dark theme styling and remove message bubbling.

### Changes Required:

#### 1. Update ChatInterface.tsx
**File**: `claude-sports-app/src/renderer/components/ChatInterface.tsx`
**Changes**: New layout with sidebar for todos

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import TodoStatusDisplay from './TodoStatusDisplay';
import { ChatMessage, OutputFile } from './types';
import { detectTodoListInMessage, TodoItem } from './utils/todoDetection';

function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTodos, setCurrentTodos] = useState<TodoItem[]>([]);

  useEffect(() => {
    const removeResponseListener = window.electron.ipcRenderer.on(
      'claude-code:response',
      (message: SDKMessage) => {
        if (message.type === 'assistant') {
          setMessages((prev) => {
            const existingIndex = prev.findIndex(
              (m) => m.type === 'assistant' && !m.content,
            );

            const textContent = message.message.content
              .filter((c) => c.type === 'text')
              .map((c) => (c.type === 'text' ? c.text : ''))
              .join('');

            const contentBlocks = message.message.content;

            if (existingIndex >= 0) {
              const updated = [...prev];
              updated[existingIndex] = {
                ...updated[existingIndex],
                content: textContent,
                contentBlocks: contentBlocks as any,
                raw: message,
                isThinking: false,
              };

              const todos = detectTodoListInMessage(JSON.stringify(message));
              if (todos && todos.length > 0) {
                setCurrentTodos(todos);
              }
              return updated;
            }

            const newMessage = {
              id: Date.now().toString(),
              type: 'assistant',
              content: textContent,
              contentBlocks: contentBlocks as any,
              timestamp: new Date(),
              raw: message,
            };

            const todos = detectTodoListInMessage(JSON.stringify(message));
            if (todos && todos.length > 0) {
              setCurrentTodos(todos);
            }

            return [...prev, newMessage];
          });
        } else if (message.type === 'result') {
          setIsLoading(false);
        }
      },
    );

    const removeErrorListener = window.electron.ipcRenderer.on(
      'claude-code:error',
      (errorMessage: string) => {
        setError(errorMessage);
        setIsLoading(false);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            type: 'error',
            content: `Error: ${errorMessage}`,
            timestamp: new Date(),
          },
        ]);
      },
    );

    const removeOutputFilesListener = window.electron.ipcRenderer.on(
      'claude-code:output-files',
      (outputFiles: OutputFile[]) => {
        setMessages((prev) => {
          const updated = [...prev];
          const lastAssistantIndex = updated.findLastIndex(
            (m) => m.type === 'assistant',
          );

          if (lastAssistantIndex >= 0) {
            updated[lastAssistantIndex] = {
              ...updated[lastAssistantIndex],
              outputFiles,
            };
          }

          return updated;
        });
      },
    );

    return () => {
      removeResponseListener();
      removeErrorListener();
      removeOutputFilesListener();
    };
  }, []);

  const sendMessage = useCallback(
    async (content: string, files?: File[]) => {
      if ((!content.trim() && !files?.length) || isLoading) return;

      let displayContent = content;
      if (files?.length) {
        const fileList = files.map((f) => f.name).join(', ');
        displayContent = content
          ? `${content}\n\nFiles: ${fileList}`
          : `Files: ${fileList}`;
      }

      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        type: 'user',
        content: displayContent,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          type: 'assistant',
          content: '',
          timestamp: new Date(),
          isThinking: true,
        },
      ]);

      setIsLoading(true);
      setError(null);

      const sendQuery = async () => {
        let fileData: { name: string; buffer: ArrayBuffer }[] | undefined;

        if (files?.length) {
          fileData = await Promise.all(
            files.map(async (file) => ({
              name: file.name,
              buffer: await file.arrayBuffer(),
            })),
          );
        }

        window.electron.ipcRenderer.sendMessage('claude-code:query', {
          content,
          files: fileData,
        });
      };

      sendQuery();
    },
    [isLoading],
  );

  return (
    <div className="flex h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header
          className="px-6 py-3 border-b"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            borderColor: 'var(--border-color)'
          }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: 'var(--accent-orange)' }}
            />
            <h1
              className="text-sm font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              Chat
            </h1>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-hidden">
          <MessageList messages={messages} isLoading={isLoading} />
        </div>

        {/* Input */}
        <div
          className="border-t"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            borderColor: 'var(--border-color)'
          }}
        >
          <MessageInput onSendMessage={sendMessage} disabled={isLoading} />
        </div>
      </div>

      {/* Tasks Sidebar */}
      <div
        className="w-72 border-l flex flex-col"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderColor: 'var(--border-color)'
        }}
      >
        <TodoStatusDisplay todos={currentTodos} />
      </div>

      {/* Error Toast */}
      {error && (
        <div
          className="absolute top-4 right-4 px-4 py-2 rounded-md border"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            borderColor: 'var(--error-red)',
            color: 'var(--error-red)'
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

export default ChatInterface;
```

#### 2. Update MessageList.tsx
**File**: `claude-sports-app/src/renderer/components/MessageList.tsx`
**Changes**: Remove bubble positioning, dark theme

```tsx
import React, { useEffect, useRef } from 'react';
import Message from './Message';
import { ChatMessage } from './types';

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
}

function MessageList({ messages, isLoading }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div
      className="h-full overflow-y-auto px-6 py-4"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      {messages.length === 0 && (
        <div className="text-center mt-8" style={{ color: 'var(--text-muted)' }}>
          <p className="text-lg mb-2">Welcome to Claude Sports Agent</p>
          <p className="text-sm">
            Start by typing a message below and attach files to get started.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
      </div>

      {isLoading && messages[messages.length - 1]?.isThinking && (
        <div className="flex items-center gap-2 mt-4" style={{ color: 'var(--text-secondary)' }}>
          <div className="flex gap-1">
            <div
              className="w-2 h-2 rounded-full animate-bounce"
              style={{ backgroundColor: 'var(--accent-orange)', animationDelay: '0ms' }}
            />
            <div
              className="w-2 h-2 rounded-full animate-bounce"
              style={{ backgroundColor: 'var(--accent-orange)', animationDelay: '100ms' }}
            />
            <div
              className="w-2 h-2 rounded-full animate-bounce"
              style={{ backgroundColor: 'var(--accent-orange)', animationDelay: '200ms' }}
            />
          </div>
          <span className="text-sm">Claude is thinking...</span>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}

export default MessageList;
```

#### 3. Update Message.tsx
**File**: `claude-sports-app/src/renderer/components/Message.tsx`
**Changes**: Same-side messages, dark theme, no bubbles

```tsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage, ContentBlock } from './types';
import ToolUseDisplay from './ToolUseDisplay';
import ThinkingDisplay from './ThinkingDisplay';
import { UserIcon, AssistantIcon } from './icons';

interface MessageProps {
  message: ChatMessage;
}

function CodeComponent({ inline, className, children }: any) {
  if (inline) {
    return (
      <code
        className="rounded px-1 py-0.5 text-sm"
        style={{ backgroundColor: 'var(--bg-tertiary)' }}
      >
        {children}
      </code>
    );
  }
  return (
    <pre
      className="rounded-md p-3 overflow-x-auto"
      style={{ backgroundColor: 'var(--bg-tertiary)' }}
    >
      <code className={className}>{children}</code>
    </pre>
  );
}

function LinkComponent({ children, href }: any) {
  return (
    <a
      className="hover:underline"
      style={{ color: 'var(--accent-orange)' }}
      target="_blank"
      rel="noopener noreferrer"
      href={href}
    >
      {children}
    </a>
  );
}

function Message({ message }: MessageProps) {
  const isUser = message.type === 'user';
  const isError = message.type === 'error';

  const handleDownloadFile = async (filePath: string, fileName: string) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('download-file', filePath);
      if (!result.success) {
        console.error('Download failed:', result.error);
      }
    } catch (error) {
      console.error('Download error:', error);
    }
  };

  const handleOpenOutputDirectory = async () => {
    try {
      await window.electron.ipcRenderer.invoke('open-output-directory');
    } catch (error) {
      console.error('Error opening directory:', error);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className="flex gap-3">
      {/* Icon */}
      <div
        className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center mt-1"
        style={{
          backgroundColor: 'var(--bg-tertiary)',
          color: isUser ? 'var(--accent-green)' : 'var(--accent-orange)'
        }}
      >
        {isUser ? <UserIcon size={14} /> : <AssistantIcon size={14} />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Sender Label */}
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-xs font-medium"
            style={{ color: isUser ? 'var(--accent-green)' : 'var(--accent-orange)' }}
          >
            {isUser ? 'You' : 'Claude'}
          </span>
          <span
            className="text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            {message.timestamp.toLocaleTimeString()}
          </span>
        </div>

        {/* Message Content */}
        {isError ? (
          <div style={{ color: 'var(--error-red)' }}>
            {message.content}
          </div>
        ) : isUser ? (
          <p
            className="whitespace-pre-wrap text-sm"
            style={{ color: 'var(--text-primary)' }}
          >
            {message.content}
          </p>
        ) : (
          <div>
            {message.contentBlocks && message.contentBlocks.length > 0 ? (
              message.contentBlocks.map((block: ContentBlock, index: number) => {
                if (block.type === 'text') {
                  return (
                    <div key={index} className="prose prose-sm max-w-none prose-invert">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code: CodeComponent,
                          a: LinkComponent,
                        }}
                      >
                        {block.text || '...'}
                      </ReactMarkdown>
                    </div>
                  );
                } else if (block.type === 'tool_use') {
                  return <ToolUseDisplay key={index} toolUse={block} />;
                } else if (block.type === 'thinking') {
                  return <ThinkingDisplay key={index} thinking={block} />;
                }
                return null;
              })
            ) : (
              <div className="prose prose-sm max-w-none prose-invert">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code: CodeComponent,
                    a: LinkComponent,
                  }}
                >
                  {message.content || '...'}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* Output Files */}
        {message.outputFiles && message.outputFiles.length > 0 && (
          <div
            className="mt-3 pt-3 border-t"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <h4
              className="text-xs font-medium mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              Output Files ({message.outputFiles.length})
            </h4>
            <div className="space-y-2">
              {message.outputFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between rounded-md p-2 border"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    borderColor: 'var(--border-color)'
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-sm font-medium truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {file.name}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {formatFileSize(file.size)} - {new Date(file.created).toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDownloadFile(file.path, file.name)}
                    className="ml-2 px-3 py-1 text-xs rounded hover:opacity-90 transition-colors"
                    style={{
                      backgroundColor: 'var(--accent-green-dark)',
                      color: 'var(--text-primary)'
                    }}
                  >
                    Download
                  </button>
                </div>
              ))}
              <button
                onClick={handleOpenOutputDirectory}
                className="w-full text-xs underline mt-1"
                style={{ color: 'var(--text-secondary)' }}
              >
                Open output folder
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Message;
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles without errors
- [ ] No console errors in browser

#### Manual Verification:
- [ ] Messages appear on same side (left-aligned)
- [ ] No message bubbles/backgrounds
- [ ] User messages show green icon, Claude shows orange
- [ ] Timestamps visible and readable
- [ ] Dark theme applied throughout

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding.

---

## Phase 4: Update Tool and Thinking Displays

### Overview
Update ToolUseDisplay and ThinkingDisplay to use SVG icons and dark theme colors.

### Changes Required:

#### 1. Update ToolUseDisplay.tsx
**File**: `claude-sports-app/src/renderer/components/ToolUseDisplay.tsx`
**Changes**: Use SVG icons, dark theme, checkmark status

```tsx
import React, { useState } from 'react';
import { getToolIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon } from './icons';
import { ToolUseBlock } from './types';
import { formatToolInput, getFriendlyParameterName } from './utils/toolMetadata';

interface ToolUseDisplayProps {
  toolUse: ToolUseBlock;
  status?: 'running' | 'completed' | 'failed';
}

function ToolUseDisplay({ toolUse, status = 'completed' }: ToolUseDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const formattedInput = formatToolInput(toolUse.name, toolUse.input);
  const hasParameters = formattedInput.length > 0;

  const Icon = getToolIcon(toolUse.name);

  // Get one-line summary
  const getOneLiner = (): string => {
    const input = toolUse.input;
    switch (toolUse.name) {
      case 'Read':
        return input.file_path ? `${input.file_path}` : '';
      case 'Write':
      case 'Edit':
        return input.file_path ? `${input.file_path}` : '';
      case 'Bash':
        const cmd = input.command || '';
        return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd;
      case 'Grep':
        return input.pattern ? `"${input.pattern}"` : '';
      case 'Glob':
        return input.pattern ? `${input.pattern}` : '';
      case 'Task':
        return input.description || input.subagent_type || '';
      default:
        if (formattedInput.length > 0) {
          return formattedInput[0].value.substring(0, 40);
        }
        return '';
    }
  };

  const oneLiner = getOneLiner();

  return (
    <div
      className="my-2 border-l-2 rounded-sm overflow-hidden"
      style={{
        borderLeftColor: 'var(--accent-orange)',
        backgroundColor: 'var(--bg-secondary)'
      }}
    >
      <div
        className="px-3 py-2 cursor-pointer transition-colors"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
        onClick={() => hasParameters && setIsExpanded(!isExpanded)}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
      >
        <div className="flex items-center gap-2">
          {/* Status/Expand Icon */}
          {hasParameters ? (
            isExpanded ? (
              <ChevronDownIcon size={14} className="text-gray-500" />
            ) : (
              <ChevronRightIcon size={14} className="text-gray-500" />
            )
          ) : (
            <CheckIcon size={14} style={{ color: 'var(--accent-green)' }} />
          )}

          {/* Tool Icon */}
          <Icon size={14} style={{ color: 'var(--accent-orange)' }} />

          {/* Tool Name */}
          <span
            className="font-medium text-sm"
            style={{ color: 'var(--text-primary)' }}
          >
            {toolUse.name}
          </span>

          {/* One-liner */}
          {oneLiner && (
            <span
              className="text-sm truncate flex-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              {oneLiner}
            </span>
          )}

          {/* Completion checkmark */}
          {status === 'completed' && (
            <CheckIcon size={14} style={{ color: 'var(--accent-green)' }} />
          )}
        </div>
      </div>

      {/* Expanded parameters view */}
      {isExpanded && hasParameters && (
        <div
          className="border-t"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            borderColor: 'var(--border-color)'
          }}
        >
          {formattedInput.map((param, index) => (
            <div
              key={index}
              className="px-3 py-2 border-b last:border-b-0"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <div
                className="text-xs font-medium mb-1"
                style={{ color: 'var(--text-secondary)' }}
              >
                {getFriendlyParameterName(param.key)}
              </div>
              <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {param.value.includes('\n') ? (
                  <pre
                    className="rounded p-2 overflow-x-auto text-xs"
                    style={{ backgroundColor: 'var(--bg-primary)' }}
                  >
                    <code>{param.value}</code>
                  </pre>
                ) : (
                  <code
                    className="rounded px-2 py-1 text-xs break-all"
                    style={{ backgroundColor: 'var(--bg-primary)' }}
                  >
                    {param.value}
                  </code>
                )}
                {param.truncated && (
                  <span
                    className="text-xs ml-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    (truncated)
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ToolUseDisplay;
```

#### 2. Update ThinkingDisplay.tsx
**File**: `claude-sports-app/src/renderer/components/ThinkingDisplay.tsx`
**Changes**: Dark theme with orange accent (no purple)

```tsx
import React, { useState } from 'react';
import { ThinkingIcon, ChevronDownIcon, ChevronRightIcon } from './icons';
import { ThinkingBlock } from './types';

interface ThinkingDisplayProps {
  thinking: ThinkingBlock;
}

function ThinkingDisplay({ thinking }: ThinkingDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const preview = thinking.thinking.substring(0, 100);
  const hasMore = thinking.thinking.length > 100;

  return (
    <div
      className="my-2 border-l-2 rounded-sm overflow-hidden"
      style={{
        borderLeftColor: 'var(--text-muted)',
        backgroundColor: 'var(--bg-secondary)'
      }}
    >
      <div
        className="px-3 py-2 cursor-pointer transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDownIcon size={14} style={{ color: 'var(--text-muted)' }} />
          ) : (
            <ChevronRightIcon size={14} style={{ color: 'var(--text-muted)' }} />
          )}
          <ThinkingIcon size={14} style={{ color: 'var(--text-secondary)' }} />
          <span
            className="font-medium text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            Thinking
          </span>
          <span
            className="text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            Extended reasoning
          </span>
        </div>

        {/* Preview when collapsed */}
        {!isExpanded && (
          <div
            className="mt-1 text-sm italic truncate"
            style={{ color: 'var(--text-muted)' }}
          >
            {preview}{hasMore && '...'}
          </div>
        )}
      </div>

      {/* Expanded view */}
      {isExpanded && (
        <div
          className="border-t px-3 py-2"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            borderColor: 'var(--border-color)'
          }}
        >
          <div
            className="text-sm italic whitespace-pre-wrap"
            style={{ color: 'var(--text-secondary)' }}
          >
            {thinking.thinking}
          </div>
        </div>
      )}
    </div>
  );
}

export default ThinkingDisplay;
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles without errors
- [ ] Icons import correctly

#### Manual Verification:
- [ ] Tool displays show SVG icons (no emojis)
- [ ] Orange accent color for tool borders
- [ ] Checkmarks appear for completed tools
- [ ] Thinking display uses gray/muted colors (no purple)
- [ ] Expand/collapse works correctly

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding.

---

## Phase 5: Update TodoStatusDisplay for Sidebar

### Overview
Redesign TodoStatusDisplay as a sidebar panel with progress tracking.

### Changes Required:

#### 1. Update TodoStatusDisplay.tsx
**File**: `claude-sports-app/src/renderer/components/TodoStatusDisplay.tsx`
**Changes**: Sidebar format with progress bar

```tsx
import React from 'react';
import { TodoIcon, CheckIcon, SpinnerIcon } from './icons';
import { TodoItem } from './utils/todoDetection';

interface TodoStatusDisplayProps {
  todos: TodoItem[];
}

function TodoStatusDisplay({ todos }: TodoStatusDisplayProps) {
  const completed = todos.filter(t => t.status === 'completed').length;
  const inProgress = todos.filter(t => t.status === 'in_progress').length;
  const pending = todos.filter(t => t.status === 'pending').length;
  const total = todos.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;

  const getStatusStyle = (status: TodoItem['status']) => {
    switch (status) {
      case 'completed':
        return {
          color: 'var(--accent-green)',
          textDecoration: 'line-through',
          opacity: 0.7
        };
      case 'in_progress':
        return { color: 'var(--accent-orange)' };
      case 'pending':
        return { color: 'var(--text-muted)' };
      default:
        return { color: 'var(--text-primary)' };
    }
  };

  const getStatusIcon = (status: TodoItem['status']) => {
    switch (status) {
      case 'completed':
        return <CheckIcon size={12} style={{ color: 'var(--accent-green)' }} />;
      case 'in_progress':
        return <SpinnerIcon size={12} style={{ color: 'var(--accent-orange)' }} />;
      case 'pending':
        return <div className="w-3 h-3 rounded-full border" style={{ borderColor: 'var(--text-muted)' }} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-4 py-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="flex items-center gap-2 mb-2">
          <TodoIcon size={16} style={{ color: 'var(--accent-orange)' }} />
          <h2
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            TASKS
          </h2>
        </div>

        {total > 0 && (
          <>
            {/* Progress bar */}
            <div
              className="h-1 rounded-full mb-2"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  backgroundColor: 'var(--accent-green)',
                  width: `${progress}%`
                }}
              />
            </div>

            {/* Progress text */}
            <div
              className="text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              {completed} of {total} completed
            </div>
          </>
        )}
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto p-4">
        {todos.length === 0 ? (
          <div
            className="text-center text-sm py-8"
            style={{ color: 'var(--text-muted)' }}
          >
            No tasks yet
          </div>
        ) : (
          <div className="space-y-2">
            {todos.map((todo, index) => (
              <div
                key={todo.id || index}
                className="flex items-start gap-2 py-1"
              >
                <div className="flex-shrink-0 mt-0.5">
                  {getStatusIcon(todo.status)}
                </div>
                <span
                  className="text-sm leading-tight"
                  style={getStatusStyle(todo.status)}
                >
                  {todo.status === 'in_progress' && todo.activeForm
                    ? todo.activeForm
                    : todo.content}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer with timestamp */}
      {todos.length > 0 && (
        <div
          className="px-4 py-2 border-t text-xs"
          style={{
            borderColor: 'var(--border-color)',
            color: 'var(--text-muted)'
          }}
        >
          Last updated: {new Date().toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

export default TodoStatusDisplay;
```

#### 2. Update TodoItem interface
**File**: `claude-sports-app/src/renderer/components/utils/todoDetection.ts`
**Changes**: Add activeForm field to TodoItem

```ts
export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
  activeForm?: string; // Display text when in_progress
}

// ... rest of file unchanged
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles without errors

#### Manual Verification:
- [ ] Tasks panel appears on right side
- [ ] Progress bar shows completion percentage
- [ ] Completed tasks show strikethrough with green checkmark
- [ ] In-progress tasks show orange spinner
- [ ] Pending tasks show empty circle
- [ ] "X of Y completed" text accurate

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding.

---

## Phase 6: Update MessageInput for Dark Theme

### Overview
Update MessageInput component styling for dark theme.

### Changes Required:

#### 1. Update MessageInput.tsx
**File**: `claude-sports-app/src/renderer/components/MessageInput.tsx`
**Changes**: Dark theme styling, update button colors

The main changes are to the styling - updating background colors, text colors, and border colors to use CSS variables. Key changes:

- Textarea: dark background, light text, orange focus ring
- File badges: dark background with appropriate text
- Send button: green background (accent-green-dark)
- Drag overlay: dark background

```tsx
// In the return statement, update className and style props:

<div className="p-4 space-y-2">
  {/* Selected Files */}
  {selectedFiles.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {selectedFiles.map((file, index) => (
        <div
          key={`${file.name}-${index}`}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)'
          }}
        >
          {/* ... file icon ... */}
          <span className="max-w-[120px] truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => removeFile(index)}
            style={{ color: 'var(--error-red)' }}
            disabled={disabled}
          >
            {/* ... close icon ... */}
          </button>
        </div>
      ))}
    </div>
  )}

  {/* Message Input */}
  <div className="flex items-end gap-2">
    <div
      className={`flex flex-col relative gap-2 w-full ${
        isDragOver ? 'ring-2 ring-opacity-50 rounded-lg' : ''
      }`}
      style={{ ringColor: isDragOver ? 'var(--accent-orange)' : undefined }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <textarea
        ref={textareaRef}
        value={message}
        onChange={(e) => {
          setMessage(e.target.value);
          adjustTextareaHeight();
        }}
        onKeyDown={handleKeyDown}
        placeholder="Type a message... (Shift+Enter for new line)"
        disabled={disabled}
        className="w-full resize-none rounded-lg border px-4 py-3 pr-10 focus:outline-none focus:ring-2 disabled:cursor-not-allowed"
        style={{
          backgroundColor: 'var(--bg-tertiary)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-primary)',
        }}
        rows={1}
      />
      <div className="flex justify-between w-full">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          style={{ color: 'var(--text-secondary)' }}
          className="hover:underline focus:outline-none text-sm"
        >
          Attach Files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".xlsx,.xls,.pdf,.docx,.doc"
          onChange={handleFileInputChange}
          className="hidden"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || (!message.trim() && selectedFiles.length === 0) || isUploading}
          className="px-4 py-1 rounded-lg hover:opacity-90 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[70px]"
          style={{
            backgroundColor: 'var(--accent-green-dark)',
            color: 'var(--text-primary)'
          }}
        >
          {isUploading ? (
            <SpinnerIcon size={16} className="mx-auto" />
          ) : (
            'Send'
          )}
        </button>
      </div>
    </div>
  </div>

  {isDragOver && (
    <div
      className="text-xs text-center"
      style={{ color: 'var(--text-secondary)' }}
    >
      Drop files to attach
    </div>
  )}
</div>
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles without errors

#### Manual Verification:
- [ ] Input area has dark background
- [ ] Text is visible (white on dark)
- [ ] Send button is green
- [ ] File badges visible with proper contrast
- [ ] Drag-and-drop visual feedback works

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding.

---

## Phase 7: Create AppWithTabs Wrapper

### Overview
Create the AppWithTabs parent component as specified in the design (single Chat tab for now).

### Changes Required:

#### 1. Create AppWithTabs.tsx
**File**: `claude-sports-app/src/renderer/components/AppWithTabs.tsx`
**Changes**: New component

```tsx
import React from 'react';
import ChatInterface from './ChatInterface';

function AppWithTabs() {
  return (
    <div
      className="h-screen flex flex-col"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      {/* Tab Bar */}
      <div
        className="flex items-center px-4 py-2 border-b"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderColor: 'var(--border-color)'
        }}
      >
        {/* Single Chat Tab */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-t border-b-2"
          style={{
            backgroundColor: 'var(--bg-primary)',
            borderBottomColor: 'var(--accent-orange)',
            color: 'var(--text-primary)'
          }}
        >
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: 'var(--accent-orange)' }}
          />
          <span className="text-sm font-medium">Chat</span>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        <ChatInterface />
      </div>
    </div>
  );
}

export default AppWithTabs;
```

#### 2. Update App.tsx
**File**: `claude-sports-app/src/renderer/App.tsx`
**Changes**: Use AppWithTabs

```tsx
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import AppWithTabs from './components/AppWithTabs';
import './App.css';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<AppWithTabs />} />
      </Routes>
    </Router>
  );
}
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles without errors
- [ ] App starts without errors

#### Manual Verification:
- [ ] Tab bar visible at top
- [ ] "Chat" tab shows with orange indicator
- [ ] Content area displays ChatInterface correctly
- [ ] Overall layout matches design spec

**Implementation Note**: After completing this phase, pause for manual confirmation before proceeding.

---

## Testing Strategy

### Unit Tests:
- Icon components render without errors
- TodoStatusDisplay calculates progress correctly
- Message component renders all content block types

### Integration Tests:
- IPC communication still works after refactor
- File upload functionality preserved
- Todo detection still works

### Manual Testing Steps:
1. Start the app and verify dark theme loads
2. Send a message and verify display
3. Attach a file and verify upload
4. Trigger a TodoWrite tool and verify sidebar updates
5. Verify tool calls display with checkmarks
6. Verify thinking blocks expand/collapse
7. Check for any purple colors (should be none)
8. Test scrolling in message list and todo list

## Performance Considerations

- CSS variables allow theme switching without re-renders
- Map data structures for O(1) todo lookups
- Memoization for expensive icon lookups via getToolIcon

## Migration Notes

- No database changes required
- Preserve existing IPC channels and message format
- Maintain backward compatibility with existing message types

## References

- Specification files: `/Users/jakewallin/claude-sports/specs/redesign-txt/IMG_1646.md` through `IMG_1667.md`
- Reference images: `/Users/jakewallin/claude-sports/specs/redesign-pics-jpg/IMG_1646.jpg`, `IMG_1647.jpg`
- UI Analysis: `/Users/jakewallin/claude-sports/specs/redesign-pics/UI_ANALYSIS.md`
- Current codebase: `/Users/jakewallin/claude-sports/claude-sports-app/src/renderer/`
