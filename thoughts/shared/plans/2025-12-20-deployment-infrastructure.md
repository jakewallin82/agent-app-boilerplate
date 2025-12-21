# Deployment Infrastructure Implementation Plan

## Overview

Deploy the agent-app-boilerplate to production with:
- **Frontend**: Vercel (React SPA)
- **Backend**: Google Cloud Run (Hono API + Claude Agent SDK)
- **Database/Storage**: Supabase (already configured)

This plan covers infrastructure setup, deployment automation, testing, and monitoring.

## Current State Analysis

**What's Done (Phase 1):**
- Monorepo structure with `apps/web` and `apps/server`
- Hono backend with Claude Agent SDK integration
- Supabase auth, database, and file storage
- Health check endpoint at `/health`
- SSE streaming for agent responses
- Local development working with `pnpm dev`

**What's Missing:**
- Dockerfile for containerization
- Cloud Run deployment configuration
- Vercel configuration for frontend
- CI/CD pipeline (GitHub Actions)
- Environment/secrets management
- Monitoring and error tracking

## Desired End State

After this plan is complete:

1. `main` branch pushes trigger automatic deployments
2. Frontend accessible at `https://your-app.vercel.app`
3. Backend accessible at `https://your-app-xxxxx-uc.a.run.app`
4. Environment variables securely managed via platform secrets
5. Basic monitoring and error tracking in place
6. Manual deployment scripts available for ad-hoc deployments

### Verification Criteria

- [ ] `curl https://your-backend.run.app/health` returns `{"status":"ok"}`
- [ ] Frontend loads and shows login page
- [ ] Sign up creates user in Supabase
- [ ] Chat message triggers agent response with streaming
- [ ] Agent-created files persist to Supabase Storage

## What We're NOT Doing

- Custom domains (can be added later)
- Staging/production environment separation (single environment for now)
- Terraform/Infrastructure as Code (manual setup faster for MVP)
- Advanced monitoring (Datadog, custom dashboards)
- Load testing
- Auto-scaling configuration beyond defaults

---

## Phase 1: Docker Configuration

### Overview

Create production-ready Dockerfile for the Hono backend that works with Cloud Run.

### Changes Required

#### 1. Create Dockerfile

**File**: `apps/server/Dockerfile`

```dockerfile
# Build stage
FROM node:20-slim AS builder

# Install pnpm
RUN npm install -g pnpm@9

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/
COPY tsconfig.base.json ./

# Build shared package first
RUN pnpm --filter @agent-app/shared build

# Build server
RUN pnpm --filter @agent-app/server build

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

# Create data directory for agent file operations
RUN mkdir -p /app/data && chmod 755 /app/data

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start server
WORKDIR /app/apps/server
CMD ["node", "dist/index.js"]
```

#### 2. Create .dockerignore

**File**: `.dockerignore`

```
# Dependencies
node_modules/
**/node_modules/

# Build outputs (we rebuild in container)
dist/
**/dist/

# Development files
.env
.env.local
.env.*.local

# Git
.git/
.gitignore

# IDE
.vscode/
.idea/

# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# Test files
**/*.test.ts
**/*.spec.ts
coverage/

# Documentation
docs/
*.md
!agent/CLAUDE.md
thoughts/

# Frontend (not needed in backend container)
apps/web/

# Local data (should be empty in container)
data/

# Scripts (not needed in container)
scripts/
```

#### 3. Update Server Config for Production

**File**: `apps/server/src/config.ts`

Add production-ready config handling:

```typescript
import { config as loadEnv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Only load .env file in development
if (process.env.NODE_ENV !== 'production') {
  const envPath = path.resolve(__dirname, '../../../.env');
  loadEnv({ path: envPath });
}

// Validate required environment variables
const requiredVars = [
  'VITE_SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'ANTHROPIC_API_KEY',
];

const missing = requiredVars.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

export const config = {
  supabase: {
    url: process.env.VITE_SUPABASE_URL!,
    secretKey: process.env.SUPABASE_SECRET_KEY!,
    publishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
  server: {
    port: parseInt(process.env.PORT || '8080'),
    frontendUrl: process.env.FRONTEND_URL || '*',  // Allow all origins in prod initially
  },
  isProduction: process.env.NODE_ENV === 'production',
};
```

#### 4. Update Agent Route for Container Environment

**File**: `apps/server/src/routes/agent.ts`

Update data directory resolution for container:

```typescript
// At the top of the file, update DATA_DIR resolution
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../../../data');
const AGENT_DIR = process.env.AGENT_DIR || path.resolve(__dirname, '../../../../agent');
```

### Success Criteria

#### Automated Verification:
- [ ] Docker build succeeds: `docker build -f apps/server/Dockerfile -t agent-server .`
- [ ] Container starts: `docker run -p 8080:8080 --env-file .env agent-server`
- [ ] Health check passes: `curl http://localhost:8080/health`

#### Manual Verification:
- [ ] Container logs show server started successfully
- [ ] API responds to authenticated requests
- [ ] No file permission errors in logs

**Implementation Note**: Verify Docker build and local container run before proceeding to Cloud Run deployment.

---

## Phase 2: Google Cloud Run Setup

### Overview

Set up GCP project and deploy the backend container to Cloud Run.

### Prerequisites (Manual Setup)

Before running deployment commands, complete these steps in GCP Console:

1. **Create or select GCP project**
   - Go to [console.cloud.google.com](https://console.cloud.google.com)
   - Create new project or select existing
   - Note the Project ID (e.g., `agent-app-prod-123`)

2. **Enable required APIs**
   - Cloud Run API
   - Cloud Build API
   - Artifact Registry API
   - Secret Manager API

3. **Install and configure gcloud CLI**
   ```bash
   # Install (macOS)
   brew install google-cloud-sdk

   # Login
   gcloud auth login

   # Set project
   gcloud config set project YOUR_PROJECT_ID

   # Configure Docker for Artifact Registry
   gcloud auth configure-docker us-central1-docker.pkg.dev
   ```

4. **Create Artifact Registry repository**
   ```bash
   gcloud artifacts repositories create agent-app \
     --repository-format=docker \
     --location=us-central1 \
     --description="Agent app container images"
   ```

5. **Create secrets in Secret Manager**
   ```bash
   # Create secrets (you'll set values in console or via commands)
   echo -n "YOUR_SUPABASE_URL" | gcloud secrets create supabase-url --data-file=-
   echo -n "YOUR_SUPABASE_SECRET_KEY" | gcloud secrets create supabase-secret-key --data-file=-
   echo -n "YOUR_SUPABASE_PUBLISHABLE_KEY" | gcloud secrets create supabase-publishable-key --data-file=-
   echo -n "YOUR_ANTHROPIC_API_KEY" | gcloud secrets create anthropic-api-key --data-file=-
   ```

### Changes Required

#### 1. Create Deployment Script

**File**: `scripts/deploy-backend.sh`

```bash
#!/bin/bash
set -e

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project)}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="agent-app-server"
IMAGE_NAME="us-central1-docker.pkg.dev/${PROJECT_ID}/agent-app/${SERVICE_NAME}"

echo "📦 Building Docker image..."
docker build -f apps/server/Dockerfile -t "${IMAGE_NAME}:latest" .

echo "⬆️ Pushing to Artifact Registry..."
docker push "${IMAGE_NAME}:latest"

echo "🚀 Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_NAME}:latest" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 10 \
  --set-secrets "VITE_SUPABASE_URL=supabase-url:latest" \
  --set-secrets "SUPABASE_SECRET_KEY=supabase-secret-key:latest" \
  --set-secrets "VITE_SUPABASE_PUBLISHABLE_KEY=supabase-publishable-key:latest" \
  --set-secrets "ANTHROPIC_API_KEY=anthropic-api-key:latest" \
  --set-env-vars "NODE_ENV=production,FRONTEND_URL=*"

echo "✅ Deployment complete!"
echo ""
echo "Service URL:"
gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --format='value(status.url)'
```

#### 2. Create Cloud Build Configuration (Optional - for CI/CD)

**File**: `cloudbuild.yaml`

```yaml
steps:
  # Build the container image
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-f'
      - 'apps/server/Dockerfile'
      - '-t'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/agent-app/agent-app-server:$COMMIT_SHA'
      - '-t'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/agent-app/agent-app-server:latest'
      - '.'

  # Push the container image to Artifact Registry
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'push'
      - '--all-tags'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/agent-app/agent-app-server'

  # Deploy to Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'agent-app-server'
      - '--image'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/agent-app/agent-app-server:$COMMIT_SHA'
      - '--region'
      - 'us-central1'
      - '--platform'
      - 'managed'
      - '--allow-unauthenticated'
      - '--memory'
      - '2Gi'
      - '--cpu'
      - '2'
      - '--timeout'
      - '300'
      - '--min-instances'
      - '0'
      - '--max-instances'
      - '10'

# Store images in Artifact Registry
images:
  - 'us-central1-docker.pkg.dev/$PROJECT_ID/agent-app/agent-app-server:$COMMIT_SHA'
  - 'us-central1-docker.pkg.dev/$PROJECT_ID/agent-app/agent-app-server:latest'

options:
  logging: CLOUD_LOGGING_ONLY
```

### Success Criteria

#### Automated Verification:
- [ ] Deployment script runs without errors: `./scripts/deploy-backend.sh`
- [ ] Cloud Run service shows "Running" status in console
- [ ] Health check passes: `curl https://YOUR_SERVICE_URL/health`

#### Manual Verification:
- [ ] Cloud Run logs show successful startup
- [ ] No secret access errors in logs
- [ ] Service URL is accessible from browser

**Implementation Note**: Get the Cloud Run service URL and save it for frontend configuration before proceeding.

---

## Phase 3: Vercel Frontend Deployment

### Overview

Deploy the React frontend to Vercel with API proxy to Cloud Run backend.

### Prerequisites (Manual Setup)

1. **Create Vercel account** at [vercel.com](https://vercel.com)

2. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   vercel login
   ```

3. **Get Cloud Run backend URL** from Phase 2

### Changes Required

#### 1. Create Vercel Configuration

**File**: `apps/web/vercel.json`

```json
{
  "buildCommand": "cd ../.. && pnpm install && pnpm --filter @agent-app/shared build && pnpm --filter @agent-app/web build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "${BACKEND_URL}/api/:path*"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-XSS-Protection",
          "value": "1; mode=block"
        }
      ]
    }
  ]
}
```

#### 2. Create Frontend Deployment Script

**File**: `scripts/deploy-frontend.sh`

```bash
#!/bin/bash
set -e

# Ensure we're in the right directory
cd "$(dirname "$0")/.."

echo "🔍 Checking environment..."
if [ -z "$BACKEND_URL" ]; then
  echo "❌ BACKEND_URL environment variable is required"
  echo "   Set it to your Cloud Run service URL"
  echo "   Example: export BACKEND_URL=https://agent-app-server-xxxxx-uc.a.run.app"
  exit 1
fi

echo "📦 Building frontend..."
pnpm --filter @agent-app/shared build
pnpm --filter @agent-app/web build

echo "🚀 Deploying to Vercel..."
cd apps/web

# Deploy with environment variables
vercel deploy --prod \
  --env VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
  --env VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
  --build-env BACKEND_URL="$BACKEND_URL"

echo "✅ Frontend deployment complete!"
```

#### 3. Update Vite Config for Production

**File**: `apps/web/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Production optimizations
    minify: 'terser',
    sourcemap: mode !== 'production',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
}));
```

#### 4. Add Environment Variable Validation

**File**: `apps/web/src/lib/supabase.ts`

Update to handle missing env vars gracefully:

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl) {
  throw new Error('Missing VITE_SUPABASE_URL environment variable');
}

if (!supabasePublishableKey) {
  throw new Error('Missing VITE_SUPABASE_PUBLISHABLE_KEY environment variable');
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
```

### Vercel Project Setup (Manual Steps)

After initial deployment:

1. **Link to Git repository** (optional but recommended)
   - Go to Vercel dashboard → Import Project
   - Connect GitHub/GitLab repository
   - Set root directory to `apps/web`

2. **Configure environment variables in Vercel dashboard**
   - `VITE_SUPABASE_URL` - Your Supabase project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` - Supabase anon/public key
   - `BACKEND_URL` - Cloud Run service URL (for rewrites)

3. **Configure build settings**
   - Build Command: `cd ../.. && pnpm install && pnpm --filter @agent-app/shared build && pnpm --filter @agent-app/web build`
   - Output Directory: `dist`
   - Install Command: (leave empty, handled in build command)

### Success Criteria

#### Automated Verification:
- [ ] Build succeeds locally: `pnpm --filter @agent-app/web build`
- [ ] Vercel deployment completes without errors
- [ ] Frontend accessible at Vercel URL

#### Manual Verification:
- [ ] Login page loads correctly
- [ ] Supabase auth works (can sign up/sign in)
- [ ] API proxy works (chat messages reach backend)
- [ ] SSE streaming works for agent responses

**Implementation Note**: After verifying frontend works, update Cloud Run FRONTEND_URL to the Vercel domain for CORS.

---

## Phase 4: Update CORS and Final Integration

### Overview

Update backend CORS configuration to allow the production frontend domain.

### Changes Required

#### 1. Update Cloud Run Environment Variable

```bash
# Get your Vercel frontend URL
FRONTEND_URL="https://your-app.vercel.app"

# Update Cloud Run service
gcloud run services update agent-app-server \
  --region us-central1 \
  --set-env-vars "FRONTEND_URL=${FRONTEND_URL}"
```

#### 2. Update Supabase Auth Redirect URLs

In Supabase Dashboard → Authentication → URL Configuration:

1. **Site URL**: Set to your Vercel frontend URL
2. **Redirect URLs**: Add your Vercel domain
   - `https://your-app.vercel.app/*`
   - `https://your-app.vercel.app`

#### 3. Verify End-to-End Flow

```bash
# Test the full flow
echo "1. Health check..."
curl https://YOUR_CLOUD_RUN_URL/health

echo "2. Frontend loads..."
curl -I https://your-app.vercel.app

echo "3. API proxy works..."
curl -I https://your-app.vercel.app/api/health
```

### Success Criteria

#### Manual Verification:
- [ ] Can sign up new user from production frontend
- [ ] Can sign in with created user
- [ ] Can send chat message and receive streaming response
- [ ] Agent can write files that persist to Supabase Storage
- [ ] Session history persists across browser refreshes
- [ ] No CORS errors in browser console

---

## Phase 5: Monitoring and Error Tracking

### Overview

Add basic monitoring and error tracking for production visibility.

### Changes Required

#### 1. Add Structured Logging

**File**: `apps/server/src/lib/logger.ts`

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  // Cloud Run expects JSON logs on stdout
  console.log(JSON.stringify(entry));
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
};
```

#### 2. Add Request Logging Middleware

**File**: `apps/server/src/middleware/logging.ts`

```typescript
import { createMiddleware } from 'hono/factory';
import { logger } from '../lib/logger.js';

export const requestLogger = createMiddleware(async (c, next) => {
  const start = Date.now();
  const requestId = crypto.randomUUID();

  // Add request ID to context for correlation
  c.set('requestId', requestId);

  await next();

  const duration = Date.now() - start;

  logger.info('request', {
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration,
    userAgent: c.req.header('user-agent'),
  });
});
```

#### 3. Add Error Handling Middleware

**File**: `apps/server/src/middleware/errorHandler.ts`

```typescript
import { createMiddleware } from 'hono/factory';
import { logger } from '../lib/logger.js';

export const errorHandler = createMiddleware(async (c, next) => {
  try {
    await next();
  } catch (error) {
    const requestId = c.get('requestId') || 'unknown';

    logger.error('unhandled_error', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      path: c.req.path,
      method: c.req.method,
    });

    return c.json(
      {
        error: 'Internal server error',
        requestId,
      },
      500
    );
  }
});
```

#### 4. Update Server Index to Use New Middleware

**File**: `apps/server/src/index.ts`

```typescript
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config.js';
import { requestLogger } from './middleware/logging.js';
import { errorHandler } from './middleware/errorHandler.js';
import { agentRouter } from './routes/agent.js';
import { authRouter } from './routes/auth.js';
import { sessionsRouter } from './routes/sessions.js';
import { filesRouter } from './routes/files.js';
import { logger } from './lib/logger.js';

const app = new Hono();

// Global middleware
app.use('*', errorHandler);
app.use('*', requestLogger);
app.use('*', cors({
  origin: config.server.frontendUrl,
  credentials: true,
}));

// Health check (no auth required)
app.get('/health', (c) => c.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: process.env.npm_package_version || 'unknown',
}));

// Routes
app.route('/api/agent', agentRouter);
app.route('/api/auth', authRouter);
app.route('/api/sessions', sessionsRouter);
app.route('/api/files', filesRouter);

const port = config.server.port;

logger.info('server_start', { port, env: process.env.NODE_ENV });

serve({ fetch: app.fetch, port });
```

#### 5. Set Up Cloud Run Alerts (Manual)

In GCP Console → Cloud Monitoring → Alerting:

1. **Create alert policy for error rate**
   - Condition: Cloud Run error count > 10 per minute
   - Notification: Email

2. **Create alert policy for latency**
   - Condition: Cloud Run request latency (p95) > 5s
   - Notification: Email

3. **Create alert policy for instance count**
   - Condition: Cloud Run instance count reaches max
   - Notification: Email

### Success Criteria

#### Automated Verification:
- [ ] Server starts with structured JSON logs
- [ ] Logs appear in Cloud Run logs explorer
- [ ] Error logs include stack traces

#### Manual Verification:
- [ ] Can view logs in GCP Console → Cloud Run → Logs
- [ ] Request logs show duration, status, path
- [ ] Errors are captured with request IDs
- [ ] Alert policies are configured

---

## Phase 6: GitHub Actions CI/CD (Optional)

### Overview

Set up automated deployment on push to main branch.

### Changes Required

#### 1. Create GitHub Actions Workflow

**File**: `.github/workflows/deploy.yml`

```yaml
name: Deploy

on:
  push:
    branches:
      - main
  workflow_dispatch:

env:
  GCP_PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  GCP_REGION: us-central1
  SERVICE_NAME: agent-app-server

jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker
        run: gcloud auth configure-docker us-central1-docker.pkg.dev

      - name: Build and Push Docker image
        run: |
          IMAGE=us-central1-docker.pkg.dev/${{ env.GCP_PROJECT_ID }}/agent-app/${{ env.SERVICE_NAME }}
          docker build -f apps/server/Dockerfile -t $IMAGE:${{ github.sha }} -t $IMAGE:latest .
          docker push --all-tags $IMAGE

      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy ${{ env.SERVICE_NAME }} \
            --image us-central1-docker.pkg.dev/${{ env.GCP_PROJECT_ID }}/agent-app/${{ env.SERVICE_NAME }}:${{ github.sha }} \
            --region ${{ env.GCP_REGION }} \
            --platform managed

  deploy-frontend:
    runs-on: ubuntu-latest
    needs: deploy-backend

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Build
        run: |
          pnpm --filter @agent-app/shared build
          pnpm --filter @agent-app/web build

      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          working-directory: apps/web
          vercel-args: '--prod'
```

### GitHub Secrets Required

Set these in GitHub → Repository → Settings → Secrets:

| Secret | Description |
|--------|-------------|
| `GCP_PROJECT_ID` | Your GCP project ID |
| `WIF_PROVIDER` | Workload Identity Federation provider |
| `WIF_SERVICE_ACCOUNT` | Service account for deployments |
| `VERCEL_TOKEN` | Vercel access token |
| `VERCEL_ORG_ID` | Vercel organization ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |

### Success Criteria

#### Automated Verification:
- [ ] Push to main triggers workflow
- [ ] Backend deploys to Cloud Run
- [ ] Frontend deploys to Vercel

#### Manual Verification:
- [ ] GitHub Actions shows green checkmarks
- [ ] Deployed versions match latest commit

---

## Testing Strategy

### Pre-Deployment Testing

1. **Local Docker test**
   ```bash
   docker build -f apps/server/Dockerfile -t agent-server .
   docker run -p 8080:8080 --env-file .env agent-server
   curl http://localhost:8080/health
   ```

2. **Local frontend build test**
   ```bash
   pnpm --filter @agent-app/web build
   pnpm --filter @agent-app/web preview
   ```

### Post-Deployment Testing

1. **Backend health check**
   ```bash
   curl https://YOUR_CLOUD_RUN_URL/health
   ```

2. **Frontend accessibility**
   ```bash
   curl -I https://your-app.vercel.app
   ```

3. **End-to-end flow**
   - Sign up new user
   - Sign in
   - Send chat message
   - Verify streaming response
   - Verify file persistence

### Manual Testing Checklist

- [ ] Sign up creates user in Supabase dashboard
- [ ] Sign in redirects to chat interface
- [ ] Chat message triggers agent response
- [ ] SSE streaming shows real-time updates
- [ ] Agent tool usage visible in UI
- [ ] Files created by agent appear in Supabase Storage
- [ ] Session persists across page refreshes
- [ ] Old sessions can be resumed

---

## Rollback Procedures

### Backend Rollback

```bash
# List previous revisions
gcloud run revisions list --service agent-app-server --region us-central1

# Route traffic to previous revision
gcloud run services update-traffic agent-app-server \
  --region us-central1 \
  --to-revisions PREVIOUS_REVISION=100
```

### Frontend Rollback

```bash
# In Vercel dashboard, go to Deployments
# Click on previous deployment
# Click "Promote to Production"

# Or via CLI
vercel rollback
```

---

## Cost Considerations

### Cloud Run

- **Free tier**: 2 million requests/month, 360,000 GB-seconds
- **Beyond free tier**: ~$0.00002400 per vCPU-second, ~$0.00000250 per GiB-second
- **Minimum instances = 0**: No cost when idle
- **Recommendation**: Start with min-instances=0 for MVP

### Vercel

- **Free tier**: Hobby plan includes unlimited deployments
- **Pro tier**: $20/month for team features
- **Recommendation**: Hobby plan sufficient for MVP

### Supabase

- **Free tier**: 500MB database, 1GB file storage
- **Pro tier**: $25/month for more resources
- **Recommendation**: Free tier sufficient for MVP

### Anthropic API

- **Claude Opus 4.5**: ~$15/M input tokens, ~$75/M output tokens
- **Recommendation**: Set up billing alerts in Anthropic console

---

## Implementation Order Summary

| Phase | Focus | Prerequisites | Duration |
|-------|-------|---------------|----------|
| 1 | Docker Configuration | None | 30 min |
| 2 | Cloud Run Setup | GCP account, gcloud CLI | 1-2 hours |
| 3 | Vercel Deployment | Vercel account, Cloud Run URL | 30 min |
| 4 | CORS & Integration | Phases 2-3 complete | 15 min |
| 5 | Monitoring | Phase 2 complete | 30 min |
| 6 | CI/CD (Optional) | GitHub repo, all secrets | 1 hour |

---

## References

- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Vercel Documentation](https://vercel.com/docs)
- [Supabase Auth Configuration](https://supabase.com/docs/guides/auth)
- [Hono Framework](https://hono.dev/)
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)
