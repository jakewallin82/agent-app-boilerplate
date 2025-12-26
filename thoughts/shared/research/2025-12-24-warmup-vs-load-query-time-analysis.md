# Warmup vs Load-at-Query-Time Analysis

**Date:** 2025-12-24
**Status:** Research Complete
**Context:** Evaluating session warmup strategy for GCP Cloud Run deployment

## Executive Summary

The current warmup implementation works perfectly for local development but **will not work on Cloud Run** due to ephemeral containers and lack of shared state. This document analyzes the failure modes, evaluates alternatives, and recommends a path forward.

---

## Current Warmup Implementation

### What Warmup Does

1. **On user login**, frontend calls `POST /api/agent/warmup`
2. **Backend creates** temporary session directory (`data/warmup-{userId}-{timestamp}`)
3. **Downloads shared files** from Supabase Storage → local disk (2-5 seconds)
4. **Copies agent config** (CLAUDE.md, .claude/) from container → session dir
5. **Caches metadata** in memory: `warmupCache.set(userId:agentId, { sessionName, sessionDir, ... })`
6. **On first query**, backend:
   - Looks up warmup cache
   - Renames warmup directory → user's requested session name
   - Skips file download (already done)
   - Saves 2-5 seconds on first query

### Key Files

- `apps/server/src/services/warmupCache.ts` - In-memory Map for warmup metadata
- `apps/server/src/services/sharedFiles.ts` - Downloads files from Supabase Storage
- `apps/server/src/routes/agent.ts` - Warmup endpoint and cache consumption
- `apps/web/src/contexts/AuthContext.tsx` - Triggers warmup on login
- `apps/web/src/config.ts` - Default agent ID configuration

---

## Why Current System Fails on Cloud Run

### Local Development (Works)

```
┌─────────────────────────────────────────────────────────────┐
│                    Single Node.js Process                   │
│                                                             │
│  warmupCache (Map)          /data/ (local disk)             │
│  ┌──────────────────┐      ┌─────────────────────┐          │
│  │ userId:sports-nfl│      │ warmup-abc123/      │          │
│  │   → warmup-abc123│      │   └─ shared/        │          │
│  └──────────────────┘      │       └─ files...   │          │
│           ↑                └─────────────────────┘          │
│           │                          ↑                      │
│     Warmup stores here         Files persist here           │
│           │                          │                      │
│           └──── Query reads both ────┘                      │
│                                                             │
│  Same process, same memory, same disk = WORKS               │
└─────────────────────────────────────────────────────────────┘
```

### Cloud Run (Broken)

**Timeline of Failure:**

```
t=0    User logs in
t=1    Frontend → POST /api/agent/warmup
t=2    Cloud Run routes to Container A (might cold start)
t=3    Container A:
         - Creates /app/data/warmup-abc123/
         - Downloads 50 files from Supabase Storage (2-3 sec)
         - warmupCache.set("userId:sports-nfl", { sessionName: "warmup-abc123", ... })
         - Returns { status: "warmed", filesLoaded: 50 }
t=6    User reads the response, warmup complete
t=7    Container A sits idle, no requests...
t=30   Cloud Run scales down Container A (min-instances: 0)
       ┌─────────────────────────────────────────────┐
       │  Container A TERMINATED                     │
       │  - Memory (warmupCache): GONE              │
       │  - Filesystem (/app/data/): GONE           │
       └─────────────────────────────────────────────┘
t=45   User submits query "analyze the Chiefs game"
t=46   Cloud Run spins up Container B (cold start, 2-3 sec)
t=48   Container B:
         - warmupCache.get("userId:sports-nfl") → null (empty Map!)
         - Checks /app/data/warmup-abc123 → doesn't exist!
         - Falls back: creates /app/data/mysession/
         - Downloads 50 files AGAIN from Supabase (2-3 sec)
         - Warmup was COMPLETELY WASTED
```

### Three Broken Assumptions

| Assumption | Local Dev | Cloud Run |
|------------|-----------|-----------|
| Memory shared between requests | ✅ Same process | ❌ Different containers |
| Filesystem persists between requests | ✅ Same disk | ❌ Ephemeral per container |
| Same instance handles warmup + query | ✅ One server | ❌ Load balancer chooses |

### Even Without Scale-to-Zero

Even with `min-instances: 1`, these scenarios break warmup:

1. **Multiple instances**: User warmup → Container A, query → Container B (load balancer)
2. **Container restart**: Deployment, OOM, health check failure → new container
3. **Long delay**: User warms up, goes to lunch, container recycled, returns

---

## Alternative Architectures

### Option 1: Disable Warmup in Production

**Implementation:**
```typescript
// AuthContext.tsx
const triggerWarmup = async () => {
  if (import.meta.env.PROD) return; // Skip in production
  // ... rest of warmup logic
};
```

**Pros:**
- Zero complexity
- No infrastructure changes
- Works immediately

**Cons:**
- First query takes 2-5 extra seconds
- Users notice "slow" first response

**When to use:** MVP, low traffic, cost-sensitive

---

### Option 2: Frontend-Based Warmup Cache

**Concept:** Store warmup metadata in browser localStorage, pass to backend with query.

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Browser)                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ localStorage:                                        │   │
│  │   warmupSessions: {                                  │   │
│  │     "sports-nfl": {                                  │   │
│  │       sessionName: "warmup-abc123",                  │   │
│  │       timestamp: 1703425600000,                      │   │
│  │       filesLoaded: 50                                │   │
│  │     }                                                │   │
│  │   }                                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ↓ (included in query request)     │
└───────────────────────────┼─────────────────────────────────┘
                            │
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Backend (Stateless Container)                              │
│  - Receives warmupSessionName from frontend                 │
│  - Checks if /app/data/warmup-abc123 exists                │
│  - Problem: IT DOESN'T (different container!)              │
└─────────────────────────────────────────────────────────────┘
```

**Problem:** Frontend knows about warmup, but files aren't on this container's disk.

**Could work if:** Warmup uploaded prepared session to Supabase Storage, but then we're just moving download time around.

**Verdict:** ❌ Doesn't solve the core problem

---

### Option 3: Redis + Main Node Architecture

**Concept:** Dedicated "Main Node" service with persistent state, separate ephemeral Query Containers.

```
                                    ┌─────────────────────────┐
                                    │   Redis (Memorystore)   │
                                    │   - Warmup cache        │
                                    │   - Session metadata    │
                                    └───────────┬─────────────┘
                                                │
┌──────────┐      ┌─────────────────────────────┼─────────────────────┐
│ Frontend │ ───→ │  Main Node (min-instances=1)                      │
└──────────┘      │  Cloud Run Service                                │
                  │  ┌───────────────────────────────────────────┐    │
                  │  │ Responsibilities:                         │    │
                  │  │ - GET /sessions, /files (simple queries)  │    │
                  │  │ - POST /warmup → stores in Redis          │    │
                  │  │ - POST /query → dispatches to Query Node  │    │
                  │  │ - WebSocket/SSE connection management     │    │
                  │  │ - Rate limiting, auth                     │    │
                  │  └───────────────────────────────────────────┘    │
                  └─────────────────────────────┬─────────────────────┘
                                                │
                                                ↓ (dispatch)
                  ┌───────────────────────────────────────────────────┐
                  │  Query Container (Cloud Run Job or async service) │
                  │  ┌───────────────────────────────────────────┐    │
                  │  │ Responsibilities:                         │    │
                  │  │ - Check Redis for warmup metadata         │    │
                  │  │ - Download files (still required)         │    │
                  │  │ - Run Claude agent (long-running)         │    │
                  │  │ - Stream results back                     │    │
                  │  │ - Die after query completes               │    │
                  │  └───────────────────────────────────────────┘    │
                  └───────────────────────────────────────────────────┘
```

**What Redis solves:**
- Warmup metadata persists across all containers
- Main Node can reliably check "did this user warm up?"
- Query Container can look up warmup info

**What Redis doesn't solve:**
- Query Container still needs to download files
- Files can't be pre-staged on Query Container's disk (ephemeral)

**Enhancement: Cloud Storage for Files**

```
Warmup Flow:
1. Main Node receives warmup request
2. Downloads shared files from Supabase → Cloud Storage bucket
3. Stores in Redis: { warmupSession: "warmup-abc", gcsPath: "gs://bucket/warmup-abc/" }

Query Flow:
1. Query Container checks Redis → finds warmup
2. Downloads from Cloud Storage (GCP→GCP, faster than Supabase)
3. Or: Mounts Cloud Storage via FUSE (gcsfuse)
```

**Time savings:**
- Supabase → Container: ~2-5 seconds (cross-cloud)
- Cloud Storage → Container: ~0.5-2 seconds (same cloud)
- Cloud Storage FUSE: Variable, depends on access pattern

**Pros:**
- Reliable warmup across containers
- Enables other features (session state, WebSocket management)
- Proper production architecture

**Cons:**
- Significant complexity increase
- Redis: ~$25-50/month (Memorystore)
- Cloud Storage: ~$0.02/GB/month
- More moving parts to debug

**When to use:** Production with multiple users, need for reliability

---

### Option 4: Cloud Storage FUSE Mount

**Concept:** Mount Cloud Storage bucket as filesystem, all containers see same files.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Container A    │     │  Container B    │     │  Container C    │
│  /mnt/data/     │     │  /mnt/data/     │     │  /mnt/data/     │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                                 ↓
                    ┌────────────────────────┐
                    │   Cloud Storage Bucket │
                    │   gs://agent-sessions/ │
                    │   ├─ warmup-abc123/    │
                    │   ├─ mysession/        │
                    │   └─ ...               │
                    └────────────────────────┘
```

**Implementation:**
```dockerfile
# Dockerfile changes
RUN apt-get install -y gcsfuse

# Or use Cloud Run's built-in volume mounts (GA as of 2024)
```

**Pros:**
- All containers see same filesystem
- Warmup files persist
- Simpler than Redis for file sharing

**Cons:**
- FUSE adds latency to every file operation
- Not suitable for high-frequency file access
- Cloud Run volume mount has limitations
- Still need Redis for metadata (or accept filesystem-based locking)

**When to use:** Medium complexity, file-heavy workloads

---

## Comparison Matrix

| Approach | First Query Latency | Warmup Effective | Complexity | Monthly Cost |
|----------|---------------------|------------------|------------|--------------|
| Disable warmup | +2-5 sec | No | None | $0 |
| Frontend cache | +2-5 sec | No | Low | $0 |
| Redis + Main Node | +0.5-2 sec | Partial | High | ~$50+ |
| Redis + Cloud Storage | +0.5-1 sec | Yes | Very High | ~$75+ |
| Cloud Storage FUSE | Variable | Yes | Medium | ~$25+ |

---

## Recommendation

### Short Term (Now)

**Disable warmup in production.** The 2-5 second first-query latency is acceptable for MVP.

```typescript
// apps/web/src/contexts/AuthContext.tsx
const triggerWarmup = async () => {
  if (import.meta.env.PROD) return;
  // ... existing logic for local dev
};
```

### Medium Term (When Needed)

Build **Main Node + Redis architecture** for reasons beyond warmup:
- Reliable SSE/WebSocket connection management
- Session state persistence
- Rate limiting and abuse prevention
- Admin operations

Once Redis exists, warmup becomes a simple addition.

### Long Term (Scale)

Consider **Cloud Storage integration** for:
- Shared file access across query containers
- Reduced Supabase egress costs
- Faster file operations (same cloud)

---

## Appendix: What Warmup Actually Saves

### File Loading Breakdown

```
loadSharedFilesIntoSession():
  1. List files from Supabase Storage        ~200-500ms
  2. Download each file (50 files × 50KB)    ~2-4 sec
  3. Write to local disk                     ~100-200ms
  Total: 2-5 seconds

loadAgentConfigIntoSession():
  1. Copy CLAUDE.md from container           ~10ms
  2. Copy .claude/ directory                 ~20ms
  Total: ~30ms (negligible)
```

**Warmup saves:** The 2-5 second Supabase download time.

### Is It Worth It?

| Scenario | Warmup Value |
|----------|--------------|
| User logs in, immediately queries | High (saves full wait) |
| User logs in, browses 30 sec, queries | Medium (warmup still valid) |
| User logs in, goes to lunch, returns | Low (warmup expired/container gone) |
| User sends 2nd message in same session | None (files already loaded) |

For most users, warmup helps the **first query only** and only if they query **within 5 minutes** of login.

---

---

## Recommended Solution: Bake Shared Files into Docker Image

### Overview

Since shared files (predictions, reflections, research) are updated by admins on a predictable schedule (daily/weekly), we can bake them directly into the Docker image. This provides **instant file access** with zero runtime download latency.

### Workflow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Daily Update Cycle                                                     │
│                                                                         │
│  1. Admin Session                                                       │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │  Admin uses sports-nfl-admin agent                          │    │
│     │  - Generates new predictions                                │    │
│     │  - Updates reflections                                      │    │
│     │  - Adds research notes                                      │    │
│     │  - Files saved to Supabase Storage: shared/sports-nfl/      │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│                              ▼                                          │
│  2. Admin Confirms                                                      │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │  "Updates complete, ready to deploy"                        │    │
│     │  - Via admin dashboard button                               │    │
│     │  - Or GitHub Actions manual trigger                         │    │
│     │  - Or scheduled (e.g., 6am daily)                           │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│                              ▼                                          │
│  3. Build Pipeline                                                      │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │  a. Download /shared from Supabase Storage                  │    │
│     │  b. COPY shared/ into Docker image                          │    │
│     │  c. Push to Artifact Registry                               │    │
│     │  d. Deploy new revision to Cloud Run                        │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│                              ▼                                          │
│  4. All Query Containers                                                │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │  /app/shared/ already contains latest files                 │    │
│     │  - Zero download time                                       │    │
│     │  - Instant file access                                      │    │
│     │  - Just copy to session dir (local disk, ~10ms)             │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Implementation Options

#### Option 1: GitHub Actions (Recommended)

```yaml
# .github/workflows/deploy-with-shared.yml
name: Deploy with Latest Shared Files

on:
  workflow_dispatch:  # Manual trigger from GitHub UI
    inputs:
      reason:
        description: 'Reason for deployment'
        required: false
  schedule:
    - cron: '0 6 * * *'  # Daily at 6am UTC

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Download shared files from Supabase
        run: |
          # Use Supabase CLI or direct API to download shared files
          npx supabase storage download agent-files/shared/sports-nfl -o ./shared-files/
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}

      - name: Build Docker image with shared files
        run: |
          docker build \
            --build-arg SHARED_DIR=./shared-files \
            -f apps/server/Dockerfile \
            -t $IMAGE_NAME .

      - name: Push and deploy to Cloud Run
        run: |
          docker push $IMAGE_NAME
          gcloud run deploy agent-app-server --image $IMAGE_NAME --region us-central1
```

**Dockerfile changes:**
```dockerfile
# Add build arg for shared files
ARG SHARED_DIR=./shared-files

# Copy shared files into image
COPY ${SHARED_DIR}/ /app/shared/
```

**Pros:**
- Full audit trail in GitHub
- Easy manual trigger via GitHub UI
- Can add approval gates
- Free for public repos

**Cons:**
- Requires GitHub secrets setup
- ~5-10 min deploy time

---

#### Option 2: Cloud Build Trigger

```yaml
# cloudbuild.yaml
steps:
  # Download shared files from Supabase
  - name: 'node:20'
    entrypoint: npx
    args: ['supabase', 'storage', 'download', 'agent-files/shared/sports-nfl', '-o', './shared-files/']
    secretEnv: ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']

  # Build with shared files
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '--build-arg', 'SHARED_DIR=./shared-files', '-t', '$_IMAGE', '.']

  # Push to Artifact Registry
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '$_IMAGE']

  # Deploy to Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    args: ['gcloud', 'run', 'deploy', 'agent-app-server', '--image', '$_IMAGE', '--region', 'us-central1']

availableSecrets:
  secretManager:
    - versionName: projects/$PROJECT_ID/secrets/supabase-url/versions/latest
      env: 'SUPABASE_URL'
    - versionName: projects/$PROJECT_ID/secrets/supabase-service-key/versions/latest
      env: 'SUPABASE_SERVICE_KEY'
```

**Trigger options:**
- Manual via Cloud Console
- Webhook (call from admin dashboard)
- Pub/Sub message
- Scheduled (Cloud Scheduler)

**Pros:**
- Native GCP integration
- Faster builds (closer to Artifact Registry)
- Easy webhook integration

**Cons:**
- Cloud Build costs (~$0.003/build-minute)
- More GCP configuration

---

#### Option 3: Admin Dashboard Button

Add a "Deploy Latest Shared" button to the admin UI that triggers deployment.

```typescript
// Frontend: Admin dashboard
const handleDeployShared = async () => {
  if (!confirm('Deploy latest shared files to production?')) return;

  const response = await fetch('/api/admin/deploy-shared', {
    method: 'POST',
    headers: await getAuthHeaders(),
  });

  const { deploymentUrl } = await response.json();
  toast.success(`Deployment started: ${deploymentUrl}`);
};

// Backend: Trigger GitHub Actions or Cloud Build
app.post('/api/admin/deploy-shared', adminOnly, async (c) => {
  // Option A: Trigger GitHub Actions
  await fetch('https://api.github.com/repos/OWNER/REPO/actions/workflows/deploy.yml/dispatches', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });

  // Option B: Trigger Cloud Build
  // await cloudBuild.projects.triggers.run({ triggerId: 'xxx' });

  return c.json({ status: 'triggered' });
});
```

**Pros:**
- Admin controls when to deploy
- Can add confirmation/preview
- Integrated into existing workflow

**Cons:**
- Requires API tokens
- Additional backend code

---

### How Query Containers Use Baked Files

With shared files baked into the image at `/app/shared/`, the query flow becomes:

```typescript
// sharedFiles.ts - Modified for baked files
const BAKED_SHARED_DIR = '/app/shared';  // Files baked into Docker image

export async function loadSharedFilesIntoSession(
  sessionName: string,
  agentId: string
): Promise<{ loaded: number; skipped: number; errors: number }> {
  const config = getAgentConfig(agentId);

  if (config.fileLoading.sharedFiles === 'none') {
    return { loaded: 0, skipped: 0, errors: 0 };
  }

  const sessionDir = await ensureSessionDir(sessionName);
  const sharedDir = path.join(sessionDir, 'shared');

  // Check if we have baked files (production) or need to download (dev)
  const bakedPath = path.join(BAKED_SHARED_DIR, agentId);

  if (existsSync(bakedPath)) {
    // PRODUCTION: Copy from baked location (~10-50ms)
    console.log('[SHARED_FILES] Using baked shared files');
    await copyDirRecursive(bakedPath, sharedDir);
    const files = await glob('**/*', { cwd: sharedDir, nodir: true });
    return { loaded: files.length, skipped: 0, errors: 0 };
  } else {
    // DEVELOPMENT: Download from Supabase (existing code)
    console.log('[SHARED_FILES] Downloading from Supabase (dev mode)');
    return await downloadFromSupabase(sessionName, agentId);
  }
}
```

**Performance comparison:**

| Approach | First Query Latency | Subsequent Queries |
|----------|---------------------|-------------------|
| Download from Supabase | +2-5 sec | 0 (cached in session) |
| Cloud Storage FUSE | +0.5-2 sec | Variable (network) |
| Baked in image | +10-50 ms (local copy) | 0 (cached in session) |

---

### Deployment Schedule Considerations

| Update Frequency | Trigger Method | Notes |
|------------------|----------------|-------|
| Daily (fixed time) | Scheduled (6am) | Simple, predictable |
| After admin session | Manual button | Admin controls timing |
| On-demand | Manual trigger | For urgent updates |
| Continuous | On Supabase webhook | Complex, may be overkill |

**Recommended:** Start with **scheduled daily deploys** (6am before users wake up) + **manual trigger** for urgent updates.

---

### Cost Analysis

| Component | Cost |
|-----------|------|
| GitHub Actions | Free (public repo) or 2000 min/mo (private) |
| Cloud Build | ~$0.003/build-min × 10 min = $0.03/build |
| Cloud Run deploy | Free (just revision swap) |
| **Total per deploy** | **~$0.03** |
| **Daily deploys (30/mo)** | **~$1/month** |

Compared to:
- Cloud Storage FUSE: Free but high latency
- Filestore NFS: $150-300/month
- Redis + warmup: $50+/month

**Baking into image is the cheapest AND fastest option.**

---

### Migration Path

1. **Phase 1:** Add baked files to Dockerfile (backward compatible)
   - If `/app/shared/{agentId}` exists, use it
   - Otherwise, fall back to Supabase download

2. **Phase 2:** Set up GitHub Actions workflow
   - Manual trigger first
   - Test in staging

3. **Phase 3:** Add scheduled trigger
   - Daily deploys at 6am

4. **Phase 4:** Add admin dashboard button
   - For on-demand deploys after updates

---

## Related Documents

- `thoughts/shared/plans/2025-12-22-multi-agent-filesystem-configuration.md` - Original warmup implementation plan
- `thoughts/shared/handoffs/general/2025-12-22_13-08-42_multi-agent-filesystem-phase4.md` - Phase 4 warmup implementation
- `DEPLOYMENT-GUIDE.md` - Cloud Run deployment configuration
