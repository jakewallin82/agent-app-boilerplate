# Kubernetes Alternatives to Cloud Run (gcloud)

> Research conducted 2025-12-19 for agent-app-boilerplate deployment options

## Context

The current spec uses `gcloud` CLI to deploy to Cloud Run. This document explores Kubernetes alternatives for users who prefer or require K8s deployments.

---

## Current Plan: Cloud Run

The spec uses `gcloud` CLI to deploy to Cloud Run:

```bash
gcloud run deploy agent-app-server \
  --image gcr.io/$PROJECT_ID/agent-app-server:$COMMIT_SHA \
  --region us-central1 \
  --allow-unauthenticated
```

**Simplicity Rating: 10/10** - One command, zero infrastructure management.

---

## Option 1: GKE (Google Kubernetes Engine)

Since the project is on GCP already, this is the most natural Kubernetes alternative.

### What Changes in the Setup

**Replace** `cloudbuild.yaml` with Kubernetes manifests:

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-app-server
spec:
  replicas: 2
  selector:
    matchLabels:
      app: agent-app-server
  template:
    metadata:
      labels:
        app: agent-app-server
    spec:
      containers:
      - name: server
        image: gcr.io/PROJECT_ID/agent-app-server:TAG
        ports:
        - containerPort: 8080
        env:
        - name: ANTHROPIC_API_KEY
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: anthropic-api-key
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
---
apiVersion: v1
kind: Service
metadata:
  name: agent-app-server
spec:
  type: LoadBalancer  # or use Ingress
  ports:
  - port: 80
    targetPort: 8080
  selector:
    app: agent-app-server
```

### Deployment Commands

```bash
# One-time cluster setup
gcloud container clusters create agent-cluster \
  --num-nodes=2 --machine-type=e2-medium --region=us-central1

# Deploy
kubectl apply -f k8s/
```

### Tradeoffs

| Aspect | GKE | Cloud Run |
|--------|-----|-----------|
| **Simplicity** | 5/10 - Need manifests, secrets, ingress | 10/10 - Single command |
| **Control** | 10/10 - Full K8s power | 4/10 - Serverless constraints |
| **Cost** | Higher - always-on nodes | Lower - pay per request |
| **Stateful workloads** | Yes | No |
| **Cold starts** | None (always running) | Yes (can be mitigated) |
| **Learning curve** | Steep if new to K8s | Minimal |

---

## Option 2: Helm Charts on Any K8s Cluster

Helm packages the deployment into a reusable, versioned "chart."

### Structure

```
helm/agent-app/
├── Chart.yaml
├── values.yaml
├── values-prod.yaml
├── templates/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   └── secrets.yaml
```

### Deployment

```bash
# Install/upgrade
helm upgrade --install agent-app ./helm/agent-app \
  -f values-prod.yaml \
  --set image.tag=$COMMIT_SHA
```

### When to Use Helm

- You need **versioned releases** with easy rollback
- You're deploying to **multiple environments** (dev/staging/prod)
- You want to **distribute** your boilerplate as a package

**Simplicity Rating: 4/10** - Adds templating complexity, but great for repeatable deployments.

### Helm Pros

- With a single `helm install` command, you can deploy an entire application stack
- Charts eliminate the need to manually apply files with kubectl, reducing human error
- Use `helm rollback` to roll back to an older version of a release with ease
- Helm 4.0.0 was recently released (first major upgrade in six years)

### Helm Cons

- Helm's "templating" approach injects dynamic values into YAML files, creating abstraction that can be hard to debug
- The templating syntax can be complex for newcomers
- Over-reliance on charts for simple tasks can sometimes complicate matters

---

## Option 3: Kustomize (Built into kubectl)

Kustomize is simpler than Helm—pure YAML patching, no templating language.

### Structure

```
k8s/
├── base/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── kustomization.yaml
├── overlays/
│   ├── dev/
│   │   └── kustomization.yaml  # patches for dev
│   └── prod/
│       └── kustomization.yaml  # patches for prod
```

### Deployment

```bash
kubectl apply -k k8s/overlays/prod
```

**Simplicity Rating: 6/10** - Native to kubectl, no new tools needed.

### Kustomize Pros

- No templating, no packaging, just pure YAML manipulation
- Google developed it and merged it into kubectl in version 1.14, making it a native Kubernetes tool
- Cognitive load is O(1) — you just look at the files, no tracing values through template hierarchies

### Kustomize Cons

- No packaging or distribution mechanism means sharing configurations between teams requires manual processes
- No equivalent to Helm's chart repositories for discovering and sharing configurations
- Limited in scope compared to Helm, focusing on customization over package management

---

## How AI Coding Agents Handle Each Option

This is an important consideration for the boilerplate.

### Cloud Run (gcloud) - Excellent AI Support

- Simple, well-documented commands
- Claude/Copilot can generate `gcloud run deploy` commands easily
- Fewer moving parts = fewer mistakes

### Kubernetes (kubectl/Helm) - Good but Error-Prone

- AI agents can generate K8s YAML, but often make subtle mistakes:
  - Wrong API versions
  - Missing required fields
  - Incorrect indentation
  - Security context misconfigurations

### Emerging AI Tools for Kubernetes

- **kubectl-ai** (Google): MCP server that exposes kubectl tools to AI clients (Claude, Cursor, VS Code). Interprets natural language like "show all pods in dev namespace" into kubectl commands.
- **Kagent** (CNCF Sandbox): Open-source framework for running AI agents in Kubernetes, automating complex DevOps operations. Built on A2A protocol, ADK, and MCP.
- **K8sGPT**: Open-source tool using AI to simplify Kubernetes cluster diagnostics with automated diagnostics and natural language summaries.
- **KoPylot**: Open-source AI assistant that analyzes K8s resources to identify vulnerabilities and misconfigurations.

### Practical Reality

Kubernetes has become a "complex beast" with exponentially scaling operational complexity. AI agents are getting better at handling this, but Cloud Run remains simpler for agents to work with correctly.

---

## Recommendation for Agent-App-Boilerplate

### Stick with Cloud Run for Phase 1

The current plan is correct:

1. **Simpler for users** - Clone, deploy, done
2. **Better AI agent support** - Claude can help debug with fewer footguns
3. **Lower cost** - Pay per request, scales to zero
4. **Matches the use case** - Stateless API backend

### Add Kubernetes as Optional Phase 2

If Kubernetes support is needed later, add it as an **alternative deployment path**:

```
infra/
├── cloudrun/
│   └── cloudbuild.yaml       # Current approach (default)
└── kubernetes/
    ├── base/                  # Kustomize base
    └── overlays/
        ├── gke/              # GKE-specific patches
        └── generic/          # Any K8s cluster
```

This lets users who already have K8s clusters deploy there, while keeping Cloud Run as the simple default.

---

## Quick Comparison Table

| Factor | Cloud Run | GKE | Any K8s + Helm |
|--------|-----------|-----|----------------|
| **Setup simplicity** | ★★★★★ | ★★☆☆☆ | ★★☆☆☆ |
| **Ongoing ops** | ★★★★★ | ★★★☆☆ | ★★★☆☆ |
| **AI agent friendliness** | ★★★★★ | ★★★☆☆ | ★★★☆☆ |
| **Control/flexibility** | ★★☆☆☆ | ★★★★★ | ★★★★★ |
| **Portability** | ★★☆☆☆ | ★★★★☆ | ★★★★★ |
| **Cost (low traffic)** | ★★★★★ | ★★☆☆☆ | ★★☆☆☆ |
| **Stateful support** | ☆☆☆☆☆ | ★★★★★ | ★★★★★ |

---

## Other Alternatives Considered

### Managed Container Platforms

- **Amazon ECS**: Fully managed PaaS for deploying containers on AWS. Can use EC2 or Fargate serverless compute.
- **Azure Container Instances**: Quick, on-demand container execution without Kubernetes. Ideal for burst workloads.
- **Northflank**: Production workload platform on managed K8s infrastructure. Supports "Bring Your Own Cloud."

### Lightweight Orchestration

- **Docker Swarm**: Simple setup, native Docker integration, built-in service discovery. Best for small to medium orgs prioritizing simplicity.
- **HashiCorp Nomad**: Lightweight scheduler for containers, VMs, and non-containerized apps. Fits well with HashiCorp tooling.

### Enterprise Platforms

- **Red Hat OpenShift**: Hybrid platform blending RHEL and Kubernetes with Docker-based containers.
- **Rancher**: Enterprise-grade platform for running containerized workloads, delivers Kubernetes as a service.

---

## Sources

- [When to use GKE vs. Cloud Run for containers](https://cloud.google.com/blog/products/containers-kubernetes/when-to-use-google-kubernetes-engine-vs-cloud-run-for-containers)
- [Cloud Run vs GKE Comparison - Happtiq](https://www.happtiq.com/blog/cloud-run-vs-gke)
- [Best Google Cloud Run alternatives in 2025 - Northflank](https://northflank.com/blog/best-google-cloud-run-alternatives-in-2025)
- [kubectl-ai - AI powered Kubernetes Assistant](https://github.com/GoogleCloudPlatform/kubectl-ai)
- [Kagent - AI Agents for Kubernetes](https://kagent.dev/)
- [AI Agents for Kubernetes: Getting Started with Kagent - InfraCloud](https://www.infracloud.io/blogs/ai-agents-for-kubernetes/)
- [Helm vs Kustomize Guide 2025 - VegaStack](https://vegastack.com/blog/helm-vs-kustomize-complete-kubernetes-application-management-comparison-2025/)
- [7 Helm alternatives - Northflank](https://northflank.com/blog/7-helm-alternatives-to-simplify-kubernetes-deployments)
- [GKE and Cloud Run - Google Cloud Docs](https://cloud.google.com/kubernetes-engine/docs/concepts/gke-and-cloud-run)
- [10 Best Kubernetes Alternatives In 2025 - CloudZero](https://www.cloudzero.com/blog/kubernetes-alternatives/)
- [Top 13 Kubernetes Alternatives - Spacelift](https://spacelift.io/blog/kubernetes-alternatives)
