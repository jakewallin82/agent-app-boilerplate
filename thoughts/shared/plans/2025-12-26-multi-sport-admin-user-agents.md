# Multi-Sport Admin + User Agents Implementation Plan

## Overview

Implement a complete multi-sport prediction system with:
1. **Admin agents** - Full-featured agents (from claude-sports) that generate predictions, reflections, and research
2. **User agents** - Read-only agents that consume predictions from `/shared` and present insights to users
3. **Baked image approach** - Shared files baked into Docker images for instant access (no runtime downloads)

## Current State Analysis

### What Exists Now
- **agent-app-boilerplate**: Has `sports-nfl` (user) and `sports-nfl-admin` (admin) agents as examples
- **claude-sports agent**: Multi-sport agent at `/Users/jakewallin/claude-sports/claude-sports-app/agent/` with:
  - CLAUDE.md - Master orchestrator for NFL/NBA/NHL/MLB/NCAAB
  - `.claude/agents/{sport}/` - Sport-specific subagents (predict, reflect, props, researchers)
  - `.claude/skills/` - fetch-odds, fetch-nba, fetch-nfl, fetch-nhl, fetch-ncaam, fetch-play-by-play
  - `data/{sport}/predictions/`, `data/{sport}/reflections/`, `data/{sport}/research/`

### Key Discoveries
- `apps/server/src/config/agents.json` defines agent configurations with `fileLoading`, `security`, `canWriteShared` settings
- `sharedFiles.ts:94-177` downloads files from Supabase Storage `shared/{agentId}/` path
- Current Dockerfile copies `agent/` directory but doesn't bake in shared files from Supabase
- Research document recommends baking shared files for ~10-50ms local copy vs ~2-5s Supabase download

## Desired End State

After implementation:
1. **Five admin agents** (`sports-nba-admin`, `sports-nfl-admin`, `sports-nhl-admin`, `sports-mlb-admin`, `sports-ncaab-admin`) with:
   - Full tool access (Bash, WebSearch, WebFetch, etc.)
   - `canWriteShared: true` - Files persist to Supabase `/shared/{agentId}/`
   - Complete subagent and skill configurations

2. **Five user agents** (`sports-nba`, `sports-nfl`, `sports-nhl`, `sports-mlb`, `sports-ncaab`) with:
   - Read-only tool access (Read, Glob, Grep)
   - Predictions loaded from baked `/app/shared/{agentId}/` at container startup
   - Simple CLAUDE.md for presenting insights

3. **Baked image pipeline** via GitHub Actions:
   - Downloads shared files from Supabase Storage
   - Bakes into Docker image at `/app/shared/`
   - Deployed on schedule (daily) or manual trigger

4. **Verification**:
   - `docker run` shows `/app/shared/{agentId}/` contains predictions
   - Admin sessions persist files to Supabase `/shared/{agentId}/`
   - User sessions have instant access to predictions (no download wait)

## What We're NOT Doing

- Not implementing Redis caching (not needed with baked images)
- Not implementing Cloud Storage FUSE mounts
- Not creating a separate admin dashboard for deployments (using GitHub Actions UI)
- Not changing the warmup system (keeping it for local dev only)
- Not implementing real-time sync between admin writes and user views (daily deploy is sufficient)

## Implementation Approach

The approach is phased:
1. **Phase 1**: Migrate claude-sports agents to boilerplate as admin agents
2. **Phase 2**: Create user-facing agent configurations
3. **Phase 3**: Implement baked image build pipeline
4. **Phase 4**: Update sharedFiles.ts to use baked files in production

---

## Phase 1: Migrate Claude-Sports Agents as Admin Agents

### Overview
Copy the claude-sports agent configuration to the boilerplate and configure as admin agents for each sport.

### Changes Required:

#### 1. Copy Agent Configs

**Source**: `/Users/jakewallin/claude-sports/claude-sports-app/agent/`
**Destination**: `/Users/jakewallin/agent-app-boilerplate/agent/configs/sports-admin/`

Structure after copy:
```
agent/configs/sports-admin/
├── CLAUDE.md           # From claude-sports CLAUDE.md (master orchestrator)
├── .claude/
│   ├── agents/         # All subagents (nba/, nfl/, nhl/, mlb/, ncaab/)
│   └── skills/         # All skills (fetch-odds, fetch-nba, etc.)
├── .env                # API keys for odds/tank01
└── requirements.txt    # Python dependencies
```

#### 2. Update agents.json with Multi-Sport Admin Agents

**File**: `apps/server/src/config/agents.json`
**Changes**: Add sport-specific admin agents that share the same configDir

```json
{
  "sports-admin": {
    "id": "sports-admin",
    "name": "Multi-Sport Admin Agent",
    "description": "Admin agent for generating predictions across all sports",
    "configDir": "sports-admin",
    "storageMode": "shared-persistent",
    "isolation": "shared",
    "fileLoading": {
      "sharedFiles": "copy-on-start",
      "includePatterns": ["**/*.md"]
    },
    "security": {
      "network": "full",
      "allowedTools": ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Task", "TaskOutput", "TodoWrite", "AskUserQuestion", "Skill"]
    },
    "startup": {
      "strategy": "on-demand"
    },
    "canWriteShared": true
  },
  "sports-nba-admin": {
    "id": "sports-nba-admin",
    "name": "NBA Admin Agent",
    "description": "Admin agent for NBA predictions",
    "configDir": "sports-admin",
    "storageMode": "shared-persistent",
    "isolation": "shared",
    "fileLoading": {
      "sharedFiles": "copy-on-start",
      "includePatterns": ["nba/**/*.md"],
      "sharedAgentId": "sports-nba"
    },
    "security": {
      "network": "full",
      "allowedTools": ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Task", "TaskOutput", "TodoWrite", "AskUserQuestion", "Skill"]
    },
    "startup": {
      "strategy": "on-demand"
    },
    "canWriteShared": true,
    "sharedStorageTarget": "sports-nba"
  }
}
```

Note: `sharedStorageTarget` tells the system to write to `/shared/sports-nba/` (the user agent's shared storage) instead of `/shared/sports-nba-admin/`.

#### 3. Update Admin CLAUDE.md Paths

**File**: `agent/configs/sports-admin/CLAUDE.md`
**Changes**: Update all file paths from `/Users/jakewallin/claude-sports/claude-sports-app/agent/` to relative paths that work in the container:

```markdown
# Before
/Users/jakewallin/claude-sports/claude-sports-app/agent/data/nba/predictions/

# After (use relative paths that work in session directory)
./predictions/nba/
# OR use the shared storage prefix
./shared/nba/predictions/
```

#### 4. Update Subagent Path References

All subagent files in `.claude/agents/{sport}/` need path updates:

**Files to update**:
- `.claude/agents/nba/predict-nba.md`
- `.claude/agents/nba/reflect-nba.md`
- `.claude/agents/nba/rest-predictor-nba.md`
- `.claude/agents/nba/props-nba.md`
- (Similar for nfl/, nhl/, mlb/, ncaab/)

**Pattern**:
```markdown
# Before
/Users/jakewallin/claude-sports/claude-sports-app/agent/data/nba/predictions/{YYYY-MM-DD}/

# After
./shared/nba/predictions/{YYYY-MM-DD}/
```

### Success Criteria:

#### Automated Verification:
- [ ] All agent config files exist in `agent/configs/sports-admin/`
- [ ] `agents.json` parses without errors: `node -e "require('./apps/server/src/config/agents.json')"`
- [ ] Server starts without errors: `pnpm --filter @agent-app/server dev`
- [ ] TypeScript compiles: `pnpm --filter @agent-app/server build`

#### Manual Verification:
- [ ] Admin agent can be selected in the UI
- [ ] Admin agent can run predictions with web search
- [ ] Files created by admin persist to Supabase `/shared/sports-nba/`
- [ ] Subagents spawn correctly with updated paths

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Create User-Facing Agent Configurations

### Overview
Create read-only user agents for each sport that consume predictions from `/shared/`.

### Changes Required:

#### 1. Create User Agent Config Directories

Create one directory per sport with simple CLAUDE.md:

```
agent/configs/sports-nba/
├── CLAUDE.md           # User-facing NBA agent
└── .claude/
    └── settings.json   # Minimal settings
```

#### 2. Create sports-nba/CLAUDE.md (Template for All Sports)

**File**: `agent/configs/sports-nba/CLAUDE.md`

```markdown
# NBA Predictions Assistant

You are a helpful assistant that discusses NBA game predictions and analysis. Your role is to read prediction files and share insights with users.

## Your Data

All prediction and analysis files are in the `./shared/` directory:

- `./shared/nba/predictions/{YYYY-MM-DD}/` - Daily game predictions
- `./shared/nba/reflections/{YYYY-MM-DD}/` - Post-game analysis
- `./shared/nba/research/` - Research notes (injury reports, rest tracking)

## What You Can Do

1. **Read prediction files** from `./shared/nba/`
2. **Summarize predictions** - explain picks, confidence levels, key factors
3. **Answer questions** about specific games, teams, or matchups
4. **Compare predictions to results** using reflection files
5. **Discuss research** - explain rest/load management, injuries

## What You Cannot Do

- You cannot search the web or fetch URLs
- You cannot create new predictions (only admins can)
- You cannot modify existing prediction files

## How to Respond

1. When asked about games, first read the relevant prediction file
2. Provide clear, concise summaries
3. Highlight confidence level and main reasoning
4. If asked about past games, check reflections for accuracy analysis

## Response Format

**Game:** [Away Team] @ [Home Team]
**Date:** [YYYY-MM-DD]
**Pick:** [Team] to cover [spread]
**Confidence:** [1-10]
**Key Factors:**
- [Factor 1]
- [Factor 2]
- [Factor 3]

## Getting Started

Ask me about:
- "What NBA games are predicted for today?"
- "What's the pick for Lakers vs Warriors?"
- "How accurate were yesterday's predictions?"
- "Who should I bet on for the Christmas Day games?"
```

#### 3. Update agents.json with User Agents

**File**: `apps/server/src/config/agents.json`
**Changes**: Add user agents for each sport

```json
{
  "sports-nba": {
    "id": "sports-nba",
    "name": "NBA Predictions Agent",
    "description": "Get NBA game predictions and analysis",
    "configDir": "sports-nba",
    "storageMode": "session-persistent",
    "isolation": "shared",
    "fileLoading": {
      "sharedFiles": "copy-on-start",
      "includePatterns": ["nba/**/*.md"],
      "maxSharedBytes": 104857600
    },
    "security": {
      "network": "none",
      "allowedTools": ["Read", "Glob", "Grep", "TodoWrite", "AskUserQuestion"]
    },
    "startup": {
      "strategy": "pre-warm-on-login",
      "warmupTTL": 300
    },
    "canWriteShared": false
  },
  "sports-nfl": { /* Similar configuration */ },
  "sports-nhl": { /* Similar configuration */ },
  "sports-mlb": { /* Similar configuration */ },
  "sports-ncaab": { /* Similar configuration */ }
}
```

#### 4. Create Config Directories for All Sports

Repeat the sports-nba structure for:
- `agent/configs/sports-nfl/` (NFL)
- `agent/configs/sports-nhl/` (NHL)
- `agent/configs/sports-mlb/` (MLB)
- `agent/configs/sports-ncaab/` (NCAAB)

### Success Criteria:

#### Automated Verification:
- [ ] All user agent config directories exist
- [ ] Each has valid CLAUDE.md
- [ ] `agents.json` parses correctly with all agents
- [ ] Server starts: `pnpm --filter @agent-app/server dev`

#### Manual Verification:
- [ ] User can select sport-specific agent in UI
- [ ] User agent can read files from `./shared/{sport}/`
- [ ] User agent cannot use web search (blocked)
- [ ] User agent cannot write to shared storage

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Implement Baked Image Build Pipeline

### Overview
Create GitHub Actions workflow that downloads shared files from Supabase and bakes them into the Docker image.

### Changes Required:

#### 1. Create Download Script

**File**: `scripts/download-shared-files.sh`

```bash
#!/bin/bash
set -e

# Download shared files from Supabase Storage
# Usage: ./scripts/download-shared-files.sh [output_dir]

OUTPUT_DIR="${1:-./shared-files}"
BUCKET_NAME="agent-files"
SHARED_PREFIX="shared"

echo "Downloading shared files from Supabase to $OUTPUT_DIR"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# List of sports to download
SPORTS=("sports-nba" "sports-nfl" "sports-nhl" "sports-mlb" "sports-ncaab")

for sport in "${SPORTS[@]}"; do
  echo "Downloading $sport..."

  # Use Supabase CLI to download files
  # Note: Requires SUPABASE_URL and SUPABASE_SERVICE_KEY env vars
  npx supabase storage download "$BUCKET_NAME/$SHARED_PREFIX/$sport" \
    --output "$OUTPUT_DIR/$sport" \
    --recursive \
    || echo "Warning: No files for $sport or download failed"
done

# Count files
FILE_COUNT=$(find "$OUTPUT_DIR" -type f | wc -l)
echo "Downloaded $FILE_COUNT total files"
```

#### 2. Update Dockerfile to Accept Shared Files

**File**: `Dockerfile`

```dockerfile
# Build stage (unchanged)
FROM node:20-slim AS builder
# ... existing build steps ...

# Production stage
FROM node:20-slim AS runner

# Install pnpm for workspace support
RUN npm install -g pnpm@9

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/apps/server/dist apps/server/dist

# Copy agent workspace (contains CLAUDE.md and agent configs)
COPY agent/ agent/

# NEW: Copy baked shared files (from build context)
# This directory is populated by CI before docker build
ARG SHARED_FILES_DIR=./shared-files
COPY ${SHARED_FILES_DIR}/ /app/shared/

# Create data directory for agent file operations
RUN mkdir -p /app/data && chmod 755 /app/data

# Set environment
ENV NODE_ENV=production
ENV PORT=8080
ENV BAKED_SHARED_DIR=/app/shared

# ... rest of Dockerfile unchanged ...
```

#### 3. Create GitHub Actions Workflow

**File**: `.github/workflows/deploy-with-shared.yml`

```yaml
name: Deploy with Latest Shared Files

on:
  workflow_dispatch:
    inputs:
      reason:
        description: 'Reason for deployment'
        required: false
        default: 'Manual deploy'
  schedule:
    # Daily at 6am UTC (1am EST, 10pm PST)
    - cron: '0 6 * * *'

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  REGION: us-central1
  SERVICE_NAME: agent-app-server
  ARTIFACT_REGISTRY: us-central1-docker.pkg.dev

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest

    permissions:
      contents: read
      id-token: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Download shared files from Supabase
        run: |
          chmod +x ./scripts/download-shared-files.sh
          ./scripts/download-shared-files.sh ./shared-files
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker
        run: gcloud auth configure-docker ${{ env.ARTIFACT_REGISTRY }}

      - name: Build and push Docker image
        run: |
          IMAGE="${{ env.ARTIFACT_REGISTRY }}/${{ env.PROJECT_ID }}/agent-app/${{ env.SERVICE_NAME }}:${{ github.sha }}"

          docker build \
            --build-arg SHARED_FILES_DIR=./shared-files \
            -t "$IMAGE" \
            -f Dockerfile .

          docker push "$IMAGE"

          echo "IMAGE=$IMAGE" >> $GITHUB_ENV

      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy ${{ env.SERVICE_NAME }} \
            --image ${{ env.IMAGE }} \
            --region ${{ env.REGION }} \
            --platform managed \
            --allow-unauthenticated

      - name: Show deployment URL
        run: |
          URL=$(gcloud run services describe ${{ env.SERVICE_NAME }} \
            --region ${{ env.REGION }} \
            --format 'value(status.url)')
          echo "Deployed to: $URL"
```

### Success Criteria:

#### Automated Verification:
- [ ] Download script exists and is executable
- [ ] Dockerfile builds successfully: `docker build -t test --build-arg SHARED_FILES_DIR=./shared-files .`
- [ ] GitHub Actions workflow YAML is valid
- [ ] Docker image contains `/app/shared/` directory

#### Manual Verification:
- [ ] Trigger workflow manually from GitHub Actions UI
- [ ] Deployment completes without errors
- [ ] New Cloud Run revision is active
- [ ] Container has shared files at `/app/shared/`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 4.

---

## Phase 4: Update sharedFiles.ts to Use Baked Files

### Overview
Modify the shared files loading to prefer baked files (production) over Supabase downloads (development).

### Changes Required:

#### 1. Update sharedFiles.ts

**File**: `apps/server/src/services/sharedFiles.ts`
**Changes**: Add baked files detection and local copy logic

```typescript
import { supabase } from '../lib/supabase.js';
import { ensureSessionDir } from './files.js';
import { getAgentConfig } from './agentConfig.js';
import { mkdir, writeFile, copyFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { minimatch } from 'minimatch';
import { glob } from 'glob';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUCKET_NAME = 'agent-files';
const SHARED_PREFIX = 'shared';

// Baked shared files directory (populated at build time in production)
const BAKED_SHARED_DIR = process.env.BAKED_SHARED_DIR || '/app/shared';

// ... existing code ...

/**
 * Load shared files into a session workspace
 * In production: copies from baked /app/shared/ (instant, ~10-50ms)
 * In development: downloads from Supabase (slower, ~2-5s)
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

  // Determine the storage agent ID (admin agents may write to user agent's storage)
  const storageAgentId = config.sharedStorageTarget || agentId;

  // Check if we have baked files (production) or need to download (dev)
  const bakedPath = path.join(BAKED_SHARED_DIR, storageAgentId);

  if (existsSync(bakedPath)) {
    // PRODUCTION: Copy from baked location (~10-50ms)
    console.log(`[SHARED_FILES] Using baked shared files from ${bakedPath}`);
    return await copyBakedFiles(bakedPath, sharedDir, config);
  } else {
    // DEVELOPMENT: Download from Supabase (existing code)
    console.log('[SHARED_FILES] Downloading from Supabase (dev mode)');
    return await downloadFromSupabase(sessionName, storageAgentId, config);
  }
}

/**
 * Copy baked files from container filesystem to session directory
 */
async function copyBakedFiles(
  bakedPath: string,
  sharedDir: string,
  config: AgentConfig
): Promise<{ loaded: number; skipped: number; errors: number }> {
  // Create shared directory
  if (!existsSync(sharedDir)) {
    await mkdir(sharedDir, { recursive: true });
  }

  const includePatterns = config.fileLoading.includePatterns || [];
  const excludePatterns = config.fileLoading.excludePatterns || [];
  const maxBytes = config.fileLoading.maxSharedBytes || 100 * 1024 * 1024;

  // Find all files in baked directory
  const allFiles = await glob('**/*', {
    cwd: bakedPath,
    nodir: true,
    dot: true
  });

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

    try {
      const srcPath = path.join(bakedPath, relativePath);
      const destPath = path.join(sharedDir, relativePath);
      const destDir = path.dirname(destPath);

      // Check file size
      const stats = await stat(srcPath);
      if (totalBytes + stats.size > maxBytes) {
        console.warn('[SHARED_FILES] Size limit reached, stopping file loading');
        break;
      }

      // Create destination directory
      if (!existsSync(destDir)) {
        await mkdir(destDir, { recursive: true });
      }

      // Copy file
      await copyFile(srcPath, destPath);
      totalBytes += stats.size;
      loaded++;
    } catch (error) {
      console.error('[SHARED_FILES] Error copying file:', relativePath, error);
      errors++;
    }
  }

  console.log(`[SHARED_FILES] Baked files loaded: ${loaded} loaded, ${skipped} skipped, ${errors} errors`);
  return { loaded, skipped, errors };
}

/**
 * Download files from Supabase Storage (development mode)
 */
async function downloadFromSupabase(
  sessionName: string,
  agentId: string,
  config: AgentConfig
): Promise<{ loaded: number; skipped: number; errors: number }> {
  // ... existing loadSharedFilesIntoSession code moved here ...
}
```

#### 2. Add sharedStorageTarget to AgentConfig Type

**File**: `packages/shared/src/types.ts`
**Changes**: Add new config field

```typescript
export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  configDir: string;
  storageMode: 'session-persistent' | 'shared-persistent';
  isolation: 'strict' | 'shared';
  fileLoading: {
    sharedFiles: 'none' | 'copy-on-start';
    includePatterns?: string[];
    excludePatterns?: string[];
    maxSharedBytes?: number;
    sharedAgentId?: string;  // For loading from a different agent's shared storage
  };
  security: {
    network: 'none' | 'full';
    allowedTools: string[];
  };
  startup: {
    strategy: 'on-demand' | 'pre-warm-on-login';
    warmupTTL?: number;
  };
  canWriteShared: boolean;
  sharedStorageTarget?: string;  // NEW: Write to different agent's shared storage
}
```

#### 3. Update files.ts for Shared Storage Target

**File**: `apps/server/src/services/files.ts`
**Changes**: Update `flushSessionFolder` to use `sharedStorageTarget`

The flush logic should check `config.sharedStorageTarget` and use that as the storage path instead of the agent's own ID when persisting files.

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles without errors: `pnpm build`
- [ ] Server starts in dev mode: `pnpm --filter @agent-app/server dev`
- [ ] Unit tests pass (if any): `pnpm test`

#### Manual Verification:
- [ ] In dev mode, files download from Supabase (see logs)
- [ ] In production (docker), files copy from `/app/shared/` (see logs)
- [ ] User agent sessions have instant access to predictions
- [ ] Load time difference is noticeable (2-5s → <100ms)

---

## Testing Strategy

### Unit Tests:
- Test `copyBakedFiles` with mock filesystem
- Test pattern matching for include/exclude
- Test `sharedStorageTarget` resolution

### Integration Tests:
- Build Docker image with mock shared files
- Verify files exist at `/app/shared/`
- Verify agent sessions can read files

### Manual Testing Steps:
1. Run admin agent, create a prediction
2. Verify file persists to Supabase `/shared/sports-nba/`
3. Trigger GitHub Actions deploy
4. Verify new container has the prediction baked in
5. Run user agent, verify instant access to prediction
6. Compare response time: baked vs downloaded

## Performance Considerations

| Approach | First Query Latency | Storage Cost |
|----------|---------------------|--------------|
| Supabase download | +2-5 sec | ~$0/GB |
| Baked in image | +10-50 ms | Image size increase |

The tradeoff is acceptable because:
- Shared files are updated daily at most
- Image size increase is minimal (~10-50MB for predictions)
- User experience improvement is significant

## Migration Notes

### Breaking Changes
- None - new agents are additive

### Rollback Plan
- If baked files cause issues, set `BAKED_SHARED_DIR=nonexistent` to force Supabase fallback
- GitHub Actions workflow can be disabled without affecting existing functionality

### Deployment Order
1. Phase 1 + 2: Can deploy without pipeline (uses Supabase download)
2. Phase 3 + 4: Deploy together to enable baked files

## References

- Research document: `thoughts/shared/research/2025-12-24-warmup-vs-load-query-time-analysis.md`
- Claude-sports agent: `/Users/jakewallin/claude-sports/claude-sports-app/agent/`
- Current agent configs: `agent/configs/`
- Shared files service: `apps/server/src/services/sharedFiles.ts`
