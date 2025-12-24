# Admin Dev Mode and Session State Persistence Implementation Plan

## Overview

Implement a "dev mode" for admins that displays ALL tool calls in a message list (not ephemeral), shows expandable subagent tool calls in a tabbed right panel, and persists the full session state to `.session-state.json` for debugging. Also enable admins to view historical user sessions with full tool call traces.

---

## ⚠️ HANDOFF NOTES (2025-12-23)

### Current Status: Phases 1-7 COMPLETE, Phase 8 NOT STARTED

**What's Working:**
- ✅ Server persists `.session-state.json` with full SDK message stream
- ✅ `isAdmin` exposed to frontend via AuthContext
- ✅ Dev mode toggle visible for admins, persists to localStorage
- ✅ Raw messages collected during streaming (for dev mode display)
- ✅ DevModeMessageList component renders full message trace
- ✅ RightPanel shows subagent tabs with live-updating messages
- ✅ Toggling between User Mode and Dev Mode preserves all state

### Critical Bugs Fixed (not in original plan):

#### 1. Stale Closure in Subagent Tabs
**Problem:** `openSubagentTab()` captured a snapshot of messages at open time. Tab never updated as new messages streamed in.

**Fix:** Changed `SubagentTab` interface to NOT store messages. Messages are now derived from `subagentRawMessages` Map at render time in `RightPanel.tsx`:
```typescript
// SubagentTab only stores id + label (NOT messages)
interface SubagentTab {
  id: string;
  label: string;
}

// RightPanel derives messages from live Map
const activeSubagentMessages = subagentRawMessages.get(activeSubagent.id) || [];
```

#### 2. Raw Messages Only Collected When Dev Mode ON
**Problem:** Original plan had `if (isDevMode) { collect raw messages }`. Toggling to dev mode mid-conversation showed empty message list.

**Fix:** Always collect raw messages regardless of mode. The toggle only affects which component renders:
```typescript
// ChatInterface.tsx - ALWAYS collect (no isDevMode check)
{
  const parentToolUseId = (message as any).parent_tool_use_id;
  if (parentToolUseId) {
    setSubagentRawMessages(prev => { ... });
  } else {
    setRawMessages(prev => [...prev, message]);
  }
}

// Toggle only affects display:
{isDevMode ? <DevModeMessageList /> : <MessageList />}
```

### Architecture Diagram (Current State):
```
Stream Messages ──┬──> rawMessages / subagentRawMessages (ALWAYS collected)
                  │
                  └──> timeline / messagesMap / subagentsMap (ALWAYS processed)

isDevMode toggle ────> Swaps which component renders (no data loss)
```

### Files Modified (beyond original plan):
- `DevModeContext.tsx` - Added `rawMessages`, `subagentRawMessages`, `subagentTabs`, `openSubagentTab`, `closeSubagentTab` to context
- `RightPanel.tsx` - Derives messages from Map instead of storing in tabs
- `ChatInterface.tsx` - Removed `isDevMode` gate on raw message collection

### What's Left (Phase 8):
- Admin session history endpoints (`/admin/all`, `/admin/:id/history`)
- Admin session list UI in FileExplorer
- Historical session viewer component

---

## Current State Analysis

### Server-Side (`apps/server/src/routes/agent.ts`)
- Query endpoint streams SSE messages (lines 143-172)
- Only text content is saved to database (lines 220-226) - NOT full SDK message structure
- Session directories created in `data/` folder
- `user.isAdmin` is already available from auth middleware (`apps/server/src/middleware/auth.ts:43`)

### Frontend (`apps/web/src/`)
- **Timeline + Maps pattern** in ChatInterface.tsx (lines 64-68):
  - `timeline: TimelineItem[]` - ordered sequence for rendering
  - `messagesMap: Map<string, ChatMessage>` - message content
  - `subagentsMap: Map<string, Subagent>` - subagent state with tool calls
- **FileViewerTabs.tsx** - Already a tabbed interface for files, can be extended for subagent tabs
- **Layout.tsx** - Three-panel layout with resizable right panel
- **SubagentViewer.tsx** - Shows expandable tool calls list
- **AuthContext.tsx** - Does NOT expose isAdmin yet (only user/session)

### Key Discoveries:
- `isAdmin` is already fetched from profiles table in auth middleware (`auth.ts:34-38`)
- Subagent tool calls already tracked in `subagentsMap` with `toolCalls[]` array
- `parent_tool_use_id` on SDK messages identifies which subagent a tool belongs to

## Desired End State

After implementation:
1. Admins see a "Dev Mode" toggle in the header
2. When enabled, ALL tool calls display chronologically (not just collapsed in SubagentViewer)
3. Clicking a subagent opens its full message list in a new tab on the right panel
4. Server persists `.session-state.json` with full SDK message stream after each query
5. Admins can view ANY user's historical session in dev mode via "View History" button

### Verification:
- Toggle dev mode → see all tool calls inline with messages
- Click subagent → opens tab showing that subagent's message stream
- Check session directory → `.session-state.json` exists with full messages array
- View History button → loads old session with full trace

## What We're NOT Doing

- Multi-session comparison (deferred)
- Advanced filtering/search within sessions (deferred)
- Real-time collaborative viewing
- Session state download endpoint (state is for backend analysis only)

## Implementation Approach

The implementation follows these principles:
1. **Server-first**: Persist session state file before frontend changes
2. **Progressive enhancement**: Dev mode is additive, doesn't change default behavior
3. **Component reuse**: Same `DevModeMessageList` for main agent AND subagent displays
4. **Admin-only**: All features gated by `isAdmin` check

---

## Phase 1: Server-Side Session State Persistence

### Overview
Collect ALL SDK messages during streaming and write to `.session-state.json` after query completes.

### Changes Required:

#### 1. Create SessionState Type
**File**: `packages/shared/src/types.ts`
**Changes**: Add new interface at end of file

```typescript
// Session state for dev mode debugging
export interface SessionState {
  version: string;
  sessionId: string;
  sessionName: string;
  agentId: string;
  userId: string;
  startTime: string;
  endTime?: string;
  messages: SDKMessage[];  // Full SDK message stream
  metadata: {
    totalTokens: number;
    totalCost: number;
    toolCallCount: number;
    subagentCount: number;
  };
}

// Re-export SDKMessage from SDK for convenience
export type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
```

#### 2. Modify Query Endpoint to Collect Messages
**File**: `apps/server/src/routes/agent.ts`
**Changes**: Add message collection and file writing

After line 138 (`return streamSSE(c, async (stream) => {`), add session state initialization:

```typescript
// Inside streamSSE callback, after line 140:
import { writeFile } from 'fs/promises';
import type { SessionState } from '@agent-app/shared';

// Initialize session state collector
const sessionState: SessionState = {
  version: '1.0',
  sessionId: '', // Will be set on init message
  sessionName,
  agentId,
  userId: user.id,
  startTime: new Date().toISOString(),
  messages: [],
  metadata: {
    totalTokens: 0,
    totalCost: 0,
    toolCallCount: 0,
    subagentCount: 0,
  },
};
```

Modify the message processing loop (around line 154):

```typescript
for await (const message of queryIterator) {
  // Collect ALL messages for session state
  sessionState.messages.push(message);

  // Capture SDK session ID from init message
  if (message.type === 'system' && (message as any).subtype === 'init') {
    sdkSessionId = message.session_id;
    sessionState.sessionId = sdkSessionId || '';
    console.log('[AGENT] SDK Session ID:', sdkSessionId);
  }

  // Count tool calls for metadata
  if (message.type === 'assistant') {
    const content = (message as any).message?.content;
    if (Array.isArray(content)) {
      const toolUses = content.filter((b: any) => b.type === 'tool_use');
      sessionState.metadata.toolCallCount += toolUses.length;
      sessionState.metadata.subagentCount += toolUses.filter(
        (b: any) => b.name === 'Task'
      ).length;
    }
  }

  // Capture usage stats from result message
  if (message.type === 'result' && (message as any).subtype === 'success') {
    sessionState.metadata.totalTokens = (message as any).usage?.total_tokens || 0;
    sessionState.metadata.totalCost = (message as any).cost_usd || 0;
  }

  // Accumulate assistant text content (existing logic)
  if (message.type === 'assistant') {
    const textContent = extractTextContent(message);
    if (textContent) {
      assistantContent += textContent;
    }
  }

  await stream.writeSSE({
    data: JSON.stringify(message),
  });
}
```

After query completes (around line 218, before `// Save messages`), add:

```typescript
// Write session state file
sessionState.endTime = new Date().toISOString();
try {
  await writeFile(
    path.join(sessionDir, '.session-state.json'),
    JSON.stringify(sessionState, null, 2)
  );
  console.log('[AGENT] Session state saved:', path.join(sessionDir, '.session-state.json'));
} catch (stateError) {
  console.error('[AGENT] Failed to save session state:', stateError);
}
```

#### 3. Update File Flush to Include Session State
**File**: `apps/server/src/services/files.ts`
**Changes**: Modify `flushSessionFolder` to persist `.session-state.json`

In `flushSessionFolder` function (line 286), update the glob pattern and add exception for session state:

```typescript
// Find all files in session directory (including .session-state.json)
const files = await glob('**/*', {
  cwd: sessionDir,
  nodir: true,
  dot: true, // Changed from false to true to include dotfiles
});
```

Add special handling for `.session-state.json` around line 296:

```typescript
for (const relativePath of files) {
  // Special handling for session state file - always persist to user storage
  const isSessionState = relativePath === '.session-state.json';

  // Skip agent config files (CLAUDE.md, .claude/) - these are never persisted
  if (!isSessionState && isAgentConfigFile(relativePath)) {
    console.log('[FILES] Skipping agent config file:', relativePath);
    continue;
  }

  // For session state, always persist to user storage (not shared)
  const persistToShared = isSessionState ? false : isShared;

  // ... rest of existing logic, using persistToShared instead of isShared
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `pnpm run --filter @agent-app/server typecheck`
- [x] TypeScript compiles: `pnpm run --filter @agent-app/shared typecheck`
- [x] Server starts without errors: `pnpm run --filter @agent-app/server dev`
- [x] Query endpoint still works: Send test query via frontend

#### Manual Verification:
- [x] After sending a message, check `data/{sessionName}/.session-state.json` exists
- [x] File contains `messages` array with SDK messages including tool_use blocks
- [x] File contains `metadata` with token/tool counts
- [x] Session state file appears in Supabase Storage under user's session

**✅ PHASE 1 COMPLETE**

---

## Phase 2: Expose isAdmin to Frontend

### Overview
Add `isAdmin` to the auth context and API response so frontend can conditionally render dev mode UI.

### Changes Required:

#### 1. Update API User Response
**File**: `apps/server/src/routes/auth.ts`
**Changes**: Include `isAdmin` in user endpoint response (if exists, otherwise add endpoint)

If there's a `/me` endpoint, ensure it returns isAdmin. If not, we already have `/api/agent/me`:

**File**: `apps/server/src/routes/agent.ts` (line 26-29)

```typescript
// Already exists, just verify isAdmin is included:
agentRouter.get('/me', (c) => {
  const user = c.get('user');
  return c.json({ user }); // user already has isAdmin from middleware
});
```

#### 2. Update AuthContext to Fetch and Expose isAdmin
**File**: `apps/web/src/contexts/AuthContext.tsx`
**Changes**: Add isAdmin to context value

Update interface (after line 6):

```typescript
interface AuthContextType {
  user: (User & { isAdmin?: boolean }) | null;  // Extended with isAdmin
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}
```

Add effect to fetch admin status (after line 43):

```typescript
// Fetch admin status after auth session is established
useEffect(() => {
  const fetchAdminStatus = async () => {
    if (!session?.access_token || !user) return;

    try {
      const response = await fetch('/api/agent/me', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        if (data.user?.isAdmin !== undefined) {
          setUser(prev => prev ? { ...prev, isAdmin: data.user.isAdmin } : prev);
        }
      }
    } catch (error) {
      console.error('Failed to fetch admin status:', error);
    }
  };

  fetchAdminStatus();
}, [session?.access_token, user?.id]);
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `pnpm run --filter @agent-app/web typecheck`
- [x] Frontend builds: `pnpm run --filter @agent-app/web build`

#### Manual Verification:
- [x] Login as admin user → `user.isAdmin` is `true` in React DevTools
- [x] Login as regular user → `user.isAdmin` is `false` or undefined

**✅ PHASE 2 COMPLETE**

---

## Phase 3: Dev Mode Context and Toggle

### Overview
Create a DevMode context to manage dev mode state and add a toggle button visible only to admins.

### Changes Required:

#### 1. Create DevModeContext
**File**: `apps/web/src/contexts/DevModeContext.tsx` (NEW FILE)

```typescript
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useAuth } from './AuthContext';

interface DevModeContextType {
  isDevMode: boolean;
  setDevMode: (enabled: boolean) => void;
  isAdmin: boolean;
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
    <DevModeContext.Provider value={{ isDevMode, setDevMode, isAdmin }}>
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
```

#### 2. Add Provider to App
**File**: `apps/web/src/App.tsx`
**Changes**: Wrap with DevModeProvider

```typescript
import { DevModeProvider } from '@/contexts/DevModeContext';

// In the return, wrap inside AuthProvider:
<AuthProvider>
  <DevModeProvider>
    <SessionProvider>
      <FileProvider>
        {/* ... rest of app */}
      </FileProvider>
    </SessionProvider>
  </DevModeProvider>
</AuthProvider>
```

#### 3. Add Dev Mode Toggle to Header
**File**: `apps/web/src/components/ChatInterface.tsx`
**Changes**: Add toggle button in header (around line 503-524)

Add import:
```typescript
import { useDevMode } from '@/contexts/DevModeContext';
```

Add hook usage (after line 57):
```typescript
const { isDevMode, setDevMode, isAdmin } = useDevMode();
```

In header section (around line 505), add toggle before "New Chat":

```typescript
<div className="flex items-center gap-4">
  {/* Dev Mode Toggle - Admin Only */}
  {isAdmin && (
    <button
      onClick={() => setDevMode(!isDevMode)}
      className={`text-xs px-2 py-1 rounded ${
        isDevMode
          ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
          : 'bg-card text-muted-foreground border border-border'
      }`}
    >
      {isDevMode ? 'Dev Mode' : 'User Mode'}
    </button>
  )}

  {currentSession && (
    <span className="text-xs text-muted-foreground font-mono">
      Session: {currentSession.session_name}
    </span>
  )}
  {/* ... rest of existing buttons */}
</div>
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `pnpm run --filter @agent-app/web typecheck`
- [x] Frontend builds: `pnpm run --filter @agent-app/web build`
- [x] No console errors on page load

#### Manual Verification:
- [x] Login as admin → Dev Mode toggle visible in header
- [x] Login as regular user → Dev Mode toggle NOT visible
- [x] Toggle persists across page refresh (localStorage)

**✅ PHASE 3 COMPLETE**

---

## Phase 4: Full Message Stream Collection in Frontend

### Overview
Extend ChatInterface to collect ALL SDK messages (not just the processed ones), storing them for display.

**⚠️ IMPLEMENTATION NOTE:** Original plan had `if (isDevMode)` gate. This was changed to ALWAYS collect messages regardless of mode - see Handoff Notes above.

### Changes Required:

#### 1. Add Raw Messages State
**File**: `apps/web/src/components/ChatInterface.tsx`
**Changes**: Add state for raw SDK messages

After line 68 (`const [addedSubagentIds, setAddedSubagentIds] = useState...`):

```typescript
// Dev mode: collect raw SDK messages for full trace display
const [rawMessages, setRawMessages] = useState<any[]>([]);
const [subagentRawMessages, setSubagentRawMessages] = useState<Map<string, any[]>>(new Map());
```

#### 2. Collect Messages During Streaming
**File**: `apps/web/src/components/ChatInterface.tsx`
**Changes**: Store raw messages when dev mode is enabled

In the streaming loop (around line 231, inside `for await`):

```typescript
for await (const message of streamAgentQuery(content, sessionName, existingSdkSessionId)) {
  // Dev mode: collect raw messages
  if (isDevMode) {
    const parentToolUseId = (message as any).parent_tool_use_id;
    if (parentToolUseId) {
      // Subagent message
      setSubagentRawMessages(prev => {
        const updated = new Map(prev);
        const existing = updated.get(parentToolUseId) || [];
        updated.set(parentToolUseId, [...existing, message]);
        return updated;
      });
    } else {
      // Main agent message
      setRawMessages(prev => [...prev, message]);
    }
  }

  // ... rest of existing message handling
```

#### 3. Clear Raw Messages on New Session
**File**: `apps/web/src/components/ChatInterface.tsx`
**Changes**: Reset raw messages when starting new session

In `handleNewSessionSubmit` (around line 165-169):

```typescript
// Clear any previous state explicitly
setTimeline([]);
setMessagesMap(new Map());
setSubagentsMap(new Map());
setAddedSubagentIds(new Set());
setRawMessages([]);  // Add this
setSubagentRawMessages(new Map());  // Add this
clearFiles();
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `pnpm run --filter @agent-app/web typecheck`
- [x] No console errors during streaming

#### Manual Verification:
- [x] Enable dev mode, send message
- [x] In React DevTools, verify `rawMessages` state contains all SDK messages
- [x] Verify `subagentRawMessages` contains messages grouped by parent_tool_use_id
- [x] **ADDED:** Toggle to user mode mid-conversation → no data loss
- [x] **ADDED:** Toggle back to dev mode → all messages still present

**✅ PHASE 4 COMPLETE**

---

## Phase 5: Dev Mode Message List Component

### Overview
Create a reusable component that displays the full message stream with all tool calls visible.

### Changes Required:

#### 1. Create DevModeMessageList Component
**File**: `apps/web/src/components/DevModeMessageList.tsx` (NEW FILE)

```typescript
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface DevModeMessageListProps {
  messages: any[];  // Raw SDK messages
  onSubagentClick?: (toolUseId: string, description: string) => void;
}

// Extract text content from SDK message
function extractText(message: any): string {
  if (message.type !== 'assistant') return '';
  const content = message.message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text || '')
    .join('');
}

// Get one-liner for tool call
function getToolOneLiner(name: string, input: any): string {
  switch (name) {
    case 'Read':
      return input.file_path?.split('/').pop() || '';
    case 'Write':
    case 'Edit':
      return input.file_path?.split('/').pop() || '';
    case 'Bash':
      const cmd = input.command || '';
      return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd;
    case 'Grep':
      return input.pattern ? `"${input.pattern}"` : '';
    case 'Glob':
      return input.pattern || '';
    case 'WebSearch':
      return input.query ? `"${input.query}"` : '';
    case 'WebFetch':
      try {
        return input.url ? new URL(input.url).hostname : '';
      } catch {
        return input.url?.substring(0, 30) || '';
      }
    case 'Task':
      return input.description || input.subagent_type || '';
    default:
      return '';
  }
}

// Message type badge
function MessageBadge({ type, subtype }: { type: string; subtype?: string }) {
  const colors: Record<string, string> = {
    user: 'bg-blue-500/20 text-blue-400',
    assistant: 'bg-green-500/20 text-green-400',
    system: 'bg-gray-500/20 text-gray-400',
    result: 'bg-purple-500/20 text-purple-400',
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded ${colors[type] || 'bg-gray-500/20'}`}>
      {type}{subtype ? `:${subtype}` : ''}
    </span>
  );
}

// Tool call display
function ToolCallItem({
  name,
  input,
  id,
  onSubagentClick
}: {
  name: string;
  input: any;
  id: string;
  onSubagentClick?: (id: string, desc: string) => void;
}) {
  const oneLiner = getToolOneLiner(name, input);
  const isTask = name === 'Task';

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 text-sm border-l-2 ${
        isTask
          ? 'border-purple-500 cursor-pointer hover:bg-purple-500/10'
          : 'border-orange-500/50'
      }`}
      onClick={() => isTask && onSubagentClick?.(id, input.description || input.subagent_type || 'Subagent')}
    >
      <span className={`font-medium ${isTask ? 'text-purple-400' : 'text-orange-400'}`}>
        {name}
      </span>
      {oneLiner && (
        <span className="text-muted-foreground truncate">
          ({oneLiner})
        </span>
      )}
      {isTask && (
        <span className="ml-auto text-xs text-muted-foreground">
          Click to view →
        </span>
      )}
    </div>
  );
}

export function DevModeMessageList({ messages, onSubagentClick }: DevModeMessageListProps) {
  return (
    <div className="space-y-2 text-sm">
      {messages.map((msg, index) => {
        // User message
        if (msg.type === 'user') {
          return (
            <div key={index} className="p-3 bg-blue-500/10 rounded border border-blue-500/20">
              <div className="flex items-center gap-2 mb-2">
                <MessageBadge type="user" />
              </div>
              <div className="text-foreground">
                {typeof msg.message === 'string'
                  ? msg.message
                  : msg.message?.content?.[0]?.text || JSON.stringify(msg.message)}
              </div>
            </div>
          );
        }

        // Assistant message with content blocks
        if (msg.type === 'assistant') {
          const content = msg.message?.content;
          const text = extractText(msg);
          const toolUses = Array.isArray(content)
            ? content.filter((b: any) => b.type === 'tool_use')
            : [];

          return (
            <div key={index} className="p-3 bg-card rounded border border-border">
              <div className="flex items-center gap-2 mb-2">
                <MessageBadge type="assistant" />
              </div>

              {/* Text content */}
              {text && (
                <div className="prose prose-invert prose-sm max-w-none mb-2">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                </div>
              )}

              {/* Tool calls */}
              {toolUses.length > 0 && (
                <div className="space-y-1 mt-2">
                  {toolUses.map((tool: any, i: number) => (
                    <ToolCallItem
                      key={tool.id || i}
                      id={tool.id}
                      name={tool.name}
                      input={tool.input}
                      onSubagentClick={onSubagentClick}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        }

        // System message
        if (msg.type === 'system') {
          return (
            <div key={index} className="p-2 bg-gray-500/10 rounded text-xs text-muted-foreground">
              <MessageBadge type="system" subtype={msg.subtype} />
              {msg.session_id && (
                <span className="ml-2 font-mono">Session: {msg.session_id.slice(0, 8)}...</span>
              )}
            </div>
          );
        }

        // Result message
        if (msg.type === 'result') {
          return (
            <div key={index} className="p-2 bg-purple-500/10 rounded border border-purple-500/20">
              <div className="flex items-center gap-2">
                <MessageBadge type="result" subtype={msg.subtype} />
                {msg.subtype === 'success' && (
                  <span className="text-green-400">✓</span>
                )}
              </div>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `pnpm run --filter @agent-app/web typecheck`
- [x] Component exports correctly

#### Manual Verification:
- [x] Component renders without errors when imported

**✅ PHASE 5 COMPLETE**

---

## Phase 6: Tabbed Right Panel for Subagents

### Overview
Extend the right panel to show subagent message lists in tabs alongside files.

**⚠️ IMPLEMENTATION NOTE:** Original plan stored `messages[]` in `SubagentTab`. This caused a stale closure bug - tabs never updated as new messages streamed in. Fixed by deriving messages from `subagentRawMessages` Map at render time. See Handoff Notes above.

### Changes Required:

#### 1. Create Combined Panel Component
**File**: `apps/web/src/components/RightPanel.tsx` (NEW FILE)

```typescript
import { useState } from 'react';
import { FileViewerTabs } from './FileViewerTabs';
import { DevModeMessageList } from './DevModeMessageList';
import { useDevMode } from '@/contexts/DevModeContext';
import { XIcon } from './Icons';

interface SubagentTab {
  id: string;
  label: string;
  messages: any[];
}

interface RightPanelProps {
  subagentTabs: SubagentTab[];
  onCloseSubagentTab: (id: string) => void;
  onSubagentClick?: (toolUseId: string, description: string) => void;
}

type TabType = 'files' | string;  // 'files' or subagent ID

export function RightPanel({ subagentTabs, onCloseSubagentTab, onSubagentClick }: RightPanelProps) {
  const { isDevMode } = useDevMode();
  const [activeTab, setActiveTab] = useState<TabType>('files');

  // If not in dev mode, just show files
  if (!isDevMode) {
    return <FileViewerTabs />;
  }

  const activeSubagent = subagentTabs.find(t => t.id === activeTab);

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
          <span className="text-sm">📁 Files</span>
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
            <span className="text-purple-400">⚡</span>
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
              messages={activeSubagent.messages}
              onSubagentClick={onSubagentClick}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

#### 2. Update Layout to Use RightPanel
**File**: `apps/web/src/components/Layout.tsx`
**Changes**: Replace FileViewerTabs with RightPanel and add state for subagent tabs

```typescript
import { useState, type ReactNode, type MouseEvent } from 'react';
import { FileExplorer } from './FileExplorer';
import { RightPanel } from './RightPanel';
import { useFiles } from '@/contexts/FileContext';
import { useSessions } from '@/contexts/SessionContext';
import { useDevMode } from '@/contexts/DevModeContext';
import type { AgentFile } from '@/types';

interface SubagentTab {
  id: string;
  label: string;
  messages: any[];
}

interface LayoutProps {
  children: ReactNode;
  subagentRawMessages?: Map<string, any[]>;
}

export function Layout({ children, subagentRawMessages }: LayoutProps) {
  const { openFile, openTabs } = useFiles();
  const { currentSession } = useSessions();
  const { files } = useFiles();
  const { isDevMode } = useDevMode();

  const [leftPanelWidth, setLeftPanelWidth] = useState(240);
  const [rightPanelWidth, setRightPanelWidth] = useState(400);
  const [subagentTabs, setSubagentTabs] = useState<SubagentTab[]>([]);

  // Show right panel if:
  // 1. There are open tabs, OR
  // 2. An old session with files is selected, OR
  // 3. Dev mode with subagent tabs open
  const showRightPanel = openTabs.length > 0 || (currentSession && files.length > 0) || (isDevMode && subagentTabs.length > 0);

  const handleFileClick = async (file: AgentFile) => {
    await openFile(file);
  };

  const handleSubagentClick = (toolUseId: string, description: string) => {
    // Check if tab already exists
    if (subagentTabs.some(t => t.id === toolUseId)) {
      return; // Already open
    }

    // Get messages for this subagent
    const messages = subagentRawMessages?.get(toolUseId) || [];

    setSubagentTabs(prev => [...prev, {
      id: toolUseId,
      label: description,
      messages,
    }]);
  };

  const handleCloseSubagentTab = (id: string) => {
    setSubagentTabs(prev => prev.filter(t => t.id !== id));
  };

  // ... rest of existing resize handlers ...

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

      {/* Right Panel */}
      {showRightPanel && (
        <div
          className="flex-shrink-0 h-full border-l border-border"
          style={{ width: rightPanelWidth }}
        >
          <RightPanel
            subagentTabs={subagentTabs}
            onCloseSubagentTab={handleCloseSubagentTab}
            onSubagentClick={handleSubagentClick}
          />
        </div>
      )}
    </div>
  );
}
```

#### 3. Pass subagentRawMessages from ChatInterface to Layout
This requires lifting state or using context. For simplicity, we'll add it to a new DevMode context state.

**File**: `apps/web/src/contexts/DevModeContext.tsx`
**Changes**: Add subagentRawMessages state

```typescript
// Add to context type:
interface DevModeContextType {
  isDevMode: boolean;
  setDevMode: (enabled: boolean) => void;
  isAdmin: boolean;
  subagentRawMessages: Map<string, any[]>;
  setSubagentRawMessages: React.Dispatch<React.SetStateAction<Map<string, any[]>>>;
  rawMessages: any[];
  setRawMessages: React.Dispatch<React.SetStateAction<any[]>>;
}

// Add state in provider:
const [rawMessages, setRawMessages] = useState<any[]>([]);
const [subagentRawMessages, setSubagentRawMessages] = useState<Map<string, any[]>>(new Map());

// Include in value:
value={{
  isDevMode,
  setDevMode,
  isAdmin,
  rawMessages,
  setRawMessages,
  subagentRawMessages,
  setSubagentRawMessages,
}}
```

Then ChatInterface uses `useDevMode()` to set messages, and Layout uses it to read.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `pnpm run --filter @agent-app/web typecheck`
- [x] Frontend builds: `pnpm run --filter @agent-app/web build`

#### Manual Verification:
- [x] In dev mode, right panel shows "Files" tab
- [x] Clicking a Task tool call in the main message list opens a subagent tab
- [x] Subagent tab shows that subagent's message stream
- [x] Closing subagent tab works correctly
- [x] **ADDED:** Subagent tab updates LIVE as new messages stream in (stale closure fix)

**✅ PHASE 6 COMPLETE**

---

## Phase 7: Dev Mode Message Display in Main Chat

### Overview
When dev mode is enabled, replace the standard MessageList with DevModeMessageList in the main chat area.

### Changes Required:

#### 1. Conditional Rendering in ChatInterface
**File**: `apps/web/src/components/ChatInterface.tsx`
**Changes**: Render DevModeMessageList when dev mode is enabled

Import the component:
```typescript
import { DevModeMessageList } from './DevModeMessageList';
```

In `renderChatView` (around line 481-497), add conditional:

```typescript
const renderChatView = () => (
  <>
    {/* Messages */}
    <main className="flex-1 overflow-y-auto p-4">
      {isDevMode ? (
        <DevModeMessageList
          messages={rawMessages}
          onSubagentClick={(id, desc) => {
            // This will be handled by the Layout/RightPanel
            // We need to lift this up - will be done via context
          }}
        />
      ) : (
        <MessageList
          timeline={timeline}
          messagesMap={messagesMap}
          subagentsMap={subagentsMap}
        />
      )}
      <div ref={messagesEndRef} />
    </main>

    {/* Input */}
    <footer className="border-t border-border p-4 flex-shrink-0">
      <MessageInput onSend={handleSend} disabled={isStreaming} />
    </footer>
  </>
);
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `pnpm run --filter @agent-app/web typecheck`
- [x] Frontend builds: `pnpm run --filter @agent-app/web build`

#### Manual Verification:
- [x] Dev mode OFF: Standard message list with collapsed tool calls
- [x] Dev mode ON: Full message stream with all tool calls visible
- [x] Clicking Task tool opens subagent in right panel tab

**✅ PHASE 7 COMPLETE**

---

## Phase 8: Admin Session History View (NOT STARTED)

### Overview
Allow admins to view any user's historical session with full dev mode trace by loading from `.session-state.json`.

### Changes Required:

#### 1. Add Admin Sessions Endpoint
**File**: `apps/server/src/routes/sessions.ts`
**Changes**: Add endpoint for admins to list all sessions

After line 33 (after the user sessions endpoint):

```typescript
// Admin: List ALL sessions
sessionsRouter.get('/admin/all', async (c) => {
  const user = c.get('user');

  if (!user.isAdmin) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const { data, error } = await supabase
    .from('sessions')
    .select(`
      *,
      file_count:agent_files(count),
      profiles!sessions_user_id_fkey(email)
    `)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  const sessions = (data || []).map(s => ({
    ...s,
    file_count: s.file_count?.[0]?.count || 0,
    user_email: s.profiles?.email || 'Unknown',
  }));

  return c.json({ sessions });
});
```

#### 2. Add Session History Endpoint
**File**: `apps/server/src/routes/sessions.ts`
**Changes**: Add endpoint to get session state file

```typescript
// Admin: Get session history (full trace from .session-state.json)
sessionsRouter.get('/admin/:id/history', async (c) => {
  const user = c.get('user');

  if (!user.isAdmin) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const sessionId = c.req.param('id');

  // Get session info to find the session name
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('session_name, user_id')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  // Try to get session state from storage
  const storagePath = `${session.user_id}/${session.session_name}/.session-state.json`;

  const { data, error } = await supabase.storage
    .from('agent-files')
    .download(storagePath);

  if (error) {
    // Try to reconstruct from messages if no session state file
    const { data: messages } = await supabase
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    return c.json({
      session,
      messages: messages || [],
      source: 'reconstructed',
    });
  }

  const text = await data.text();
  const sessionState = JSON.parse(text);

  return c.json({
    session,
    sessionState,
    source: 'session-state-file',
  });
});
```

#### 3. Add API Functions
**File**: `apps/web/src/lib/api.ts`
**Changes**: Add functions to call admin endpoints

```typescript
// Admin: Get all sessions
export async function getAdminSessions(): Promise<any[]> {
  const response = await fetchWithAuth('/api/sessions/admin/all');
  if (!response.ok) {
    throw new Error('Failed to fetch admin sessions');
  }
  const data = await response.json();
  return data.sessions;
}

// Admin: Get session history
export async function getSessionHistory(sessionId: string): Promise<any> {
  const response = await fetchWithAuth(`/api/sessions/admin/${sessionId}/history`);
  if (!response.ok) {
    throw new Error('Failed to fetch session history');
  }
  return response.json();
}
```

#### 4. Add Admin Sessions View
This can be added to FileExplorer or as a separate component. For now, add a simple "View History" link in FileExplorer when admin.

**File**: `apps/web/src/components/FileExplorer.tsx`
**Changes**: Add admin session list section

The full implementation of the history viewer UI would be a separate component that loads the session state and displays it in read-only dev mode format.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `pnpm run --filter @agent-app/server typecheck`
- [x] TypeScript compiles: `pnpm run --filter @agent-app/web typecheck`

#### Manual Verification:
- [ ] Admin can see all sessions in a list
- [ ] Clicking "View History" loads the session's full trace
- [ ] Non-admin users cannot access admin endpoints (403)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:
- DevModeContext provider behavior
- DevModeMessageList rendering with various message types
- Tool call extraction functions

### Integration Tests:
- Session state file creation during query
- Admin endpoint authorization

### Manual Testing Steps:
1. Login as admin, enable dev mode, send message with subagents
2. Verify all tool calls visible in chronological order
3. Click subagent → verify tab opens with subagent trace
4. Refresh page → verify dev mode preference persisted
5. Check session directory for .session-state.json
6. View History on old session → verify full trace loads
7. Login as non-admin → verify dev mode toggle not visible

## Performance Considerations

- Session state files can be large (10MB+) - consider compression
- Lazy load subagent messages only when tab is opened
- Limit admin session list to recent 100 sessions with pagination

## Migration Notes

- No database migrations required (using existing tables + storage)
- Session state files are forward-compatible (version field allows future changes)
- Existing sessions without .session-state.json will fall back to reconstructed view

## References

- Original research: `thoughts/shared/research/2025-12-23-admin-dev-mode-session-state.md`
- Server agent route: `apps/server/src/routes/agent.ts`
- Frontend chat: `apps/web/src/components/ChatInterface.tsx`
- Auth middleware: `apps/server/src/middleware/auth.ts`
