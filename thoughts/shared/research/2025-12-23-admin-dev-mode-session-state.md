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

**New endpoint** for downloading session state:

```typescript
// GET /api/agent/session-state/:sessionName
app.get('/session-state/:sessionName', async (c) => {
  const user = c.get('user');
  if (!user.isAdmin) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const sessionName = c.req.param('sessionName');
  const sessionDir = path.join(DATA_DIR, sessionName);
  const statePath = path.join(sessionDir, '.session-state.json');

  if (!existsSync(statePath)) {
    return c.json({ error: 'Session state not found' }, 404);
  }

  const content = await readFile(statePath, 'utf-8');
  return c.json(JSON.parse(content));
});
```

#### 3. Frontend Changes

**New context**: `DevModeContext.tsx`

```typescript
interface DevModeContextValue {
  isDevMode: boolean;
  setDevMode: (enabled: boolean) => void;
  showToolResults: boolean;
  setShowToolResults: (enabled: boolean) => void;
  expandAllSubagents: boolean;
  setExpandAllSubagents: (enabled: boolean) => void;
}
```

**Enhanced MessageList for dev mode**:

```typescript
// In MessageList.tsx
const { isDevMode } = useDevMode();

// Dev mode shows ALL tool calls inline, not collapsed
{isDevMode ? (
  <DevModeMessageList
    timeline={timeline}
    messagesMap={messagesMap}
    subagentsMap={subagentsMap}
  />
) : (
  // Existing user-facing display
  <StandardMessageList ... />
)}
```

**DevModeMessageList component**:
- Shows complete message stream in chronological order
- Displays all tool_use blocks with full parameters
- Shows tool results inline (not hidden)
- Subagents are expandable but default to expanded
- Visual indicators for parent_tool_use_id relationships
- Token counts per message
- Copy-to-clipboard for debugging

**DevModeToolbar component**:
- Toggle dev mode on/off
- Download session state button
- Expand all / Collapse all subagents
- Filter by message type (assistant, tool, result)
- Search within session

#### 4. Admin Testing Flow

**Testing user-facing agents after shared upload**:

1. Admin logs in → uses `sports-nfl-admin` agent
2. Admin generates content → files persist to `shared/{agentId}/`
3. Admin switches to `sports-nfl` agent (user-facing)
4. Admin runs test queries with dev mode enabled
5. Admin verifies shared files are loaded and accessible
6. Admin downloads session state for detailed analysis

**UI flow**:
```
[Agent Selector Dropdown]
├── sports-nfl (User View)
└── sports-nfl-admin (Admin - Shared Storage)

[Dev Mode Toggle] - Only visible to admins
├── Show Tool Results
├── Expand Subagents
└── Download Session State
```

### Implementation Phases

#### Phase 1: Server-side Session State Persistence
1. Create `SessionState` type in shared package
2. Modify `/query` endpoint to collect and persist messages
3. Add `.session-state.json` to hidden files list
4. Create `/session-state/:sessionName` download endpoint
5. Ensure session state is flushed to Supabase Storage with other files

#### Phase 2: Frontend Dev Mode Toggle
1. Create `DevModeContext` with localStorage persistence
2. Add dev mode toggle to header (admin only)
3. Conditionally render dev mode components

#### Phase 3: Enhanced Tool Call Display
1. Create `DevModeMessageList` component
2. Create `DevModeToolUseDisplay` with full parameter view
3. Create `DevModeSubagentViewer` with auto-expand and token counts
4. Add tool result display inline

#### Phase 4: Admin Testing Features
1. Add agent selector dropdown (shows user's available agents)
2. Add "Test as User" button for admin-to-user agent switch
3. Add session state download button
4. Add copy-to-clipboard for debugging

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

## Open Questions

1. **Session state size limits**: Should we truncate very long sessions or paginate?
2. **Session state retention**: How long to keep .session-state.json files? Clean up on session delete?
3. **Real-time dev mode**: Stream tool results to dev mode UI during execution, or wait until complete?
4. **Multi-session comparison**: Would admins benefit from comparing session states side-by-side?
5. **Filtering/search**: What filters are most valuable for debugging? (tool type, error status, duration)

## Recommendations

1. **Start with server-side persistence** - This is the foundation and provides value even without UI changes
2. **Keep user-facing display unchanged** - Dev mode is additive, not a replacement
3. **Use existing component patterns** - SubagentViewer already supports expandable tool calls
4. **Persist locally first, sync later** - Write to .session-state.json immediately, flush to Supabase async
5. **Admin-only access** - Dev mode and session state download should require `isAdmin: true`
