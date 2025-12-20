// Config must be imported first to load env vars
import './config.js';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { agentRouter } from './routes/agent.js';
import { authRouter } from './routes/auth.js';
import { sessionsRouter } from './routes/sessions.js';
import { config } from './config.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: config.server.frontendUrl,
  credentials: true,
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes
app.route('/api/agent', agentRouter);
app.route('/api/auth', authRouter);
app.route('/api/sessions', sessionsRouter);

console.log(`Server running on http://localhost:${config.server.port}`);

serve({ fetch: app.fetch, port: config.server.port });
