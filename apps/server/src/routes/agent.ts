import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
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
  sessionId: z.string().uuid().optional(), // Optional - can run without DB session
  sdkSessionId: z.string().optional(),
});

// Agent workspace directory (relative to server)
const AGENT_DIR = path.resolve(__dirname, '../../../../agent');

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

  const { content, sessionId, sdkSessionId: requestSdkSessionId } = parseResult.data;

  // If sessionId provided, verify ownership
  let session: any = null;
  if (sessionId) {
    const { data, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .single();

    if (sessionError || !data) {
      return c.json({ error: 'Session not found' }, 404);
    }
    session = data;

    // Save user message to existing session
    await supabase.from('messages').insert({
      session_id: sessionId,
      role: 'user',
      content,
    });
  }

  return streamSSE(c, async (stream) => {
    let assistantContent = '';
    // Prefer SDK session ID from request (localStorage), fall back to database
    let sdkSessionId = requestSdkSessionId || session?.sdk_session_id;

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
        if (message.type === 'system' && (message as any).subtype === 'init') {
          sdkSessionId = message.session_id;
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

      // Only save to DB if we have a session
      if (sessionId && session) {
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
