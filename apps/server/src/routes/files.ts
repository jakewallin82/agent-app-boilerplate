import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { listSessionFiles, getSignedUrl, restoreSessionFiles } from '../services/files.js';

export const filesRouter = new Hono();

filesRouter.use('*', authMiddleware);

// List files for a session
filesRouter.get('/sessions/:sessionId/files', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');

  // Verify session ownership
  const { data: session, error } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (error || !session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const files = await listSessionFiles(sessionId);
  return c.json({ files });
});

// Get file content (returns signed URL)
filesRouter.get('/sessions/:sessionId/files/:fileId', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  const fileId = c.req.param('fileId');

  // Verify ownership
  const { data: file, error } = await supabase
    .from('agent_files')
    .select('*')
    .eq('id', fileId)
    .eq('session_id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (error || !file) {
    return c.json({ error: 'File not found' }, 404);
  }

  const signedUrl = await getSignedUrl(file.storage_path);

  return c.json({
    file: {
      id: file.id,
      sessionId: file.session_id,
      userId: file.user_id,
      filePath: file.file_path,
      storagePath: file.storage_path,
      fileType: file.file_type,
      fileSize: file.file_size,
      contentHash: file.content_hash,
      createdAt: file.created_at,
      updatedAt: file.updated_at,
      signedUrl,
    }
  });
});

// Restore session files to container (for resuming work)
filesRouter.post('/sessions/:sessionId/restore', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');

  // Verify session ownership
  const { data: session, error } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (error || !session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  await restoreSessionFiles(sessionId);

  return c.json({ success: true });
});
