import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFile } from 'fs/promises';
import { supabase } from '../lib/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  ensureSessionDir,
  flushSessionFolder,
  getSessionDir,
  renameSessionDir,
} from '../services/files.js';
import { getAgentConfig } from '../services/agentConfig.js';
import { loadSharedFilesIntoSession, loadAgentConfigIntoSession } from '../services/sharedFiles.js';
import { setWarmedSession, consumeWarmedSession, getWarmupCacheStats } from '../services/warmupCache.js';
import { getAllowedTools, getSandboxSystemPrompt } from '../services/toolSandbox.js';
import {
  createSessionStream,
  publishMessage,
  markStreamComplete,
  getSessionStream,
  isStreamOwner,
  subscribeToSession,
  isStreamComplete,
} from '../services/sessionStreams.js';
import type { SessionState } from '@agent-app/shared';

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
      // Use the warmed session - rename directory to user's requested name
      console.log(`[AGENT] Using warmed session: ${warmedSession.sessionName} -> ${requestedSessionName}`);
      try {
        sessionDir = await renameSessionDir(warmedSession.sessionName, requestedSessionName);
        sharedFilesAlreadyLoaded = true;
        console.log(`[AGENT] Renamed warmup session to: ${sessionDir}`);
      } catch (renameError) {
        // If rename fails (e.g., target exists), fall back to creating new session
        console.warn(`[AGENT] Failed to rename warmup session, creating new:`, renameError);
        sessionDir = path.join(DATA_DIR, sessionName);
        await ensureSessionDir(sessionName);
      }
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

    // Initialize session state collector for dev mode debugging
    const sessionState: SessionState = {
      version: '1.0',
      sessionId: '', // Will be set on init message
      sessionName,
      agentId,
      userId: user.id,
      startTime: new Date().toISOString(),
      messages: [],
      metadata: {
        totalTokens: 0,
        totalCost: 0,
        toolCallCount: 0,
        subagentCount: 0,
      },
    };

    // Add initial user message to session state (SDK doesn't emit this)
    // Format matches what deriveUserView expects for user messages
    const initialUserMessage = {
      type: 'user',
      uuid: crypto.randomUUID(),
      message: {
        content: [{ type: 'text', text: content }],
      },
      timestamp: new Date().toISOString(),
    };
    sessionState.messages.push(initialUserMessage);

    // Emit the initial user message so frontend rawMessages includes it
    await stream.writeSSE({
      data: JSON.stringify(initialUserMessage),
    });

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
        // Collect ALL messages for session state
        sessionState.messages.push(message);

        // Publish to session stream (for reconnecting clients)
        if (sdkSessionId) {
          await publishMessage(sdkSessionId, message);
        }

        // Capture SDK session ID from init message
        if (message.type === 'system' && (message as any).subtype === 'init') {
          sdkSessionId = message.session_id;
          sessionState.sessionId = sdkSessionId || '';
          console.log('[AGENT] SDK Session ID:', sdkSessionId);

          // Create session stream for reconnection support
          if (sdkSessionId) {
            createSessionStream(sdkSessionId, user.id);
            // Publish the initial user message that was already emitted
            await publishMessage(sdkSessionId, initialUserMessage);
          }

          // Create session record IMMEDIATELY so frontend can navigate to /sessionName
          if (sdkSessionId) {
            console.log('[AGENT] Creating session record (early):', sdkSessionId);
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
        }

        // Count tool calls for metadata
        if (message.type === 'assistant') {
          const content = (message as any).message?.content;
          if (Array.isArray(content)) {
            const toolUses = content.filter((b: any) => b.type === 'tool_use');
            sessionState.metadata.toolCallCount += toolUses.length;
            sessionState.metadata.subagentCount += toolUses.filter(
              (b: any) => b.name === 'Task'
            ).length;
          }
        }

        // Capture usage stats from result message
        if (message.type === 'result' && (message as any).subtype === 'success') {
          sessionState.metadata.totalTokens = (message as any).usage?.total_tokens || 0;
          sessionState.metadata.totalCost = (message as any).cost_usd || 0;
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

      // Mark stream as complete (after loop, before file persistence)
      if (sdkSessionId) {
        markStreamComplete(sdkSessionId);
      }

      // Update session timestamp (session was already created on init message)
      if (sdkSessionId) {
        await supabase
          .from('sessions')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', sdkSessionId);
      }

      // Flush session folder - persist all files to Supabase
      if (!sdkSessionId) {
        console.log('[AGENT] No SDK session ID, skipping file flush');
      }
      // Write session state file BEFORE flush so it gets uploaded to Supabase
      sessionState.endTime = new Date().toISOString();
      try {
        await writeFile(
          path.join(sessionDir, '.session-state.json'),
          JSON.stringify(sessionState, null, 2)
        );
        console.log('[AGENT] Session state saved:', path.join(sessionDir, '.session-state.json'));
      } catch (stateError) {
        console.error('[AGENT] Failed to save session state:', stateError);
      }

      // Determine if files should go to shared storage (admin using shared-persistent agent)
      const isShared = config.canWriteShared && user.isAdmin;
      console.log('[AGENT] Flushing session folder:', sessionName, 'with session ID:', sdkSessionId, 'shared:', isShared);
      const persistedFiles = sdkSessionId
        ? await flushSessionFolder(user.id, sdkSessionId, sessionName, agentId, isShared)
        : [];

      // Emit file events for each persisted file
      for (const fileInfo of persistedFiles) {
        const fileEvent = {
          type: 'file_event',
          subtype: 'created',
          file: fileInfo,
        };
        await stream.writeSSE({
          data: JSON.stringify(fileEvent),
        });
        // Also publish to session stream
        if (sdkSessionId) {
          await publishMessage(sdkSessionId, fileEvent);
        }
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

/**
 * GET /stream/:sessionId - Reconnect to an active session stream
 *
 * Flow:
 * 1. Check if session stream exists and user owns it
 * 2. Send all buffered messages immediately (catch up)
 * 3. If stream is complete, send [DONE]
 * 4. If stream is active, subscribe for new messages
 * 5. When stream completes or client disconnects, cleanup
 */
agentRouter.get('/stream/:sessionId', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');

  console.log('[RECONNECT] Reconnect request for session:', sessionId, 'user:', user.id);

  // Check if session stream exists
  const sessionStream = getSessionStream(sessionId);
  if (!sessionStream) {
    console.log('[RECONNECT] No active stream found for session:', sessionId);
    return c.json({ error: 'No active stream for this session' }, 404);
  }

  // Check authorization - user must own the stream
  if (!isStreamOwner(sessionId, user.id)) {
    console.log('[RECONNECT] User does not own stream:', sessionId);
    return c.json({ error: 'Not authorized' }, 403);
  }

  return streamSSE(c, async (stream) => {
    console.log('[RECONNECT] Starting SSE stream for session:', sessionId);

    // Subscribe to get buffered messages and live updates
    const subscription = subscribeToSession(sessionId, async (message) => {
      // This callback is called for NEW messages (after subscription)
      await stream.writeSSE({ data: JSON.stringify(message) });
    });

    if (!subscription) {
      // Stream was deleted between check and subscribe (race condition)
      await stream.writeSSE({ data: '[DONE]' });
      return;
    }

    const { bufferedMessages, unsubscribe } = subscription;

    try {
      // Send all buffered messages first (catch up)
      console.log('[RECONNECT] Sending', bufferedMessages.length, 'buffered messages');
      for (const message of bufferedMessages) {
        await stream.writeSSE({ data: JSON.stringify(message) });
      }

      // Signal that catch-up is complete - client can hide "Reconnecting" banner
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'system',
          subtype: 'reconnect_synced',
          buffered_count: bufferedMessages.length,
        }),
      });

      // If stream is already complete, we're done
      if (isStreamComplete(sessionId)) {
        console.log('[RECONNECT] Stream already complete, sending DONE');
        await stream.writeSSE({ data: '[DONE]' });
        unsubscribe();
        return;
      }

      // Wait for stream to complete (new messages delivered via subscriber callback)
      await new Promise<void>((resolve) => {
        // Check periodically if stream completed
        const checkInterval = setInterval(() => {
          if (isStreamComplete(sessionId)) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);

        // Handle client disconnect
        c.req.raw.signal.addEventListener('abort', () => {
          console.log('[RECONNECT] Client disconnected for session:', sessionId);
          clearInterval(checkInterval);
          resolve();
        });
      });

      // Stream completed, send final DONE
      if (!c.req.raw.signal.aborted) {
        await stream.writeSSE({ data: '[DONE]' });
      }
    } finally {
      unsubscribe();
      console.log('[RECONNECT] SSE stream ended for session:', sessionId);
    }
  });
});
