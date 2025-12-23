# Multi-Agent Filesystem Configuration Implementation Plan

## Overview

Implement a configuration-driven multi-agent filesystem system that supports:
- Per-agent-type configuration (storage modes, file loading, security, startup)
- Admin-generated shared files accessible to all users (sport agent pattern)
- Container warm-up on login with shared file pre-loading
- Network/tool sandboxing via configuration

All storage uses Supabase. Agent configs are stored in a local JSON file (deployed with code).

## Current State Analysis

**Existing Implementation:**
- Files stored locally at `/data/{sessionName}/` then flushed to Supabase Storage (`agent-files` bucket)
- Sessions use SDK session ID as primary key in `sessions` table
- No configuration options - all sessions work identically
- No shared file loading mechanism
- No container warm-up on login
- No network/tool sandboxing

**Key Files:**
- `apps/server/src/services/files.ts` - File persistence (persistFile, flushSessionFolder, restoreSessionFiles)
- `apps/server/src/routes/agent.ts` - Agent query endpoint
- `packages/shared/src/types.ts` - Shared type definitions
- `supabase/migrations/20251220000002_agent_files.sql` - Current schema

## Desired End State

After implementation:

1. **Agent Configuration**: JSON-based config per agent type (`sports-nfl`, `coding`, etc.) defining storage mode, file loading patterns, allowed tools, and network restrictions

2. **Admin Dashboard**: Admins use the same UI but their generated files go to `shared/` storage path, accessible by all users of that agent type

3. **Shared File Loading**: When users start sessions, shared files are automatically copied to their session workspace based on agent config patterns

4. **Container Warm-up**: On login, frontend triggers warmup endpoint that pre-loads shared files into a session directory, reducing first-query latency

5. **Tool/Network Sandboxing**: Agent configs define allowed tools and network allowlists, enforced at query time

### Verification:
- Admin can run "predict all games" and files appear in shared storage
- User starting a session sees shared predictions in their workspace
- Login triggers warmup, first query has files ready
- Agents with restricted tools cannot use disallowed tools
- WebFetch calls respect network allowlist

## What We're NOT Doing

- Database-stored agent configs (using JSON file instead)
- CRUD endpoints for agent configs
- Git-style version control or branching
- GCS FUSE volume mounting (copy-on-start only)
- User-persistent storage mode (only session + shared)
- Ephemeral storage mode (all sessions persist)
- Per-session config overrides (agent-type config only)

## Implementation Approach

Six phases, each building on the previous:

1. **Agent Configuration System** - Types and JSON config file
2. **Admin Role & Shared Storage** - Database changes, admin detection, shared file paths
3. **Shared File Loading** - Copy shared files into session at start
4. **Container Warm-up** - Pre-load on login
5. **Tool/Network Sandboxing** - Enforce restrictions from config
6. **Testing & Validation** - Comprehensive test coverage

---

## Phase 1: Agent Configuration System

### Overview
Create the configuration type system and JSON config file that defines behavior per agent type.

### Changes Required:

#### 1. Create Agent Config Types
**File**: `packages/shared/src/agentConfig.ts` (new file)

```typescript
/**
 * Storage mode for agent sessions
 */
export type StorageMode =
  | 'session-persistent'  // Files persist for session duration, deleted on session end
  | 'shared-persistent';  // Files shared across users (admin-generated)

/**
 * Isolation level for workspaces
 */
export type IsolationLevel =
  | 'strict'   // Each session completely isolated
  | 'user'     // Sessions share user's files
  | 'shared';  // Sessions can access shared files

/**
 * How shared files are loaded into session workspace
 */
export type SharedFileLoadingMode =
  | 'none'           // No shared files
  | 'copy-on-start'; // Copy shared files at session start

/**
 * Network access restrictions
 */
export type NetworkMode =
  | 'full'       // Unrestricted network access
  | 'allowlist'  // Only allowed domains
  | 'none';      // No network access (WebFetch/WebSearch disabled)

/**
 * Startup strategy for containers
 */
export type StartupStrategy =
  | 'on-demand'         // Load files when session starts (default)
  | 'pre-warm-on-login'; // Pre-load shared files on user login

/**
 * File loading configuration
 */
export interface FileLoadingConfig {
  /** How to load shared files */
  sharedFiles: SharedFileLoadingMode;

  /** Patterns to include when loading shared files (glob patterns) */
  includePatterns?: string[];

  /** Patterns to exclude when loading shared files */
  excludePatterns?: string[];

  /** Maximum total size of shared files to load (bytes) */
  maxSharedBytes?: number;
}

/**
 * Security/sandboxing configuration
 */
export interface SecurityConfig {
  /** Network access mode */
  network: NetworkMode;

  /** Allowed domains for WebFetch/WebSearch (when network='allowlist') */
  networkAllowlist?: string[];

  /** Allowed tools (subset of available tools) */
  allowedTools?: string[];

  /** Explicitly blocked tools */
  deniedTools?: string[];
}

/**
 * Startup configuration
 */
export interface StartupConfig {
  /** Container startup strategy */
  strategy: StartupStrategy;

  /** How long to keep warmed session (seconds) */
  warmupTTL?: number;
}

/**
 * Complete agent configuration
 */
export interface AgentConfig {
  /** Unique identifier for this agent type */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of this agent type */
  description?: string;

  /** Storage mode */
  storageMode: StorageMode;

  /** Isolation level */
  isolation: IsolationLevel;

  /** File loading configuration */
  fileLoading: FileLoadingConfig;

  /** Security configuration */
  security: SecurityConfig;

  /** Startup configuration */
  startup: StartupConfig;

  /** Whether this agent can write to shared storage (admin only) */
  canWriteShared: boolean;
}

/**
 * All agent configurations
 */
export interface AgentConfigFile {
  version: string;
  agents: Record<string, AgentConfig>;
  defaultAgentId: string;
}
```

#### 2. Export from shared package
**File**: `packages/shared/src/index.ts`
**Changes**: Add export

```typescript
export * from './types';
export * from './agentConfig';
```

#### 3. Create Agent Config JSON
**File**: `apps/server/src/config/agents.json` (new file)

```json
{
  "version": "1.0.0",
  "defaultAgentId": "default",
  "agents": {
    "default": {
      "id": "default",
      "name": "Default Coding Agent",
      "description": "General-purpose coding assistant",
      "storageMode": "session-persistent",
      "isolation": "strict",
      "fileLoading": {
        "sharedFiles": "none"
      },
      "security": {
        "network": "full",
        "allowedTools": ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Task", "Skill", "TodoWrite"]
      },
      "startup": {
        "strategy": "on-demand"
      },
      "canWriteShared": false
    },
    "sports-nfl": {
      "id": "sports-nfl",
      "name": "NFL Sports Prediction Agent",
      "description": "NFL game predictions and analysis",
      "storageMode": "session-persistent",
      "isolation": "shared",
      "fileLoading": {
        "sharedFiles": "copy-on-start",
        "includePatterns": ["predictions/**", "reflections/**", "research/**"],
        "maxSharedBytes": 104857600
      },
      "security": { // HUMAN NOTE: make network full at first
        "network": "allowlist",
        "networkAllowlist": ["espn.com", "nfl.com", "pro-football-reference.com", "api.sportsdata.io"],
        "allowedTools": ["Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "Task", "TodoWrite"]
      },
      "startup": {
        "strategy": "pre-warm-on-login",
        "warmupTTL": 300
      },
      "canWriteShared": false
    },
    "sports-nfl-admin": {
      "id": "sports-nfl-admin",
      "name": "NFL Sports Admin Agent",
      "description": "Admin agent for generating NFL predictions",
      "storageMode": "shared-persistent",
      "isolation": "shared",
      "fileLoading": {
        "sharedFiles": "copy-on-start",
        "includePatterns": ["predictions/**", "reflections/**", "research/**"]
      },
      "security": {
        "network": "full",
        "allowedTools": ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Task", "Skill", "TodoWrite"]
      },
      "startup": {
        "strategy": "on-demand"
      },
      "canWriteShared": true
    }
  }
}
```

#### 4. Create Config Loader Service
**File**: `apps/server/src/services/agentConfig.ts` (new file)

```typescript
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { AgentConfig, AgentConfigFile } from '@agent-app/shared';

const CONFIG_PATH = resolve(__dirname, '../config/agents.json');

let configCache: AgentConfigFile | null = null;

/**
 * Load agent configurations from JSON file
 */
export function loadAgentConfigs(): AgentConfigFile {
  if (configCache) {
    return configCache;
  }

  const content = readFileSync(CONFIG_PATH, 'utf-8');
  configCache = JSON.parse(content) as AgentConfigFile;
  return configCache;
}

/**
 * Get configuration for a specific agent type
 */
export function getAgentConfig(agentId: string): AgentConfig {
  const configs = loadAgentConfigs();
  const config = configs.agents[agentId];

  if (!config) {
    console.warn(`[AGENT_CONFIG] Unknown agent ID: ${agentId}, using default`);
    return configs.agents[configs.defaultAgentId];
  }

  return config;
}

/**
 * Get the default agent configuration
 */
export function getDefaultAgentConfig(): AgentConfig {
  const configs = loadAgentConfigs();
  return configs.agents[configs.defaultAgentId];
}

/**
 * List all available agent IDs
 */
export function listAgentIds(): string[] {
  const configs = loadAgentConfigs();
  return Object.keys(configs.agents);
}

/**
 * Clear config cache (for testing or hot reload)
 */
export function clearConfigCache(): void {
  configCache = null;
}
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles without errors: `cd packages/shared && npm run build`
- [x] Server compiles without errors: `cd apps/server && npm run build`
- [x] Config loads correctly: Add simple test that loads and validates config
- [x] All agent configs have required fields

#### Manual Verification:
- [x] Review config types match research document specifications
- [x] Verify sports-nfl config matches sport agent use case requirements

**Implementation Note**: After completing this phase, pause for confirmation before proceeding.

---

## Phase 2: Admin Role & Shared File Storage

### Overview
Add admin role detection and modify file storage to support shared files.

### Changes Required:

#### 1. Database Migration for Admin Role
**File**: `supabase/migrations/20251222000001_admin_role.sql` (new file)

```sql
-- Add is_admin column to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Create index for admin queries
CREATE INDEX IF NOT EXISTS idx_profiles_is_admin ON public.profiles(is_admin) WHERE is_admin = true;

-- Add agent_id column to sessions table if not exists
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS agent_id TEXT DEFAULT 'default';

-- Create index for agent queries
CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON public.sessions(agent_id);
```

#### 2. Add Admin Check to Auth Types
**File**: `apps/server/src/middleware/auth.ts`
**Changes**: Update AuthUser interface

```typescript
export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
}
```

**Changes**: Update middleware to fetch admin status

```typescript
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing authorization header' }, 401);
  }

  const token = authHeader.split(' ')[1];

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  // Fetch admin status from profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  c.set('user', {
    id: user.id,
    email: user.email ?? '',
    isAdmin: profile?.is_admin ?? false
  });
  c.set('accessToken', token);

  await next();
};
```

#### 3. Update Shared Types for Admin
**File**: `packages/shared/src/types.ts`
**Changes**: Add isAdmin to relevant types

```typescript
export interface ChatSession {
  id: string;
  user_id: string;
  agent_id: string;
  title?: string;
  created_at: string;
  updated_at: string;
}

// Add new type for session creation with agent config
export interface CreateSessionRequest {
  sessionName: string;
  agentId: string;
}
```

#### 4. Modify File Persistence for Shared Storage
**File**: `apps/server/src/services/files.ts`
**Changes**: Add shared file support

```typescript
// Add new constant for shared storage prefix
const SHARED_PREFIX = 'shared';

/**
 * Get storage path based on whether writing to shared or user storage
 */
function getStoragePath(
  userId: string,
  agentId: string,
  sessionName: string,
  relativePath: string,
  isShared: boolean
): string {
  if (isShared) {
    // Shared files: shared/{agentId}/{relativePath}
    return path.join(SHARED_PREFIX, agentId, relativePath).replace(/\\/g, '/');
  }
  // User files: {userId}/{sessionName}/{relativePath}
  return path.join(userId, sessionName, relativePath).replace(/\\/g, '/');
}

/**
 * Persist a file to cloud storage (user or shared)
 */
export async function persistFile(
  userId: string,
  sessionId: string,
  sessionName: string,
  agentId: string,
  localFilePath: string,
  isShared: boolean = false
): Promise<FileInfo | null> {
  try {
    const content = await readFile(localFilePath);
    const contentHash = createHash('md5').update(content).digest('hex');

    const sessionDir = getSessionDir(sessionName);
    const relativePath = path.relative(sessionDir, localFilePath);

    if (relativePath.startsWith('..')) {
      console.log('[FILES] Skipping file outside session dir:', localFilePath);
      return null;
    }

    const storagePath = getStoragePath(userId, agentId, sessionName, relativePath, isShared);
    const fileType = path.extname(localFilePath).slice(1) || 'txt';

    console.log(`[FILES] Persisting file to ${isShared ? 'shared' : 'user'} storage:`, storagePath);

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, content, {
        contentType: getContentType(fileType),
        upsert: true,
      });

    if (uploadError) {
      console.error('[FILES] Upload error:', uploadError);
      return null;
    }

    // Insert/update database record
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
        is_shared: isShared,
        agent_id: agentId,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'session_id,file_path',
      })
      .select()
      .single();

    if (dbError) {
      console.error('[FILES] Database error:', dbError);
      return null;
    }

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
    };
  } catch (error) {
    console.error('[FILES] Error persisting file:', error);
    return null;
  }
}

/**
 * Flush session folder with shared storage support
 */
export async function flushSessionFolder(
  userId: string,
  sessionId: string,
  sessionName: string,
  agentId: string,
  isShared: boolean = false
): Promise<FileInfo[]> {
  const sessionDir = getSessionDir(sessionName);

  if (!existsSync(sessionDir)) {
    console.log('[FILES] Session directory does not exist:', sessionDir);
    return [];
  }

  const files = await glob('**/*', {
    cwd: sessionDir,
    nodir: true,
    dot: false,
    absolute: true,
  });

  console.log(`[FILES] Flushing ${files.length} files from ${sessionDir} (shared: ${isShared})`);

  const persistedFiles: FileInfo[] = [];

  for (const localFilePath of files) {
    const content = await readFile(localFilePath);
    const currentHash = createHash('md5').update(content).digest('hex');

    const relativePath = path.relative(sessionDir, localFilePath);
    const existingHash = await getExistingFileHash(sessionId, relativePath);

    if (existingHash === currentHash) {
      console.log('[FILES] Skipping unchanged file:', relativePath);
      continue;
    }

    const fileInfo = await persistFile(
      userId,
      sessionId,
      sessionName,
      agentId,
      localFilePath,
      isShared
    );

    if (fileInfo) {
      persistedFiles.push(fileInfo);
    }
  }

  return persistedFiles;
}
```

#### 5. Database Migration for Shared Files
**File**: `supabase/migrations/20251222000002_shared_files.sql` (new file)

```sql
-- Add is_shared and agent_id columns to agent_files
ALTER TABLE public.agent_files
ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS agent_id TEXT DEFAULT 'default';

-- Create index for shared file queries
CREATE INDEX IF NOT EXISTS idx_agent_files_shared ON public.agent_files(agent_id, is_shared)
WHERE is_shared = true;

-- RLS policy for shared files (anyone can read)
DROP POLICY IF EXISTS "Anyone can read shared files" ON public.agent_files;
CREATE POLICY "Anyone can read shared files" ON public.agent_files
  FOR SELECT USING (is_shared = true);

-- Update existing policy to still allow users to manage their own files
DROP POLICY IF EXISTS "Users can manage own files" ON public.agent_files;
CREATE POLICY "Users can manage own files" ON public.agent_files
  FOR ALL USING (auth.uid() = user_id);
```

### Success Criteria:

#### Automated Verification:
- [x] Migrations apply cleanly: `npx supabase db push`
- [x] TypeScript compiles: `npm run build` in both packages/shared and apps/server
- [x] Auth middleware returns isAdmin field

#### Manual Verification:
- [x] Set a user as admin in database, verify middleware returns `isAdmin: true`
- [x] Verify shared file storage path format: `shared/{agentId}/{relativePath}`
- [x] Verify RLS allows reading shared files but only owner can modify

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 3: Shared File Loading into Sessions

### Overview
Implement loading shared files into user session workspaces at session start.

### Changes Required:

#### 1. Create Shared File Loading Service
**File**: `apps/server/src/services/sharedFiles.ts` (new file)

```typescript
import { supabase } from '../lib/supabase';
import { ensureSessionDir } from './files';
import { getAgentConfig } from './agentConfig';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';

const BUCKET_NAME = 'agent-files';
const SHARED_PREFIX = 'shared';

interface SharedFile {
  name: string;
  id: string;
  metadata: {
    size: number;
    mimetype: string;
  };
}

/**
 * List all shared files for an agent type
 */
export async function listSharedFiles(agentId: string): Promise<SharedFile[]> {
  const sharedPath = `${SHARED_PREFIX}/${agentId}`;

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .list(sharedPath, {
      limit: 1000,
      sortBy: { column: 'name', order: 'asc' },
    });

  if (error) {
    console.error('[SHARED_FILES] Error listing shared files:', error);
    return [];
  }

  return data || [];
}

/**
 * Recursively list all files in a storage path
 */
async function listAllFilesRecursively(
  basePath: string,
  currentPath: string = ''
): Promise<string[]> {
  const fullPath = currentPath ? `${basePath}/${currentPath}` : basePath;

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .list(fullPath, { limit: 1000 });

  if (error || !data) {
    return [];
  }

  const files: string[] = [];

  for (const item of data) {
    const itemPath = currentPath ? `${currentPath}/${item.name}` : item.name;

    // Check if it's a folder (no metadata.size means it's a folder placeholder)
    if (item.id === null) {
      // It's a folder, recurse
      const subFiles = await listAllFilesRecursively(basePath, itemPath);
      files.push(...subFiles);
    } else {
      // It's a file
      files.push(itemPath);
    }
  }

  return files;
}

/**
 * Check if a file path matches any of the include patterns
 */
function matchesPatterns(filePath: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) {
    return true; // No patterns means include all
  }

  return patterns.some(pattern => minimatch(filePath, pattern));
}

/**
 * Load shared files into a session workspace
 */
export async function loadSharedFilesIntoSession(
  sessionName: string,
  agentId: string
): Promise<{ loaded: number; skipped: number; errors: number }> {
  const config = getAgentConfig(agentId);

  if (config.fileLoading.sharedFiles === 'none') {
    console.log('[SHARED_FILES] Shared file loading disabled for agent:', agentId);
    return { loaded: 0, skipped: 0, errors: 0 };
  }

  const sessionDir = await ensureSessionDir(sessionName);
  const sharedDir = path.join(sessionDir, 'shared');

  // Create shared directory
  if (!existsSync(sharedDir)) {
    await mkdir(sharedDir, { recursive: true });
  }

  const sharedStoragePath = `${SHARED_PREFIX}/${agentId}`;
  const allFiles = await listAllFilesRecursively(sharedStoragePath);

  console.log(`[SHARED_FILES] Found ${allFiles.length} shared files for agent ${agentId}`);

  const includePatterns = config.fileLoading.includePatterns || [];
  const excludePatterns = config.fileLoading.excludePatterns || [];
  const maxBytes = config.fileLoading.maxSharedBytes || 100 * 1024 * 1024; // 100MB default

  let loaded = 0;
  let skipped = 0;
  let errors = 0;
  let totalBytes = 0;

  for (const relativePath of allFiles) {
    // Check include patterns
    if (includePatterns.length > 0 && !matchesPatterns(relativePath, includePatterns)) {
      skipped++;
      continue;
    }

    // Check exclude patterns
    if (excludePatterns.length > 0 && matchesPatterns(relativePath, excludePatterns)) {
      skipped++;
      continue;
    }

    // Download file from storage
    const storagePath = `${sharedStoragePath}/${relativePath}`;
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(storagePath);

    if (error || !data) {
      console.error('[SHARED_FILES] Error downloading file:', storagePath, error);
      errors++;
      continue;
    }

    // Check size limit
    const fileSize = data.size;
    if (totalBytes + fileSize > maxBytes) {
      console.warn('[SHARED_FILES] Size limit reached, stopping file loading');
      break;
    }

    // Write to local filesystem
    const localPath = path.join(sharedDir, relativePath);
    const localDir = path.dirname(localPath);

    if (!existsSync(localDir)) {
      await mkdir(localDir, { recursive: true });
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    await writeFile(localPath, buffer);

    totalBytes += fileSize;
    loaded++;
    console.log('[SHARED_FILES] Loaded:', relativePath);
  }

  console.log(`[SHARED_FILES] Loading complete: ${loaded} loaded, ${skipped} skipped, ${errors} errors`);
  return { loaded, skipped, errors };
}

/**
 * Get total size of shared files for an agent
 */
export async function getSharedFilesSize(agentId: string): Promise<number> {
  const { data, error } = await supabase
    .from('agent_files')
    .select('file_size')
    .eq('agent_id', agentId)
    .eq('is_shared', true);

  if (error || !data) {
    return 0;
  }

  return data.reduce((sum, file) => sum + (file.file_size || 0), 0);
}
```

#### 2. Add minimatch dependency
**File**: `apps/server/package.json`
**Changes**: Add minimatch for glob pattern matching

```json
{
  "dependencies": {
    "minimatch": "^9.0.3"
  },
  "devDependencies": {
    "@types/minimatch": "^5.1.2"
  }
}
```

#### 3. Modify Agent Query to Load Shared Files
**File**: `apps/server/src/routes/agent.ts`
**Changes**: Add shared file loading at session start

```typescript
import { loadSharedFilesIntoSession } from '../services/sharedFiles';
import { getAgentConfig } from '../services/agentConfig';

// Update request schema to include agentId
const querySchema = z.object({
  content: z.string().min(1),
  sessionName: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/),
  sdkSessionId: z.string().uuid().optional(),
  agentId: z.string().optional().default('default'),
});

// Inside the query handler, after ensureSessionDir:
app.post('/query', async (c) => {
  // ... existing validation code ...

  const { content, sessionName, sdkSessionId: existingSessionId, agentId } = body;
  const config = getAgentConfig(agentId);
  const user = c.get('user');

  // Create session directory
  const sessionDir = path.join(DATA_DIR, sessionName);
  await ensureSessionDir(sessionName);

  // Load shared files if this is a new session and config requires it
  if (!existingSessionId && config.fileLoading.sharedFiles === 'copy-on-start') {
    console.log(`[AGENT] Loading shared files for agent ${agentId}`);
    const loadResult = await loadSharedFilesIntoSession(sessionName, agentId);
    console.log(`[AGENT] Shared files loaded:`, loadResult);
  }

  // ... rest of query handling ...

  // When flushing files, pass isShared based on config
  const isShared = config.canWriteShared && user.isAdmin;
  const persistedFiles = await flushSessionFolder(
    user.id,
    sdkSessionId,
    sessionName,
    agentId,
    isShared
  );

  // ... rest of handler ...
});
```

#### 4. Update Session Creation to Include Agent ID
**File**: `apps/server/src/routes/agent.ts`
**Changes**: Store agent_id in session record

```typescript
// Update session upsert to include agent_id
const { error: sessionError } = await supabase
  .from('sessions')
  .upsert({
    id: sdkSessionId,
    user_id: user.id,
    sdk_session_id: sdkSessionId,
    session_name: sessionName,
    agent_id: agentId,  // Add this
    title: content.slice(0, 100),
    updated_at: new Date().toISOString(),
  }, {
    onConflict: 'id',
  });
```

### Success Criteria:

#### Automated Verification:
- [x] npm install completes (minimatch added)
- [x] TypeScript compiles: `cd apps/server && npm run build`
- [x] Server starts without errors: `npm run dev`

#### Manual Verification:
- [ ] Create shared files manually in Supabase Storage under `shared/sports-nfl/predictions/`
- [ ] Start a session with `agentId: 'sports-nfl'`
- [ ] Verify files appear in session's `/shared/` directory
- [ ] Verify include/exclude patterns work correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 4: Container Warm-up on Login

### Overview
Add endpoint to pre-load shared files on user login for faster first query.

### Changes Required:

#### 1. Create Warmup Cache
**File**: `apps/server/src/services/warmupCache.ts` (new file)

```typescript
interface WarmupEntry {
  sessionName: string;
  agentId: string;
  sessionDir: string;
  timestamp: number;
  filesLoaded: number;
}

// In-memory cache for warmed sessions
const warmupCache = new Map<string, WarmupEntry>();

// Default TTL: 5 minutes
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Generate a cache key for a user + agent combination
 */
function getCacheKey(userId: string, agentId: string): string {
  return `${userId}:${agentId}`;
}

/**
 * Store a warmed session in cache
 */
export function setWarmedSession(
  userId: string,
  agentId: string,
  entry: Omit<WarmupEntry, 'timestamp'>
): void {
  const key = getCacheKey(userId, agentId);
  warmupCache.set(key, {
    ...entry,
    timestamp: Date.now(),
  });
  console.log(`[WARMUP] Cached session for ${key}:`, entry.sessionName);
}

/**
 * Get and consume a warmed session (removes from cache)
 */
export function consumeWarmedSession(
  userId: string,
  agentId: string,
  ttlMs: number = DEFAULT_TTL_MS
): WarmupEntry | null {
  const key = getCacheKey(userId, agentId);
  const entry = warmupCache.get(key);

  if (!entry) {
    return null;
  }

  // Check if expired
  if (Date.now() - entry.timestamp > ttlMs) {
    warmupCache.delete(key);
    console.log(`[WARMUP] Expired session for ${key}`);
    return null;
  }

  // Consume (remove from cache)
  warmupCache.delete(key);
  console.log(`[WARMUP] Consumed warmed session for ${key}:`, entry.sessionName);
  return entry;
}

/**
 * Check if a warmed session exists (without consuming)
 */
export function hasWarmedSession(
  userId: string,
  agentId: string,
  ttlMs: number = DEFAULT_TTL_MS
): boolean {
  const key = getCacheKey(userId, agentId);
  const entry = warmupCache.get(key);

  if (!entry) {
    return false;
  }

  if (Date.now() - entry.timestamp > ttlMs) {
    warmupCache.delete(key);
    return false;
  }

  return true;
}

/**
 * Clear all cached entries (for testing)
 */
export function clearWarmupCache(): void {
  warmupCache.clear();
}

/**
 * Get cache stats (for monitoring)
 */
export function getWarmupCacheStats(): { size: number; entries: string[] } {
  return {
    size: warmupCache.size,
    entries: Array.from(warmupCache.keys()),
  };
}
```

#### 2. Add Warmup Endpoint
**File**: `apps/server/src/routes/agent.ts`
**Changes**: Add warmup endpoint

```typescript
import { setWarmedSession, consumeWarmedSession } from '../services/warmupCache';
import { loadSharedFilesIntoSession } from '../services/sharedFiles';
import { getAgentConfig } from '../services/agentConfig';
import { randomUUID } from 'crypto';

// Warmup request schema
const warmupSchema = z.object({
  agentId: z.string().optional().default('default'),
});

/**
 * POST /warmup - Pre-warm container with shared files
 * Called by frontend on login
 */
app.post('/warmup', async (c) => {
  const user = c.get('user');

  const body = await c.req.json().catch(() => ({}));
  const parseResult = warmupSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json({ error: 'Invalid request', details: parseResult.error }, 400);
  }

  const { agentId } = parseResult.data;
  const config = getAgentConfig(agentId);

  // Check if warmup is enabled for this agent
  if (config.startup.strategy !== 'pre-warm-on-login') {
    return c.json({
      status: 'skipped',
      reason: 'Warmup not enabled for this agent'
    });
  }

  // Generate a temporary session name for warmup
  const sessionName = `warmup-${user.id.slice(0, 8)}-${Date.now()}`;

  try {
    // Create session directory and load shared files
    const sessionDir = await ensureSessionDir(sessionName);
    const loadResult = await loadSharedFilesIntoSession(sessionName, agentId);

    // Cache the warmed session
    setWarmedSession(user.id, agentId, {
      sessionName,
      agentId,
      sessionDir,
      filesLoaded: loadResult.loaded,
    });

    return c.json({
      status: 'warmed',
      sessionName,
      filesLoaded: loadResult.loaded,
      ttl: config.startup.warmupTTL || 300,
    });
  } catch (error) {
    console.error('[WARMUP] Error warming up:', error);
    return c.json({ error: 'Warmup failed' }, 500);
  }
});
```

#### 3. Modify Query to Use Warmed Session
**File**: `apps/server/src/routes/agent.ts`
**Changes**: Check for warmed session before loading files

```typescript
app.post('/query', async (c) => {
  // ... existing validation ...

  const { content, sessionName: requestedSessionName, sdkSessionId: existingSessionId, agentId } = body;
  const config = getAgentConfig(agentId);
  const user = c.get('user');

  let sessionName = requestedSessionName;
  let sessionDir: string;
  let sharedFilesAlreadyLoaded = false;

  // Check for warmed session (only for new sessions)
  if (!existingSessionId) {
    const warmedSession = consumeWarmedSession(
      user.id,
      agentId,
      (config.startup.warmupTTL || 300) * 1000
    );

    if (warmedSession) {
      // Use the warmed session
      console.log(`[AGENT] Using warmed session: ${warmedSession.sessionName}`);
      sessionName = warmedSession.sessionName;
      sessionDir = warmedSession.sessionDir;
      sharedFilesAlreadyLoaded = true;
    } else {
      // Create new session directory
      sessionDir = path.join(DATA_DIR, sessionName);
      await ensureSessionDir(sessionName);
    }
  } else {
    // Resuming existing session
    sessionDir = path.join(DATA_DIR, sessionName);
    await ensureSessionDir(sessionName);
  }

  // Load shared files if needed
  if (!existingSessionId && !sharedFilesAlreadyLoaded && config.fileLoading.sharedFiles === 'copy-on-start') {
    console.log(`[AGENT] Loading shared files for agent ${agentId}`);
    await loadSharedFilesIntoSession(sessionName, agentId);
  }

  // ... rest of query handling ...
});
```

#### 4. Add Warmup Call to Frontend
**File**: `apps/web/src/lib/api.ts`
**Changes**: Add warmup function

```typescript
/**
 * Pre-warm container with shared files
 * Call after successful login
 */
export async function warmupAgent(agentId: string = 'default'): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/api/agent/warmup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getAccessToken()}`,
      },
      body: JSON.stringify({ agentId }),
    });

    if (!response.ok) {
      console.warn('[WARMUP] Warmup failed:', response.status);
      return;
    }

    const result = await response.json();
    console.log('[WARMUP] Result:', result);
  } catch (error) {
    // Ignore errors - warmup is best-effort
    console.warn('[WARMUP] Error:', error);
  }
}
```

#### 5. Call Warmup on Login
**File**: `apps/web/src/contexts/AuthContext.tsx` (or similar auth handler)
**Changes**: Call warmup after successful login

```typescript
import { warmupAgent } from '@/lib/api';

// After successful login:
async function onLoginSuccess() {
  // Fire and forget - don't block login flow
  warmupAgent('sports-nfl').catch(() => {});

  // Continue with normal login flow
  router.push('/dashboard');
}
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run build` in apps/server and apps/web
- [x] Server starts without errors
- [x] `/api/agent/warmup` endpoint responds

#### Manual Verification:
- [x] Call warmup endpoint, verify session created with shared files
- [x] Start query with same user/agent, verify warmed session is consumed
- [ ] Verify cache expires after TTL
- [x] Verify warmup is skipped for agents without pre-warm strategy

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 5: Network/Tool Sandboxing

### Overview
Enforce tool restrictions and network allowlists from agent configuration.

### Changes Required:

#### 1. Create Tool Sandboxing Service
**File**: `apps/server/src/services/toolSandbox.ts` (new file)

```typescript
import type { AgentConfig } from '@agent-app/shared';

// All available tools in the system
const ALL_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'WebSearch', 'WebFetch', 'Task', 'Skill', 'TodoWrite',
];

// Network-related tools
const NETWORK_TOOLS = ['WebSearch', 'WebFetch'];

/**
 * Get the list of allowed tools based on agent configuration
 */
export function getAllowedTools(config: AgentConfig): string[] {
  let tools: string[];

  // Start with explicitly allowed tools, or all tools
  if (config.security.allowedTools && config.security.allowedTools.length > 0) {
    tools = [...config.security.allowedTools];
  } else {
    tools = [...ALL_TOOLS];
  }

  // Remove denied tools
  if (config.security.deniedTools && config.security.deniedTools.length > 0) {
    tools = tools.filter(tool => !config.security.deniedTools!.includes(tool));
  }

  // Remove network tools if network is disabled
  if (config.security.network === 'none') {
    tools = tools.filter(tool => !NETWORK_TOOLS.includes(tool));
  }

  return tools;
}

/**
 * Check if a URL is allowed by the network allowlist
 */
export function isUrlAllowed(url: string, config: AgentConfig): boolean {
  if (config.security.network === 'full') {
    return true;
  }

  if (config.security.network === 'none') {
    return false;
  }

  // network === 'allowlist'
  const allowlist = config.security.networkAllowlist || [];

  if (allowlist.length === 0) {
    // Empty allowlist means block everything in allowlist mode
    return false;
  }

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Check if hostname matches any allowed domain
    return allowlist.some(allowed => {
      const allowedLower = allowed.toLowerCase();
      // Exact match or subdomain match
      return hostname === allowedLower || hostname.endsWith('.' + allowedLower);
    });
  } catch {
    // Invalid URL
    return false;
  }
}

/**
 * Generate system prompt additions for sandboxing
 */
export function getSandboxSystemPrompt(config: AgentConfig): string {
  const parts: string[] = [];

  // Network restrictions
  if (config.security.network === 'none') {
    parts.push('IMPORTANT: Network access is disabled. Do not attempt to use WebFetch or WebSearch tools.');
  } else if (config.security.network === 'allowlist' && config.security.networkAllowlist) {
    parts.push(`IMPORTANT: Network access is restricted to these domains only: ${config.security.networkAllowlist.join(', ')}`);
    parts.push('Do not attempt to access any other domains.');
  }

  // Tool restrictions
  if (config.security.deniedTools && config.security.deniedTools.length > 0) {
    parts.push(`IMPORTANT: The following tools are disabled: ${config.security.deniedTools.join(', ')}`);
  }

  return parts.join('\n');
}
```

#### 2. Apply Tool Restrictions in Agent Query
**File**: `apps/server/src/routes/agent.ts`
**Changes**: Use config-based tool restrictions

```typescript
import { getAllowedTools, getSandboxSystemPrompt } from '../services/toolSandbox';

app.post('/query', async (c) => {
  // ... existing code ...

  const config = getAgentConfig(agentId);

  // Get allowed tools from config
  const allowedTools = getAllowedTools(config);
  console.log(`[AGENT] Allowed tools for ${agentId}:`, allowedTools);

  // Add sandbox system prompt
  const sandboxPrompt = getSandboxSystemPrompt(config);
  const enhancedPrompt = sandboxPrompt
    ? `${sandboxPrompt}\n\n---\n\n${promptWithContext}`
    : promptWithContext;

  // Query agent with config-based tools
  const messages = query(enhancedPrompt, {
    cwd: sessionDir,
    maxTurns: 100,
    allowedTools,
    ...(existingSessionId && { resume: existingSessionId }),
  });

  // ... rest of handler ...
});
```

#### 3. Add URL Validation Hook (Optional Enhancement)
**File**: `apps/server/src/services/urlValidator.ts` (new file)

```typescript
import { getAgentConfig } from './agentConfig';
import { isUrlAllowed } from './toolSandbox';

/**
 * Validate a URL against agent config before allowing WebFetch
 * This can be used as a pre-check hook if the SDK supports it
 */
export function validateUrl(url: string, agentId: string): { allowed: boolean; reason?: string } {
  const config = getAgentConfig(agentId);

  if (isUrlAllowed(url, config)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `URL not allowed by network policy: ${url}`,
  };
}
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `cd apps/server && npm run build`
- [ ] Unit tests for `getAllowedTools()` function (skipped per user request - Phase 6)
- [ ] Unit tests for `isUrlAllowed()` function (skipped per user request - Phase 6)

#### Manual Verification:
- [x] Query with `sports-nfl` agent, verify only allowed tools are available (WebSearch/WebFetch removed)
- [x] Verify `default` agent has full tool access (WebSearch/WebFetch available)
- [x] Verify sandbox system prompt is added for restricted agents (agent acknowledges network disabled)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 6: Testing & Validation

### Overview
Comprehensive testing to ensure all features work correctly together.

### Changes Required:

#### 1. Unit Tests for Agent Config
**File**: `apps/server/src/services/__tests__/agentConfig.test.ts` (new file)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { getAgentConfig, getDefaultAgentConfig, listAgentIds, clearConfigCache } from '../agentConfig';

describe('agentConfig', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('loads default agent config', () => {
    const config = getDefaultAgentConfig();
    expect(config.id).toBe('default');
    expect(config.storageMode).toBe('session-persistent');
  });

  it('loads sports-nfl config', () => {
    const config = getAgentConfig('sports-nfl');
    expect(config.id).toBe('sports-nfl');
    expect(config.fileLoading.sharedFiles).toBe('copy-on-start');
    expect(config.startup.strategy).toBe('pre-warm-on-login');
  });

  it('falls back to default for unknown agent', () => {
    const config = getAgentConfig('unknown-agent');
    expect(config.id).toBe('default');
  });

  it('lists all agent IDs', () => {
    const ids = listAgentIds();
    expect(ids).toContain('default');
    expect(ids).toContain('sports-nfl');
    expect(ids).toContain('sports-nfl-admin');
  });
});
```

#### 2. Unit Tests for Tool Sandbox
**File**: `apps/server/src/services/__tests__/toolSandbox.test.ts` (new file)

```typescript
import { describe, it, expect } from 'vitest';
import { getAllowedTools, isUrlAllowed } from '../toolSandbox';
import type { AgentConfig } from '@agent-app/shared';

describe('toolSandbox', () => {
  describe('getAllowedTools', () => {
    it('returns all tools when no restrictions', () => {
      const config: AgentConfig = {
        id: 'test',
        name: 'Test',
        storageMode: 'session-persistent',
        isolation: 'strict',
        fileLoading: { sharedFiles: 'none' },
        security: { network: 'full' },
        startup: { strategy: 'on-demand' },
        canWriteShared: false,
      };

      const tools = getAllowedTools(config);
      expect(tools).toContain('Bash');
      expect(tools).toContain('WebFetch');
    });

    it('removes network tools when network is disabled', () => {
      const config: AgentConfig = {
        id: 'test',
        name: 'Test',
        storageMode: 'session-persistent',
        isolation: 'strict',
        fileLoading: { sharedFiles: 'none' },
        security: { network: 'none' },
        startup: { strategy: 'on-demand' },
        canWriteShared: false,
      };

      const tools = getAllowedTools(config);
      expect(tools).not.toContain('WebFetch');
      expect(tools).not.toContain('WebSearch');
    });

    it('applies denied tools', () => {
      const config: AgentConfig = {
        id: 'test',
        name: 'Test',
        storageMode: 'session-persistent',
        isolation: 'strict',
        fileLoading: { sharedFiles: 'none' },
        security: { network: 'full', deniedTools: ['Bash'] },
        startup: { strategy: 'on-demand' },
        canWriteShared: false,
      };

      const tools = getAllowedTools(config);
      expect(tools).not.toContain('Bash');
      expect(tools).toContain('WebFetch');
    });
  });

  describe('isUrlAllowed', () => {
    it('allows all URLs in full mode', () => {
      const config: AgentConfig = {
        id: 'test',
        name: 'Test',
        storageMode: 'session-persistent',
        isolation: 'strict',
        fileLoading: { sharedFiles: 'none' },
        security: { network: 'full' },
        startup: { strategy: 'on-demand' },
        canWriteShared: false,
      };

      expect(isUrlAllowed('https://example.com', config)).toBe(true);
      expect(isUrlAllowed('https://evil.com', config)).toBe(true);
    });

    it('blocks all URLs in none mode', () => {
      const config: AgentConfig = {
        id: 'test',
        name: 'Test',
        storageMode: 'session-persistent',
        isolation: 'strict',
        fileLoading: { sharedFiles: 'none' },
        security: { network: 'none' },
        startup: { strategy: 'on-demand' },
        canWriteShared: false,
      };

      expect(isUrlAllowed('https://example.com', config)).toBe(false);
    });

    it('respects allowlist', () => {
      const config: AgentConfig = {
        id: 'test',
        name: 'Test',
        storageMode: 'session-persistent',
        isolation: 'strict',
        fileLoading: { sharedFiles: 'none' },
        security: {
          network: 'allowlist',
          networkAllowlist: ['espn.com', 'nfl.com'],
        },
        startup: { strategy: 'on-demand' },
        canWriteShared: false,
      };

      expect(isUrlAllowed('https://espn.com/nfl', config)).toBe(true);
      expect(isUrlAllowed('https://www.espn.com/nfl', config)).toBe(true);
      expect(isUrlAllowed('https://nfl.com', config)).toBe(true);
      expect(isUrlAllowed('https://evil.com', config)).toBe(false);
    });
  });
});
```

#### 3. Integration Test for Shared Files
**File**: `apps/server/src/services/__tests__/sharedFiles.integration.test.ts` (new file)

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadSharedFilesIntoSession } from '../sharedFiles';
import { existsSync, rmSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';

// This test requires Supabase to be running with test data
describe.skip('sharedFiles integration', () => {
  const testSessionName = 'test-shared-files-' + Date.now();
  const testAgentId = 'sports-nfl';

  afterAll(() => {
    // Cleanup test session directory
    const sessionDir = path.join(process.cwd(), 'data', testSessionName);
    if (existsSync(sessionDir)) {
      rmSync(sessionDir, { recursive: true });
    }
  });

  it('loads shared files into session', async () => {
    const result = await loadSharedFilesIntoSession(testSessionName, testAgentId);

    expect(result.loaded).toBeGreaterThan(0);
    expect(result.errors).toBe(0);
  });

  it('creates shared directory in session', async () => {
    const sharedDir = path.join(process.cwd(), 'data', testSessionName, 'shared');
    expect(existsSync(sharedDir)).toBe(true);
  });
});
```

#### 4. E2E Test Script
**File**: `apps/server/scripts/test-sport-agent-flow.ts` (new file)

```typescript
/**
 * End-to-end test for sport agent flow:
 * 1. Admin creates predictions
 * 2. User queries with shared predictions available
 */

import { config } from '../src/config';

const API_URL = `http://localhost:${config.server.port}/api`;

async function main() {
  console.log('=== Sport Agent E2E Test ===\n');

  // Step 1: Get admin token (requires admin user in database)
  console.log('1. Authenticating as admin...');
  // TODO: Implement admin auth

  // Step 2: Admin runs prediction generation
  console.log('2. Admin generating predictions...');
  // TODO: Implement admin query with sports-nfl-admin agent

  // Step 3: Verify shared files created
  console.log('3. Verifying shared files...');
  // TODO: Check Supabase storage for shared files

  // Step 4: Get regular user token
  console.log('4. Authenticating as regular user...');
  // TODO: Implement user auth

  // Step 5: User queries with shared context
  console.log('5. User querying with shared context...');
  // TODO: Implement user query, verify shared files accessible

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
```

#### 5. Add Test Scripts to package.json
**File**: `apps/server/package.json`
**Changes**: Add test scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "tsx scripts/test-sport-agent-flow.ts"
  }
}
```

### Success Criteria:

#### Automated Verification:
- [ ] All unit tests pass: `cd apps/server && npm run test`
- [ ] Test coverage > 80% for new services
- [ ] TypeScript compiles with no errors

#### Manual Verification:
- [ ] Complete sport agent E2E flow works:
  1. Admin logs in
  2. Admin runs "predict all NFL games" with sports-nfl-admin agent
  3. Predictions appear in shared storage
  4. User logs in (triggers warmup)
  5. User starts session with sports-nfl agent
  6. Shared predictions are available in user's session
  7. User asks "what's your confidence on the Bills game?"
  8. Agent responds using shared prediction data

**Implementation Note**: After completing this phase and all verification passes, the implementation is complete.

---

## Testing Strategy

### Unit Tests
- Agent config loading and validation
- Tool sandbox logic (allowed tools, URL validation)
- Warmup cache operations
- Shared file pattern matching

### Integration Tests
- Shared file loading from Supabase Storage
- Session creation with shared files
- Warmup endpoint with file pre-loading

### E2E Tests
- Complete admin → user flow for sport agent
- Warmup on login → first query latency
- Tool restrictions enforcement

### Manual Testing Steps
1. Create admin user in database (`UPDATE profiles SET is_admin = true WHERE email = '...'`)
2. Log in as admin, select sports-nfl-admin agent
3. Ask agent to create prediction files
4. Verify files appear in `shared/sports-nfl/` in Supabase Storage
5. Log in as regular user
6. Verify warmup endpoint called on login
7. Start new session with sports-nfl agent
8. Verify `/workspace/shared/` directory contains predictions
9. Query agent about predictions, verify it has context

---

## Migration Notes

### Database Migrations
Run in order:
1. `20251222000001_admin_role.sql` - Adds admin flag to profiles
2. `20251222000002_shared_files.sql` - Adds shared file support to agent_files

### Deployment Checklist
1. Deploy database migrations
2. Deploy updated server code with agents.json
3. Create/configure admin users in database
4. Seed initial shared files if needed
5. Deploy frontend with warmup call

### Rollback Plan
1. Revert to previous server deployment
2. Run down migrations (if needed)
3. Shared files remain in storage (no data loss)

---

## References

- Research document: `thoughts/shared/research/2025-12-21-multi-agent-filesystem-configuration.md`
- Current implementation: `apps/server/src/services/files.ts`, `apps/server/src/routes/agent.ts`
- Database schema: `supabase/migrations/20251220000002_agent_files.sql`
