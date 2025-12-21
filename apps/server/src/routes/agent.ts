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
} from '../services/files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const agentRouter = new Hono();

agentRouter.use('*', authMiddleware);

const querySchema = z.object({
  content: z.string().min(1),
  sessionName: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Session name must be alphanumeric with underscores/hyphens only'),
  sdkSessionId: z.string().uuid().optional(), // For resuming existing sessions
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

  const { content, sessionName, sdkSessionId: existingSessionId } = parseResult.data;

  // Session folder path (human-readable name)
  const sessionDir = path.join(DATA_DIR, sessionName);
  await ensureSessionDir(sessionName);

  console.log('[AGENT] Session name:', sessionName);
  console.log('[AGENT] Session directory:', sessionDir);
  console.log('[AGENT] Resuming session:', existingSessionId || 'none (new session)');

  // Build prompt with session context
  const promptWithContext = `[Session Name: ${sessionName}]
[Output Directory: ${sessionDir}]

IMPORTANT: Save all output files to the current working directory using relative paths (e.g., ./report.md).

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
          allowedTools: [
            'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
            'WebSearch', 'WebFetch', 'Task', 'Skill', 'TodoWrite',
          ],
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
      console.log('[AGENT] Flushing session folder:', sessionName, 'with session ID:', sdkSessionId);
      const persistedFiles = sdkSessionId
        ? await flushSessionFolder(user.id, sdkSessionId, sessionName)
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
