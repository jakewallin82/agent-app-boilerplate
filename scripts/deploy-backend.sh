#!/bin/bash
set -e

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project)}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="agent-app-server"
IMAGE_NAME="us-central1-docker.pkg.dev/${PROJECT_ID}/agent-app/${SERVICE_NAME}"

echo "📦 Building Docker image (linux/amd64 for Cloud Run)..."
docker build --platform linux/amd64 -f apps/server/Dockerfile -t "${IMAGE_NAME}:latest" .

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
