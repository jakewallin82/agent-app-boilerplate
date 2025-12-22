# Deployment Guide

This guide walks through deploying the agent-app-boilerplate to production with:
- **Frontend**: Vercel (React SPA)
- **Backend**: Google Cloud Run (Hono API + Claude Agent SDK)
- **Database/Storage**: Supabase (already configured)

## Prerequisites

### Required Accounts
- [Google Cloud Platform](https://console.cloud.google.com) account with billing enabled
- [Vercel](https://vercel.com) account
- [Supabase](https://supabase.com) project (already set up)
- [Anthropic](https://console.anthropic.com) API key

### Required Tools

**Install on macOS:**
```bash
# Google Cloud CLI
brew install google-cloud-sdk

# Vercel CLI
npm install -g vercel

# Docker Desktop
brew install --cask docker
```

**Verify installations:**
```bash
gcloud --version
vercel --version
docker --version
```

### Required Environment Variables

Ensure your `.env` file has:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
SUPABASE_SECRET_KEY=your-secret-key
ANTHROPIC_API_KEY=sk-ant-api03-...
```

---

## Phase 1: Docker Configuration

The Dockerfile and related files are already created. This phase verifies they work.

### Test Docker Build Locally

```bash
# Build the image
docker build -f apps/server/Dockerfile -t agent-server .

# Run the container (use port 8081 if 8080 is in use)
docker run -p 8081:8080 --env-file .env agent-server

# In another terminal, test health check
curl http://localhost:8081/health
# Expected: {"status":"ok","timestamp":"..."}

# Stop with Ctrl+C
```

### Files Created
- `apps/server/Dockerfile` - Multi-stage build for Node.js backend
- `.dockerignore` - Excludes node_modules, .env, frontend, etc.

---

## Phase 2: Google Cloud Run Setup

### Step 1: Configure GCP Project

**Option A: CLI**
```bash
# Login to GCP
gcloud auth login

# Set your project (create one at console.cloud.google.com if needed)
gcloud config set project YOUR_PROJECT_ID

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

**Option B: Console**
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create or select a project
3. Go to **APIs & Services** → **Enable APIs**
4. Enable: Cloud Run API, Cloud Build API, Artifact Registry API, Secret Manager API

### Step 2: Create Artifact Registry Repository

**CLI:**
```bash
gcloud artifacts repositories create agent-app \
  --repository-format=docker \
  --location=us-central1 \
  --description="Agent app container images"
```

**Console:**
1. Go to **Artifact Registry** → **Create Repository**
2. Name: `agent-app`
3. Format: Docker
4. Region: us-central1

### Step 3: Configure Docker Authentication

```bash
gcloud auth configure-docker us-central1-docker.pkg.dev
```

### Step 4: Create Secrets

**CLI:**
```bash
# Replace with your actual values
echo -n "https://your-project.supabase.co" | gcloud secrets create supabase-url --data-file=-
echo -n "your-supabase-secret-key" | gcloud secrets create supabase-secret-key --data-file=-
echo -n "your-supabase-anon-key" | gcloud secrets create supabase-publishable-key --data-file=-
echo -n "sk-ant-api03-..." | gcloud secrets create anthropic-api-key --data-file=-
```

**Console:**
1. Go to **Secret Manager** → **Create Secret**
2. Create each secret with its value:
   - `supabase-url`
   - `supabase-secret-key`
   - `supabase-publishable-key`
   - `anthropic-api-key`

### Step 5: Grant Secret Access to Cloud Run

```bash
# Get your project number
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')

# Grant access
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### Step 6: Build and Deploy

**Using the deployment script:**
```bash
./scripts/deploy-backend.sh
```

**Or manually:**
```bash
PROJECT_ID=$(gcloud config get-value project)
IMAGE_NAME="us-central1-docker.pkg.dev/${PROJECT_ID}/agent-app/agent-app-server"

# Build for amd64 (required for Cloud Run)
docker build --platform linux/amd64 -f apps/server/Dockerfile -t "${IMAGE_NAME}:latest" .

# Push to Artifact Registry
docker push "${IMAGE_NAME}:latest"

# Deploy to Cloud Run
gcloud run deploy agent-app-server \
  --image "${IMAGE_NAME}:latest" \
  --region us-central1 \
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
```

### Step 7: Verify Backend Deployment

```bash
# Get the service URL
gcloud run services describe agent-app-server --region us-central1 --format='value(status.url)'

# Test health endpoint
curl https://YOUR_CLOUD_RUN_URL/health
# Expected: {"status":"ok","timestamp":"..."}
```

**Save your Cloud Run URL** - you'll need it for the frontend configuration.

---

## Phase 3: Vercel Frontend Deployment

### Step 1: Update Backend URL in vercel.json

Edit `vercel.json` and replace the backend URL in the rewrites section:
```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://YOUR_CLOUD_RUN_URL/api/:path*"
    }
  ]
}
```

### Step 2: Login to Vercel

```bash
vercel login
```

### Step 3: Deploy

**Option A: CLI (Recommended)**
```bash
# From project root
vercel --prod --yes \
  -e VITE_SUPABASE_URL=https://your-project.supabase.co \
  -e VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
```

**Option B: Connect GitHub for Auto-Deploy**
1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your GitHub repository
3. Configure:
   - **Root Directory**: Leave empty (monorepo root)
   - **Build Command**: Auto-detected from vercel.json
   - **Output Directory**: Auto-detected from vercel.json
4. Add Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
5. Deploy

### Step 4: Verify Frontend Deployment

```bash
curl -I https://YOUR_VERCEL_URL
# Expected: HTTP/2 200
```

---

## Phase 4: Final Configuration

### Update Supabase Auth URLs

1. Go to **Supabase Dashboard** → Your Project
2. Navigate to **Authentication** → **URL Configuration**
3. Set **Site URL**:
   ```
   https://your-app.vercel.app
   ```
4. Add to **Redirect URLs**:
   ```
   https://your-app.vercel.app/*
   https://your-app.vercel.app
   ```

### Update Cloud Run CORS (Optional)

If you want to restrict CORS to your specific frontend domain:

```bash
gcloud run services update agent-app-server \
  --region us-central1 \
  --set-env-vars "FRONTEND_URL=https://your-app.vercel.app"
```

---

## Verification Checklist

- [ ] Backend health check returns 200: `curl https://YOUR_CLOUD_RUN_URL/health`
- [ ] Frontend loads at your Vercel URL
- [ ] Can sign up / sign in
- [ ] Can create a new session
- [ ] Can send messages and receive streaming responses
- [ ] Files created by agent appear in file explorer
- [ ] Sessions persist across page refreshes

---

## Redeployment

### Backend (Cloud Run)

```bash
./scripts/deploy-backend.sh
```

Or trigger from GCP Console → Cloud Run → agent-app-server → Edit & Deploy New Revision

### Frontend (Vercel)

**If connected to GitHub:**
```bash
git push origin main  # Auto-deploys
```

**Manual:**
```bash
vercel --prod
```

---

## Rollback

### Backend

```bash
# List revisions
gcloud run revisions list --service agent-app-server --region us-central1

# Route traffic to previous revision
gcloud run services update-traffic agent-app-server \
  --region us-central1 \
  --to-revisions PREVIOUS_REVISION_NAME=100
```

### Frontend

```bash
vercel rollback
```

Or in Vercel Dashboard → Deployments → Click previous deployment → Promote to Production

---

## Cost Estimates

| Service | Free Tier | Beyond Free Tier |
|---------|-----------|------------------|
| Cloud Run | 2M requests/month, 360k GB-seconds | ~$0.00002400/vCPU-sec |
| Vercel | Unlimited deploys (Hobby) | $20/month (Pro) |
| Supabase | 500MB DB, 1GB storage | $25/month (Pro) |
| Anthropic | N/A | ~$15/M input, $75/M output tokens |

**Tip**: Set `--min-instances 0` on Cloud Run to avoid charges when idle.

---

## Troubleshooting

### Docker build fails
- Ensure Docker Desktop is running
- Check `.dockerignore` isn't excluding required files

### Cloud Run deployment fails with "permission denied on secret"
```bash
# Re-grant secret access
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### Cloud Run fails with "must support amd64/linux"
- Rebuild with `--platform linux/amd64` flag (required on Apple Silicon)

### Vercel build fails with "npm install" error
- Ensure `vercel.json` has correct `installCommand` for pnpm monorepo

### CORS errors in browser
- Check `FRONTEND_URL` env var in Cloud Run
- Verify the URL matches exactly (including https://)

### Auth redirects to wrong URL
- Update Supabase URL Configuration with production URLs
