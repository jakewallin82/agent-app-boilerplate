import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../lib/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  ensureSessionDir,
  flushSessionFolder,
  getSessionDir,
} from '../services/files.js';
import { getAgentConfig } from '../services/agentConfig.js';
import { loadSharedFilesIntoSession, loadAgentConfigIntoSession } from '../services/sharedFiles.js';
import { setWarmedSession, consumeWarmedSession, getWarmupCacheStats } from '../services/warmupCache.js';
import { getAllowedTools, getSandboxSystemPrompt } from '../services/toolSandbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const agentRouter = new Hono();

agentRouter.use('*', authMiddleware);

// Debug endpoint to check current user info
agentRouter.get('/me', (c) => {
  const user = c.get('user');
  return c.json({ user });
});

const querySchema = z.object({
  content: z.string().min(1),
  sessionName: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Session name must be alphanumeric with underscores/hyphens only'),
  sdkSessionId: z.string().uuid().optional(), // For resuming existing sessions
  agentId: z.string().optional().default('default'),
});

const warmupSchema = z.object({
  agentId: z.string().optional().default('default'),
});

// Base directories - use env vars in production (container) or resolve from source in development
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../../../data');
const AGENT_DIR = process.env.AGENT_DIR || path.resolve(__dirname, '../../../../agent');

// Helper to extract text content from assistant message
function extractTextContent(message: SDKMessage): string {
  if (message.type !== 'assistant') return '';

  const content = (message as any).message?.content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text || '')
    .join('');
}

agentRouter.post('/query', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();

  const parseResult = querySchema.safeParse(body);
  if (!parseResult.success) {
    return c.json({ error: 'Invalid request', details: parseResult.error }, 400);
  }

  const { content, sessionName: requestedSessionName, sdkSessionId: existingSessionId, agentId } = parseResult.data;
  const config = getAgentConfig(agentId);

  let sessionName = requestedSessionName;
  let sessionDir: string;
  let sharedFilesAlreadyLoaded = false;

  // Check for warmed session (only for new sessions)
  if (!existingSessionId) {
    const warmedSession = consumeWarmedSession(
      user.id,
      agentId,
      (config.startup.warmupTTL || 300) * 1000
    );

    if (warmedSession) {
      // Use the warmed session
      console.log(`[AGENT] Using warmed session: ${warmedSession.sessionName}`);
      sessionName = warmedSession.sessionName;
      sessionDir = warmedSession.sessionDir;
      sharedFilesAlreadyLoaded = true;
    } else {
      // Create new session directory
      sessionDir = path.join(DATA_DIR, sessionName);
      await ensureSessionDir(sessionName);
    }
  } else {
    // Resuming existing session
    sessionDir = path.join(DATA_DIR, sessionName);
    await ensureSessionDir(sessionName);
  }

  console.log('[AGENT] Session name:', sessionName);
  console.log('[AGENT] Agent ID:', agentId);
  console.log('[AGENT] Session directory:', sessionDir);
  console.log('[AGENT] Resuming session:', existingSessionId || 'none (new session)');
  console.log('[AGENT] Warmed session used:', sharedFilesAlreadyLoaded);

  // For new sessions, load agent config and shared files (if not already loaded from warmup)
  if (!existingSessionId && !sharedFilesAlreadyLoaded) {
    // Load agent configuration (CLAUDE.md, .claude folder) into session
    console.log(`[AGENT] Loading agent config for ${agentId}`);
    const configResult = await loadAgentConfigIntoSession(sessionName, agentId);
    console.log(`[AGENT] Agent config loaded:`, configResult);

    // Load shared files if config requires it
    if (config.fileLoading.sharedFiles === 'copy-on-start') {
      console.log(`[AGENT] Loading shared files for agent ${agentId}`);
      const loadResult = await loadSharedFilesIntoSession(sessionName, agentId);
      console.log(`[AGENT] Shared files loaded:`, loadResult);
    }
  }

  // Get allowed tools from config (handles network restrictions)
  const allowedTools = getAllowedTools(config);
  console.log(`[AGENT] Allowed tools for ${agentId}:`, allowedTools);

  // Build sandbox prompt for network restrictions
  const sandboxPrompt = getSandboxSystemPrompt(config);

  // Build prompt with session context
  const promptWithContext = `[Session Name: ${sessionName}]
[Output Directory: ${sessionDir}]

IMPORTANT: Save all output files to the current working directory using relative paths (e.g., ./report.md).
${sandboxPrompt ? `\n${sandboxPrompt}` : ''}
---

${content}`;

  return streamSSE(c, async (stream) => {
    let assistantContent = '';
    let sdkSessionId: string | undefined = existingSessionId;

    try {
      const queryIterator = query({
        prompt: promptWithContext,
        options: {
          cwd: sessionDir,
          maxTurns: 100,
          settingSources: ['project'],  // Load CLAUDE.md from session directory
          allowedTools,  // Use tools from getAllowedTools (handles network restrictions)
          ...(existingSessionId && { resume: existingSessionId }),
        },
      });

      for await (const message of queryIterator) {
        // Capture SDK session ID from init message
        if (message.type === 'system' && (message as any).subtype === 'init') {
          sdkSessionId = message.session_id;
          console.log('[AGENT] SDK Session ID:', sdkSessionId);
        }

        // Accumulate assistant text content
        if (message.type === 'assistant') {
          const textContent = extractTextContent(message);
          if (textContent) {
            assistantContent += textContent;
          }
        }

        await stream.writeSSE({
          data: JSON.stringify(message),
        });
      }

      // Save session to DB FIRST (before file flush, due to foreign key constraint)
      if (sdkSessionId) {
        console.log('[AGENT] Creating session record:', sdkSessionId);
        const { error: sessionError } = await supabase
          .from('sessions')
          .upsert({
            id: sdkSessionId,
            user_id: user.id,
            sdk_session_id: sdkSessionId,
            session_name: sessionName,
            agent_id: agentId,
            title: sessionName,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'id',
          });

        if (sessionError) {
          console.error('[AGENT] Session upsert error:', sessionError);
        }
      }

      // Flush session folder - persist all files to Supabase
      if (!sdkSessionId) {
        console.log('[AGENT] No SDK session ID, skipping file flush');
      }
      // Determine if files should go to shared storage (admin using shared-persistent agent)
      const isShared = config.canWriteShared && user.isAdmin;
      console.log('[AGENT] Flushing session folder:', sessionName, 'with session ID:', sdkSessionId, 'shared:', isShared);
      const persistedFiles = sdkSessionId
        ? await flushSessionFolder(user.id, sdkSessionId, sessionName, agentId, isShared)
        : [];

      // Emit file events for each persisted file
      for (const fileInfo of persistedFiles) {
        await stream.writeSSE({
          data: JSON.stringify({
            type: 'file_event',
            subtype: 'created',
            file: fileInfo,
          }),
        });
      }

      console.log('[AGENT] Flushed', persistedFiles.length, 'files');

      // Save messages
      if (sdkSessionId) {
        await supabase.from('messages').insert([
          { session_id: sdkSessionId, role: 'user', content },
          { session_id: sdkSessionId, role: 'assistant', content: assistantContent },
        ]);
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

/**
 * POST /warmup - Pre-warm container with shared files
 * Called by frontend on login to reduce first-query latency
 */
agentRouter.post('/warmup', async (c) => {
  const user = c.get('user');

  const body = await c.req.json().catch(() => ({}));
  const parseResult = warmupSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json({ error: 'Invalid request', details: parseResult.error }, 400);
  }

  const { agentId } = parseResult.data;
  const config = getAgentConfig(agentId);

  // Check if warmup is enabled for this agent
  if (config.startup.strategy !== 'pre-warm-on-login') {
    console.log(`[WARMUP] Skipping warmup for agent ${agentId} (strategy: ${config.startup.strategy})`);
    return c.json({
      status: 'skipped',
      reason: 'Warmup not enabled for this agent',
    });
  }

  // Generate a temporary session name for warmup
  const sessionName = `warmup-${user.id.slice(0, 8)}-${Date.now()}`;

  try {
    console.log(`[WARMUP] Starting warmup for user ${user.id}, agent ${agentId}`);

    // Create session directory
    const sessionDir = await ensureSessionDir(sessionName);

    // Load agent config into session
    const configResult = await loadAgentConfigIntoSession(sessionName, agentId);
    console.log(`[WARMUP] Agent config loaded:`, configResult);

    // Load shared files
    const loadResult = await loadSharedFilesIntoSession(sessionName, agentId);
    console.log(`[WARMUP] Shared files loaded:`, loadResult);

    // Cache the warmed session
    setWarmedSession(user.id, agentId, {
      sessionName,
      agentId,
      sessionDir,
      filesLoaded: loadResult.loaded,
    });

    return c.json({
      status: 'warmed',
      sessionName,
      filesLoaded: loadResult.loaded,
      ttl: config.startup.warmupTTL || 300,
    });
  } catch (error) {
    console.error('[WARMUP] Error warming up:', error);
    return c.json({ error: 'Warmup failed' }, 500);
  }
});

/**
 * GET /warmup/stats - Get warmup cache statistics (for debugging)
 */
agentRouter.get('/warmup/stats', async (c) => {
  const stats = getWarmupCacheStats();
  return c.json(stats);
});
