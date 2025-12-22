---
date: 2025-12-21T12:00:00-08:00
researcher: Claude
git_commit: 1f9d47745f704c3a2db20f4ac5c40b8a1a39d75d
branch: main
repository: agent-app-boilerplate
topic: "Session Creation and Message Sending Frontend Issues"
tags: [research, codebase, sessions, chat-interface, frontend, bug-analysis]
status: complete
last_updated: 2025-12-21
last_updated_by: Claude
---

# Research: Session Creation and Message Sending Frontend Issues

**Date**: 2025-12-21T12:00:00-08:00
**Researcher**: Claude
**Git Commit**: 1f9d47745f704c3a2db20f4ac5c40b8a1a39d75d
**Branch**: main
**Repository**: agent-app-boilerplate

## Research Question
Why is there weird behavior with session creation and message sending in the frontend? Specifically:
1. Can't send a message at the beginning since there is no current session
2. When submitting from the Create Session Modal, the folder is created in /data but the message is not sent to the agent
3. Nothing runs or is shown in the UI

## Summary

**Root Cause: Race Condition in State Updates**

The primary issue is a race condition between setting the current session and clearing state via a React `useEffect`. When `handleNewSessionSubmit` runs, it:
1. Sets a temporary session with `id: 'pending'`
2. Calls `sendMessage()` which adds messages to the timeline
3. But the `useEffect` that clears state on `currentSession?.id` change then runs and wipes out the messages that were just added

**Secondary Issues:**
- The message input is permanently disabled when no session exists (`disabled={!currentSession}`)
- The modal-based session creation flow adds unnecessary complexity and state management

## Detailed Findings

### Issue 1: Message Input Disabled Without Session

**Location:** `apps/web/src/components/ChatInterface.tsx:475`

```typescript
<MessageInput onSend={handleSend} disabled={isStreaming || !currentSession} />
```

The input is unconditionally disabled when `currentSession` is null. This prevents any message from being sent without first creating a session through the modal.

Additionally, `handleSend` at line 93-94 has a guard:
```typescript
const handleSend = async (content: string) => {
  if (!currentSession) return;  // <-- Early return if no session
  ...
};
```

### Issue 2: Race Condition in Session Creation

**Location:** `apps/web/src/components/ChatInterface.tsx:86-91` and `98-128`

The `useEffect` at lines 86-91:
```typescript
useEffect(() => {
  setTimeline([]);
  setMessagesMap(new Map());
  setSubagentsMap(new Map());
  setAddedSubagentIds(new Set());
}, [currentSession?.id]);  // <-- Triggers when session ID changes
```

The `handleNewSessionSubmit` function at lines 98-128:
```typescript
const handleNewSessionSubmit = async () => {
  // ... validation ...

  // Step 1: Clear modal and close
  setSessionNameInput('');
  setInitialMessageInput('');
  onModalClose();

  // Step 2: Clear previous session state
  setTimeline([]);
  setMessagesMap(new Map());
  // ...

  // Step 3: Set temporary session (triggers the useEffect!)
  setCurrentSession({
    id: 'pending',  // <-- This changes currentSession?.id
    ...
  });

  // Step 4: Send message (adds to timeline/messagesMap)
  await sendMessage(message, name, undefined);
};
```

**The Race Condition:**
1. `setCurrentSession({ id: 'pending' })` is called (line 116)
2. React batches this state update
3. `sendMessage()` is called immediately (line 127)
4. `sendMessage()` adds user message to `messagesMap` and `timeline` (lines 145-149)
5. `sendMessage()` adds thinking placeholder (lines 161-165)
6. React processes the `currentSession` state update
7. The `useEffect` runs because `currentSession?.id` changed to 'pending'
8. **The useEffect CLEARS the timeline and messages that were just added!**
9. The SSE stream continues but the UI shows nothing because state was cleared

### Issue 3: Backend Works Correctly

**Location:** `apps/server/src/routes/agent.ts`

The backend is NOT the issue. When the `/api/agent/query` endpoint is called:
- Line 56: `ensureSessionDir(sessionName)` creates the `/data/{sessionName}` folder
- Lines 77-88: The Claude Agent SDK `query()` function is called correctly
- Lines 90-108: SSE messages are streamed correctly

The folder creation works because `ensureSessionDir` is called synchronously before streaming starts. The message not appearing is purely a frontend state management issue.

## Sources of Overcomplexity

### 1. Modal State Management (Prop Drilling)

**Files:** `App.tsx:9-18`, `ChatInterface.tsx:19-22, 61, 367-428`

The modal state is managed in `App.tsx` and passed through props:
```
App.tsx (showNewSessionModal state)
  → Layout (onNewSession prop)
    → FileExplorer (uses onNewSession)
  → ChatInterface (showNewSessionModal, onModalClose, onNewSession props)
```

This creates unnecessary coupling between components.

### 2. Dual ID System for Sessions

**Files:** `ChatInterface.tsx:116-124`, `types.ts:82-91`

Sessions have two identifiers:
- `id`: Database UUID (starts as 'pending', updated later)
- `sdk_session_id`: Claude SDK session ID

The temporary `id: 'pending'` pattern adds complexity and triggers the problematic `useEffect`.

### 3. Timeline Abstraction

**Files:** `ChatInterface.tsx:71-74`

Using three separate state variables:
```typescript
const [timeline, setTimeline] = useState<TimelineItem[]>([]);
const [messagesMap, setMessagesMap] = useState<Map<string, ChatMessage>>(new Map());
const [subagentsMap, setSubagentsMap] = useState<Map<string, Subagent>>(new Map());
```

This indirection (timeline IDs pointing to maps) adds complexity compared to a simple array of messages.

### 4. Effect-Based State Clearing

**File:** `ChatInterface.tsx:86-91`

The `useEffect` that clears state on session change is problematic because:
- It runs asynchronously after state updates
- It can race with other operations that set state
- It's a side effect that's hard to reason about

## Code References

- `apps/web/src/components/ChatInterface.tsx:475` - MessageInput disabled check
- `apps/web/src/components/ChatInterface.tsx:93-96` - handleSend guard clause
- `apps/web/src/components/ChatInterface.tsx:86-91` - useEffect that clears state (THE BUG)
- `apps/web/src/components/ChatInterface.tsx:98-128` - handleNewSessionSubmit
- `apps/web/src/components/ChatInterface.tsx:116-124` - Temporary session creation
- `apps/web/src/components/ChatInterface.tsx:130-350` - sendMessage function
- `apps/web/src/components/ChatInterface.tsx:367-428` - Modal rendering
- `apps/web/src/App.tsx:9-18` - Modal state management
- `apps/server/src/routes/agent.ts:43-172` - Backend agent query (works correctly)

## Proposed Fixes

### Recommended Approach: Inline Session Creation Form

Replace the modal with an inline form in the Agent Chat column:

1. **Remove modal entirely** - Delete lines 367-428 in ChatInterface.tsx, remove modal props and state from App.tsx

2. **Show inline form when no session** - When `currentSession` is null, render a session name input + message input directly in the main content area:

```typescript
<main className="flex-1 overflow-y-auto p-4">
  {!currentSession ? (
    <InlineSessionForm onSubmit={handleNewSessionSubmit} />
  ) : timeline.length === 0 ? (
    <div>Session ready message</div>
  ) : (
    <MessageList ... />
  )}
</main>
```

3. **Remove the problematic useEffect** - Delete lines 86-91. Instead, clear state explicitly when selecting a different session in `SessionContext.selectSession()`

4. **Atomic session + message creation** - In `handleNewSessionSubmit`, don't set `currentSession` until AFTER the first message is successfully sent and the real session ID is received:

```typescript
const handleNewSessionSubmit = async (sessionName: string, message: string) => {
  // Don't set currentSession yet!
  // Clear state explicitly here instead of relying on useEffect
  setTimeline([]);
  setMessagesMap(new Map());

  // Send message with session name (no currentSession needed)
  await sendMessage(message, sessionName, undefined);

  // currentSession gets set in the stream handler when init message arrives
};
```

### Alternative Quick Fix

If a minimal change is preferred, simply remove or guard the problematic `useEffect`:

```typescript
// Option A: Remove entirely
// Delete lines 86-91

// Option B: Guard against 'pending' sessions
useEffect(() => {
  if (currentSession?.id && currentSession.id !== 'pending') {
    setTimeline([]);
    setMessagesMap(new Map());
    setSubagentsMap(new Map());
    setAddedSubagentIds(new Set());
  }
}, [currentSession?.id]);
```

## Open Questions

1. Should session history (messages) be persisted and loaded when resuming a session, or always start fresh?
2. Should the file list be shown in the right panel before any files are created?
3. Is there a reason for the timeline/map pattern vs a simple messages array?

## Architecture Insights

The current architecture has these patterns:
- **Context-based state**: SessionContext, FileContext, AuthContext provide global state
- **SSE streaming**: Backend streams messages via Server-Sent Events
- **Optimistic UI updates**: Temporary 'pending' session created before backend confirms
- **Effect-based side effects**: State clearing triggered by dependencies changing

The optimistic update pattern (temporary session) combined with effect-based clearing creates the race condition. The fix should either:
1. Make updates truly atomic (wait for backend before updating state)
2. Or remove the effect-based clearing in favor of explicit calls
