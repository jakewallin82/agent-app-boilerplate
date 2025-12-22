---
date: 2025-12-21T10:30:00-08:00
researcher: Claude
git_commit: 21f128327245180944b9d2bea0266daac92e23fb
branch: main
repository: agent-app-boilerplate
topic: "Multi-Agent File System Configuration Patterns for Coding Agent Boilerplates"
tags: [research, codebase, multi-agent, filesystem, containers, sandboxing, security, cloud-run, storage]
status: complete
last_updated: 2025-12-21
last_updated_by: Claude
---

# Research: Multi-Agent File System Configuration Patterns for Coding Agent Boilerplates

**Date**: 2025-12-21T10:30:00-08:00
**Researcher**: Claude
**Git Commit**: 21f128327245180944b9d2bea0266daac92e23fb
**Branch**: main
**Repository**: agent-app-boilerplate

## Research Question

We need to make a detailed plan of the various mechanisms for controlling multi-agent file systems and input context. With 20+ users executing coding agent conversations in separate containers (sandboxes), we need configurable options for:
- Ephemeral vs permanent storage
- Private vs shared file systems
- Context injection patterns (previous agent output as possible context)
- Security/isolation tradeoffs
- Simplicity vs flexibility tradeoffs

## Summary

This research reveals a mature but fragmented landscape of multi-agent sandbox patterns. Key findings:

1. **Three Main Isolation Levels**: OS-level sandboxing (Claude Code/Cursor), container sandboxing (Modal/gVisor), and micro-VM isolation (E2B/Firecracker). Each offers different security/performance tradeoffs.

2. **Current Implementation**: The boilerplate uses ephemeral local storage (`/app/data/{sessionName}/`) during execution, then flushes to Supabase Storage. This is a hybrid approach suitable for Cloud Run's stateless architecture.

3. **Configuration Dimensions**: Industry patterns suggest 4 key configuration axes:
   - **Persistence**: Ephemeral → Session-persistent → User-persistent → Shared
   - **Isolation**: Private → Session-scoped → User-scoped → Tenant-scoped → Shared
   - **File Loading**: None → Copy on session start → Volume mount (read-only) → Layered (shared + private)
   - **Startup Strategy**: On-demand → Pre-warm on login → Min instances → Baked image

4. **Security Considerations**: Cloud Run provides two-layer sandboxing (gVisor + VM isolation), but container-to-container isolation within instances is weaker than instance-to-instance isolation. For truly hostile multi-tenant workloads, separate Cloud Run services per tenant are recommended.

5. **Recommended Configuration Options**: A configuration schema with ~20 options covering storage mode, file loading, startup strategy, security level, and resource limits would provide the flexibility needed for various use cases.

6. **Recommended Default Startup Strategy**: Use `pre-warm-on-login` with fallback to `on-demand` for cost efficiency, or `min-instances: 1` for simplicity when cost is not a concern. For daily batch data (like sports predictions), use `baked-image` with scheduled builds.

---

## Detailed Findings

### 1. Industry Sandbox Patterns

#### 1.1 Major Platform Approaches

| Platform | Isolation Type | Startup | Persistence | Max Session | Best For |
|----------|---------------|---------|-------------|-------------|----------|
| **Claude Code** | OS primitives (bubblewrap/seatbelt) | Instant | Persistent (local FS) | N/A | Local development |
| **OpenAI Code Interpreter** | Docker containers | Seconds | Session (1 hour) | 1 hour | Cloud-hosted agents |
| **E2B** | Firecracker micro-VMs | <200ms | Hybrid (pause/resume) | 24 hours | Untrusted code |
| **Modal** | gVisor containers | <1 second | Hybrid (volumes) | 24 hours | Scalable workloads |
| **Fly.io** | Firecracker VMs | ~300ms | Ephemeral (+ volumes) | Unlimited | Edge deployment |
| **Replit** | omegajail/containers | 100ms | Session-persistent | Auto-timeout | Collaborative |

#### 1.2 Key Architectural Insights

**Ephemeral-First Design (OpenAI Pattern)**:
- Container created on first interaction
- State persists for session duration (up to 1 hour)
- Automatic cleanup on inactivity (20 min timeout)
- Files recoverable via `file_ids` for new sessions

**Hybrid Persistence (E2B/Modal Pattern)**:
- Default: Ephemeral (sandbox destroyed on close)
- Optional: Pause/resume for state persistence
- Explicit volumes for cross-session data
- Template snapshots for instant workspace provisioning

**Git-Based State (Claude Code/Cursor Pattern)**:
- Direct filesystem access (no container overhead)
- Version control as safety mechanism
- `.cursorignore` / `CLAUDE.md` for access control
- Immediate write-through to disk

### 2. Current Implementation Analysis

The boilerplate currently implements a **hybrid ephemeral-to-cloud** pattern:

```
Agent Query → Session Directory Created → Agent Executes → Files Flushed to Supabase → Container Terminates
    ↓                    ↓                      ↓                    ↓
/app/data/{sessionName}  CLAUDE.md context     Read/Write/Edit      Storage bucket + DB record
```

**Current File Flow** (from `apps/server/src/routes/agent.ts` and `apps/server/src/services/files.ts`):

1. **Session Directory**: `/app/data/{sessionName}/` (ephemeral, container-local)
2. **Agent SDK CWD**: Set to session directory, isolating agent operations
3. **Batch Flush**: After query completes, all files uploaded to `agent-files` bucket
4. **Change Detection**: MD5 hashing avoids redundant uploads
5. **Restoration**: `restoreSessionFiles()` downloads from Supabase for session resume

**Strengths**:
- Works well with Cloud Run's stateless architecture
- Supabase provides durable storage with RLS security
- Session isolation prevents cross-user file access

**Limitations**:
- No configuration options for different storage modes
- All files always persisted (no ephemeral-only option)
- No shared workspace support
- No context injection from previous sessions

### 3. Proposed Configuration Schema

Based on industry patterns, recommend the following configuration dimensions:

#### 3.1 Storage Mode Configuration

```typescript
interface StorageConfig {
  /**
   * Primary storage mode for agent workspaces
   */
  mode:
    | 'ephemeral'           // Files deleted after session (no persistence)
    | 'session-persistent'  // Files persist for session duration only
    | 'user-persistent'     // Files persist across sessions for user
    | 'shared-persistent';  // Files shared across users (with access control)

  /**
   * Where to store persistent files
   */
  backend:
    | 'supabase-storage'    // Current default
    | 'gcs'                 // Google Cloud Storage direct
    | 'local-volume'        // Persistent volume (requires volume mount)
    | 's3';                 // AWS S3 compatible

  /**
   * Time-to-live for session files (session-persistent mode)
   */
  sessionTTL?: number;      // Seconds, default 3600 (1 hour)

  /**
   * Quota limits
   */
  quotas: {
    maxFileSizeBytes: number;     // Default 10MB
    maxSessionStorageBytes: number; // Default 100MB
    maxFilesPerSession: number;    // Default 1000
  };
}
```

**Use Cases**:
- **`ephemeral`**: One-off calculations, sensitive data processing, cost optimization
- **`session-persistent`**: Multi-turn coding sessions with cleanup after
- **`user-persistent`**: User's personal workspace, accumulating files over time
- **`shared-persistent`**: Team workspaces, shared code repositories

#### 3.2 Workspace Isolation Configuration

```typescript
interface IsolationConfig {
  /**
   * Isolation level determines file visibility
   */
  level:
    | 'strict'       // Each session has completely isolated workspace
    | 'user'         // Sessions share user's workspace
    | 'tenant'       // Sessions share tenant/organization workspace
    | 'shared';      // Single shared workspace (multi-user)

  /**
   * Base workspace initialization
   */
  baseWorkspace:
    | 'empty'             // Start with empty directory
    | 'template'          // Clone from template (templateId required)
    | 'git-clone'         // Clone from git repository
    | 'previous-session'  // Copy from specific session
    | 'user-workspace';   // Use user's persistent workspace

  /**
   * Template or source configuration
   */
  templateId?: string;
  gitUrl?: string;
  gitBranch?: string;
  previousSessionId?: string;

  /**
   * Cleanup behavior on session end
   */
  cleanupPolicy:
    | 'delete-all'      // Remove all files
    | 'delete-generated'  // Keep base template, delete generated
    | 'preserve'        // Keep all files
    | 'archive';        // Move to archive storage
}
```

**Use Cases**:
- **`strict` + `empty`**: Maximum isolation, clean slate each time
- **`strict` + `template`**: Consistent starting point with isolation
- **`user` + `preserve`**: Personal development environment
- **`tenant` + `git-clone`**: Team working on same repository

#### 3.3 File Loading Configuration

```typescript
interface FileLoadingConfig {
  /**
   * How to load shared/previous files into the container workspace
   */
  sharedFiles:
    | 'none'              // No shared files loaded
    | 'copy-on-start'     // Copy files from cloud storage at session start
    | 'volume-mount'      // Mount cloud storage as read-only volume (GCS FUSE)
    | 'layered';          // Shared (read-only) + private (read-write) layers

  /**
   * Source for shared files
   */
  sharedSource?:
    | 'admin-generated'   // Files created by admin sessions
    | 'template'          // Pre-defined template files
    | 'previous-session'; // Files from a specific previous session

  /**
   * Patterns to include when loading shared files
   */
  includePatterns?: string[];  // e.g., ["predictions/**", "reflections/**"]

  /**
   * Patterns to exclude when loading shared files
   */
  excludePatterns?: string[];  // e.g., ["*.tmp", ".env"]

  /**
   * Maximum total size of shared files to load
   */
  maxSharedBytes?: number;    // Default 100MB
}
```

**Use Cases**:
- **`none`**: Fresh start, no shared files
- **`copy-on-start`**: Download shared files to workspace before agent runs
- **`volume-mount`**: GCS FUSE mount for large datasets (read-only)
- **`layered`**: Shared base files + user's private workspace overlay

#### 3.4 Security Configuration

```typescript
interface SecurityConfig {
  /**
   * Sandbox enforcement level
   */
  sandboxLevel:
    | 'standard'      // Default Cloud Run gVisor sandbox
    | 'enhanced'      // Additional seccomp/AppArmor profiles
    | 'strict';       // Restricted tool access, no network

  /**
   * Network access configuration
   */
  network:
    | 'full'          // Unrestricted network access
    | 'allowlist'     // Only allowed domains
    | 'denylist'      // Block specific domains
    | 'none';         // No network access

  networkAllowlist?: string[];
  networkDenylist?: string[];

  /**
   * Tool restrictions
   */
  allowedTools?: string[];   // Subset of available tools
  deniedTools?: string[];    // Explicitly blocked tools

  /**
   * File system restrictions
   */
  readOnlyPaths?: string[];  // Paths agent can read but not write
  deniedPaths?: string[];    // Paths agent cannot access

  /**
   * Resource limits
   */
  limits: {
    maxCpuSeconds: number;    // CPU time limit
    maxMemoryMB: number;      // Memory limit
    maxDiskMB: number;        // Disk space limit
    maxProcesses: number;     // Process count limit
    maxOpenFiles: number;     // File descriptor limit
  };
}
```

#### 3.5 Container Startup Strategy Configuration

For latency-sensitive applications, container startup strategy is a critical configuration choice. This determines how quickly users can begin interacting with the agent after requesting a session.

```typescript
interface StartupStrategyConfig {
  /**
   * Strategy for minimizing container cold-start latency
   */
  strategy:
    | 'on-demand'           // Default: load files when session starts
    | 'min-instances'       // Keep warm instances ready (Cloud Run)
    | 'pre-warm-on-login'   // Start loading when user authenticates
    | 'baked-image';        // Shared files built into Docker image

  /**
   * Min instances configuration (for 'min-instances' strategy)
   */
  minInstances?: number;    // Default 0, set 1-3 for low latency

  /**
   * Pre-warm configuration (for 'pre-warm-on-login' strategy)
   */
  warmupTTL?: number;       // How long to keep warmed session (seconds)
  warmupFallback?: boolean; // Fall back to on-demand if warmup not ready

  /**
   * Baked image configuration (for 'baked-image' strategy)
   */
  buildSchedule?: string;   // Cron expression for image rebuilds
  dataFreshness?: 'daily' | 'hourly' | 'realtime';
}
```

**Strategy Options:**

**Option A: Min Instances (Always-Warm)**

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloud Run Service                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ Instance 1  │  │ Instance 2  │  │ Instance 3  │          │
│  │ (idle/warm) │  │ (idle/warm) │  │ (idle/warm) │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│        ▲                                                     │
│        │ Request arrives → instantly routed to warm instance │
└─────────────────────────────────────────────────────────────┘
```

```bash
gcloud run deploy agent-server --min-instances 3
```

| Metric | Rating | Notes |
|--------|--------|-------|
| Simplicity | ★★★★★ | One flag to set |
| Robustness | ★★★★★ | Cloud Run handles everything |
| Latency | ★★★★ | ~200ms (warm, still loads files from Supabase) |
| Cost | ★★ | ~$50-150/month for 3 idle instances |

**Option B: Pre-warm on Login (Recommended Default)**

```
User Login                         First Query
    │                                   │
    ▼                                   ▼
┌────────────┐    ┌─────────────┐   ┌─────────────┐
│ Auth       │───▶│ Background  │   │ Container   │
│ succeeds   │    │ warmup call │   │ already has │
│            │    │             │   │ files ready │
└────────────┘    └─────────────┘   └─────────────┘
```

```typescript
// Frontend: after successful login
async function onLoginSuccess(user: User) {
  // Fire and forget - pre-warm the container
  fetch('/api/agent/warmup', {
    method: 'POST',
    body: JSON.stringify({ userId: user.id }),
  }).catch(() => {}); // Ignore errors, fallback to on-demand

  router.push('/dashboard');
}

// Backend: warmup endpoint
app.post('/api/agent/warmup', async (c) => {
  const { userId } = await c.req.json();
  const sessionDir = `/app/data/warmup-${userId}`;

  await loadSharedFiles(sessionDir);
  warmupCache.set(userId, { sessionDir, timestamp: Date.now() });

  return c.json({ status: 'warmed' });
});

// Backend: when creating actual session
app.post('/api/sessions', async (c) => {
  const { userId } = await c.req.json();

  // Check for pre-warmed session
  const warmed = warmupCache.get(userId);
  if (warmed && Date.now() - warmed.timestamp < 5 * 60 * 1000) {
    // Use pre-warmed session (instant!)
    warmupCache.delete(userId);
    return useWarmedSession(warmed.sessionDir, userId);
  }

  // Fallback: load on-demand
  return createSessionOnDemand(userId);
});
```

| Metric | Rating | Notes |
|--------|--------|-------|
| Simplicity | ★★★★ | ~50 lines of code |
| Robustness | ★★★★ | Fallback ensures it always works |
| Latency | ★★★★★ | Near-zero if warmup beats user |
| Cost | ★★★★★ | Only warm when users are active |

**Option C: Baked-in Docker Image**

```
Daily Build Pipeline
        │
        ▼
┌─────────────────────────────────────────────────┐
│ FROM node:20-slim                                │
│ ...                                              │
│ # Fetch and bake shared data into image         │
│ COPY --from=data-fetcher /shared /app/shared    │
└─────────────────────────────────────────────────┘
        │
        ▼
   Container starts with files already present
   (ZERO load time)
```

```dockerfile
# Multi-stage build that fetches shared data
FROM node:20-slim AS data-fetcher
RUN npm install @supabase/supabase-js
COPY fetch-shared.js .
ARG SUPABASE_URL
ARG SUPABASE_KEY
RUN node fetch-shared.js  # Downloads to /shared

FROM node:20-slim AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=data-fetcher /shared ./shared  # Baked in!
CMD ["node", "dist/index.js"]
```

```yaml
# Cloud Build trigger - runs daily
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/agent-server',
           '--build-arg', 'SUPABASE_URL=$_SUPABASE_URL', '.']
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    args: ['run', 'deploy', 'agent-server',
           '--image', 'gcr.io/$PROJECT_ID/agent-server']
```

| Metric | Rating | Notes |
|--------|--------|-------|
| Simplicity | ★★★★ | Standard Docker pattern |
| Robustness | ★★★★★ | No runtime dependencies |
| Latency | ★★★★★ | Zero file loading |
| Cost | ★★★★ | Larger image, daily builds |

**Best for:** Daily batch data (predictions, reports, templates)

**Comparison Matrix:**

| Strategy | Simplicity | Robustness | Latency | Cost | Best For |
|----------|------------|------------|---------|------|----------|
| on-demand | ★★★★★ | ★★★★★ | ★★ | ★★★★★ | MVP, low traffic |
| **min-instances** | ★★★★★ | ★★★★★ | ★★★★ | ★★ | **Production default** |
| **pre-warm-on-login** | ★★★★ | ★★★★ | ★★★★★ | ★★★★★ | **Cost-conscious default** |
| baked-image | ★★★★ | ★★★★★ | ★★★★★ | ★★★★ | Daily batch data |

**Recommended Default:** Use `pre-warm-on-login` with fallback to `on-demand` for cost efficiency, or `min-instances: 1` for simplicity when cost is not a concern.

### 4. Configuration Presets

Define common configurations as presets:

```typescript
const PRESETS = {
  /**
   * Isolated one-off execution
   * Use case: Running untrusted code, sensitive calculations
   */
  ephemeral: {
    storage: { mode: 'ephemeral', backend: 'supabase-storage' },
    isolation: { level: 'strict', baseWorkspace: 'empty', cleanupPolicy: 'delete-all' },
    fileLoading: { sharedFiles: 'none' },
    startup: { strategy: 'on-demand' },
    security: { sandboxLevel: 'strict', network: 'none' }
  },

  /**
   * Standard coding session (Recommended Default)
   * Use case: Multi-turn coding with session persistence
   */
  session: {
    storage: { mode: 'session-persistent', backend: 'supabase-storage', sessionTTL: 3600 },
    isolation: { level: 'strict', baseWorkspace: 'empty', cleanupPolicy: 'preserve' },
    fileLoading: { sharedFiles: 'none' },
    startup: { strategy: 'pre-warm-on-login', warmupFallback: true },  // Recommended
    security: { sandboxLevel: 'standard', network: 'full' }
  },

  /**
   * Personal development workspace
   * Use case: Long-running user workspace
   */
  workspace: {
    storage: { mode: 'user-persistent', backend: 'supabase-storage' },
    isolation: { level: 'user', baseWorkspace: 'user-workspace', cleanupPolicy: 'preserve' },
    fileLoading: { sharedFiles: 'copy-on-start', sharedSource: 'previous-session' },
    startup: { strategy: 'pre-warm-on-login', warmupFallback: true },
    security: { sandboxLevel: 'standard', network: 'full' }
  },

  /**
   * Shared content with private queries (Sports Agent pattern)
   * Use case: Admin-generated predictions readable by all users
   */
  'shared-readonly': {
    storage: { mode: 'session-persistent', backend: 'supabase-storage' },
    isolation: { level: 'user', baseWorkspace: 'empty', cleanupPolicy: 'preserve' },
    fileLoading: {
      sharedFiles: 'layered',
      sharedSource: 'admin-generated',
      includePatterns: ['predictions/**', 'reflections/**', 'research/**']
    },
    startup: { strategy: 'baked-image', buildSchedule: '0 6 * * *', dataFreshness: 'daily' },
    security: { sandboxLevel: 'standard', network: 'full' }
  },

  /**
   * Production with guaranteed low latency
   * Use case: Customer-facing apps where latency matters
   */
  'low-latency': {
    storage: { mode: 'session-persistent', backend: 'supabase-storage', sessionTTL: 3600 },
    isolation: { level: 'strict', baseWorkspace: 'empty', cleanupPolicy: 'preserve' },
    fileLoading: { sharedFiles: 'none' },
    startup: { strategy: 'min-instances', minInstances: 2 },
    security: { sandboxLevel: 'standard', network: 'full' }
  },

  /**
   * Team collaboration
   * Use case: Shared team repository
   */
  team: {
    storage: { mode: 'shared-persistent', backend: 'supabase-storage' },
    isolation: { level: 'tenant', baseWorkspace: 'git-clone', cleanupPolicy: 'preserve' },
    fileLoading: { sharedFiles: 'copy-on-start', sharedSource: 'template' },
    startup: { strategy: 'min-instances', minInstances: 1 },
    security: { sandboxLevel: 'standard', network: 'allowlist' }
  }
};
```

### 5. Use Case: Sports Prediction Agent (Admin + User Pattern)

This use case demonstrates the `shared-readonly` preset pattern with a sports prediction agent.

#### 5.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ADMIN SESSIONS (Daily Scheduled)                  │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │ Admin Agent runs daily:                                     │     │
│  │ - "Predict all NFL games for week 15"                       │     │
│  │ - "Reflect on all NBA games from yesterday"                 │     │
│  │                                                              │     │
│  │ Output written to: shared/                                   │     │
│  │ ├── nfl/predictions/week_15/*.md                            │     │
│  │ ├── nfl/reflections/week_15/*.md                            │     │
│  │ ├── nba/predictions/2025-12-21/*.md                         │     │
│  │ └── research/injury-reports/*.md                            │     │
│  └────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓ READ-ONLY (copied to container)
┌─────────────────────────────────────────────────────────────────────┐
│                    USER SESSIONS (On-demand)                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ User A Container  │  │ User B Container  │  │ User C Container  │  │
│  │ /workspace/       │  │ /workspace/       │  │ /workspace/       │  │
│  │ ├── shared/ (RO)  │  │ ├── shared/ (RO)  │  │ ├── shared/ (RO)  │  │
│  │ │   └── nfl/...   │  │ │   └── nfl/...   │  │ │   └── nfl/...   │  │
│  │ └── user/ (RW)    │  │ └── user/ (RW)    │  │ └── user/ (RW)    │  │
│  │     └── queries/  │  │     └── my-bets/  │  │     └── analysis/ │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
│                                                                      │
│  User queries:                                                       │
│  - "What's your confidence on the Bills game?"                      │
│  - "Analyze player props for Lakers vs Warriors"                    │
│  - "Compare your prediction to Vegas consensus"                     │
│                                                                      │
│  Agent can READ shared predictions, WRITE only to user/ directory   │
└─────────────────────────────────────────────────────────────────────┘
```

#### 5.2 File Storage Structure

```
Supabase Storage: agent-files/
├── shared/                              # Admin-generated, all users can read
│   ├── nfl/
│   │   ├── predictions/
│   │   │   ├── week_15/
│   │   │   │   ├── BUF_vs_NYJ_week15.md
│   │   │   │   ├── KC_vs_LAC_week15.md
│   │   │   │   └── SUMMARY.md
│   │   │   └── week_14/...
│   │   ├── reflections/
│   │   │   └── week_14/*.md
│   │   └── research/
│   │       ├── injury-reports/*.md
│   │       └── depth-charts/*.md
│   ├── nba/
│   │   ├── predictions/2025-12-21/*.md
│   │   └── reflections/2025-12-20/*.md
│   └── ...
│
├── {userId}/                            # User-private files
│   └── sessions/{sessionId}/
│       └── user/
│           ├── my-analysis.md
│           └── bet-tracker.md
```

#### 5.3 Implementation Options

**Option A: Supabase RLS + Copy-on-Start (Simplest)**

```sql
-- RLS policy: Anyone authenticated can read shared files
CREATE POLICY "Anyone can read shared files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'agent-files'
  AND name LIKE 'shared/%'
  AND auth.role() = 'authenticated'
);

-- RLS policy: Users can only write to their own directory
CREATE POLICY "Users write own files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'agent-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
```

```typescript
// At session start, copy shared files to container
async function setupSportsAgentWorkspace(sessionId: string, userId: string, sport: string) {
  const sessionDir = `/app/data/${sessionId}`;

  // Create workspace structure
  await mkdir(path.join(sessionDir, 'shared', sport), { recursive: true });
  await mkdir(path.join(sessionDir, 'user'), { recursive: true });

  // Copy recent shared predictions/reflections (last 7 days)
  const sharedFiles = await supabase.storage
    .from('agent-files')
    .list(`shared/${sport}`, { limit: 500 });

  for (const file of sharedFiles) {
    const { data } = await supabase.storage
      .from('agent-files')
      .download(`shared/${sport}/${file.name}`);

    await writeFile(
      path.join(sessionDir, 'shared', sport, file.name),
      Buffer.from(await data.arrayBuffer())
    );
  }

  return sessionDir;
}
```

**Tradeoffs:**

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Simplicity** | ★★★★★ | Minimal changes to existing code |
| **Performance** | ★★★ | Copy overhead on each session start |
| **Cost** | ★★★★ | Bandwidth for copies, storage for shared |
| **Implementation** | ~2-4 hours | RLS policy + workspace setup |

**Option B: GCS FUSE Volume Mount (For Scale)**

```yaml
# Cloud Run service configuration
volumes:
  - name: shared-predictions
    csi:
      driver: gcsfuse.run.googleapis.com
      volumeAttributes:
        bucketName: sports-predictions-shared
        mountOptions: "ro,implicit-dirs"

volumeMounts:
  - name: shared-predictions
    mountPath: /workspace/shared
    readOnly: true
```

```typescript
// Workspace is pre-mounted, just set up user directory
async function setupSportsAgentWorkspace(sessionId: string, userId: string) {
  const sessionDir = `/app/data/${sessionId}`;

  // Shared is already mounted at /workspace/shared (read-only)
  // Just create user directory
  await mkdir(path.join(sessionDir, 'user'), { recursive: true });

  // Symlink to mounted shared directory
  await symlink('/workspace/shared', path.join(sessionDir, 'shared'));

  return sessionDir;
}
```

**Tradeoffs:**

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Simplicity** | ★★★ | Requires GCS bucket, Cloud Run Gen 2 |
| **Performance** | ★★ | GCS FUSE has latency for small files |
| **Cost** | ★★★★★ | No copy overhead, pay for reads |
| **Implementation** | ~4-6 hours | GCS setup, IAM, Cloud Run config |

**Option C: Layered with Metadata Tracking (Most Flexible)**

```typescript
// Database table to track shared vs private files
interface FileMetadata {
  id: string;
  storage_path: string;
  is_shared: boolean;        // true = admin-generated, readable by all
  sport: string;             // nfl, nba, nhl, mlb, ncaab
  content_type: string;      // prediction, reflection, research
  date_key: string;          // week_15 or 2025-12-21
  created_by: string;        // 'admin' or user_id
  created_at: Date;
}

// Query to get relevant shared files
const sharedFiles = await supabase
  .from('file_metadata')
  .select('storage_path')
  .eq('is_shared', true)
  .eq('sport', 'nfl')
  .in('content_type', ['prediction', 'reflection'])
  .gte('created_at', subDays(new Date(), 7));
```

**Tradeoffs:**

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Simplicity** | ★★★ | New table, more query logic |
| **Performance** | ★★★★ | Efficient queries, selective copying |
| **Cost** | ★★★★ | Only copy what's needed |
| **Implementation** | ~4-6 hours | New table, metadata tracking |

#### 5.4 Admin Job Scheduling

```typescript
// Cloud Scheduler or Cloud Run Job for daily predictions
async function dailyAdminJob() {
  const today = new Date().toISOString().split('T')[0];
  const sports = ['nfl', 'nba', 'nhl'];

  for (const sport of sports) {
    // Create admin session
    const { data: session } = await supabase
      .from('sessions')
      .insert({
        user_id: ADMIN_USER_ID,
        is_admin_session: true,
        agent_id: `sports-${sport}`
      })
      .select()
      .single();

    // Run predictions
    await queryAgent(session.id, `Predict all ${sport.toUpperCase()} games for today`);

    // Run reflections for yesterday
    await queryAgent(session.id, `Reflect on all ${sport.toUpperCase()} games from yesterday`);
  }
}
```

#### 5.5 Recommended Approach: Start Simple (Option A), Evolve to C

**Phase 1 (MVP):**
- Add `is_admin_session` column to sessions table
- Add RLS policy for shared files
- Copy shared files at session start
- Implementation: ~2-4 hours

**Phase 2 (Scale):**
- Add file metadata table for better querying
- Selective file loading based on sport/date
- Add admin scheduling via Cloud Scheduler
- Implementation: +4-6 hours

**Phase 3 (Performance):**
- Migrate to GCS FUSE for large shared datasets
- Or use pre-built Docker images with shared content
- Implementation: +4-8 hours

### 6. Implementation Recommendations

#### 6.1 Cloud Run Architecture Options

**Option A: Single Service, Multiple Configurations** (Recommended for v1)
- One Cloud Run service handles all configurations
- Configuration passed as request parameter
- Storage mode determined at runtime
- Simplest to implement and maintain

```
Cloud Run Service
├── Configuration Parser
├── Workspace Manager
│   ├── Ephemeral Handler
│   ├── Session Handler
│   └── Persistent Handler
├── File Loader
│   ├── Copy-on-Start Handler
│   ├── Volume Mount Handler
│   └── Layered Workspace Handler
└── Agent Executor
```

**Option B: Dedicated Services per Isolation Level** (For scaling)
- Separate Cloud Run services for different isolation needs
- Stronger isolation between tenant types
- Higher operational complexity

```
Cloud Run Service (ephemeral) - Strict isolation
Cloud Run Service (session)   - Standard isolation
Cloud Run Service (workspace) - User persistent
Cloud Run Service (team)      - Tenant shared
```

**Option C: Cloud Run Jobs for Long-Running** (For extended sessions)
- Use Cloud Run Jobs for sessions >1 hour
- Jobs support up to 24-hour execution
- Better for large refactoring tasks

#### 6.2 Storage Backend Implementations

**Supabase Storage (Current)**:
- Works well for user-persistent and session-persistent
- RLS provides user-level isolation
- Requires flush/restore cycle for Cloud Run

**Google Cloud Storage (Alternative)**:
- Better for shared workspaces (fine-grained IAM)
- FUSE mounting available but poor performance
- Consider for large file handling

**Persistent Volumes (For Fly.io/Self-hosted)**:
- Eliminates flush/restore overhead
- Single-machine limitation on Fly.io
- Better performance for I/O-heavy workloads

#### 6.3 File Loading Strategies

**Strategy 1: Copy Shared Files on Session Start**
```typescript
// Download shared files from cloud storage to container workspace
async function loadSharedFiles(sessionDir: string, config: FileLoadingConfig) {
  const sharedFiles = await supabase.storage
    .from('agent-files')
    .list('shared/', { limit: 1000 });

  for (const file of sharedFiles) {
    if (matchesPattern(file.name, config.includePatterns)) {
      const { data } = await supabase.storage
        .from('agent-files')
        .download(`shared/${file.name}`);

      // Write to read-only shared directory in workspace
      const targetPath = path.join(sessionDir, 'shared', file.name);
      await writeFile(targetPath, data);
    }
  }
}
```

**Strategy 2: GCS FUSE Volume Mount (Cloud Run Gen 2)**
```yaml
# Cloud Run service with GCS FUSE mount
volumes:
  - name: shared-data
    csi:
      driver: gcsfuse.run.googleapis.com
      volumeAttributes:
        bucketName: agent-shared-files
        mountOptions: "ro,implicit-dirs"  # Read-only!
```

**Strategy 3: Layered Workspace (Shared + Private)**
```typescript
// Container workspace structure:
// /workspace/
// ├── shared/     <- Read-only shared files (copied or mounted)
// └── user/       <- User's private writable space

async function setupLayeredWorkspace(sessionId: string, userId: string) {
  const sessionDir = `/app/data/${sessionId}`;

  // Create directories
  await mkdir(path.join(sessionDir, 'shared'), { recursive: true });
  await mkdir(path.join(sessionDir, 'user'), { recursive: true });

  // Load shared files (read-only)
  await loadSharedFiles(path.join(sessionDir, 'shared'));

  // Restore user's previous files (if any)
  await restoreUserFiles(userId, path.join(sessionDir, 'user'));

  // Set agent CWD to user directory (can read shared, write to user)
  return sessionDir;
}
```

### 7. Security Considerations

#### 7.1 Cloud Run Default Protections

Cloud Run provides:
- **gVisor sandbox**: Userspace kernel intercepts syscalls
- **VM-level isolation**: Each instance runs in dedicated VM
- **Encrypted traffic**: All traffic encrypted in transit
- **Stateless**: Terminating instance discards state

#### 7.2 Additional Hardening for Multi-Tenant

For hostile multi-tenant workloads:

1. **Separate Services per Tenant** (strongest isolation):
   ```yaml
   - agent-app-tenant-a (min-instances: 1)
   - agent-app-tenant-b (min-instances: 1)
   ```

2. **Network Policies**:
   - Use VPC connectors for private resource access
   - Restrict egress to allowlisted domains
   - Block access to metadata server

3. **Resource Limits**:
   - Memory: 2GB default, configurable per tenant
   - CPU: 2 vCPU default
   - Timeout: 300s (5 min) per request
   - Concurrency: 1 (ensure isolation)

4. **Audit Logging**:
   - Enable Cloud Audit Logs
   - Log all file operations
   - Track tool usage per session

#### 7.3 Storage Security

1. **RLS Enforcement** (Current):
   - User can only access own files
   - Session-level isolation via session_id

2. **Tenant Isolation** (If needed):
   - Separate storage buckets per tenant
   - IAM-based access control
   - Encryption keys per tenant

3. **Path Sanitization** (Already implemented):
   ```typescript
   // From files.ts:72-75
   if (relativePath.startsWith('..')) {
     console.log('[FILES] Skipping file outside session dir:', localFilePath);
     return null;
   }
   ```

### 8. Tradeoff Analysis

#### 8.1 Simplicity vs Flexibility

| Approach | Simplicity | Flexibility | Implementation Cost |
|----------|------------|-------------|---------------------|
| Single preset (current) | High | Low | Already done |
| 3-4 presets | High | Medium | Low |
| Full configuration | Medium | High | Medium |
| Custom per-tenant | Low | Maximum | High |

**Recommendation**: Start with 4 presets (ephemeral, session, workspace, team), allow override of specific options.

#### 8.2 Security vs Performance

| Security Level | Isolation | Startup Time | Overhead |
|----------------|-----------|--------------|----------|
| Standard (gVisor) | Good | ~200ms | ~15% |
| Enhanced (+ seccomp) | Better | ~250ms | ~20% |
| Strict (no network) | Best | ~200ms | ~10% |
| Firecracker | Maximum | ~300ms | ~15% |

**Recommendation**: Standard (gVisor) sufficient for most use cases. Offer Firecracker for untrusted code execution.

#### 8.3 Persistence vs Cost

| Mode | Storage Cost | Complexity | Cold Start |
|------|--------------|------------|------------|
| Ephemeral | $0 | Low | Fast |
| Session (1hr) | ~$0.001/session | Medium | Fast |
| User-persistent | ~$0.01/user/month | Medium | Medium (restore) |
| Shared | ~$0.1/tenant/month | High | Slow (sync) |

**Recommendation**: Default to session-persistent. User-persistent for premium tiers.

---

## Architecture Insights

### Git Context Controller (GCC) Pattern

Research revealed a promising pattern for managing agent context like version control:

```
.GCC/
├── main.md           # Global roadmap, goals
└── branches/
    ├── commit.md     # Progressive achievements
    ├── log.md        # Observation-thought-action traces
    └── metadata.yaml # File structures, dependencies
```

This pattern achieved **48% resolution on SWE-Bench-Lite** vs 43% for next-best baseline. Consider incorporating for complex multi-session workflows.

### OverlayFS for Efficient Workspaces

Docker's OverlayFS provides efficient copy-on-write:
- Base template layers shared across containers
- Only modified files stored per session
- Instant container startup (no image duplication)

For template-based workspaces, consider pre-built Docker images with base dependencies.

### State Machine for Reliability

One production system using persistent state machines achieved:
- 86% reduction in "lost work" incidents
- 3x faster project resumption
- Zero duplicate file creation errors

Consider implementing formal state machine for session lifecycle management.

---

## Historical Context

### Current Spec Reference

From `thoughts/shared/specs/2025-12-19-agent-app-boilerplate.md`:
- Phase 1 focused on basic session persistence to Supabase
- Storage bucket `agent-files` with RLS protection
- SDK session resumption via `sdk_session_id`
- No configuration options for storage modes

### Deployment Context

From `DEPLOYMENT-GUIDE.md`:
- Cloud Run with 2GB memory, 2 vCPU
- Stateless containers (`--min-instances 0`)
- Secrets via Secret Manager
- `/app/data` created but not mounted as volume

---

## Code References

- `apps/server/src/routes/agent.ts:27-28` - DATA_DIR and AGENT_DIR configuration
- `apps/server/src/routes/agent.ts:55-56` - Session directory creation
- `apps/server/src/routes/agent.ts:80` - Agent SDK CWD configuration
- `apps/server/src/services/files.ts:56-136` - File persistence implementation
- `apps/server/src/services/files.ts:246-299` - Batch flush implementation
- `supabase/migrations/20251220000002_agent_files.sql` - Database schema

---

## Related Research

- [Anthropic: Claude Code Sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing)
- [E2B: Firecracker vs QEMU](https://e2b.dev/blog/firecracker-vs-qemu)
- [Modal: Sandboxes Documentation](https://modal.com/docs/guide/sandboxes)
- [Git Context Controller Paper](https://arxiv.org/html/2508.00031v1)
- [AWS: Multi-Tenant Agentic AI](https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-multitenant/)

---

## Open Questions

1. **Volume Mounting on Cloud Run**: Would persistent volumes improve performance enough to justify complexity? Cloud Run Gen 2 supports NFS/GCS FUSE mounts.

2. **Copy vs Mount Tradeoffs**: When is copy-on-start better than volume mounting? Consider file count, total size, and access patterns.

3. **Tenant Isolation Requirements**: Do customers need stronger isolation than Cloud Run provides by default?

4. **Cost Modeling**: Need detailed cost analysis for user-persistent and shared modes at scale.

5. **Template System**: How to efficiently provision templated workspaces (Docker images vs file copy)?

6. **Git Integration**: Should the boilerplate provide native git worktree support for parallel agents?

---

## Recommended Next Steps

1. **Implement Configuration Schema** (Phase 1):
   - Add `StorageConfig`, `IsolationConfig`, and `FileLoadingConfig` interfaces
   - Implement preset selection via API parameter
   - Default to "session" preset

2. **Add Shared File Loading** (Phase 2):
   - Implement `copy-on-start` file loading from Supabase Storage
   - Add RLS policy for shared files (admin-generated content)
   - Add `is_admin_session` flag for admin content generation

3. **Security Enhancements** (Phase 3):
   - Add network allowlist configuration
   - Implement tool restrictions
   - Add audit logging

4. **Advanced File Loading** (Phase 4):
   - Implement GCS FUSE volume mounting for large shared datasets
   - Add layered workspace support (shared read-only + user writable)
   - Build admin scheduling for daily content generation
