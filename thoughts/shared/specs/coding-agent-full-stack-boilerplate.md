# Coding Agent Full Stack Deployed Boilerplate (Claude Agent SDK + Supabase + React)

This document is a **step-by-step implementation plan** (and reference project layout) for a production-shaped boilerplate that lets you:

- Deploy a **simple Claude Agent SDK-based agent** with **filesystem access**
- Chat with the agent from a **React + TypeScript** frontend
- **Stream messages** to the UI (token/events)
- Persist **users + conversations** in **Supabase Postgres**
- Persist **conversation history + run artifacts** in **durable file storage** (S3 or Supabase Storage), while using local disk as scratch during execution
- Support **2–10 minute user runs** and **20–30 minute admin runs**

---

## References (provided by you)

```text
Claude Agent SDK docs:
https://platform.claude.com/docs/en/agent-sdk/overview

Excel demo (streaming pattern, FE components ideas):
https://github.com/anthropics/claude-agent-sdk-demos/tree/main/excel-demo
```

---

## Main learnings / design principles

### 1) “Supabase-direct from frontend” is great… until you need agents
Many fast “vibe-coded” apps start with:
- Frontend ↔ Supabase JS client (Auth + Postgres + Storage)
- Row Level Security (RLS) as the primary guardrail

But agent apps almost always require a backend because you need:
- **LLM provider keys** kept server-side
- **Streaming** (SSE/WebSockets) from a long-lived process
- **Filesystem** access (Claude Agents SDK workspace)
- **Long-running jobs** (minutes) + retries + robust logging
- Better control over **rate limiting**, **billing gates**, and **tool execution**

### 2) Containers > serverless for “minutes-long + filesystem” workloads
Your runtime shape (2–30 minutes) strongly favors:
- **Container services** (long-lived HTTP + disk + background tasks)
- Local disk as a **workspace** during the run
- Durable storage for transcripts/artifacts in **object storage**

### 3) Database is the index; storage is the source of truth for blobs
Use:
- Supabase Postgres for **metadata** (users, conversations, runs, references to artifacts)
- Object storage (S3 or Supabase Storage) for **durable files**
- Local disk for **scratch** during an active run

### 4) Streaming should be event-driven (not “stream from DB”)
Do not write each token as a DB row unless you must.
Better:
- Worker emits events → API streams events to client
- Persist events in **coarser chunks** (e.g., 250–500ms batches) for replay
- Make streams **resumable** via a monotonic `seq`

### 5) Start with a POC that is “production-shaped”
Even as a solo dev, you can keep things simple *without* painting yourself into a corner:
- Single API service for POC
- Clear separation between “API” and “Runner” responsibilities even if they run in one process
- Data model that supports later queues/workers

---

## Target architecture

### Phase A — POC (single service + local disk + optional archive)
- **Web**: React + TypeScript (Vite or Next.js)
- **API**: FastAPI (HTTP + streaming)
- **Supabase**: Auth + Postgres (+ optional Storage)
- **Filesystem**:
  - Local disk: per-run workspace under `/workspaces/...`
  - Optional archive to object storage

### Phase B — Scale (API + Runner split, queue, autoscaling)
- **API / Stream Gateway**:
  - AuthZ checks, billing gates, conversation CRUD
  - Creates `run` records and enqueues work
  - Streams events (SSE or WS) to clients
- **Runner / Worker**:
  - Executes Claude Agent SDK runs in isolated workspace
  - Writes transcripts/artifacts to disk
  - Publishes events (token/tool/log)
  - Archives to object storage

---

## Example monorepo layout

```text
agent-boilerplate/
  apps/
    web/                      # React + TypeScript UI
      src/
        components/
          Chat/
          ConversationList/
          Auth/
        pages/
        lib/
          apiClient.ts
          supabaseClient.ts
        styles/
      vite.config.ts (or next.config.js)
      package.json

    api/                      # FastAPI backend + runner
      app/
        main.py               # FastAPI app
        auth.py               # Supabase JWT verification
        db.py                 # Supabase/Postgres access (async)
        models.py             # Pydantic + DB models
        routes/
          conversations.py
          runs.py
          billing.py
          health.py
        streaming/
          sse.py
          websocket.py
          events.py           # event store helpers
        runner/
          agent_runner.py     # Claude Agent SDK integration
          workspace.py        # filesystem workspace management
          archive.py          # upload transcript/artifacts to storage
      requirements.txt
      Dockerfile

  packages/
    shared/
      src/
        types.ts              # shared types
        schemas.ts            # zod/pydantic mirrored schemas

  infra/
    deploy/
      render.yaml (or fly.toml / cloudrun scripts)
    docker/
      docker-compose.dev.yml  # local dev (optional)

  README.md
  .env.example
```

---

## Supabase setup (step-by-step)

### 1) Create project + enable Auth
- Create a Supabase project
- Enable email/password auth (or magic links / OAuth)
- Configure redirect URLs for local dev + prod

### 2) Create tables

#### `conversations`
- `id (uuid pk)`
- `user_id (uuid fk -> auth.users.id)`
- `title (text)`
- `created_at (timestamptz)`
- `updated_at (timestamptz)`

#### `agent_runs`
- `id (uuid pk)`
- `conversation_id (uuid fk)`
- `user_id (uuid fk)`
- `status (text)` → `queued | running | succeeded | failed | canceled`
- `started_at (timestamptz)`
- `ended_at (timestamptz)`
- `workspace_path (text)` → local path used during the run
- `transcript_object_key (text nullable)` → pointer in object storage
- `model_config (jsonb nullable)`
- `error (text nullable)`

#### `run_events` (for resumable streaming + replay)
- `id (bigint pk)` or `uuid`
- `run_id (uuid fk)`
- `seq (bigint)` monotonic per run
- `type (text)` → `token | tool_start | tool_end | log | final | error | state`
- `payload (jsonb)`
- `created_at (timestamptz)`

#### Optional: `subscriptions` (Stripe gating)
- `user_id (uuid pk)`
- `stripe_customer_id (text)`
- `stripe_subscription_id (text)`
- `plan (text)`
- `status (text)`
- `current_period_end (timestamptz)`

### 3) Enable Row Level Security (RLS)
Enable RLS on all app tables and create policies:

- Read/write must satisfy `user_id = auth.uid()`
- Admin tables (if any) should be locked down or separated

> Tip: Even if you don’t let the client write these tables directly, RLS is still valuable defense-in-depth.

---

## Filesystem + storage plan

### Workspace layout (on backend disk)
For each run:
```text
/workspaces/{user_id}/{conversation_id}/{run_id}/
  meta.json
  transcript.jsonl
  artifacts/
    ...
  scratch/
    ...
```

- **Local disk** is used for tool execution + agent working directory.
- **transcript.jsonl**: each streamed event appended as one JSON line.
- **artifacts/**: any files produced by the agent.

### Durable storage
Pick one:
- **Supabase Storage** (simple, integrated)
- **S3-compatible** (AWS S3, Cloudflare R2, GCS via interop, etc.)

Recommended pattern:
- Write locally during run
- On completion (or periodically), upload:
  - `transcript.jsonl`
  - `artifacts/` (or a zipped tarball)
- Store object keys in `agent_runs.transcript_object_key` + optional artifact table

---

## API design (FastAPI)

### Auth model
- Web app uses Supabase Auth → obtains JWT
- API verifies JWT on each request
- API derives `user_id` from the JWT (never trust client-provided IDs)

### Endpoints

#### Conversations
- `POST /v1/conversations`
  - Creates a conversation row
- `GET /v1/conversations`
  - Lists conversations for the current user
- `GET /v1/conversations/{id}`
  - Returns metadata + most recent runs

#### Runs
- `POST /v1/conversations/{id}/runs`
  - Body: `{ "input": "...", "options": {...} }`
  - Creates run row, allocates workspace, starts runner
  - Returns `{ run_id }`

#### Streaming (choose one)

**Option A: WebSocket**
- `WS /v1/runs/{run_id}/ws`
  - Server emits events: `{ seq, type, payload }`

**Option B: SSE**
- `GET /v1/runs/{run_id}/events`
  - `text/event-stream` with `id: {seq}` and `data: {json}`

#### Replay (for reconnects / history)
- `GET /v1/runs/{run_id}/events?after_seq=123`
- `GET /v1/runs/{run_id}/transcript`
  - returns parsed transcript or a signed URL to storage

---

## Runner implementation (Claude Agent SDK)

### Goals
- Execute the agent in a dedicated workspace directory
- Stream events to the client in real time
- Persist a replayable transcript for “read old agent output” tasks

### Implementation outline
1) Create workspace
2) Initialize Agent SDK session
3) Begin streaming query (user input)
4) For each streamed event:
   - append to `transcript.jsonl`
   - publish to the stream channel (WS/SSE)
5) On completion:
   - mark run `succeeded` or `failed`
   - archive workspace to object storage
   - update DB pointers

### Event schema (suggested)
All messages sent to the FE should follow one shape:

```json
{
  "seq": 42,
  "type": "token",
  "payload": {
    "text": "partial output..."
  }
}
```

Common `type` values:
- `token` (streamed output)
- `tool_start` / `tool_end`
- `log` (structured logging for UI)
- `state` (queued/running)
- `final` (final output, usage stats)
- `error`

---

## Frontend (React + TS) plan

### Screens/components
- **Auth**:
  - Sign in / sign up
- **Conversation List**:
  - List conversations + last updated
  - New conversation
- **Chat**:
  - Messages panel
  - Input box + send button
  - Streaming output area
  - Status indicators (running, tool usage, error)
- **History / Replay**:
  - Load past runs and show transcript
  - “Resume” / “Continue” action

### Data flow
1) User logs in (Supabase Auth)
2) Web calls API with bearer token
3) Web creates/opens a conversation
4) Web starts a run
5) Web opens stream (WS or SSE) and renders events as they arrive
6) Web can reopen stream and replay from `after_seq` if disconnected

### Streaming UX behaviors (recommended)
- Show partial assistant message as tokens arrive
- Render tool events as expandable “cards” (start/end + output)
- Allow interrupt/cancel (optional)
- Persist the final run output and show “View transcript”

---

## Deployment plan (step-by-step)

### Phase A: local development
1) Create Supabase project
2) Set `.env` for:
   - Supabase URL + anon key (frontend)
   - Supabase URL + service key (backend, **server-only**)
   - Anthropic API key (backend, **server-only**)
   - Storage credentials (if using S3)
3) Run:
   - `apps/web` dev server
   - `apps/api` FastAPI server

### Phase B: deployed (solo-friendly, production-shaped)
1) Deploy web app (Vercel or similar)
2) Deploy API to a container host that supports:
   - long-running requests / streaming
   - enough memory/CPU for agent runs
   - **a writable filesystem** (ephemeral ok for POC; persistent volume preferred)
3) Configure:
   - environment variables (Anthropic key, Supabase service key)
   - CORS allowlist (your frontend)
   - HTTPS
4) Validate:
   - auth works end-to-end
   - streaming stays open for 10+ minutes
   - transcript persists and is replayable

### Phase C: scale upgrade (optional)
1) Split runner into a separate service
2) Add a queue
3) Add autoscaling rules
4) Add admin-only “debug agent” run path

---

## Security + reliability checklist

### Secrets & keys
- Never expose Anthropic/Stripe secrets to the client
- Use platform secret manager or encrypted env vars

### Authorization
- Verify JWT on API requests
- RLS in Supabase as defense-in-depth
- Backend should be the **authority** for:
  - runs
  - billing gates
  - tool execution
  - any cross-user data

### Isolation
- Per-run workspace directories
- No shared directories across users
- Restrict what tools can access; sanitize file paths

### Limits
- Max run time (user: 10–12 min; admin: 30–40 min)
- Max output size (avoid runaway transcripts)
- Rate limit per user (requests per minute; concurrent runs)

### Observability
- Structured logs per run id
- Save `meta.json` with timestamps + config
- Optional: store run summaries in DB

---

## Step-by-step implementation checklist (coding-agent friendly)

1) **Initialize repo**
   - Create monorepo folders
   - Add `.env.example`, `README.md`

2) **Supabase**
   - Create tables + RLS
   - Add SQL migration files (checked in)

3) **Web auth**
   - Add Supabase client in `apps/web`
   - Implement login/signup UI
   - Store session; attach bearer token to API calls

4) **API auth**
   - Implement JWT verification middleware using Supabase JWKS
   - Add `get_current_user()` dependency

5) **Conversations CRUD**
   - Implement endpoints and UI list/detail

6) **Run creation**
   - `POST /runs` creates DB record
   - Allocate workspace dir
   - Start runner task (async task or background worker)

7) **Runner skeleton**
   - Implement `AgentRunner.run(run_id, user_input)`
   - Write transcript.jsonl lines
   - Emit streaming events

8) **Streaming**
   - Add SSE or WS endpoint
   - Frontend connects and renders events

9) **History/replay**
   - Implement transcript retrieval
   - UI loads past runs and renders saved transcript

10) **Storage archive (optional but recommended)**
   - Upload transcript/artifacts to object storage
   - Store object keys in DB

11) **Billing gates (optional)**
   - Add Stripe checkout + webhooks
   - Gate run creation based on subscription state

12) **Deploy**
   - Deploy web
   - Deploy API container with writable disk
   - Verify streaming + long runs

---

## Appendix: recommended defaults

### For POC
- SSE for streaming (simpler than WS)
- Single FastAPI service (API + runner in one)
- Local disk for workspaces + transcript
- Optional “archive on completion” to storage

### For production
- Split API and runner
- Add queue + concurrency controls
- Store event stream in DB for replay
- Always archive transcript/artifacts to storage

---

## What “done” looks like

✅ User can sign in  
✅ User can create/select a conversation  
✅ User sends a message and starts a run  
✅ UI streams agent output live  
✅ Run writes transcript + artifacts to filesystem  
✅ Run is indexed in Supabase (user → conversations → runs)  
✅ Past runs can be replayed and “old agent output” can be read  
✅ (Optional) artifacts are archived to S3/Supabase Storage  

---

## Notes for the coding agent implementing this boilerplate

When implementing:
- Keep everything **typed** end-to-end (shared types in `packages/shared`)
- Keep a strict separation of concerns:
  - API request handlers: auth + validation + DB
  - Runner: workspace + SDK + streaming events
- Make streaming robust:
  - monotonic seq
  - replay from `after_seq`
  - persist final transcript
