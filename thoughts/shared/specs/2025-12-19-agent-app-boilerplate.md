# Agent App Boilerplate Implementation Plan

## Overview

Build a reusable boilerplate for deploying AI agent-powered web applications using the Claude Agent SDK. The boilerplate enables rapid development: clone, customize the agent, and deploy. Includes the sports prediction agent as a working example.

## Current State Analysis

**Existing Reference**: `claude-sports-app/` Electron app demonstrates:
- Claude Agent SDK integration with streaming responses
- Subagent loading from `.claude/agents/` with YAML frontmatter
- Session persistence for multi-turn conversations
- Skills for external API integration (`fetch-odds`, `fetch-play-by-play`)
- React components for chat interface, subagent visualization

## Desired End State

A monorepo boilerplate that provides:

1. **React SPA** (Vite + TypeScript) - dark mode only
2. **Hono Backend** with Claude Agent SDK
3. **Supabase** for auth, database, and persistent file storage
4. **Easy local development** with real Supabase connection
5. **Simple deployment** to Vercel (frontend) + Cloud Run (backend)
6. **Sports prediction agent** as working example

### Phase 1 Success Criteria

**The full stack works locally:**
- [ ] `pnpm dev` starts frontend (port 3000) and backend (port 8080)
- [ ] User can sign up/sign in via Supabase Auth
- [ ] User can send a message and receive streaming agent response
- [ ] Agent subagent spawning is visible in UI
- [ ] Chat sessions persist to Supabase database
- [ ] Agent output files persist to Supabase Storage

## What We're NOT Doing (v1)

- Stripe billing (future phase)
- Meta-agents for building/deploying (`/deploy`, `/new-agent`, `/new-instance`)
- Dark mode toggle (dark mode only)
- Mobile app
- Real-time collaborative agents
- Complex RBAC
- Agent cost controls
- Context overflow handling

## Tech Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Frontend | Vite + React 18 + TypeScript | Fast dev, you know React |
| Styling | Tailwind CSS + shadcn/ui | Dark mode, accessible |
| Chat UI | @llamaindex/chat-ui | Built for LLM streaming |
| Backend | Hono + TypeScript | 50ms cold starts, native TS |
| Database | Supabase (Postgres) | Auth + DB + Storage |
| Auth | Supabase Auth | Simple, JWT-based |
| Agent Runtime | @anthropic-ai/claude-agent-sdk | Official SDK |
| Frontend Hosting | Vercel | Free tier, fast deploys |
| Backend Hosting | Google Cloud Run | Serverless containers |
| Monorepo | pnpm workspaces | Fast, disk efficient |

## Directory Structure

```
agent-app-boilerplate/
├── apps/
│   ├── web/                    # React frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── contexts/
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   └── App.tsx
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── server/                 # Hono backend
│       ├── src/
│       │   ├── routes/
│       │   ├── services/
│       │   ├── middleware/
│       │   └── index.ts
│       ├── Dockerfile
│       └── package.json
│
├── packages/
│   └── shared/                 # Shared types
│       ├── src/
│       │   └── types.ts
│       └── package.json
│
├── agent/                      # Agent workspace
│   ├── CLAUDE.md              # Main agent prompt
│   └── .claude/
│       ├── agents/            # Subagent definitions
│       ├── skills/            # Skill definitions
│       └── commands/
│
├── data/                       # Agent output (local temp)
│   ├── nfl/
│   ├── nba/
│   └── ...
│
├── infra/
│   ├── supabase/
│   │   └── migrations/
│   └── cloudbuild.yaml
│
├── .env.example
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## Manual Setup (Before Coding)

Complete these steps before running any code.

### 1. Supabase Project Setup

1. **Create project** at [supabase.com](https://supabase.com)
   - Note your project URL: `https://xxx.supabase.co` (Settings → General)
   - Go to Settings → API Keys:
     - **Publishable key** (`sb_publishable_...`) - safe for frontend
     - **Secret key** (`sb_secret_...`) - backend only, never expose

2. **Enable Email Auth**
   - Dashboard → Authentication → Providers → Email
   - Disable "Confirm email" for easier local testing (optional)

3. **Create Storage Bucket**
   - Dashboard → Storage → New Bucket
   - Name: `agent-files`
   - Public: OFF

4. **Run SQL Migrations** (Dashboard → SQL Editor → New Query):

```sql
-- Users table (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Chat sessions
create table public.sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  agent_id text not null default 'default',
  title text,
  sdk_session_id text, -- Claude SDK session ID for resume
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Chat messages (for history display)
create table public.messages (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Agent output files
create table public.agent_files (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  file_path text not null,
  storage_path text not null,
  file_type text,
  file_size integer,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.agent_files enable row level security;

-- RLS Policies
create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

create policy "Users can manage own sessions"
  on public.sessions for all using (auth.uid() = user_id);

create policy "Users can manage messages in own sessions"
  on public.messages for all using (
    session_id in (select id from public.sessions where user_id = auth.uid())
  );

create policy "Users can manage own files"
  on public.agent_files for all using (auth.uid() = user_id);

-- Trigger to create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Storage policies
create policy "Users can upload own files"
  on storage.objects for insert
  with check (
    bucket_id = 'agent-files' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can read own files"
  on storage.objects for select
  using (
    bucket_id = 'agent-files' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete own files"
  on storage.objects for delete
  using (
    bucket_id = 'agent-files' and
    auth.uid()::text = (storage.foldername(name))[1]
  );
```

### 2. Anthropic API Key

1. Get API key from [console.anthropic.com](https://console.anthropic.com)
2. Note it for `.env` file

### 3. Google Cloud Setup (for later deployment)

1. Create GCP project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable Cloud Run API
3. Enable Container Registry API
4. Install `gcloud` CLI: `brew install google-cloud-sdk`
5. Authenticate: `gcloud auth login`

### 4. Vercel Setup (for later deployment)

1. Create account at [vercel.com](https://vercel.com)
2. Install CLI: `npm install -g vercel`
3. Authenticate: `vercel login`

### 5. Environment Variables

Create `.env` file in project root:

```bash
# Supabase (get from Settings → API Keys)
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...  # Safe for frontend
SUPABASE_SECRET_KEY=sb_secret_...  # Backend only, never expose

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Server
PORT=8080
FRONTEND_URL=http://localhost:3000

# GCP (for deployment)
GCP_PROJECT_ID=your-project-id
```

---

## Phase 1: Full Stack Local Development

### Overview

Build everything needed to run the full stack locally with real Supabase. This is one continuous phase - all pieces need to work together.

### 1.1 Monorepo Scaffold

**File**: `package.json`
```json
{
  "name": "agent-app-boilerplate",
  "private": true,
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

**File**: `pnpm-workspace.yaml`
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**File**: `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**File**: `.gitignore`
```
node_modules/
dist/
.env
.env.local
data/
*.log
.DS_Store
```

### 1.2 Shared Package

**File**: `packages/shared/package.json`
```json
{
  "name": "@agent-app/shared",
  "version": "0.0.1",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

**File**: `packages/shared/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**File**: `packages/shared/src/index.ts`
```typescript
export * from './types';
```

**File**: `packages/shared/src/types.ts`
```typescript
// Agent message types (matching SDK output)
export interface AgentMessage {
  type: 'system' | 'assistant' | 'user' | 'result';
  subtype?: 'init' | 'thinking' | 'tool_use' | 'tool_result' | 'text';
  content?: string;
  session_id?: string;
  parent_tool_use_id?: string;
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export interface ChatSession {
  id: string;
  user_id: string;
  agent_id: string;
  sdk_session_id?: string;
  title?: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface AgentFile {
  id: string;
  session_id: string;
  user_id: string;
  file_path: string;
  storage_path: string;
  file_type?: string;
  file_size?: number;
  created_at: string;
}
```

### 1.3 Backend (Hono + Claude Agent SDK)

**File**: `apps/server/package.json`
```json
{
  "name": "@agent-app/server",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.0.0",
    "@hono/node-server": "^1.8.0",
    "@anthropic-ai/claude-agent-sdk": "^0.1.73",
    "@supabase/supabase-js": "^2.39.0",
    "@agent-app/shared": "workspace:*",
    "zod": "^3.22.0",
    "dotenv": "^16.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.0"
  }
}
```

**File**: `apps/server/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**File**: `apps/server/src/index.ts`
```typescript
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { agentRouter } from './routes/agent.js';
import { authRouter } from './routes/auth.js';
import { sessionsRouter } from './routes/sessions.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes
app.route('/api/agent', agentRouter);
app.route('/api/auth', authRouter);
app.route('/api/sessions', sessionsRouter);

const port = parseInt(process.env.PORT || '8080');
console.log(`🚀 Server running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
```

**File**: `apps/server/src/lib/supabase.ts`
```typescript
import { createClient } from '@supabase/supabase-js';

if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  throw new Error('Missing Supabase environment variables');
}

// Service client for backend (bypasses RLS)
export const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// User client factory (respects RLS)
export function createUserClient(accessToken: string) {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    }
  );
}
```

**File**: `apps/server/src/middleware/auth.ts`
```typescript
import { createMiddleware } from 'hono/factory';
import { supabase } from '../lib/supabase.js';

export interface AuthUser {
  id: string;
  email: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
    accessToken: string;
  }
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing authorization header' }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    c.set('user', { id: user.id, email: user.email! });
    c.set('accessToken', token);
    await next();
  } catch (error) {
    console.error('Auth error:', error);
    return c.json({ error: 'Authentication failed' }, 401);
  }
});
```

**File**: `apps/server/src/routes/auth.ts`
```typescript
import { Hono } from 'hono';
import { supabase } from '../lib/supabase.js';
import { authMiddleware } from '../middleware/auth.js';

export const authRouter = new Hono();

// Verify token and return user
authRouter.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  return c.json({ user });
});
```

**File**: `apps/server/src/routes/sessions.ts`
```typescript
import { Hono } from 'hono';
import { supabase } from '../lib/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import type { ChatSession, ChatMessage } from '@agent-app/shared';

export const sessionsRouter = new Hono();

sessionsRouter.use('*', authMiddleware);

// List user's sessions
sessionsRouter.get('/', async (c) => {
  const user = c.get('user');

  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ sessions: data as ChatSession[] });
});

// Create new session
sessionsRouter.post('/', async (c) => {
  const user = c.get('user');
  const { agent_id = 'default', title } = await c.req.json();

  const { data, error } = await supabase
    .from('sessions')
    .insert({ user_id: user.id, agent_id, title })
    .select()
    .single();

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ session: data as ChatSession });
});

// Get session messages
sessionsRouter.get('/:id/messages', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');

  // Verify ownership
  const { data: session } = await supabase
    .from('sessions')
    .select('user_id')
    .eq('id', sessionId)
    .single();

  if (!session || session.user_id !== user.id) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ messages: data as ChatMessage[] });
});
```

**File**: `apps/server/src/routes/agent.ts`
```typescript
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../lib/supabase.js';
import { authMiddleware } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const agentRouter = new Hono();

agentRouter.use('*', authMiddleware);

const querySchema = z.object({
  content: z.string().min(1),
  sessionId: z.string().uuid(),
});

// Agent workspace directory (relative to server)
const AGENT_DIR = path.resolve(__dirname, '../../../../agent');
const DATA_DIR = path.resolve(__dirname, '../../../../data');

agentRouter.post('/query', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();

  const parseResult = querySchema.safeParse(body);
  if (!parseResult.success) {
    return c.json({ error: 'Invalid request', details: parseResult.error }, 400);
  }

  const { content, sessionId } = parseResult.data;

  // Verify session ownership
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (sessionError || !session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  // Save user message
  await supabase.from('messages').insert({
    session_id: sessionId,
    role: 'user',
    content,
  });

  return streamSSE(c, async (stream) => {
    let assistantContent = '';
    let sdkSessionId = session.sdk_session_id;

    try {
      const queryIterator = query({
        prompt: content,
        options: {
          cwd: AGENT_DIR,
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
        if (message.type === 'system' && message.subtype === 'init') {
          sdkSessionId = message.session_id;
        }

        // Accumulate assistant text content
        if (message.type === 'assistant' && message.subtype === 'text' && message.content) {
          assistantContent += message.content;
        }

        await stream.writeSSE({
          data: JSON.stringify(message),
        });
      }

      // Save assistant message
      if (assistantContent) {
        await supabase.from('messages').insert({
          session_id: sessionId,
          role: 'assistant',
          content: assistantContent,
        });
      }

      // Update session with SDK session ID for resume
      if (sdkSessionId && sdkSessionId !== session.sdk_session_id) {
        await supabase
          .from('sessions')
          .update({ sdk_session_id: sdkSessionId, updated_at: new Date().toISOString() })
          .eq('id', sessionId);
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

### 1.4 Frontend (Vite + React + Tailwind)

**File**: `apps/web/package.json`
```json
{
  "name": "@agent-app/web",
  "version": "0.0.1",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@supabase/supabase-js": "^2.39.0",
    "@agent-app/shared": "workspace:*",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.2.0",
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.32",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  }
}
```

**File**: `apps/web/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "noEmit": true
  },
  "include": ["src"]
}
```

**File**: `apps/web/vite.config.ts`
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
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
});
```

**File**: `apps/web/tailwind.config.js`
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0a',
        foreground: '#fafafa',
        card: '#18181b',
        'card-foreground': '#fafafa',
        border: '#27272a',
        input: '#27272a',
        primary: '#3b82f6',
        'primary-foreground': '#fafafa',
        secondary: '#27272a',
        'secondary-foreground': '#fafafa',
        muted: '#27272a',
        'muted-foreground': '#a1a1aa',
        accent: '#27272a',
        'accent-foreground': '#fafafa',
      },
    },
  },
  plugins: [],
};
```

**File**: `apps/web/postcss.config.js`
```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

**File**: `apps/web/index.html`
```html
<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent App</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body class="bg-background text-foreground font-mono">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**File**: `apps/web/src/index.css`
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

* {
  font-family: 'JetBrains Mono', monospace;
}

/* Custom scrollbar */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: #18181b;
}

::-webkit-scrollbar-thumb {
  background: #3f3f46;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #52525b;
}
```

**File**: `apps/web/src/main.tsx`
```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from '@/contexts/AuthContext';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
```

**File**: `apps/web/src/App.tsx`
```typescript
import { useAuth } from '@/contexts/AuthContext';
import { AuthPage } from '@/components/AuthPage';
import { ChatInterface } from '@/components/ChatInterface';

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

  return <ChatInterface />;
}
```

**File**: `apps/web/src/lib/supabase.ts`
```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
```

**File**: `apps/web/src/lib/api.ts`
```typescript
import { supabase } from './supabase';

async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session?.access_token || ''}`,
  };
}

export async function createSession(agentId = 'default'): Promise<{ id: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers,
    body: JSON.stringify({ agent_id: agentId }),
  });

  if (!res.ok) throw new Error('Failed to create session');
  const { session } = await res.json();
  return session;
}

export async function* streamAgentQuery(
  sessionId: string,
  content: string
): AsyncGenerator<any> {
  const headers = await getAuthHeaders();

  const res = await fetch('/api/agent/query', {
    method: 'POST',
    headers: {
      ...headers,
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({ sessionId, content }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) throw new Error('No response body');

  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          yield JSON.parse(data);
        } catch (e) {
          console.error('Failed to parse SSE:', e);
        }
      }
    }
  }
}
```

**File**: `apps/web/src/contexts/AuthContext.tsx`
```typescript
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

**File**: `apps/web/src/components/AuthPage.tsx`
```typescript
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await signIn(email, password);
      } else {
        await signUp(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card border border-border rounded-lg p-8">
          <h1 className="text-2xl font-semibold text-center mb-6">
            {isLogin ? 'Sign In' : 'Sign Up'}
          </h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm text-muted-foreground mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-input border border-border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm text-muted-foreground mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-input border border-border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                required
                minLength={6}
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground rounded py-2 font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? 'Loading...' : isLogin ? 'Sign In' : 'Sign Up'}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-4">
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-primary hover:underline"
            >
              {isLogin ? 'Sign Up' : 'Sign In'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
```

**File**: `apps/web/src/components/ChatInterface.tsx`
```typescript
import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createSession, streamAgentQuery } from '@/lib/api';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import type { AgentMessage } from '@agent-app/shared';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: AgentMessage[];
}

export function ChatInterface() {
  const { user, signOut } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const ensureSession = useCallback(async () => {
    if (!sessionId) {
      const session = await createSession();
      setSessionId(session.id);
      return session.id;
    }
    return sessionId;
  }, [sessionId]);

  const handleSend = async (content: string) => {
    const currentSessionId = await ensureSession();

    // Add user message
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
    };
    setMessages(prev => [...prev, userMessage]);

    // Start streaming
    setIsStreaming(true);
    let assistantContent = '';
    const toolCalls: AgentMessage[] = [];

    try {
      for await (const message of streamAgentQuery(currentSessionId, content)) {
        if (message.type === 'assistant' && message.subtype === 'text' && message.content) {
          assistantContent += message.content;
          setMessages(prev => {
            const existing = prev.find(m => m.id === 'streaming');
            if (existing) {
              return prev.map(m =>
                m.id === 'streaming' ? { ...m, content: assistantContent } : m
              );
            }
            return [...prev, { id: 'streaming', role: 'assistant', content: assistantContent }];
          });
        }

        if (message.type === 'assistant' && message.subtype === 'tool_use') {
          toolCalls.push(message);
        }
      }

      // Finalize assistant message
      if (assistantContent || toolCalls.length > 0) {
        setMessages(prev =>
          prev.map(m =>
            m.id === 'streaming'
              ? { id: crypto.randomUUID(), role: 'assistant', content: assistantContent, toolCalls }
              : m
          )
        );
      }
    } catch (error) {
      console.error('Stream error:', error);
      setMessages(prev => [
        ...prev.filter(m => m.id !== 'streaming'),
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ]);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleNewChat = () => {
    setSessionId(null);
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Agent Chat</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={handleNewChat}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            New Chat
          </button>
          <span className="text-sm text-muted-foreground">{user?.email}</span>
          <button
            onClick={signOut}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Send a message to start chatting with the agent
          </div>
        ) : (
          <MessageList messages={messages} />
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input */}
      <footer className="border-t border-border p-4">
        <MessageInput onSend={handleSend} disabled={isStreaming} />
      </footer>
    </div>
  );
}
```

**File**: `apps/web/src/components/MessageList.tsx`
```typescript
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentMessage } from '@agent-app/shared';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: AgentMessage[];
}

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[80%] rounded-lg px-4 py-3 ${
              message.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-card border border-border'
            }`}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              className="prose prose-invert prose-sm max-w-none"
            >
              {message.content}
            </ReactMarkdown>

            {/* Tool calls */}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border space-y-2">
                {message.toolCalls.map((tool, i) => (
                  <div key={i} className="text-xs">
                    <span className="text-muted-foreground">Tool: </span>
                    <span className="text-primary">{tool.tool_name}</span>
                    {tool.tool_input && (
                      <pre className="mt-1 p-2 bg-background rounded text-muted-foreground overflow-x-auto">
                        {JSON.stringify(tool.tool_input, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

**File**: `apps/web/src/components/MessageInput.tsx`
```typescript
import { useState } from 'react';

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [content, setContent] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (content.trim() && !disabled) {
      onSend(content.trim());
      setContent('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
      <div className="flex gap-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={disabled}
          rows={1}
          className="flex-1 bg-input border border-border rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !content.trim()}
          className="bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {disabled ? 'Sending...' : 'Send'}
        </button>
      </div>
    </form>
  );
}
```

### 1.5 Agent Workspace

Copy your existing sports agent or create a minimal one:

**File**: `agent/CLAUDE.md`
```markdown
# Agent

You are a helpful AI assistant. You can search the web, read files, and help users with various tasks.

## Available Tools

- **WebSearch**: Search the web for information
- **WebFetch**: Fetch content from URLs
- **Read/Write/Edit**: File operations
- **Bash**: Run shell commands
- **Task**: Spawn subagents for complex tasks

## Instructions

1. Be helpful and concise
2. Use tools when needed to gather information
3. Cite sources when using web search
```

Create the data directory:
```bash
mkdir -p data
```

### 1.6 Environment File Template

**File**: `.env.example`
```bash
# Supabase (get from Settings → API Keys)
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...

# Anthropic (get from console.anthropic.com)
ANTHROPIC_API_KEY=sk-ant-...

# Server
PORT=8080
FRONTEND_URL=http://localhost:3000
```

---

## Running Locally

### First Time Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Build shared package
pnpm --filter @agent-app/shared build

# 3. Copy and fill environment variables
cp .env.example .env
# Edit .env with your real values

# 4. Start development servers
pnpm dev
```

### Development Workflow

```bash
# Start everything (frontend + backend)
pnpm dev

# Or start individually:
pnpm --filter @agent-app/server dev    # Backend: http://localhost:8080
pnpm --filter @agent-app/web dev       # Frontend: http://localhost:3000

# Type checking
pnpm typecheck

# Build for production
pnpm build
```

---

## Phase 1 Success Criteria

### Automated Verification

```bash
# All commands should pass:
pnpm install
pnpm --filter @agent-app/shared build
pnpm typecheck
curl http://localhost:8080/health  # Should return {"status":"ok"}
```

### Manual Verification

- [ ] Frontend loads at http://localhost:3000
- [ ] Sign up form creates user in Supabase
- [ ] Sign in works with created user
- [ ] New chat session is created in `sessions` table
- [ ] Sending message shows streaming response
- [ ] Messages are saved to `messages` table
- [ ] Agent tool usage is visible in UI
- [ ] Session persists across page refreshes

---

## Phase 2: Deployment (Future)

### Overview

Deploy frontend to Vercel and backend to Google Cloud Run.

### Vercel Deployment

```bash
# From apps/web directory
vercel --prod
```

**File**: `apps/web/vercel.json`
```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://YOUR_CLOUD_RUN_URL/api/:path*" }
  ]
}
```

### Cloud Run Deployment

**File**: `apps/server/Dockerfile`
```dockerfile
FROM node:20-slim

RUN npm install -g pnpm

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
COPY agent ./agent
COPY data ./data

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @agent-app/shared build
RUN pnpm --filter @agent-app/server build

EXPOSE 8080

CMD ["pnpm", "--filter", "@agent-app/server", "start"]
```

**File**: `cloudbuild.yaml`
```yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/agent-app-server:$COMMIT_SHA', '-f', 'apps/server/Dockerfile', '.']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/agent-app-server:$COMMIT_SHA']
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'agent-app-server'
      - '--image'
      - 'gcr.io/$PROJECT_ID/agent-app-server:$COMMIT_SHA'
      - '--region'
      - 'us-central1'
      - '--platform'
      - 'managed'
      - '--allow-unauthenticated'
      - '--min-instances'
      - '1'
      - '--memory'
      - '2Gi'
      - '--timeout'
      - '300'
images:
  - 'gcr.io/$PROJECT_ID/agent-app-server:$COMMIT_SHA'
```

---

## Future Phases (Out of Scope for v1)

### Stripe Billing
- Subscription management
- Webhook handling
- Usage-based billing

### Meta-Agents for Building
- `/deploy` command using vercel/cloud-run subagents
- `/new-agent` command for adding agents to existing deployment
- `/new-instance` command for deploying new projects
- Skills for infrastructure management

### Advanced Features
- Agent cost controls and monitoring
- Context overflow handling
- Multi-agent collaboration
- File upload in chat

---

## References

- [Claude Agent SDK - TypeScript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Hono Documentation](https://hono.dev/)
- [Supabase Documentation](https://supabase.com/docs)
- [Vercel Documentation](https://vercel.com/docs)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [shadcn/ui](https://ui.shadcn.com/)
- [@llamaindex/chat-ui](https://github.com/run-llama/chat-ui)
