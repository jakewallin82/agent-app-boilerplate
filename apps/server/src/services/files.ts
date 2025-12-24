import { createHash } from 'crypto';
import { readFile, mkdir, writeFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';
import { supabase } from '../lib/supabase.js';
import { isAgentConfigFile, isSharedFile } from '@agent-app/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve to repo root /data directory (from apps/server/src/services/)
const DATA_DIR = path.resolve(__dirname, '../../../../data');
const BUCKET_NAME = 'agent-files';
const SHARED_PREFIX = 'shared';

/**
 * Get storage path based on whether writing to shared or user storage
 */
function getStoragePath(
  userId: string,
  agentId: string,
  sessionName: string,
  relativePath: string,
  isShared: boolean
): string {
  if (isShared) {
    // Shared files: shared/{agentId}/{relativePath}
    return path.join(SHARED_PREFIX, agentId, relativePath).replace(/\\/g, '/');
  }
  // User files: {userId}/{sessionName}/{relativePath}
  return path.join(userId, sessionName, relativePath).replace(/\\/g, '/');
}

export interface FileInfo {
  id: string;
  sessionId: string;
  userId: string;
  filePath: string;
  storagePath: string;
  fileType: string;
  fileSize: number;
  contentHash: string;
  signedUrl?: string;
  createdAt: string;
  updatedAt: string;
}

// Ensure session directory exists
export async function ensureSessionDir(sessionId: string): Promise<string> {
  console.log('[FILES] DATA_DIR:', DATA_DIR);
  const sessionDir = path.join(DATA_DIR, sessionId);
  console.log('[FILES] Ensuring session directory:', sessionDir);

  // Also ensure the parent data directory exists
  if (!existsSync(DATA_DIR)) {
    console.log('[FILES] Creating data directory:', DATA_DIR);
    await mkdir(DATA_DIR, { recursive: true });
  }

  if (!existsSync(sessionDir)) {
    console.log('[FILES] Creating session directory:', sessionDir);
    await mkdir(sessionDir, { recursive: true });
  } else {
    console.log('[FILES] Session directory already exists');
  }

  return sessionDir;
}

// Get session directory path
export function getSessionDir(sessionId: string): string {
  return path.join(DATA_DIR, sessionId);
}

// Persist a file to Supabase Storage (user or shared)
export async function persistFile(
  userId: string,
  sessionId: string,      // UUID for database
  sessionName: string,    // Human-readable folder name
  agentId: string,        // Agent type ID
  localFilePath: string,
  isShared: boolean = false
): Promise<FileInfo | null> {
  try {
    // Read file content
    const content = await readFile(localFilePath);
    const contentHash = createHash('md5').update(content).digest('hex');

    // Extract relative path from session dir
    const sessionDir = getSessionDir(sessionName);
    const relativePath = path.relative(sessionDir, localFilePath);

    // Skip files outside session directory
    if (relativePath.startsWith('..')) {
      console.log('[FILES] Skipping file outside session dir:', localFilePath);
      return null;
    }

    const storagePath = getStoragePath(userId, agentId, sessionName, relativePath, isShared);
    const fileType = path.extname(relativePath).slice(1) || 'txt';

    console.log(`[FILES] Persisting file to ${isShared ? 'shared' : 'user'} storage:`, storagePath);

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, content, {
        upsert: true,
        contentType: getContentType(fileType),
      });

    if (uploadError) {
      console.error('[FILES] Upload error:', uploadError);
      throw uploadError;
    }

    // Upsert to agent_files table (use UUID sessionId for DB)
    const { data, error: dbError } = await supabase
      .from('agent_files')
      .upsert({
        session_id: sessionId,
        session_name: sessionName,
        user_id: userId,
        file_path: relativePath,
        storage_path: storagePath,
        file_type: fileType,
        file_size: content.length,
        content_hash: contentHash,
        is_shared: isShared,
        agent_id: agentId,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'session_id,file_path',
      })
      .select()
      .single();

    if (dbError) {
      console.error('[FILES] DB error:', dbError);
      throw dbError;
    }

    console.log('[FILES] Persisted:', relativePath);

    return {
      id: data.id,
      sessionId: data.session_id,
      userId: data.user_id,
      filePath: data.file_path,
      storagePath: data.storage_path,
      fileType: data.file_type,
      fileSize: data.file_size,
      contentHash: data.content_hash,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  } catch (error) {
    console.error('[FILES] Persist error:', error);
    return null;
  }
}

// Get signed URL for a file
export async function getSignedUrl(storagePath: string, expiresIn = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, expiresIn);

  if (error) {
    console.error('[FILES] Signed URL error:', error);
    return null;
  }

  return data.signedUrl;
}

// List files for a session
export async function listSessionFiles(sessionId: string): Promise<FileInfo[]> {
  const { data, error } = await supabase
    .from('agent_files')
    .select('*')
    .eq('session_id', sessionId)
    .order('file_path');

  if (error) {
    console.error('[FILES] List error:', error);
    return [];
  }

  // Add signed URLs
  const filesWithUrls = await Promise.all(
    data.map(async (file) => ({
      id: file.id,
      sessionId: file.session_id,
      userId: file.user_id,
      filePath: file.file_path,
      storagePath: file.storage_path,
      fileType: file.file_type,
      fileSize: file.file_size,
      contentHash: file.content_hash,
      signedUrl: (await getSignedUrl(file.storage_path)) ?? undefined,
      createdAt: file.created_at,
      updatedAt: file.updated_at,
    }))
  );

  return filesWithUrls;
}

// Restore session files from Storage to local disk
export async function restoreSessionFiles(sessionId: string): Promise<void> {
  const files = await listSessionFiles(sessionId);
  const sessionDir = await ensureSessionDir(sessionId);

  for (const file of files) {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(file.storagePath);

    if (error) {
      console.error('[FILES] Download error:', file.filePath, error);
      continue;
    }

    const localPath = path.join(sessionDir, file.filePath);
    const localDir = path.dirname(localPath);

    if (!existsSync(localDir)) {
      await mkdir(localDir, { recursive: true });
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    await writeFile(localPath, buffer);
    console.log('[FILES] Restored:', file.filePath);
  }
}

// Content type mapping
function getContentType(ext: string): string {
  const types: Record<string, string> = {
    md: 'text/markdown',
    json: 'application/json',
    txt: 'text/plain',
    csv: 'text/csv',
    html: 'text/html',
    js: 'text/javascript',
    ts: 'text/typescript',
    py: 'text/x-python',
  };
  return types[ext] || 'application/octet-stream';
}

// Get existing file hash from database
async function getExistingFileHash(sessionId: string, relativePath: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('agent_files')
    .select('content_hash')
    .eq('session_id', sessionId)
    .eq('file_path', relativePath)
    .single();

  if (error || !data) {
    return null;
  }

  return data.content_hash;
}

// Flush all files in session folder to Supabase
// Returns array of files that were new or modified
export async function flushSessionFolder(
  userId: string,
  sessionId: string,    // UUID for database
  sessionName: string,  // Human-readable folder name
  agentId: string = 'default',
  isShared: boolean = false
): Promise<FileInfo[]> {
  const sessionDir = getSessionDir(sessionName);

  if (!existsSync(sessionDir)) {
    console.log('[FILES] Session directory does not exist:', sessionDir);
    return [];
  }

  // Find all files in session directory (including .session-state.json)
  const files = await glob('**/*', {
    cwd: sessionDir,
    nodir: true,
    dot: true, // Include dotfiles to capture .session-state.json
  });

  console.log(`[FILES] Flushing ${files.length} files from ${sessionDir} (shared: ${isShared})`);

  const persistedFiles: FileInfo[] = [];

  for (const relativePath of files) {
    // Special handling for session state file - always persist to user storage
    const isSessionState = relativePath === '.session-state.json';

    // Skip agent config files (CLAUDE.md, .claude/) - these are never persisted
    if (!isSessionState && isAgentConfigFile(relativePath)) {
      console.log('[FILES] Skipping agent config file:', relativePath);
      continue;
    }

    // Skip shared files when writing to user storage (they already exist in shared storage)
    // But DO persist them when writing to shared storage (admin agent)
    // Session state file is always persisted to user storage
    if (!isSessionState && !isShared && isSharedFile(relativePath)) {
      console.log('[FILES] Skipping shared file (already in shared storage):', relativePath);
      continue;
    }

    // For session state, always persist to user storage (not shared)
    const persistToShared = isSessionState ? false : isShared;

    const localPath = path.join(sessionDir, relativePath);

    try {
      // Get file stats and hash
      const content = await readFile(localPath);
      const currentHash = createHash('md5').update(content).digest('hex');

      // Check if file is new or modified
      const existingHash = await getExistingFileHash(sessionId, relativePath);

      if (existingHash === currentHash) {
        console.log('[FILES] Skipping unchanged file:', relativePath);
        continue;
      }

      console.log('[FILES] Persisting file:', relativePath, existingHash ? '(modified)' : '(new)');

      // Persist the file (use persistToShared for session state special handling)
      const fileInfo = await persistFile(userId, sessionId, sessionName, agentId, localPath, persistToShared);
      if (fileInfo) {
        persistedFiles.push(fileInfo);
      }
    } catch (error) {
      console.error('[FILES] Error processing file:', relativePath, error);
    }
  }

  console.log('[FILES] Flush complete. Persisted', persistedFiles.length, 'files');
  return persistedFiles;
}
