import { Hono } from 'hono';
import { supabase } from '../lib/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import type { ChatSession, ChatMessage } from '@agent-app/shared';

export const sessionsRouter = new Hono();

sessionsRouter.use('*', authMiddleware);

// List user's sessions with file count
sessionsRouter.get('/', async (c) => {
  const user = c.get('user');

  const { data, error } = await supabase
    .from('sessions')
    .select(`
      *,
      file_count:agent_files(count)
    `)
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  // Transform file_count from array to number
  const sessions = (data || []).map(s => ({
    ...s,
    file_count: s.file_count?.[0]?.count || 0,
  }));

  return c.json({ sessions });
});

// Create or get session - SDK session ID is used as the primary key
sessionsRouter.post('/', async (c) => {
  const user = c.get('user');
  const { id, agent_id = 'default', title } = await c.req.json();

  if (!id) {
    return c.json({ error: 'Session ID (SDK session ID) is required' }, 400);
  }

  // Try to insert - if duplicate, fetch existing
  const { data, error } = await supabase
    .from('sessions')
    .insert({ id, user_id: user.id, agent_id, title })
    .select()
    .single();

  if (error) {
    // If duplicate key error, fetch the existing session
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', id)
        .single();

      if (existing) {
        return c.json({ session: existing as ChatSession });
      }
    }
    console.error('Session creation error:', error);
    return c.json({ error: error.message }, 500);
  }

  return c.json({ session: data as ChatSession });
});

// Get session by ID
sessionsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');

  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (error || !data) {
    return c.json({ error: 'Session not found' }, 404);
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

// Save a message to a session
sessionsRouter.post('/:id/messages', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');
  const { role, content } = await c.req.json();

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
    .insert({ session_id: sessionId, role, content })
    .select()
    .single();

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  // Update session's updated_at
  await supabase
    .from('sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId);

  return c.json({ message: data as ChatMessage });
});

// Admin: List ALL sessions
sessionsRouter.get('/admin/all', async (c) => {
  const user = c.get('user');

  if (!user.isAdmin) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const { data, error } = await supabase
    .from('sessions')
    .select(`
      *,
      file_count:agent_files(count),
      profiles!sessions_user_id_fkey(email)
    `)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  const sessions = (data || []).map(s => ({
    ...s,
    file_count: s.file_count?.[0]?.count || 0,
    user_email: s.profiles?.email || 'Unknown',
  }));

  return c.json({ sessions });
});

// Admin: Get session history (full trace from .session-state.json)
sessionsRouter.get('/admin/:id/history', async (c) => {
  const user = c.get('user');

  if (!user.isAdmin) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const sessionId = c.req.param('id');

  // Get session info to find the session name
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('session_name, user_id')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  // Try to get session state from storage
  const storagePath = `${session.user_id}/${session.session_name}/.session-state.json`;

  const { data, error } = await supabase.storage
    .from('agent-files')
    .download(storagePath);

  if (error) {
    // Try to reconstruct from messages if no session state file
    const { data: messages } = await supabase
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    return c.json({
      session,
      messages: messages || [],
      source: 'reconstructed',
    });
  }

  const text = await data.text();
  const sessionState = JSON.parse(text);

  return c.json({
    session,
    sessionState,
    source: 'session-state-file',
  });
});
