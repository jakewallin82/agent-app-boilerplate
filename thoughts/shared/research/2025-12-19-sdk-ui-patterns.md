# Claude Agent SDK UI Patterns Research

## Key Findings

### 1. Session Management

**How Resume Works:**
- All SDK messages include `session_id` field
- Capture `session_id` from first message (typically `SDKSystemMessage` with `subtype: 'init'`)
- Pass captured ID as `resume` option in subsequent queries
- SDK internally loads conversation history from `~/.claude/projects/`
- No need to pass message history back - SDK handles it

**Implementation Pattern (from electron app):**
```typescript
let currentSessionId: string | null = null;

const queryIterator = query({
  prompt: content,
  options: {
    resume: currentSessionId || undefined,
    // ...
  },
});

for await (const message of queryIterator) {
  if (!currentSessionId && 'session_id' in message) {
    currentSessionId = message.session_id;
  }
}
```

### 2. SDK Message Types

| Type | When Emitted | Key Fields |
|------|-------------|------------|
| `system` (init) | First message | `session_id`, `model`, `tools`, `cwd` |
| `assistant` | Complete response | `message.content` (array of blocks), `parent_tool_use_id` |
| `stream_event` | During streaming | `event` (partial content deltas) - requires `includePartialMessages: true` |
| `user` | Tool results | `tool_use_result`, `isSynthetic` |
| `result` | Query complete | `total_cost_usd`, `num_turns`, `usage` |
| `tool_progress` | Long tools | `tool_name`, `elapsed_time_seconds` |

**Content Blocks in Assistant Messages:**
- `text` - Text content with `.text` field
- `tool_use` - Tool calls with `.id`, `.name`, `.input`
- `thinking` - Extended thinking with `.thinking` field

### 3. Timeline-Based UI Architecture

The electron app uses a unified timeline approach:

```typescript
// Three separate state structures
const [timeline, setTimeline] = useState<TimelineItem[]>([]);
const [messagesMap, setMessagesMap] = useState<Map<string, ChatMessage>>(new Map());
const [subagentsMap, setSubagentsMap] = useState<Map<string, Subagent>>(new Map());

// Timeline controls render order
type TimelineItem =
  | { type: 'message'; id: string; timestamp: Date }
  | { type: 'subagent'; id: string; timestamp: Date };
```

**Benefits:**
- Clean separation of order (timeline) vs data (maps)
- Easy chronological rendering
- Efficient updates via Map lookups

### 4. Subagent Detection and Tracking

**How to Detect Subagents:**
- `Task` tool_use blocks in assistant messages spawn subagents
- `tool_use.id` becomes the subagent ID
- Messages with `parent_tool_use_id` belong to that subagent
- `result` message with `parent_tool_use_id` = subagent completion

**Subagent Structure:**
```typescript
interface Subagent {
  id: string;                    // tool_use id
  type: string;                  // input.subagent_type
  description: string;           // input.description
  status: 'running' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  toolCalls: SubagentToolCall[];
}
```

**Processing Flow:**
1. Main assistant message with `Task` tool → Create subagent, add to timeline
2. Assistant message with `parent_tool_use_id` → Append to `subagent.toolCalls[]` (NOT timeline)
3. Result message with `parent_tool_use_id` → Mark subagent completed

### 5. Tool Call Display

**One-liner summaries for each tool:**
```typescript
switch (toolName) {
  case 'Read': return filename;
  case 'Write/Edit': return filename;
  case 'Bash': return command.slice(0, 50);
  case 'Grep': return `"${pattern}"`;
  case 'Glob': return pattern;
  case 'WebSearch': return `"${query}"`;
  case 'Task': return description || subagent_type;
}
```

**Visual Hierarchy:**
- Main messages: Full width
- Tool calls: Orange left border, collapsible
- Subagents: Colored left border (by status), collapsible
- Subagent tools: Double-indented with connecting lines

### 6. Streaming with Partial Messages

Enable with `includePartialMessages: true`:
```typescript
const queryIterator = query({
  prompt,
  options: {
    includePartialMessages: true,
    // ...
  }
});
```

**Stream Event Types:**
- `message_start` - Streaming begins
- `content_block_start` - New text/tool block
- `content_block_delta` - Incremental text chunks
- `content_block_stop` - Block complete
- `message_stop` - Streaming ends

---

## Implementation Recommendations

### Session Persistence
1. Store `sessionId` in localStorage on first message
2. On page load, read from localStorage
3. Pass to `resume` option
4. Clear on "New Chat"

### Message Storage Strategy
Since agents produce 100+ messages per query, don't save all to Supabase immediately:

**Option A: Lazy Persistence**
- Keep messages in React state during session
- Only save final assistant text + user messages to DB
- Save on session end or periodic intervals

**Option B: Batch Writes**
- Queue messages in memory
- Flush to DB in batches (every 10 messages or 5 seconds)
- Use Supabase batch insert

**Option C: Local-First**
- Store full message history in IndexedDB
- Only sync summaries to Supabase
- Reduces DB costs, improves performance

### UI Components Needed
1. `SubagentViewer` - Collapsible card showing subagent with tool calls
2. `ToolUseDisplay` - Collapsible tool call with parameters
3. `MessageList` - Timeline-based rendering
4. Tool icons mapping
5. Status indicators (running/completed/failed)

### Message Processing Logic
```typescript
function handleSDKMessage(message: SDKMessage) {
  const parentId = message.parent_tool_use_id;

  if (message.type === 'system' && message.subtype === 'init') {
    // Save session_id to localStorage
    localStorage.setItem('agentSessionId', message.session_id);
  }

  if (message.type === 'result' && parentId) {
    // Subagent completed
    updateSubagent(parentId, { status: 'completed', endTime: new Date() });
    return;
  }

  if (parentId && message.type === 'assistant') {
    // Subagent message - don't add to timeline
    appendSubagentToolCalls(parentId, extractToolCalls(message));
    return;
  }

  if (message.type === 'assistant') {
    // Main agent message
    const taskCalls = extractTaskToolCalls(message);
    taskCalls.forEach(task => {
      createSubagent(task.id, task.input);
      addToTimeline({ type: 'subagent', id: task.id });
    });

    // Add message to timeline
    const msg = createChatMessage(message);
    addToTimeline({ type: 'message', id: msg.id });
  }
}
```
