# File Viewer UI + Persistence Implementation Plan

## Overview

Add an IDE-style three-column layout with file explorer, chat interface, and file viewer tabs. Implement automatic file persistence to Supabase Storage with session-scoped file management that works in ephemeral Cloud Run containers.

## Current State Analysis

**Completed in Phase 1:**
- Monorepo with Vite frontend + Hono backend
- Supabase auth and session persistence
- Chat interface with streaming SSE responses
- Subagent visualization
- Agent can write files to local filesystem via Write/Edit tools

**Missing:**
- No file detection when agent writes files
- No file persistence to Supabase Storage
- No file viewer UI
- No session-scoped file management
- No session restore (download files from Storage)

## Desired End State

```
+-------------------+------------------------+------------------------+
│  File Explorer   │    Chat Interface     │   File Viewer Tabs    │
│                  │                       │                       │
│ ▼ Sessions       │  ┌─────────────────┐  │  [analysis.md ×]      │
│   📁 Analysis    │  │ User: Analyze   │  │  ┌──────────────────┐ │
│   📁 Research    │  └─────────────────┘  │  │ # Analysis       │ │
│   📁 Draft       │  ┌─────────────────┐  │  │                  │ │
│                  │  │ Agent: Done...  │  │  │ Content here...  │ │
│ + New Session    │  └─────────────────┘  │  └──────────────────┘ │
│                  │                       │                       │
│ Current Files    │  [   Input area   ]   │                       │
│   📄 output.md   │                       │                       │
│   📄 data.json   │                       │                       │
+-------------------+------------------------+------------------------+
```

**Features:**
1. **File Explorer (Left)** - List all sessions, click to load. Show files in current session.
2. **Chat Interface (Middle)** - Existing chat, no changes needed.
3. **File Viewer (Right)** - Closable tabs showing file content. Markdown rendered.
4. **Auto-persist** - Files uploaded to Supabase Storage immediately when agent writes them.
5. **Session Restore** - When loading a past session, download files from Storage to container.

## What We're NOT Doing

- JSON viewer with custom components (future phase)
- File editing in the UI (read-only for now)
- Real-time collaborative editing
- File upload from user
- File deletion from UI

---

## Architecture Decision: Hooks vs SSE Stream Interception

### Option A: Claude Code Hooks (PostToolUse)

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/persist-file.sh"
      }]
    }]
  }
}
```

**Pros:**
- Automatic, handles all file writes including subagents
- Clean separation from agent code

**Cons:**
- Script runs outside SSE stream - frontend doesn't know immediately
- Need polling or Supabase Realtime for frontend updates
- Shell script needs Supabase credentials (security concern)
- More complex deployment

### Option B: SSE Stream Interception (Recommended)

Detect Write/Edit tool_result in agent.ts SSE stream, upload immediately, emit file_event.

**Pros:**
- Real-time frontend updates via existing SSE stream
- All logic in TypeScript
- Credentials managed normally via environment
- Simpler deployment

**Cons:**
- Need to parse SSE messages in agent.ts
- Slightly more code

### Decision: **Option B - SSE Stream Interception**

The SSE approach provides real-time updates to the frontend without additional infrastructure. We can add hooks as a backup later if needed.

---

## Database Changes

### Add columns to sessions table

```sql
-- Add session name and data folder path
ALTER TABLE public.sessions
ADD COLUMN name TEXT,
ADD COLUMN data_folder TEXT;

-- Add index for faster lookups
CREATE INDEX sessions_user_updated ON public.sessions(user_id, updated_at DESC);
```

### Update agent_files table (already in spec, ensure it exists)

```sql
-- Agent output files (from original spec)
CREATE TABLE IF NOT EXISTS public.agent_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  file_path TEXT NOT NULL,           -- Relative path: "analysis.md"
  storage_path TEXT NOT NULL,        -- Full storage path: "{user_id}/{session_id}/analysis.md"
  file_type TEXT,                    -- Extension: "md", "json"
  file_size INTEGER,
  content_hash TEXT,                 -- MD5 for change detection
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Unique constraint: one file per path per session
ALTER TABLE public.agent_files
ADD CONSTRAINT agent_files_session_path_unique
UNIQUE (session_id, file_path);

-- RLS
ALTER TABLE public.agent_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own files"
  ON public.agent_files FOR ALL
  USING (auth.uid() = user_id);
```

---

## Phase 1: Backend File Detection & Persistence

### Overview

Intercept Write/Edit tool results in SSE stream, upload files to Supabase Storage, emit file events to frontend.

### Changes Required

#### 1. File Service

**File**: `apps/server/src/services/files.ts`

```typescript
import { createHash } from 'crypto';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { supabase } from '../lib/supabase.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const BUCKET_NAME = 'agent-files';

export interface FileInfo {
  id: string;
  sessionId: string;
  userId: string;
  filePath: string;
  storagePath: string;
  fileType: string;
  fileSize: number;
  contentHash: string;
  signedUrl?: string;
  createdAt: string;
  updatedAt: string;
}

// Ensure session directory exists
export async function ensureSessionDir(sessionId: string): Promise<string> {
  const sessionDir = path.join(DATA_DIR, sessionId);
  if (!existsSync(sessionDir)) {
    await mkdir(sessionDir, { recursive: true });
  }
  return sessionDir;
}

// Get session directory path
export function getSessionDir(sessionId: string): string {
  return path.join(DATA_DIR, sessionId);
}

// Persist a file to Supabase Storage
export async function persistFile(
  userId: string,
  sessionId: string,
  localFilePath: string
): Promise<FileInfo | null> {
  try {
    // Read file content
    const content = await readFile(localFilePath);
    const contentHash = createHash('md5').update(content).digest('hex');

    // Extract relative path from session dir
    const sessionDir = getSessionDir(sessionId);
    const relativePath = path.relative(sessionDir, localFilePath);

    // Skip files outside session directory
    if (relativePath.startsWith('..')) {
      console.log('[FILES] Skipping file outside session dir:', localFilePath);
      return null;
    }

    // Storage path: {userId}/{sessionId}/{relativePath}
    const storagePath = `${userId}/${sessionId}/${relativePath}`;
    const fileType = path.extname(relativePath).slice(1) || 'txt';

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, content, {
        upsert: true,
        contentType: getContentType(fileType),
      });

    if (uploadError) {
      console.error('[FILES] Upload error:', uploadError);
      throw uploadError;
    }

    // Upsert to agent_files table
    const { data, error: dbError } = await supabase
      .from('agent_files')
      .upsert({
        session_id: sessionId,
        user_id: userId,
        file_path: relativePath,
        storage_path: storagePath,
        file_type: fileType,
        file_size: content.length,
        content_hash: contentHash,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'session_id,file_path',
      })
      .select()
      .single();

    if (dbError) {
      console.error('[FILES] DB error:', dbError);
      throw dbError;
    }

    console.log('[FILES] Persisted:', relativePath);

    return {
      id: data.id,
      sessionId: data.session_id,
      userId: data.user_id,
      filePath: data.file_path,
      storagePath: data.storage_path,
      fileType: data.file_type,
      fileSize: data.file_size,
      contentHash: data.content_hash,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  } catch (error) {
    console.error('[FILES] Persist error:', error);
    return null;
  }
}

// Get signed URL for a file
export async function getSignedUrl(storagePath: string, expiresIn = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, expiresIn);

  if (error) {
    console.error('[FILES] Signed URL error:', error);
    return null;
  }

  return data.signedUrl;
}

// List files for a session
export async function listSessionFiles(sessionId: string): Promise<FileInfo[]> {
  const { data, error } = await supabase
    .from('agent_files')
    .select('*')
    .eq('session_id', sessionId)
    .order('file_path');

  if (error) {
    console.error('[FILES] List error:', error);
    return [];
  }

  // Add signed URLs
  const filesWithUrls = await Promise.all(
    data.map(async (file) => ({
      id: file.id,
      sessionId: file.session_id,
      userId: file.user_id,
      filePath: file.file_path,
      storagePath: file.storage_path,
      fileType: file.file_type,
      fileSize: file.file_size,
      contentHash: file.content_hash,
      signedUrl: await getSignedUrl(file.storage_path),
      createdAt: file.created_at,
      updatedAt: file.updated_at,
    }))
  );

  return filesWithUrls;
}

// Restore session files from Storage to local disk
export async function restoreSessionFiles(sessionId: string): Promise<void> {
  const files = await listSessionFiles(sessionId);
  const sessionDir = await ensureSessionDir(sessionId);

  for (const file of files) {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(file.storagePath);

    if (error) {
      console.error('[FILES] Download error:', file.filePath, error);
      continue;
    }

    const localPath = path.join(sessionDir, file.filePath);
    const localDir = path.dirname(localPath);

    if (!existsSync(localDir)) {
      await mkdir(localDir, { recursive: true });
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    await writeFile(localPath, buffer);
    console.log('[FILES] Restored:', file.filePath);
  }
}

// Content type mapping
function getContentType(ext: string): string {
  const types: Record<string, string> = {
    md: 'text/markdown',
    json: 'application/json',
    txt: 'text/plain',
    csv: 'text/csv',
    html: 'text/html',
    js: 'text/javascript',
    ts: 'text/typescript',
    py: 'text/x-python',
  };
  return types[ext] || 'application/octet-stream';
}
```

#### 2. Update Agent Route

**File**: `apps/server/src/routes/agent.ts`

Add file detection and persistence:

```typescript
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../lib/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  persistFile,
  ensureSessionDir,
  getSessionDir,
  restoreSessionFiles,
  type FileInfo
} from '../services/files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const agentRouter = new Hono();

agentRouter.use('*', authMiddleware);

const querySchema = z.object({
  content: z.string().min(1),
  sessionId: z.string().uuid().optional(),
  sdkSessionId: z.string().optional(),
});

// Base data directory
const DATA_DIR = path.resolve(__dirname, '../../../../data');

// Helper to extract text content from assistant message
function extractTextContent(message: SDKMessage): string {
  if (message.type !== 'assistant') return '';
  const content = (message as any).message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text || '')
    .join('');
}

// Detect Write/Edit tool results
interface ToolResult {
  toolName: string;
  filePath: string | null;
  success: boolean;
}

function parseToolResult(message: SDKMessage): ToolResult | null {
  if (message.type !== 'user') return null;

  const content = (message as any).message?.content;
  if (!Array.isArray(content)) return null;

  for (const block of content) {
    if (block.type === 'tool_result') {
      // Tool results contain the outcome of Write/Edit
      const toolUseId = block.tool_use_id;
      const resultContent = block.content;

      // Check if it's a file operation result
      if (typeof resultContent === 'string') {
        // Write tool returns: "Successfully wrote to /path/to/file.md"
        const writeMatch = resultContent.match(/Successfully wrote to (.+)/);
        if (writeMatch) {
          return { toolName: 'Write', filePath: writeMatch[1], success: true };
        }

        // Edit tool returns: "Successfully edited /path/to/file.md"
        const editMatch = resultContent.match(/Successfully edited (.+)/);
        if (editMatch) {
          return { toolName: 'Edit', filePath: editMatch[1], success: true };
        }
      }
    }
  }

  return null;
}

agentRouter.post('/query', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();

  const parseResult = querySchema.safeParse(body);
  if (!parseResult.success) {
    return c.json({ error: 'Invalid request', details: parseResult.error }, 400);
  }

  const { content, sessionId, sdkSessionId: requestSdkSessionId } = parseResult.data;

  // If sessionId provided, verify ownership and restore files
  let session: any = null;
  let currentSessionId = sessionId;

  if (sessionId) {
    const { data, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .single();

    if (sessionError || !data) {
      return c.json({ error: 'Session not found' }, 404);
    }
    session = data;

    // Restore files from Storage to local disk
    await restoreSessionFiles(sessionId);

    // Save user message to existing session
    await supabase.from('messages').insert({
      session_id: sessionId,
      role: 'user',
      content,
    });
  }

  // Ensure session directory exists
  const sessionDir = currentSessionId
    ? await ensureSessionDir(currentSessionId)
    : DATA_DIR;

  return streamSSE(c, async (stream) => {
    let assistantContent = '';
    let sdkSessionId = requestSdkSessionId || session?.sdk_session_id;

    try {
      const queryIterator = query({
        prompt: content,
        options: {
          cwd: sessionDir, // Agent works in session-scoped directory
          maxTurns: 100,
          resume: sdkSessionId || undefined,
          allowedTools: [
            'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
            'WebSearch', 'WebFetch', 'Task', 'Skill', 'TodoWrite',
          ],
          settingSources: ['local', 'project'],
        },
      });

      for await (const message of queryIterator) {
        // Capture SDK session ID from init message
        if (message.type === 'system' && (message as any).subtype === 'init') {
          sdkSessionId = message.session_id;

          // Create session in DB if we don't have one
          if (!currentSessionId && sdkSessionId) {
            const { data: newSession } = await supabase
              .from('sessions')
              .insert({
                id: sdkSessionId,
                user_id: user.id,
                sdk_session_id: sdkSessionId,
                name: `Session ${new Date().toLocaleDateString()}`,
                data_folder: `data/${sdkSessionId}`,
              })
              .select()
              .single();

            if (newSession) {
              currentSessionId = newSession.id;
              await ensureSessionDir(currentSessionId);
            }
          }
        }

        // Detect file writes and persist immediately
        const toolResult = parseToolResult(message);
        if (toolResult && toolResult.success && toolResult.filePath && currentSessionId) {
          const fileInfo = await persistFile(user.id, currentSessionId, toolResult.filePath);

          if (fileInfo) {
            // Emit file event to frontend
            await stream.writeSSE({
              data: JSON.stringify({
                type: 'file_event',
                subtype: toolResult.toolName === 'Write' ? 'created' : 'updated',
                file: fileInfo,
              }),
            });
          }
        }

        // Accumulate assistant text content
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

      // Save to DB if we have a session
      if (currentSessionId) {
        if (assistantContent) {
          await supabase.from('messages').insert({
            session_id: currentSessionId,
            role: 'assistant',
            content: assistantContent,
          });
        }

        if (sdkSessionId) {
          await supabase
            .from('sessions')
            .update({
              sdk_session_id: sdkSessionId,
              updated_at: new Date().toISOString()
            })
            .eq('id', currentSessionId);
        }
      }

      await stream.writeSSE({ data: '[DONE]' });
    } catch (error) {
      console.error('Agent error:', error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'error',
          content: error instanceof Error ? error.message : 'Unknown error',
        }),
      });
    }
  });
});
```

#### 3. Files API Route

**File**: `apps/server/src/routes/files.ts`

```typescript
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { listSessionFiles, getSignedUrl, restoreSessionFiles } from '../services/files.js';

export const filesRouter = new Hono();

filesRouter.use('*', authMiddleware);

// List files for a session
filesRouter.get('/sessions/:sessionId/files', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');

  // Verify session ownership
  const { data: session, error } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (error || !session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const files = await listSessionFiles(sessionId);
  return c.json({ files });
});

// Get file content (returns signed URL)
filesRouter.get('/sessions/:sessionId/files/:fileId', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  const fileId = c.req.param('fileId');

  // Verify ownership
  const { data: file, error } = await supabase
    .from('agent_files')
    .select('*')
    .eq('id', fileId)
    .eq('session_id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (error || !file) {
    return c.json({ error: 'File not found' }, 404);
  }

  const signedUrl = await getSignedUrl(file.storage_path);

  return c.json({
    file: {
      ...file,
      signedUrl,
    }
  });
});

// Restore session files to container (for resuming work)
filesRouter.post('/sessions/:sessionId/restore', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');

  // Verify session ownership
  const { data: session, error } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (error || !session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  await restoreSessionFiles(sessionId);

  return c.json({ success: true });
});
```

#### 4. Update sessions route

**File**: `apps/server/src/routes/sessions.ts`

Add file count to session listing:

```typescript
// In sessionsRouter.get('/', ...)
sessionsRouter.get('/', async (c) => {
  const user = c.get('user');

  const { data, error } = await supabase
    .from('sessions')
    .select(`
      *,
      file_count:agent_files(count)
    `)
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  // Transform file_count from array to number
  const sessions = data.map(s => ({
    ...s,
    file_count: s.file_count?.[0]?.count || 0,
  }));

  return c.json({ sessions });
});
```

#### 5. Register routes in index.ts

**File**: `apps/server/src/index.ts`

```typescript
import { filesRouter } from './routes/files.js';

// ... existing code ...

app.route('/api/files', filesRouter);
```

### Success Criteria

#### Automated Verification:
- [ ] `pnpm typecheck` passes
- [ ] Server starts without errors: `pnpm --filter @agent-app/server dev`
- [ ] Health check passes: `curl http://localhost:8080/health`

#### Manual Verification:
- [ ] Agent writes a file → file appears in Supabase Storage bucket
- [ ] Agent writes a file → record created in agent_files table
- [ ] SSE stream includes file_event messages when files are written
- [ ] Files persist across container restarts

**Implementation Note**: After completing this phase, pause for manual verification before proceeding.

---

## Phase 2: Frontend Three-Column Layout

### Overview

Refactor the UI to a three-column resizable layout with File Explorer, Chat, and File Viewer.

### Changes Required

#### 1. Shared Types

**File**: `apps/web/src/types.ts`

Add file types:

```typescript
// Add to existing types

export interface AgentFile {
  id: string;
  sessionId: string;
  userId: string;
  filePath: string;
  storagePath: string;
  fileType: string;
  fileSize: number;
  contentHash: string;
  signedUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileEvent {
  type: 'file_event';
  subtype: 'created' | 'updated' | 'deleted';
  file: AgentFile;
}

export interface SessionWithFiles {
  id: string;
  user_id: string;
  name: string;
  sdk_session_id?: string;
  data_folder?: string;
  file_count: number;
  created_at: string;
  updated_at: string;
}
```

#### 2. API Client Updates

**File**: `apps/web/src/lib/api.ts`

Add file and session API calls:

```typescript
// Add to existing file

export async function getSessions(): Promise<SessionWithFiles[]> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/sessions', { headers });
  if (!res.ok) throw new Error('Failed to fetch sessions');
  const { sessions } = await res.json();
  return sessions;
}

export async function getSessionFiles(sessionId: string): Promise<AgentFile[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/files/sessions/${sessionId}/files`, { headers });
  if (!res.ok) throw new Error('Failed to fetch files');
  const { files } = await res.json();
  return files;
}

export async function getFileContent(signedUrl: string): Promise<string> {
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error('Failed to fetch file content');
  return res.text();
}

export async function restoreSession(sessionId: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/files/sessions/${sessionId}/restore`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) throw new Error('Failed to restore session');
}

export async function updateSession(
  sessionId: string,
  updates: { name?: string }
): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update session');
}
```

#### 3. File Context

**File**: `apps/web/src/contexts/FileContext.tsx`

```typescript
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { AgentFile } from '@/types';
import { getSessionFiles, getFileContent } from '@/lib/api';

interface OpenTab {
  file: AgentFile;
  content: string;
  isLoading: boolean;
}

interface FileContextType {
  // Current session files
  files: AgentFile[];
  setFiles: (files: AgentFile[]) => void;
  addOrUpdateFile: (file: AgentFile) => void;

  // Open tabs
  openTabs: OpenTab[];
  activeTabId: string | null;
  openFile: (file: AgentFile) => Promise<void>;
  closeTab: (fileId: string) => void;
  setActiveTab: (fileId: string) => void;

  // Loading state
  isLoadingFiles: boolean;
  loadSessionFiles: (sessionId: string) => Promise<void>;
}

const FileContext = createContext<FileContextType | undefined>(undefined);

export function FileProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  const addOrUpdateFile = useCallback((file: AgentFile) => {
    setFiles(prev => {
      const existing = prev.findIndex(f => f.id === file.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = file;
        return updated;
      }
      return [...prev, file];
    });

    // Update open tab if file is open
    setOpenTabs(prev =>
      prev.map(tab =>
        tab.file.id === file.id
          ? { ...tab, file, isLoading: true } // Will reload content
          : tab
      )
    );
  }, []);

  const loadSessionFiles = useCallback(async (sessionId: string) => {
    setIsLoadingFiles(true);
    try {
      const sessionFiles = await getSessionFiles(sessionId);
      setFiles(sessionFiles);
    } catch (error) {
      console.error('Failed to load files:', error);
    } finally {
      setIsLoadingFiles(false);
    }
  }, []);

  const openFile = useCallback(async (file: AgentFile) => {
    // Check if already open
    const existing = openTabs.find(t => t.file.id === file.id);
    if (existing) {
      setActiveTabId(file.id);
      return;
    }

    // Add tab with loading state
    setOpenTabs(prev => [...prev, { file, content: '', isLoading: true }]);
    setActiveTabId(file.id);

    // Fetch content
    try {
      if (file.signedUrl) {
        const content = await getFileContent(file.signedUrl);
        setOpenTabs(prev =>
          prev.map(t =>
            t.file.id === file.id ? { ...t, content, isLoading: false } : t
          )
        );
      }
    } catch (error) {
      console.error('Failed to load file content:', error);
      setOpenTabs(prev =>
        prev.map(t =>
          t.file.id === file.id
            ? { ...t, content: 'Error loading file', isLoading: false }
            : t
        )
      );
    }
  }, [openTabs]);

  const closeTab = useCallback((fileId: string) => {
    setOpenTabs(prev => prev.filter(t => t.file.id !== fileId));

    // If closing active tab, switch to another
    if (activeTabId === fileId) {
      setOpenTabs(prev => {
        const remaining = prev.filter(t => t.file.id !== fileId);
        setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].file.id : null);
        return prev;
      });
    }
  }, [activeTabId]);

  const setActiveTab = useCallback((fileId: string) => {
    setActiveTabId(fileId);
  }, []);

  return (
    <FileContext.Provider
      value={{
        files,
        setFiles,
        addOrUpdateFile,
        openTabs,
        activeTabId,
        openFile,
        closeTab,
        setActiveTab,
        isLoadingFiles,
        loadSessionFiles,
      }}
    >
      {children}
    </FileContext.Provider>
  );
}

export function useFiles() {
  const context = useContext(FileContext);
  if (!context) {
    throw new Error('useFiles must be used within a FileProvider');
  }
  return context;
}
```

#### 4. Session Context

**File**: `apps/web/src/contexts/SessionContext.tsx`

```typescript
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { SessionWithFiles } from '@/types';
import { getSessions, restoreSession } from '@/lib/api';

interface SessionContextType {
  sessions: SessionWithFiles[];
  currentSession: SessionWithFiles | null;
  isLoadingSessions: boolean;
  loadSessions: () => Promise<void>;
  selectSession: (session: SessionWithFiles) => Promise<void>;
  createNewSession: () => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionWithFiles[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionWithFiles | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const data = await getSessions();
      setSessions(data);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  const selectSession = useCallback(async (session: SessionWithFiles) => {
    // Restore files to container
    await restoreSession(session.id);
    setCurrentSession(session);
  }, []);

  const createNewSession = useCallback(() => {
    setCurrentSession(null);
  }, []);

  return (
    <SessionContext.Provider
      value={{
        sessions,
        currentSession,
        isLoadingSessions,
        loadSessions,
        selectSession,
        createNewSession,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSessions() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSessions must be used within a SessionProvider');
  }
  return context;
}
```

#### 5. File Explorer Component

**File**: `apps/web/src/components/FileExplorer.tsx`

```typescript
import { useEffect } from 'react';
import { useSessions } from '@/contexts/SessionContext';
import { useFiles } from '@/contexts/FileContext';
import type { AgentFile } from '@/types';

interface FileExplorerProps {
  onFileClick: (file: AgentFile) => void;
}

export function FileExplorer({ onFileClick }: FileExplorerProps) {
  const {
    sessions,
    currentSession,
    isLoadingSessions,
    loadSessions,
    selectSession,
    createNewSession,
  } = useSessions();

  const { files, isLoadingFiles, loadSessionFiles } = useFiles();

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Load files when session changes
  useEffect(() => {
    if (currentSession) {
      loadSessionFiles(currentSession.id);
    }
  }, [currentSession, loadSessionFiles]);

  return (
    <div className="h-full flex flex-col bg-card border-r border-border">
      {/* Header */}
      <div className="p-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Sessions</h2>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingSessions ? (
          <div className="p-3 text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="py-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => selectSession(session)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors ${
                  currentSession?.id === session.id ? 'bg-accent' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">📁</span>
                  <span className="truncate">{session.name || 'Untitled'}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {session.file_count} files
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* New Session Button */}
      <div className="p-3 border-t border-border">
        <button
          onClick={createNewSession}
          className="w-full text-sm text-primary hover:text-primary/80 flex items-center gap-2"
        >
          <span>+</span>
          <span>New Session</span>
        </button>
      </div>

      {/* Current Session Files */}
      {currentSession && (
        <>
          <div className="p-3 border-t border-border">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase">
              Files
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto max-h-48">
            {isLoadingFiles ? (
              <div className="p-3 text-sm text-muted-foreground">Loading...</div>
            ) : files.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">No files yet</div>
            ) : (
              <div className="py-1">
                {files.map((file) => (
                  <button
                    key={file.id}
                    onClick={() => onFileClick(file)}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors flex items-center gap-2"
                  >
                    <span className="text-muted-foreground">
                      {file.fileType === 'md' ? '📝' : '📄'}
                    </span>
                    <span className="truncate">{file.filePath}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

#### 6. File Viewer Tabs Component

**File**: `apps/web/src/components/FileViewerTabs.tsx`

```typescript
import { useFiles } from '@/contexts/FileContext';
import { MarkdownViewer } from './MarkdownViewer';

export function FileViewerTabs() {
  const { openTabs, activeTabId, closeTab, setActiveTab } = useFiles();

  if (openTabs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-background text-muted-foreground">
        <p>Click a file to view it here</p>
      </div>
    );
  }

  const activeTab = openTabs.find(t => t.file.id === activeTabId);

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Tab Bar */}
      <div className="flex border-b border-border overflow-x-auto">
        {openTabs.map((tab) => (
          <div
            key={tab.file.id}
            className={`flex items-center gap-2 px-3 py-2 border-r border-border cursor-pointer min-w-0 ${
              tab.file.id === activeTabId
                ? 'bg-card text-foreground'
                : 'text-muted-foreground hover:bg-accent'
            }`}
            onClick={() => setActiveTab(tab.file.id)}
          >
            <span className="truncate text-sm">{tab.file.filePath}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.file.id);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab?.isLoading ? (
          <div className="text-muted-foreground">Loading...</div>
        ) : activeTab ? (
          <MarkdownViewer content={activeTab.content} />
        ) : null}
      </div>
    </div>
  );
}
```

#### 7. Markdown Viewer Component

**File**: `apps/web/src/components/MarkdownViewer.tsx`

```typescript
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownViewerProps {
  content: string;
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

#### 8. Main Layout Component

**File**: `apps/web/src/components/Layout.tsx`

```typescript
import { useState, type ReactNode } from 'react';
import { FileExplorer } from './FileExplorer';
import { FileViewerTabs } from './FileViewerTabs';
import { useFiles } from '@/contexts/FileContext';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { openFile, openTabs } = useFiles();
  const [leftPanelWidth, setLeftPanelWidth] = useState(220);
  const [rightPanelWidth, setRightPanelWidth] = useState(400);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);

  // Open right panel when a file is opened
  const handleFileClick = async (file: any) => {
    await openFile(file);
    setIsRightPanelOpen(true);
  };

  // Close right panel when all tabs are closed
  const showRightPanel = isRightPanelOpen && openTabs.length > 0;

  return (
    <div className="flex h-screen">
      {/* Left Panel - File Explorer */}
      <div
        className="flex-shrink-0 h-full"
        style={{ width: leftPanelWidth }}
      >
        <FileExplorer onFileClick={handleFileClick} />
      </div>

      {/* Resizer */}
      <div
        className="w-1 bg-border cursor-col-resize hover:bg-primary transition-colors"
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startWidth = leftPanelWidth;

          const onMouseMove = (e: MouseEvent) => {
            const newWidth = startWidth + e.clientX - startX;
            setLeftPanelWidth(Math.max(150, Math.min(400, newWidth)));
          };

          const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
          };

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        }}
      />

      {/* Center Panel - Chat */}
      <div className="flex-1 min-w-0 h-full">
        {children}
      </div>

      {/* Resizer */}
      {showRightPanel && (
        <div
          className="w-1 bg-border cursor-col-resize hover:bg-primary transition-colors"
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = rightPanelWidth;

            const onMouseMove = (e: MouseEvent) => {
              const newWidth = startWidth - (e.clientX - startX);
              setRightPanelWidth(Math.max(250, Math.min(600, newWidth)));
            };

            const onMouseUp = () => {
              document.removeEventListener('mousemove', onMouseMove);
              document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
          }}
        />
      )}

      {/* Right Panel - File Viewer */}
      {showRightPanel && (
        <div
          className="flex-shrink-0 h-full border-l border-border"
          style={{ width: rightPanelWidth }}
        >
          <FileViewerTabs />
        </div>
      )}
    </div>
  );
}
```

#### 9. Update App.tsx

**File**: `apps/web/src/App.tsx`

```typescript
import { useAuth } from '@/contexts/AuthContext';
import { SessionProvider } from '@/contexts/SessionContext';
import { FileProvider } from '@/contexts/FileContext';
import { AuthPage } from '@/components/AuthPage';
import { ChatInterface } from '@/components/ChatInterface';
import { Layout } from '@/components/Layout';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <SessionProvider>
      <FileProvider>
        <Layout>
          <ChatInterface />
        </Layout>
      </FileProvider>
    </SessionProvider>
  );
}
```

#### 10. Update ChatInterface to handle file events

**File**: `apps/web/src/components/ChatInterface.tsx`

Add to the SSE message handler:

```typescript
// In the for await loop processing SSE messages:

// Handle file events
if ((message as any).type === 'file_event') {
  const fileEvent = message as FileEvent;
  addOrUpdateFile(fileEvent.file);
  continue;
}
```

### Success Criteria

#### Automated Verification:
- [ ] `pnpm typecheck` passes
- [ ] `pnpm --filter @agent-app/web dev` starts without errors

#### Manual Verification:
- [ ] Three-column layout displays correctly
- [ ] Sessions list shows in left panel
- [ ] Clicking session loads its files
- [ ] Clicking file opens it in right panel tab
- [ ] Multiple files can be open as tabs
- [ ] Tabs can be closed with X button
- [ ] Panels are resizable
- [ ] Right panel hidden when no tabs open
- [ ] File events from SSE update file list in real-time

**Implementation Note**: After completing this phase, pause for manual verification before proceeding.

---

## Phase 3: Session Workflow Integration

### Overview

Wire everything together so sessions persist correctly and can be resumed.

### Changes Required

#### 1. Update ChatInterface to use Session Context

Integrate with SessionContext so:
- New chats create new sessions
- Loading a session resumes the SDK session
- Session name can be edited

#### 2. Session name auto-generation

When a new session is created, generate a name from the first user message:
```typescript
const generateSessionName = (firstMessage: string): string => {
  // Take first 50 chars, truncate at word boundary
  const truncated = firstMessage.slice(0, 50);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
};
```

#### 3. Session update endpoint

**File**: `apps/server/src/routes/sessions.ts`

```typescript
sessionsRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');
  const { name } = await c.req.json();

  const { data, error } = await supabase
    .from('sessions')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error || !data) {
    return c.json({ error: 'Session not found' }, 404);
  }

  return c.json({ session: data });
});
```

### Success Criteria

#### Automated Verification:
- [ ] `pnpm typecheck` passes
- [ ] All API endpoints respond correctly

#### Manual Verification:
- [ ] Create new session → appears in session list
- [ ] Session gets named from first message
- [ ] Click old session → loads files and chat history
- [ ] Resume old session → agent remembers context
- [ ] Agent writes file in resumed session → file persists
- [ ] Session list updates when new session created

---

## Cloud Run Deployment Considerations

### File System

Cloud Run containers have an ephemeral filesystem:
- `/tmp` is writable but lost on container restart
- Use `/tmp/data/{sessionId}/` for session files
- Files MUST be persisted to Supabase Storage immediately
- Files MUST be restored from Storage when session is resumed

### Environment Variables

Required for Cloud Run:
```yaml
VITE_SUPABASE_URL: https://xxx.supabase.co
SUPABASE_SECRET_KEY: sb_secret_...
ANTHROPIC_API_KEY: sk-ant-...
```

### Container Configuration

```yaml
# cloudbuild.yaml additions
- --memory=2Gi          # Agent needs memory
- --timeout=300         # Long-running SSE streams
- --min-instances=1     # Avoid cold starts for SSE
- --cpu=2               # Agent is CPU intensive
```

### Dockerfile Updates

```dockerfile
# Ensure data directory exists
RUN mkdir -p /app/data

# Set working directory for agent
ENV AGENT_CWD=/app/agent
ENV DATA_DIR=/app/data
```

---

## Testing Strategy

### Unit Tests

- File service: upload, download, list operations
- Session service: create, update, restore
- Tool result parsing: Write/Edit detection

### Integration Tests

- Full flow: send message → agent writes file → file persisted → file event received
- Session resume: load session → files restored → agent can read them

### Manual Testing Steps

1. Start new session, send message that causes agent to write a file
2. Verify file appears in Storage bucket
3. Verify file appears in left panel
4. Click file to open in viewer
5. Refresh page - verify session and files reload
6. Click old session - verify files restore correctly
7. Continue conversation - verify new files also persist

---

## Performance Considerations

### File Downloads

- Use signed URLs (1 hour expiry) to avoid proxying through backend
- Frontend fetches file content directly from Supabase Storage
- Cache file content in memory while tab is open

### Session Loading

- List sessions with file counts in single query (use COUNT aggregate)
- Lazy-load file list only when session is selected
- Lazy-load file content only when tab is opened

### Real-time Updates

- File events via existing SSE stream (no extra connections)
- Session list refresh on focus (not polling)

---

## References

- Phase 1 spec: `thoughts/shared/specs/2025-12-19-agent-app-boilerplate.md`
- Claude Code Hooks: https://docs.anthropic.com/en/docs/claude-code/hooks
- Supabase Storage: https://supabase.com/docs/guides/storage
- Claude Agent SDK: https://github.com/anthropics/claude-agent-sdk-typescript
