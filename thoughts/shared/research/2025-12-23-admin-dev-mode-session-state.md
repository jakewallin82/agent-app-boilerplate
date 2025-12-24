---
date: 2025-12-23T10:30:00-05:00
researcher: Claude
git_commit: 6287344788ef92251f2686728b557341b3a4a733
branch: main
repository: agent-app-boilerplate
topic: "Admin Dev Mode and Session State Persistence for Agent Debugging"
tags: [research, codebase, admin, dev-mode, session-state, tool-calls, debugging]
status: complete
last_updated: 2025-12-23
last_updated_by: Claude
---

# Research: Admin Dev Mode and Session State Persistence for Agent Debugging

**Date**: 2025-12-23T10:30:00-05:00
**Researcher**: Claude
**Git Commit**: 6287344788ef92251f2686728b557341b3a4a733
**Branch**: main
**Repository**: agent-app-boilerplate

## Research Question

How to implement a "dev mode" for admins that:
1. Displays ALL tool calls in a message list (not ephemeral/replacing)
2. Shows expandable subagent tool calls
3. Persists the full session state to `.session-state.json` for debugging/download
4. Allows admins to test user-facing agents after uploading to `/shared`

## Summary

The current implementation uses an ephemeral display pattern where tool calls replace each other. The claude-sports-app provides a reference implementation with full tool call history and expandable subagents. To enable admin dev mode, we need:

1. **Server-side**: Persist full SDKMessage stream to `.session-state.json` in session directory
2. **Frontend**: Add dev mode toggle that switches between ephemeral and full-history display
3. **State management**: Extend existing timeline+maps pattern to handle full message list
4. **File download**: Endpoint/mechanism to download session state for offline analysis

## Detailed Findings

### Current Implementation Analysis

#### Frontend Tool Call Display (agent-app-boilerplate)
**File**: `apps/web/src/components/ChatInterface.tsx`

The current implementation:
- Uses **timeline + maps** pattern for state management (lines 65-67):
  - `timeline: TimelineItem[]` - ordered sequence of messages/subagents
  - `messagesMap: Map<string, ChatMessage>` - message content keyed by ID
  - `subagentsMap: Map<string, Subagent>` - subagent state and tool calls
- Tool calls are rendered inline within `MessageContent` component (`MessageList.tsx:29-35`)
- Non-Task tools rendered as `<ToolUseDisplay>` with collapse/expand
- Task tools spawn `SubagentViewer` components in timeline
- **Ephemeral behavior**: Tool calls are accumulated in contentBlocks but subagent tool calls are appended as they arrive (not replacing)

**Key limitation**: While the architecture supports full history, the user-facing display is optimized for simplicity - admins need more detail.

#### Server-side Message Handling
**File**: `apps/server/src/routes/agent.ts`

Current message flow:
1. `query()` returns `AsyncGenerator<SDKMessage>` with types:
   - `system` (init, status, compact_boundary)
   - `user` (user messages, tool results)
   - `assistant` (model responses with content blocks)
   - `result` (final result with usage stats)
   - `tool_progress` (long-running tool updates)

2. Messages are streamed to frontend via SSE (lines 169-171)
3. **Only text content is saved** to database (lines 220-226):
   ```typescript
   await supabase.from('messages').insert([
     { session_id: sdkSessionId, role: 'user', content },
     { session_id: sdkSessionId, role: 'assistant', content: assistantContent },
   ]);
   ```

**Missing**: Full SDKMessage structure is not persisted anywhere for debugging.

#### Reference Implementation (claude-sports-app)
**File**: `claude-sports-app/src/renderer/components/ChatInterface.tsx`

Key patterns to adopt:
1. **Full tool call history** in SubagentViewer (lines 189-244)
2. **Expandable nested tool calls** with status indicators
3. **Visual hierarchy** using left borders and indentation
4. **Claude Code style** CSS variables for consistent theming

### Proposed Architecture

#### 1. Session State File Structure

```typescript
// .session-state.json structure
interface SessionState {
  version: string;
  sessionId: string;
  sessionName: string;
  agentId: string;
  userId: string;
  startTime: string;
  endTime?: string;
  messages: SDKMessage[];
  metadata: {
    totalTokens: number;
    totalCost: number;
    toolCallCount: number;
    subagentCount: number;
  };
}
```

**Location**: `{sessionDir}/.session-state.json`

#### 2. Server Changes

**File**: `apps/server/src/routes/agent.ts`

Add session state collection and persistence:

```typescript
// Inside query handler
const sessionState: SessionState = {
  version: '1.0',
  sessionId: sdkSessionId,
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

for await (const message of queryIterator) {
  // Collect all messages
  sessionState.messages.push(message);

  // Update metadata counts
  if (message.type === 'assistant') {
    const toolUses = message.message?.content?.filter(
      (b: any) => b.type === 'tool_use'
    );
    sessionState.metadata.toolCallCount += toolUses?.length || 0;
    sessionState.metadata.subagentCount += toolUses?.filter(
      (b: any) => b.name === 'Task'
    ).length || 0;
  }

  if (message.type === 'result' && message.subtype === 'success') {
    sessionState.metadata.totalTokens = message.usage?.total_tokens || 0;
    sessionState.metadata.totalCost = message.cost_usd || 0;
  }

  // Stream to frontend as before
  await stream.writeSSE({ data: JSON.stringify(message) });
}

// After query completes, write session state
sessionState.endTime = new Date().toISOString();
await writeFile(
  path.join(sessionDir, '.session-state.json'),
  JSON.stringify(sessionState, null, 2)
);
```

**Note**: No download endpoint needed - session state is for backend debugging/analysis only.

#### 3. Frontend Changes

**New context**: `DevModeContext.tsx`

```typescript
interface DevModeContextValue {
  isDevMode: boolean;
  setDevMode: (enabled: boolean) => void;
  showToolResults: boolean;
  setShowToolResults: (enabled: boolean) => void;
}
```

**Key Architecture Decision: Tabbed Right Panel for Subagents**

The right-side panel (currently showing output files) becomes a tabbed interface:
- **Files tab**: Existing file viewer
- **Subagent tabs**: Each opened subagent gets its own tab showing its message list

When a subagent is clicked in the main message list, a new tab opens on the right showing that subagent's full message stream.

```
┌─────────────────────────────────────┬──────────────────────────────────┐
│  Main Agent Message List            │  [Files] [Subagent-1] [Subagent-2]│
│                                     │  ─────────────────────────────────│
│  [User] What's the prediction...    │  Subagent-1 Message List:        │
│  [Assistant] I'll analyze...        │                                  │
│    └─ [Task] Subagent-1 ← click     │  [User] Research NFL stats...    │
│    └─ [Read] predictions.json       │  [Assistant] Let me search...    │
│  [Assistant] Based on the data...   │    └─ [WebFetch] espn.com        │
│                                     │    └─ [Read] stats.json          │
│                                     │  [Assistant] Found the data...   │
└─────────────────────────────────────┴──────────────────────────────────┘
```

**Component Reuse**: The subagent message list uses the SAME `DevModeMessageList` component as the main agent. This means:
- User messages displayed the same way
- Assistant messages displayed the same way
- Tool use blocks displayed the same way
- Nested subagents within subagents also clickable (opens another tab)

**DevModeMessageList component** (reusable for main agent AND subagents):
- Shows complete message stream in chronological order
- Displays user, assistant, and tool_use messages
- Tool_use blocks are clickable if they're Task tools (opens tab)
- Shows tool results inline
- Visual indicators for message types
- Real-time updates as messages stream in

**DevModeToolbar component**:
- Toggle dev mode on/off
- Filter by message type (user, assistant, tool)
- Search within session

#### 4. Admin Testing Flow

**Testing user-facing agents after shared upload**:

1. Admin logs in → uses `sports-nfl-admin` agent
2. Admin generates content → files persist to `shared/{agentId}/`
3. Admin switches to `sports-nfl` agent (user-facing)
4. Admin enables dev mode toggle
5. Admin runs test queries → sees ALL tool calls in real-time
6. Admin verifies shared files are loaded and accessible
7. (Backend: `.session-state.json` persisted for later analysis if needed)

**UI flow**:
```
[Agent Selector Dropdown]
├── sports-nfl (User View)
└── sports-nfl-admin (Admin - Shared Storage)

[Dev Mode Toggle] - Only visible to admins
├── Show All Tool Calls (real-time)
├── Auto-expand Subagents
└── Show Tool Results Inline
```

#### 5. View History Feature (Admin Debugging)

**Purpose**: Allow admins to view ANY old user session in dev mode to debug what happened with all tool calls, subagents, etc.

**"View History" Button**:
- Visible to admins in the session list
- Clicking opens that session in read-only dev mode view
- Loads the full agent + subagent trace from `.session-state.json`

**Implementation**:

1. **Session List Enhancement**:
   - Admin sees all user sessions (not just their own)
   - "View History" button next to each session
   - Filter by user, agent type, date range

2. **History Viewer**:
   - Read-only mode (no sending new messages)
   - Full dev mode display of the session
   - Uses same `DevModeMessageList` component
   - Subagent tabs work the same (click to open in right panel)
   - Shows timing info, token counts, any errors

3. **Data Source**:
   - Reads from `.session-state.json` in session directory
   - Falls back to reconstructing from DB messages if file not found
   - New endpoint: `GET /api/admin/session-history/:sessionId`

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Session History - User: john@example.com - 2025-12-23 10:30 AM        │
│  Agent: sports-nfl | Duration: 45s | Tokens: 12,450 | Status: Success  │
├─────────────────────────────────────┬───────────────────────────────────┤
│  Main Agent Message List            │  [Files] [research-agent]         │
│                                     │  ─────────────────────────────────│
│  [User] What's your prediction...   │  research-agent trace:            │
│  [Assistant] Let me check...        │                                   │
│    └─ [Task] research-agent ← click │  [User] Find NFL stats for...     │
│    └─ [Read] /shared/predictions/   │  [Assistant] Searching...         │
│  [Assistant] Based on my analysis..│    └─ [WebFetch] espn.com/nfl     │
│                                     │  [Assistant] Found the data...    │
└─────────────────────────────────────┴───────────────────────────────────┘
```

**Admin Session List UI**:
```
┌─────────────────────────────────────────────────────────────────────────┐
│  All Sessions (Admin View)                         [Filter ▼] [Search] │
├─────────────────────────────────────────────────────────────────────────┤
│  User              Agent         Date          Status    Actions       │
├─────────────────────────────────────────────────────────────────────────┤
│  john@example.com  sports-nfl    Dec 23, 10:30 Success  [View History] │
│  jane@example.com  sports-nfl    Dec 23, 09:15 Success  [View History] │
│  admin@example.com sports-admin  Dec 22, 16:00 Success  [View History] │
│  john@example.com  sports-nfl    Dec 22, 14:30 Error    [View History] │
└─────────────────────────────────────────────────────────────────────────┘
```

### Implementation Phases

#### Phase 1: Server-side Session State Persistence
1. Create `SessionState` type in shared package
2. Modify `/query` endpoint to collect ALL messages during streaming
3. Write `.session-state.json` after query completes
4. Add `.session-state.json` to hidden files list (don't flush to Supabase Storage)
5. Flush `.session-state.json` to Supabase Storage for history viewing

#### Phase 2: Frontend Dev Mode Toggle & Context
1. Create `DevModeContext` with localStorage persistence
2. Add dev mode toggle to header (admin only)
3. Conditionally render dev mode components based on context

#### Phase 3: Tabbed Right Panel & DevModeMessageList
1. **Convert right panel to tabbed interface**:
   - Files tab (existing)
   - Subagent tabs (new - opened when subagent clicked)
   - Tab close buttons, active tab indicator

2. **DevModeMessageList component** (reusable):
   - Shows user, assistant, and tool_use messages chronologically
   - Tool_use blocks clickable if Task (opens subagent tab)
   - Tool results shown inline
   - Real-time updates during streaming
   - Used for BOTH main agent and subagent displays

3. **Subagent message tracking**:
   - Track messages by `parent_tool_use_id`
   - Store subagent message lists in subagentsMap
   - Real-time append as subagent messages stream in

#### Phase 4: Admin Agent Testing Features
1. Add agent selector dropdown to switch between agents
2. Allow admin to test user-facing agents (sports-nfl) after uploading to shared
3. Visual indicator showing which agent/storage mode is active

#### Phase 5: View History Feature
1. **Admin session list enhancements**:
   - Show all user sessions (not just admin's own)
   - Add "View History" button per session
   - Filter by user, agent type, date range

2. **History viewing endpoint**:
   - `GET /api/admin/session-history/:sessionId`
   - Returns `.session-state.json` from Supabase Storage
   - Admin-only access

3. **History viewer component**:
   - Read-only mode (no message input)
   - Full dev mode display using same components
   - Subagent tabs work identically
   - Shows session metadata (user, duration, tokens, status)

## Code References

- `apps/server/src/routes/agent.ts:143-172` - Query execution and streaming
- `apps/server/src/routes/agent.ts:220-226` - Current message persistence (text only)
- `apps/web/src/components/ChatInterface.tsx:65-67` - Timeline + maps state
- `apps/web/src/components/ChatInterface.tsx:310-378` - Content block processing
- `apps/web/src/components/MessageList.tsx:29-35` - Tool call rendering
- `apps/web/src/components/SubagentViewer.tsx:130-167` - Nested tool calls display
- `apps/web/src/components/ToolUseDisplay.tsx:58-123` - Tool display component
- `claude-sports-app/src/renderer/components/ChatInterface.tsx:115-139` - Reference subagent tool tracking
- `claude-sports-app/src/renderer/components/SubagentViewer.tsx:172-247` - Reference expandable display

## Architecture Insights

### Why Timeline + Maps?
The timeline + maps pattern separates ordering from data storage:
- Timeline maintains chronological order for rendering
- Maps provide O(1) lookups for updates during streaming
- Both apps use this pattern - it's proven effective

### Session State vs Database Messages
- **Database**: Simple user/assistant text for history list
- **Session state file**: Full SDK message stream for debugging
- This separation keeps the DB lean while enabling detailed debugging

### Dev Mode as Progressive Enhancement
Dev mode should not change the core data flow - it's purely a display enhancement:
- Same timeline + maps structures
- Same streaming behavior
- Different rendering components
- Additional download capabilities

## Related Files from Implementation Plan

The recently completed multi-agent filesystem plan provides the foundation:
- `apps/server/src/services/agentConfig.ts` - Agent configuration
- `apps/server/src/services/toolSandbox.ts` - Tool restrictions
- `apps/server/src/services/sharedFiles.ts` - Shared file loading
- `apps/server/src/services/warmupCache.ts` - Pre-warming
- `apps/server/src/config/agents.json` - Agent definitions

## Decisions Made

1. **Session state persistence**: Always persist `.session-state.json` for every conversation (no size limits)
2. **No direct frontend download**: Session state file persisted for backend analysis and history viewing
3. **Real-time updates required**: Dev mode must show tool calls as they happen, including subagent tool calls in progress
4. **Streaming-based for live**: Dev mode works with existing SSE stream during live execution
5. **Tabbed right panel**: Subagent message lists display as tabs alongside files - clicking a subagent opens its tab
6. **Component reuse**: Same `DevModeMessageList` component used for main agent AND subagent displays
7. **View History feature**: Admins can view any old user session in dev mode, loading from `.session-state.json`

## Open Questions

1. **Multi-session comparison**: Would admins benefit from comparing session states side-by-side? human answer: not needed yet
2. **Filtering/search**: What filters are most valuable for debugging? (tool type, error status, duration) human answer: not needed yet

## Recommendations

1. **Start with server-side persistence** - Simple change, provides value for backend debugging immediately
2. **Keep user-facing display unchanged** - Dev mode is additive, not a replacement
3. **Use existing component patterns** - SubagentViewer already supports expandable tool calls, just need to enhance
4. **Real-time is stream-based** - Dev mode reads from existing SSE stream, session-state.json is for offline analysis only
5. **Admin-only access** - Dev mode toggle should only appear for users with `isAdmin: true`
6. **Track tool call status** - Need to correlate tool_use blocks with their results (via tool_use_id)
