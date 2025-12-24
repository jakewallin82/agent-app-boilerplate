# Phase 8: Admin Session History View + Data Architecture Cleanup

## TL;DR - The Solution

**Problem:** `.session-state.json` only saves to Supabase *after* agent run completes. Refreshing mid-run loses everything.

**Solution:** Hybrid localStorage + Supabase Storage

```
┌─────────────────────────────────────────────────────────────────┐
│  During streaming: Save to localStorage after every SSE message │
│  After refresh:    Load from localStorage (or Supabase if done) │
│  Admin history:    Load from Supabase Storage                   │
└─────────────────────────────────────────────────────────────────┘
```

This gives us:
- ✅ Survive refresh during agent runs (localStorage)
- ✅ Permanent storage for completed sessions (Supabase)
- ✅ Admin can view any user's session history
- ✅ Toggle between User/Dev mode works anytime

---

## Problem Statement

We need to allow admins to view historical sessions with full tool call traces. However, the current data architecture has inconsistencies that make this confusing:

### Current Data Sources (Messy)

| Scenario | Data Source | Contains |
|----------|-------------|----------|
| Live streaming | SSE → React state | Full SDK messages |
| Page refresh (current session) | `messages` DB table | Text-only, processed |
| Dev mode toggle | React state (`rawMessages`) | Full SDK messages |
| Historical session (proposed) | `.session-state.json` | Full SDK messages |

**The Problem:** After refresh, we lose raw SDK messages. User mode shows DB text, but dev mode has nothing (or stale data). History viewing would add a 3rd data source.

### Critical Issue: Mid-Run Refresh

The `.session-state.json` is only saved to Supabase storage **after the entire agent run completes**. This means:
- If user refreshes during an agent run, the session state file doesn't exist yet
- There's no way to recover the rawMessages or continue viewing in dev mode
- Need a solution that persists data **during** the run, not just after

---

## Data Architecture Analysis

### Option A: Keep Dual Sources (Current + Add History)
```
Live Session:
  - User Mode → React state (timeline/messagesMap) → derived from SSE
  - Dev Mode  → React state (rawMessages) → from SSE

After Refresh:
  - User Mode → DB messages table (text only)
  - Dev Mode  → ??? (broken - no raw messages in DB)

History View:
  - Both modes → .session-state.json from Storage
```

**Pros:** Minimal changes
**Cons:**
- Dev mode broken after refresh
- Can't toggle modes after loading from DB
- 3 different data sources, confusing

### Option B: Hybrid localStorage + Supabase (Recommended)

**Key Insight:** Use localStorage for real-time persistence during agent runs, Supabase Storage for permanent history.

```
LIVE SESSION (streaming):
  - SSE → rawMessages (React state)
  - SSE → localStorage (persist after every message)
  - User Mode view derived from rawMessages
  - Dev Mode view uses rawMessages directly

AFTER REFRESH (same session, mid-run OR completed):
  - Check localStorage first (keyed by sessionId)
  - If found: Load rawMessages from localStorage
  - If not found: Try loading .session-state.json from Supabase
  - Both modes work identically

HISTORY VIEW (admin viewing other session):
  - Load .session-state.json from Supabase Storage
  - Populate rawMessages from it
  - Both modes work identically

AGENT RUN COMPLETES:
  - Server saves .session-state.json to Supabase Storage (already happens)
  - Client can optionally clear localStorage for that session
```

**Data Flow Diagram:**
```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  LIVE STREAMING                                                      │
│  ──────────────                                                      │
│  SSE Stream ─┬──► rawMessages (React state) ──► Display              │
│              │                                                       │
│              └──► localStorage[sessionId] (persisted every message)  │
│                                                                      │
│  AFTER REFRESH                                                       │
│  ─────────────                                                       │
│  1. Check localStorage[sessionId]                                    │
│     ├─ Found: Load → rawMessages → Display                           │
│     └─ Not Found: Check Supabase Storage                             │
│                                                                       │
│  2. Check Supabase Storage (.session-state.json)                     │
│     ├─ Found: Load → rawMessages → Display                           │
│     └─ Not Found: Fall back to DB messages (user mode only)          │
│                                                                      │
│  HISTORY VIEW (admin)                                                │
│  ────────────────────                                                │
│  Supabase Storage ──► rawMessages ──► Display                        │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Survives refresh **during** agent runs (localStorage)
- Permanent storage for completed sessions (Supabase)
- Toggle between modes works anytime
- Consistent behavior live vs history
- DB `messages` table becomes optional (for search/listing only)

**Cons:**
- Slightly larger download for history (full SDK messages vs text)
- Need to derive user-mode view from raw messages
- localStorage has size limits (~5-10MB per origin, but per-session should be fine)

### Option C: Store Raw Messages in DB
Store full SDK message JSON in database instead of just text.

**Pros:** Single source everywhere, fast queries
**Cons:**
- Large storage increase (10x+)
- Schema migration
- Most SDK message content is ephemeral (tool results, etc.)
- Overkill for non-admin users

---

## Recommended Solution: Option B (Hybrid localStorage + Supabase)

### Architecture After Implementation

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Data Flow Diagram                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  LIVE SESSION                                                       │
│  ────────────                                                       │
│  SSE Stream ─┬───► rawMessages (DevModeContext)                     │
│              │          │                                           │
│              │          ├──► DevModeMessageList (dev mode)          │
│              │          │                                           │
│              │          └──► deriveUserView() ──► MessageList       │
│              │                                    (user mode)       │
│              │                                                      │
│              └───► localStorage[`session-${sessionId}`]             │
│                    (persisted after every SSE message)              │
│                                                                     │
│  AFTER REFRESH (own session)                                        │
│  ───────────────────────────                                        │
│  1. localStorage[`session-${sessionId}`] ──► rawMessages            │
│                                                  │                  │
│     (If localStorage empty, try Supabase)        ├──► DevModeList   │
│                                                  │                  │
│  2. Supabase .session-state.json ──► rawMessages └──► MessageList   │
│                                                                     │
│  HISTORY VIEW (admin viewing other session)                         │
│  ──────────────────────────────────────────                         │
│  Supabase .session-state.json ──► rawMessages ──► Display           │
│                                                                     │
│  DB messages table: Only used for session list + search             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Changes

1. **Add localStorage persistence during streaming**
   - After every SSE message, persist rawMessages to `localStorage[session-${sessionId}]`
   - Survives page refresh even during active agent runs

2. **Add session state loading with fallback chain**
   - First check localStorage (for current/recent sessions)
   - Then check Supabase Storage `.session-state.json` (for completed sessions)
   - Fall back to DB messages if neither exists (user mode only, with warning)

3. **Add `deriveUserView()` utility**
   - Converts raw SDK messages → `timeline` + `messagesMap` + `subagentsMap`
   - Used for user mode display (live or history)

4. **Add "history mode" flag**
   - When viewing history, disable message input
   - Show banner indicating read-only mode

---

## Implementation Plan

### Step 1: Add localStorage Persistence During Streaming

**File:** `apps/web/src/lib/sessionStorage.ts` (NEW)

```typescript
const SESSION_STORAGE_PREFIX = 'session-state-';

interface StoredSessionState {
  sessionId: string;
  rawMessages: unknown[];
  subagentRawMessages: Record<string, unknown[]>; // Map serialized as object
  lastUpdated: number;
}

/**
 * Persist session state to localStorage after every message.
 * Called from SSE message handler.
 */
export function persistSessionState(
  sessionId: string,
  rawMessages: unknown[],
  subagentRawMessages: Map<string, unknown[]>
): void {
  const key = `${SESSION_STORAGE_PREFIX}${sessionId}`;
  const state: StoredSessionState = {
    sessionId,
    rawMessages,
    subagentRawMessages: Object.fromEntries(subagentRawMessages),
    lastUpdated: Date.now(),
  };

  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch (error) {
    // localStorage might be full or disabled
    console.warn('Failed to persist session state to localStorage:', error);
  }
}

/**
 * Load session state from localStorage.
 * Returns null if not found or expired.
 */
export function loadSessionStateFromLocal(sessionId: string): StoredSessionState | null {
  const key = `${SESSION_STORAGE_PREFIX}${sessionId}`;

  try {
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const state: StoredSessionState = JSON.parse(stored);

    // Optional: expire after 24 hours
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;
    if (Date.now() - state.lastUpdated > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }

    return state;
  } catch (error) {
    console.warn('Failed to load session state from localStorage:', error);
    return null;
  }
}

/**
 * Clear session state from localStorage (e.g., when session is deleted).
 */
export function clearSessionState(sessionId: string): void {
  const key = `${SESSION_STORAGE_PREFIX}${sessionId}`;
  localStorage.removeItem(key);
}

/**
 * Cleanup old session states to prevent localStorage from filling up.
 * Keep only the N most recent sessions.
 */
export function cleanupOldSessionStates(keepCount: number = 10): void {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(SESSION_STORAGE_PREFIX));

  if (keys.length <= keepCount) return;

  // Sort by lastUpdated, remove oldest
  const states = keys
    .map(key => {
      try {
        const state: StoredSessionState = JSON.parse(localStorage.getItem(key) || '{}');
        return { key, lastUpdated: state.lastUpdated || 0 };
      } catch {
        return { key, lastUpdated: 0 };
      }
    })
    .sort((a, b) => b.lastUpdated - a.lastUpdated);

  // Remove oldest beyond keepCount
  states.slice(keepCount).forEach(({ key }) => {
    localStorage.removeItem(key);
  });
}
```

### Step 2: Add Session State Loading API (Server)

**File:** `apps/server/src/routes/sessions.ts`

```typescript
// Get session state file for any session (admin only for other users' sessions)
sessionsRouter.get('/:id/state', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');

  // Get session info
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('session_name, user_id')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  // Check authorization: own session OR admin
  if (session.user_id !== user.id && !user.isAdmin) {
    return c.json({ error: 'Not authorized' }, 403);
  }

  // Download session state from storage
  const storagePath = `${session.user_id}/${session.session_name}/.session-state.json`;

  const { data, error } = await supabase.storage
    .from('agent-files')
    .download(storagePath);

  if (error) {
    return c.json({ error: 'Session state not found', code: 'NO_STATE_FILE' }, 404);
  }

  const text = await data.text();
  const sessionState = JSON.parse(text);

  return c.json({ sessionState });
});
```

### Step 3: Add Frontend API Function

**File:** `apps/web/src/lib/api.ts`

```typescript
export async function getSessionState(sessionId: string): Promise<SessionState | null> {
  const response = await fetchWithAuth(`/api/sessions/${sessionId}/state`);

  if (!response.ok) {
    if (response.status === 404) {
      return null; // No session state file
    }
    throw new Error('Failed to fetch session state');
  }

  const data = await response.json();
  return data.sessionState;
}
```

### Step 4: Add Derive User View Utility

**File:** `apps/web/src/lib/messageUtils.ts` (NEW)

```typescript
import type { ChatMessage, TimelineItem, Subagent, SubagentToolCall } from '@/types';

interface UserViewState {
  timeline: TimelineItem[];
  messagesMap: Map<string, ChatMessage>;
  subagentsMap: Map<string, Subagent>;
}

/**
 * Derives user-mode view state from raw SDK messages.
 * This allows us to display the same data in both modes.
 */
export function deriveUserView(rawMessages: unknown[]): UserViewState {
  const timeline: TimelineItem[] = [];
  const messagesMap = new Map<string, ChatMessage>();
  const subagentsMap = new Map<string, Subagent>();
  const addedSubagentIds = new Set<string>();

  let currentUserMessageId: string | null = null;
  let currentAssistantMessageId: string | null = null;
  let assistantContent = '';

  for (const raw of rawMessages) {
    const msg = raw as {
      type?: string;
      subtype?: string;
      uuid?: string;
      message?: { content?: unknown[] } | string;
      parent_tool_use_id?: string;
    };

    // Skip subagent messages (they go into subagentsMap)
    if (msg.parent_tool_use_id) {
      // Handle subagent tool calls
      if (msg.type === 'assistant') {
        const content = (msg.message as { content?: unknown[] })?.content;
        if (Array.isArray(content)) {
          const toolUses = content.filter((b: unknown) =>
            (b as { type?: string }).type === 'tool_use' &&
            (b as { name?: string }).name !== 'Task'
          );

          if (toolUses.length > 0) {
            const subagent = subagentsMap.get(msg.parent_tool_use_id);
            if (subagent) {
              const newToolCalls: SubagentToolCall[] = toolUses.map((tc: unknown) => {
                const t = tc as { id?: string; name?: string; input?: Record<string, unknown> };
                return {
                  id: t.id || '',
                  name: t.name || 'Unknown',
                  input: t.input || {},
                  status: 'completed' as const,
                  timestamp: new Date(),
                };
              });
              subagentsMap.set(msg.parent_tool_use_id, {
                ...subagent,
                toolCalls: [...subagent.toolCalls, ...newToolCalls],
              });
            }
          }
        }
      }

      // Mark subagent complete on result
      if (msg.type === 'result') {
        const subagent = subagentsMap.get(msg.parent_tool_use_id);
        if (subagent) {
          subagentsMap.set(msg.parent_tool_use_id, {
            ...subagent,
            status: 'completed',
            endTime: new Date(),
          });
        }
      }
      continue;
    }

    // User message
    if (msg.type === 'user') {
      const id = msg.uuid || crypto.randomUUID();

      // Extract text from user message
      let content = '';
      if (typeof msg.message === 'string') {
        content = msg.message;
      } else if (Array.isArray((msg.message as { content?: unknown[] })?.content)) {
        const textBlocks = ((msg.message as { content?: unknown[] }).content || [])
          .filter((b: unknown) => (b as { type?: string }).type === 'text')
          .map((b: unknown) => (b as { text?: string }).text || '');
        content = textBlocks.join('\n');
      }

      // Skip tool_result only messages
      if (!content) continue;

      const chatMessage: ChatMessage = {
        id,
        type: 'user',
        content,
        timestamp: new Date(),
      };

      messagesMap.set(id, chatMessage);
      timeline.push({ type: 'message', id, timestamp: new Date() });
      currentUserMessageId = id;

      // Reset assistant accumulator
      assistantContent = '';
      currentAssistantMessageId = null;
    }

    // Assistant message
    if (msg.type === 'assistant') {
      const content = (msg.message as { content?: unknown[] })?.content;
      if (!Array.isArray(content)) continue;

      // Extract text
      const textContent = content
        .filter((b: unknown) => (b as { type?: string }).type === 'text')
        .map((b: unknown) => (b as { text?: string }).text || '')
        .join('');

      // Extract Task tool calls (subagent spawning)
      const taskCalls = content.filter((b: unknown) =>
        (b as { type?: string; name?: string }).type === 'tool_use' &&
        (b as { name?: string }).name === 'Task'
      );

      // Create subagents for Task calls
      for (const task of taskCalls) {
        const t = task as { id?: string; input?: { subagent_type?: string; description?: string; prompt?: string } };
        const taskId = t.id || '';

        if (!addedSubagentIds.has(taskId)) {
          const subagent: Subagent = {
            id: taskId,
            type: t.input?.subagent_type || 'unknown',
            description: t.input?.description || t.input?.prompt?.substring(0, 50) || 'Task',
            status: 'running',
            startTime: new Date(),
            toolCalls: [],
          };

          subagentsMap.set(taskId, subagent);
          addedSubagentIds.add(taskId);
          timeline.push({ type: 'subagent', id: taskId, timestamp: new Date() });
        }
      }

      // Accumulate assistant text
      if (textContent) {
        assistantContent += textContent;

        if (!currentAssistantMessageId) {
          currentAssistantMessageId = msg.uuid || crypto.randomUUID();
          timeline.push({ type: 'message', id: currentAssistantMessageId, timestamp: new Date() });
        }

        messagesMap.set(currentAssistantMessageId, {
          id: currentAssistantMessageId,
          type: 'assistant',
          content: assistantContent,
          contentBlocks: content as any[],
          timestamp: new Date(),
        });
      }
    }
  }

  return { timeline, messagesMap, subagentsMap };
}
```

### Step 5: Add History Mode + localStorage Integration to DevModeContext

**File:** `apps/web/src/contexts/DevModeContext.tsx`

```typescript
import {
  persistSessionState,
  loadSessionStateFromLocal,
  cleanupOldSessionStates
} from '@/lib/sessionStorage';
import { getSessionState } from '@/lib/api';

interface DevModeContextType {
  // ... existing fields ...

  // History mode
  isHistoryMode: boolean;
  historySessionId: string | null;
  loadSessionHistory: (sessionId: string) => Promise<void>;
  loadSessionFromStorage: (sessionId: string) => Promise<boolean>; // For refresh recovery
  exitHistoryMode: () => void;

  // Persistence
  persistCurrentSession: () => void; // Call after each SSE message
}

// In provider:
const [isHistoryMode, setIsHistoryMode] = useState(false);
const [historySessionId, setHistorySessionId] = useState<string | null>(null);
const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

// Persist to localStorage after every message update
const persistCurrentSession = useCallback(() => {
  if (!currentSessionId) return;
  persistSessionState(currentSessionId, rawMessages, subagentRawMessages);
}, [currentSessionId, rawMessages, subagentRawMessages]);

// Load session state with fallback chain: localStorage → Supabase → null
const loadSessionFromStorage = async (sessionId: string): Promise<boolean> => {
  // 1. Try localStorage first (for mid-run refresh recovery)
  const localState = loadSessionStateFromLocal(sessionId);
  if (localState) {
    console.log('Loaded session from localStorage');
    setRawMessages(localState.rawMessages);
    setSubagentRawMessages(new Map(Object.entries(localState.subagentRawMessages)));
    setCurrentSessionId(sessionId);
    return true;
  }

  // 2. Try Supabase Storage (for completed sessions)
  try {
    const sessionState = await getSessionState(sessionId);
    if (sessionState) {
      console.log('Loaded session from Supabase Storage');
      const mainMessages: unknown[] = [];
      const subagentMessages = new Map<string, unknown[]>();

      for (const msg of sessionState.messages) {
        const parentId = (msg as any).parent_tool_use_id;
        if (parentId) {
          const existing = subagentMessages.get(parentId) || [];
          subagentMessages.set(parentId, [...existing, msg]);
        } else {
          mainMessages.push(msg);
        }
      }

      setRawMessages(mainMessages);
      setSubagentRawMessages(subagentMessages);
      setCurrentSessionId(sessionId);
      return true;
    }
  } catch (error) {
    console.warn('Failed to load from Supabase Storage:', error);
  }

  // 3. Neither found
  return false;
};

// Load history for admin viewing (always from Supabase)
const loadSessionHistory = async (sessionId: string) => {
  try {
    const sessionState = await getSessionState(sessionId);
    if (!sessionState) {
      throw new Error('Session state not found');
    }

    // Clear existing state
    setRawMessages([]);
    setSubagentRawMessages(new Map());
    setSubagentTabs([]);

    // Populate from session state
    const mainMessages: unknown[] = [];
    const subagentMessages = new Map<string, unknown[]>();

    for (const msg of sessionState.messages) {
      const parentId = (msg as any).parent_tool_use_id;
      if (parentId) {
        const existing = subagentMessages.get(parentId) || [];
        subagentMessages.set(parentId, [...existing, msg]);
      } else {
        mainMessages.push(msg);
      }
    }

    setRawMessages(mainMessages);
    setSubagentRawMessages(subagentMessages);
    setIsHistoryMode(true);
    setHistorySessionId(sessionId);
  } catch (error) {
    console.error('Failed to load session history:', error);
    throw error;
  }
};

const exitHistoryMode = () => {
  setIsHistoryMode(false);
  setHistorySessionId(null);
  setRawMessages([]);
  setSubagentRawMessages(new Map());
  setSubagentTabs([]);
};

// Cleanup old localStorage entries on mount
useEffect(() => {
  cleanupOldSessionStates(10); // Keep 10 most recent
}, []);
```

### Step 6: Update ChatInterface for History Mode + localStorage Persistence

**File:** `apps/web/src/components/ChatInterface.tsx`

```typescript
const {
  isDevMode, setDevMode, isAdmin, openSubagentTab,
  rawMessages, isHistoryMode, exitHistoryMode,
  persistCurrentSession, loadSessionFromStorage
} = useDevMode();

// On session change, try to load from storage (for refresh recovery)
useEffect(() => {
  if (sessionId && rawMessages.length === 0) {
    loadSessionFromStorage(sessionId);
  }
}, [sessionId]);

// Persist to localStorage after each SSE message
// (called from SSE handler after updating rawMessages)
useEffect(() => {
  if (rawMessages.length > 0 && !isHistoryMode) {
    persistCurrentSession();
  }
}, [rawMessages, isHistoryMode, persistCurrentSession]);

// Derive user view from raw messages (works for both live and history)
const derivedUserView = useMemo(() => {
  if (rawMessages.length === 0) return null;
  return deriveUserView(rawMessages);
}, [rawMessages]);

// Use derived view OR live state
const displayTimeline = derivedUserView?.timeline ?? timeline;
const displayMessagesMap = derivedUserView?.messagesMap ?? messagesMap;
const displaySubagentsMap = derivedUserView?.subagentsMap ?? subagentsMap;

// In render:
const renderChatView = () => (
  <>
    {/* History Mode Banner */}
    {isHistoryMode && (
      <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-2 flex items-center justify-between">
        <span className="text-yellow-400 text-sm">
          Viewing session history (read-only)
        </span>
        <button
          onClick={exitHistoryMode}
          className="text-xs text-yellow-400 hover:text-yellow-300"
        >
          Exit History View
        </button>
      </div>
    )}

    {/* Messages */}
    <main className="flex-1 overflow-y-auto p-4">
      {isDevMode ? (
        <DevModeMessageList
          messages={rawMessages}
          onSubagentClick={openSubagentTab}
        />
      ) : (
        <MessageList
          timeline={displayTimeline}
          messagesMap={displayMessagesMap}
          subagentsMap={displaySubagentsMap}
        />
      )}
      <div ref={messagesEndRef} />
    </main>

    {/* Input - disabled in history mode */}
    {!isHistoryMode && (
      <footer className="border-t border-border p-4 flex-shrink-0">
        <MessageInput onSend={handleSend} disabled={isStreaming} />
      </footer>
    )}
  </>
);
```

### Step 7: Add "View History" Button to Session List

**File:** `apps/web/src/components/FileExplorer.tsx` (or SessionList)

```typescript
const { isAdmin, loadSessionHistory } = useDevMode();

// In session list item render:
{isAdmin && (
  <button
    onClick={(e) => {
      e.stopPropagation();
      loadSessionHistory(session.id);
    }}
    className="text-xs text-muted-foreground hover:text-foreground"
    title="View full session history"
  >
    View History
  </button>
)}
```

---

## Implementation Phases

### Phase 8 (Single Phase - Full Implementation)

Since we're not worrying about backwards compatibility, we implement everything together:

1. **localStorage persistence** - Survive mid-run refresh
2. **Supabase Storage loading** - Load completed sessions
3. **deriveUserView()** - Unified rendering from rawMessages
4. **History mode UI** - Admin session viewing
5. **View History button** - Admin access to any session

---

## Success Criteria

- [ ] User refreshes mid-agent-run → session state restored from localStorage
- [ ] User refreshes after agent completes → session state loaded from Supabase Storage
- [ ] Admin can click "View History" on any session
- [ ] Both User Mode and Dev Mode display correctly after refresh
- [ ] Toggle between modes works after refresh
- [ ] Message input is disabled in history mode (read-only)
- [ ] "Exit History View" returns to normal state
- [ ] Non-admin users cannot view other users' sessions
- [ ] localStorage cleanup prevents storage bloat (keep 10 most recent)

---

## Decisions Made

1. **Backwards compatibility?** → No, don't worry about it

2. **Large session file size?** → OK, acceptable for now

3. **Backfill old sessions?** → No, don't backfill

4. **Real-time updates?** → No, manual refresh only

5. **Sessions without `.session-state.json`?** → Show "Full history not available" message (no fallback to DB)

---

## Files to Create/Modify

| File | Change |
|------|--------|
| `apps/web/src/lib/sessionStorage.ts` | NEW - localStorage persistence utilities |
| `apps/server/src/routes/sessions.ts` | Add `/:id/state` endpoint |
| `apps/web/src/lib/api.ts` | Add `getSessionState()` |
| `apps/web/src/lib/messageUtils.ts` | NEW - `deriveUserView()` |
| `apps/web/src/contexts/DevModeContext.tsx` | Add history mode + localStorage integration |
| `apps/web/src/components/ChatInterface.tsx` | History mode UI + persistence hooks |
| `apps/web/src/components/FileExplorer.tsx` | "View History" button |
