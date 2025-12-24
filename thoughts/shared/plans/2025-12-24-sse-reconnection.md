# SSE Reconnection Implementation Plan

## Overview

Implement server-side message buffering with pub/sub pattern to allow clients to reconnect to active SSE streams after page refresh. Instead of polling for completion, the client will reconnect to a live stream that sends buffered messages first, then continues with real-time messages.

## Current State Analysis

### Problem
When a user refreshes mid-stream:
1. The SSE connection is closed (browser terminates it)
2. Server continues running the `query()` iterator
3. Client loads stale localStorage state
4. Client polls Supabase waiting for `.session-state.json`
5. User sees "Session was interrupted. Waiting for server to complete..." banner
6. **Bad UX**: No real-time updates until server finishes

### What Exists Now
- `apps/server/src/services/warmupCache.ts` - In-memory cache pattern to follow
- `apps/server/src/routes/agent.ts:140-316` - SSE streaming with `streamSSE`
- `apps/web/src/lib/api.ts:151-200` - `streamAgentQuery` async generator
- `apps/web/src/contexts/DevModeContext.tsx:113-179` - Polling mechanism (to be replaced)

## Desired End State

After implementation:
1. User refreshes mid-stream
2. Client detects `isStreaming: true` in localStorage
3. Client calls `GET /api/agent/stream/:sessionId`
4. Server sends all buffered messages immediately (catch up)
5. Server subscribes client to live stream for new messages
6. Client receives messages in real-time (same UX as before refresh)
7. When stream completes, client receives `[DONE]`

### Verification:
- Start a long-running agent query
- Refresh the page mid-stream
- Confirm messages continue streaming in real-time
- Confirm final result appears correctly

## What We're NOT Doing

- WebSocket migration (too large a refactor)
- Persistent message queue (Redis/DB - overkill for this use case)
- Distributed pub/sub (single-process is fine for now)
- Recovery from server restarts (edge case, acceptable loss)

## Implementation Approach

Create an in-memory pub/sub service following the `warmupCache.ts` pattern. Each active query publishes messages to a buffer keyed by `sdkSessionId`. Reconnecting clients subscribe to receive buffered + live messages.

---

## Phase 1: Session Streams Service

### Overview
Create the server-side message buffer and pub/sub service.

### Changes Required:

#### 1. Create Session Streams Service
**File**: `apps/server/src/services/sessionStreams.ts` (NEW)

```typescript
/**
 * In-memory message buffer and pub/sub for SSE reconnection.
 *
 * Pattern: When a query starts, create a stream buffer keyed by sdkSessionId.
 * Messages are published to the buffer AND streamed to the original client.
 * Reconnecting clients subscribe and receive buffered messages first,
 * then live messages as they arrive.
 */

export interface SessionStream {
  sessionId: string;
  userId: string;
  messages: unknown[];
  isComplete: boolean;
  subscribers: Set<(message: unknown) => Promise<void>>;
  createdAt: number;
  completedAt?: number;
}

const sessionStreams = new Map<string, SessionStream>();

/**
 * Create a new session stream for buffering messages.
 * Called when we receive the SDK session ID from the init message.
 */
export function createSessionStream(sessionId: string, userId: string): SessionStream {
  const stream: SessionStream = {
    sessionId,
    userId,
    messages: [],
    isComplete: false,
    subscribers: new Set(),
    createdAt: Date.now(),
  };
  sessionStreams.set(sessionId, stream);
  console.log('[STREAMS] Created stream for session:', sessionId);
  return stream;
}

/**
 * Publish a message to the session stream buffer.
 * Also notifies all subscribers (reconnected clients).
 */
export async function publishMessage(sessionId: string, message: unknown): Promise<void> {
  const stream = sessionStreams.get(sessionId);
  if (!stream) return;

  // Buffer the message
  stream.messages.push(message);

  // Notify all subscribers (reconnected clients)
  const notifyPromises = Array.from(stream.subscribers).map(async (callback) => {
    try {
      await callback(message);
    } catch (error) {
      // Subscriber disconnected, will be cleaned up
      console.warn('[STREAMS] Subscriber notification failed:', error);
      stream.subscribers.delete(callback);
    }
  });

  await Promise.all(notifyPromises);
}

/**
 * Subscribe to a session stream for new messages.
 * Returns buffered messages and an unsubscribe function.
 * Returns null if no active stream exists.
 */
export function subscribeToSession(
  sessionId: string,
  callback: (message: unknown) => Promise<void>
): { bufferedMessages: unknown[]; unsubscribe: () => void } | null {
  const stream = sessionStreams.get(sessionId);
  if (!stream) return null;

  stream.subscribers.add(callback);
  console.log('[STREAMS] Subscriber added for session:', sessionId, 'total:', stream.subscribers.size);

  return {
    bufferedMessages: [...stream.messages],
    unsubscribe: () => {
      stream.subscribers.delete(callback);
      console.log('[STREAMS] Subscriber removed for session:', sessionId, 'remaining:', stream.subscribers.size);
    },
  };
}

/**
 * Mark a session stream as complete (no more messages coming).
 */
export function markStreamComplete(sessionId: string): void {
  const stream = sessionStreams.get(sessionId);
  if (stream) {
    stream.isComplete = true;
    stream.completedAt = Date.now();
    console.log('[STREAMS] Stream completed for session:', sessionId);
  }
}

/**
 * Check if a session stream is complete.
 */
export function isStreamComplete(sessionId: string): boolean {
  return sessionStreams.get(sessionId)?.isComplete ?? true;
}

/**
 * Get a session stream by ID.
 */
export function getSessionStream(sessionId: string): SessionStream | undefined {
  return sessionStreams.get(sessionId);
}

/**
 * Check if user owns the session stream (for authorization).
 */
export function isStreamOwner(sessionId: string, userId: string): boolean {
  const stream = sessionStreams.get(sessionId);
  return stream?.userId === userId;
}

/**
 * Get stream statistics (for debugging).
 */
export function getStreamStats(): {
  activeStreams: number;
  completedStreams: number;
  totalMessages: number;
  totalSubscribers: number;
} {
  let activeStreams = 0;
  let completedStreams = 0;
  let totalMessages = 0;
  let totalSubscribers = 0;

  for (const stream of sessionStreams.values()) {
    if (stream.isComplete) {
      completedStreams++;
    } else {
      activeStreams++;
    }
    totalMessages += stream.messages.length;
    totalSubscribers += stream.subscribers.size;
  }

  return { activeStreams, completedStreams, totalMessages, totalSubscribers };
}

/**
 * Cleanup old completed streams to prevent memory leaks.
 * Call periodically (e.g., every minute).
 */
export function cleanupOldStreams(maxAgeMs: number = 10 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, stream] of sessionStreams) {
    // Only clean up completed streams older than maxAge
    if (stream.isComplete && stream.completedAt && now - stream.completedAt > maxAgeMs) {
      sessionStreams.delete(sessionId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log('[STREAMS] Cleaned up', cleaned, 'old streams');
  }

  return cleaned;
}

// Start cleanup interval (every minute)
setInterval(() => cleanupOldStreams(), 60 * 1000);
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `pnpm build`
- [x] Service exports all required functions

#### Manual Verification:
- [ ] N/A - tested in Phase 2

---

## Phase 2: Update Query Endpoint

### Overview
Modify the `/query` endpoint to publish messages to the session stream buffer.

### Changes Required:

#### 1. Import Session Streams Service
**File**: `apps/server/src/routes/agent.ts`
**Location**: Top of file (around line 19)

```typescript
import {
  createSessionStream,
  publishMessage,
  markStreamComplete,
} from '../services/sessionStreams.js';
```

#### 2. Create Stream on Init Message
**File**: `apps/server/src/routes/agent.ts`
**Location**: Inside the init message handler (around line 195-221)

After `sdkSessionId = message.session_id;` add:
```typescript
// Create session stream for reconnection support
createSessionStream(sdkSessionId, user.id);
```

#### 3. Publish Messages to Buffer
**File**: `apps/server/src/routes/agent.ts`
**Location**: After collecting message in sessionState.messages (around line 192)

After `sessionState.messages.push(message);` add:
```typescript
// Publish to session stream (for reconnecting clients)
if (sdkSessionId) {
  await publishMessage(sdkSessionId, message);
}
```

Also publish the initial user message (around line 174-176):
```typescript
// Emit the initial user message so frontend rawMessages includes it
await stream.writeSSE({
  data: JSON.stringify(initialUserMessage),
});

// Also publish to session stream (will be buffered once stream created)
// Note: Can't publish yet since we don't have sdkSessionId
```

Actually, we need to handle the initial user message specially since we don't have the session ID yet. Better approach: publish it after we get the session ID.

**Revised approach**: After creating the stream, immediately publish the initial user message:
```typescript
// Create session stream for reconnection support
createSessionStream(sdkSessionId, user.id);
// Publish the initial user message that was already emitted
await publishMessage(sdkSessionId, initialUserMessage);
```

#### 4. Mark Stream Complete
**File**: `apps/server/src/routes/agent.ts`
**Location**: After the for-await loop completes (around line 253)

```typescript
// Mark stream as complete (after loop, before file persistence)
if (sdkSessionId) {
  markStreamComplete(sdkSessionId);
}
```

#### 5. Publish File Events
**File**: `apps/server/src/routes/agent.ts`
**Location**: In the file events loop (around line 287-294)

After `await stream.writeSSE(...)` add:
```typescript
// Also publish to session stream
if (sdkSessionId) {
  await publishMessage(sdkSessionId, {
    type: 'file_event',
    subtype: 'created',
    file: fileInfo,
  });
}
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `pnpm build`
- [ ] Server starts without errors: `pnpm dev`

#### Manual Verification:
- [ ] Send a query and verify console logs show stream creation
- [ ] Verify messages are being published (add temporary logging)

---

## Phase 3: Reconnect Endpoint

### Overview
Create the `GET /stream/:sessionId` endpoint that reconnecting clients call.

### Changes Required:

#### 1. Add Reconnect Endpoint
**File**: `apps/server/src/routes/agent.ts`
**Location**: After the `/query` endpoint (around line 317)

```typescript
/**
 * GET /stream/:sessionId - Reconnect to an active session stream
 *
 * Flow:
 * 1. Check if session stream exists and user owns it
 * 2. Send all buffered messages immediately (catch up)
 * 3. If stream is complete, send [DONE]
 * 4. If stream is active, subscribe for new messages
 * 5. When stream completes or client disconnects, cleanup
 */
agentRouter.get('/stream/:sessionId', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');

  console.log('[RECONNECT] Reconnect request for session:', sessionId, 'user:', user.id);

  // Check if session stream exists
  const sessionStream = getSessionStream(sessionId);
  if (!sessionStream) {
    console.log('[RECONNECT] No active stream found for session:', sessionId);
    return c.json({ error: 'No active stream for this session' }, 404);
  }

  // Check authorization - user must own the stream
  if (!isStreamOwner(sessionId, user.id)) {
    console.log('[RECONNECT] User does not own stream:', sessionId);
    return c.json({ error: 'Not authorized' }, 403);
  }

  return streamSSE(c, async (stream) => {
    console.log('[RECONNECT] Starting SSE stream for session:', sessionId);

    // Subscribe to get buffered messages and live updates
    const subscription = subscribeToSession(sessionId, async (message) => {
      // This callback is called for NEW messages (after subscription)
      await stream.writeSSE({ data: JSON.stringify(message) });
    });

    if (!subscription) {
      // Stream was deleted between check and subscribe (race condition)
      await stream.writeSSE({ data: '[DONE]' });
      return;
    }

    const { bufferedMessages, unsubscribe } = subscription;

    try {
      // Send all buffered messages first (catch up)
      console.log('[RECONNECT] Sending', bufferedMessages.length, 'buffered messages');
      for (const message of bufferedMessages) {
        await stream.writeSSE({ data: JSON.stringify(message) });
      }

      // If stream is already complete, we're done
      if (isStreamComplete(sessionId)) {
        console.log('[RECONNECT] Stream already complete, sending DONE');
        await stream.writeSSE({ data: '[DONE]' });
        unsubscribe();
        return;
      }

      // Wait for stream to complete (new messages delivered via subscriber callback)
      await new Promise<void>((resolve) => {
        // Check periodically if stream completed
        const checkInterval = setInterval(() => {
          if (isStreamComplete(sessionId)) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);

        // Handle client disconnect
        c.req.raw.signal.addEventListener('abort', () => {
          console.log('[RECONNECT] Client disconnected for session:', sessionId);
          clearInterval(checkInterval);
          resolve();
        });
      });

      // Stream completed, send final DONE
      if (!c.req.raw.signal.aborted) {
        await stream.writeSSE({ data: '[DONE]' });
      }
    } finally {
      unsubscribe();
      console.log('[RECONNECT] SSE stream ended for session:', sessionId);
    }
  });
});
```

Also add the required imports at the top:
```typescript
import {
  createSessionStream,
  publishMessage,
  markStreamComplete,
  getSessionStream,
  isStreamOwner,
  subscribeToSession,
  isStreamComplete,
} from '../services/sessionStreams.js';
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `pnpm build`
- [ ] Server starts without errors

#### Manual Verification:
- [ ] Start a query, note the session ID
- [ ] Call `GET /api/agent/stream/:sessionId` and verify buffered messages are received
- [ ] Verify `[DONE]` is sent when stream completes

---

## Phase 4: Frontend Reconnection

### Overview
Replace the polling mechanism with true SSE reconnection.

### Changes Required:

#### 1. Add `reconnectToSession` API Function
**File**: `apps/web/src/lib/api.ts`
**Location**: After `streamAgentQuery` function (around line 200)

```typescript
/**
 * Reconnect to an active session stream after page refresh.
 * Returns buffered messages first, then continues streaming live.
 */
export async function* reconnectToSession(sessionId: string): AsyncGenerator<any> {
  const headers = await getAuthHeaders();

  const res = await fetch(`/api/agent/stream/${sessionId}`, {
    headers: {
      ...headers,
      'Accept': 'text/event-stream',
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      // No active stream - server finished before we could reconnect
      console.log('[RECONNECT] No active stream, session may have completed');
      return;
    }
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  // Same SSE parsing logic as streamAgentQuery
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) throw new Error('No response body');

  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          yield JSON.parse(data);
        } catch (e) {
          console.error('Failed to parse SSE:', e);
        }
      }
    }
  }
}
```

#### 2. Update DevModeContext - Replace Polling with Reconnection
**File**: `apps/web/src/contexts/DevModeContext.tsx`

Replace the polling mechanism with reconnection logic. Update the interface:

```typescript
interface DevModeContextType {
  // ... existing fields ...

  // Recovery state - true when reconnecting to server stream
  isReconnecting: boolean;
  reconnectToActiveSession: (sessionId: string) => Promise<void>;
}
```

Replace `isWaitingForServerCompletion`, `startPollingForCompletion`, and `stopPolling` with:

```typescript
// Reconnection state
const [isReconnecting, setIsReconnecting] = useState(false);
const reconnectAbortRef = useRef<AbortController | null>(null);

// Reconnect to an active server stream
const reconnectToActiveSession = useCallback(async (sessionId: string) => {
  if (isReconnecting) return;

  console.log('[RECONNECT] Attempting to reconnect to session:', sessionId);
  setIsReconnecting(true);

  // Create abort controller for cleanup
  reconnectAbortRef.current = new AbortController();

  try {
    for await (const message of reconnectToSession(sessionId)) {
      // Check if we should stop (user sent new message, etc.)
      if (reconnectAbortRef.current?.signal.aborted) {
        console.log('[RECONNECT] Reconnection aborted');
        break;
      }

      // Process message same as in ChatInterface
      const parentToolUseId = (message as { parent_tool_use_id?: string }).parent_tool_use_id;
      if (parentToolUseId) {
        setSubagentRawMessages(prev => {
          const updated = new Map(prev);
          const existing = updated.get(parentToolUseId) || [];
          updated.set(parentToolUseId, [...existing, message]);
          return updated;
        });
      } else {
        setRawMessages(prev => [...prev, message]);
      }
    }

    // Reconnection complete, mark session as complete
    markSessionComplete(sessionId);
    console.log('[RECONNECT] Reconnection completed successfully');
  } catch (error) {
    console.error('[RECONNECT] Reconnection failed:', error);
    // Fall back to trying Supabase
    try {
      const sessionState = await getSessionState(sessionId);
      if (sessionState) {
        console.log('[RECONNECT] Falling back to Supabase state');
        const mainMessages: unknown[] = [];
        const subagentMessages = new Map<string, unknown[]>();

        for (const msg of sessionState.messages) {
          const parentId = (msg as { parent_tool_use_id?: string }).parent_tool_use_id;
          if (parentId) {
            const existing = subagentMessages.get(parentId) || [];
            subagentMessages.set(parentId, [...existing, msg]);
          } else {
            mainMessages.push(msg);
          }
        }

        setRawMessages(mainMessages);
        setSubagentRawMessages(subagentMessages);
        markSessionComplete(sessionId);
      }
    } catch (supabaseError) {
      console.error('[RECONNECT] Supabase fallback also failed:', supabaseError);
    }
  } finally {
    setIsReconnecting(false);
    reconnectAbortRef.current = null;
  }
}, [isReconnecting]);

// Stop reconnection (called when user sends new message)
const stopReconnection = useCallback(() => {
  if (reconnectAbortRef.current) {
    reconnectAbortRef.current.abort();
    reconnectAbortRef.current = null;
  }
  setIsReconnecting(false);
}, []);
```

Update `loadSessionFromStorage` to use reconnection:
```typescript
// If session was streaming when we left, try to reconnect
if (localState.isStreaming) {
  console.log('[RECOVERY] Detected interrupted streaming session, attempting reconnection');
  // Don't await - let it run in background
  reconnectToActiveSession(sessionId);
}
```

Add import at top:
```typescript
import { reconnectToSession } from '@/lib/api';
```

#### 3. Update ChatInterface
**File**: `apps/web/src/components/ChatInterface.tsx`

Update destructuring:
```typescript
const {
  // ... existing ...
  isReconnecting, // renamed from isWaitingForServerCompletion
  stopReconnection, // renamed from stopPolling
} = useDevMode();
```

Update sendMessage to stop reconnection:
```typescript
// Stop any active reconnection - user is sending new message
stopReconnection();
```

Update the banner:
```typescript
{/* Recovery Banner - shown when reconnecting to server stream */}
{isReconnecting && (
  <div className="bg-blue-500/10 border-b border-blue-500/30 px-4 py-2 flex items-center gap-2">
    <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
    <span className="text-blue-400 text-sm">
      Reconnecting to server stream...
    </span>
  </div>
)}
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `pnpm build`
- [ ] No console errors on page load

#### Manual Verification:
- [ ] Start a long-running query
- [ ] Refresh page mid-stream
- [ ] Verify "Reconnecting to server stream..." banner appears briefly
- [ ] Verify messages continue streaming in real-time
- [ ] Verify final response appears correctly
- [ ] Send new message while reconnecting - verify reconnection stops

---

## Phase 5: Cleanup

### Overview
Remove obsolete polling code and update context exports.

### Changes Required:

#### 1. Remove Polling Code from DevModeContext
**File**: `apps/web/src/contexts/DevModeContext.tsx`

Remove:
- `isWaitingForServerCompletion` state
- `pollingIntervalRef`
- `pollingSessionIdRef`
- `stopPolling` function (replaced by `stopReconnection`)
- `startPollingForCompletion` function (replaced by `reconnectToActiveSession`)
- The polling `setInterval` and `setTimeout` logic

Update provider exports to remove old, add new:
```typescript
<DevModeContext.Provider value={{
  // ... keep existing ...
  // Remove: isWaitingForServerCompletion, startPollingForCompletion, stopPolling
  // Add: isReconnecting, reconnectToActiveSession, stopReconnection
}}>
```

#### 2. Update DevModeContextType
Remove old properties from interface, ensure new ones are present.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles with no errors: `pnpm build`
- [x] No unused variable warnings

#### Manual Verification:
- [ ] Full flow works end-to-end

---

## Testing Strategy

### Unit Tests:
- `sessionStreams.ts` - Test buffer creation, message publishing, subscription, cleanup

### Integration Tests:
- Start query → refresh → verify reconnection receives all messages
- Start query → let complete → refresh → verify Supabase fallback works

### Manual Testing Steps:
1. Start a long query (e.g., "research and write a detailed report")
2. Refresh page after ~10 seconds
3. Verify blue "Reconnecting..." banner appears
4. Verify messages continue streaming
5. Verify final result appears
6. Verify dev mode toggle works after reconnection
7. Test edge case: refresh after query completes (should load from Supabase)
8. Test edge case: send new message while reconnecting (should stop reconnection)

## Performance Considerations

- **Memory**: Buffers cleared 10 minutes after completion
- **Subscribers**: Cleaned up on disconnect
- **No persistence**: Acceptable - server restart is rare during a query

## References

- warmupCache pattern: `apps/server/src/services/warmupCache.ts`
- SSE streaming: `apps/server/src/routes/agent.ts:140-316`
- Frontend SSE handling: `apps/web/src/lib/api.ts:151-200`
