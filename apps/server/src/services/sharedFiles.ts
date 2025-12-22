import { supabase } from '../lib/supabase.js';
import { ensureSessionDir } from './files.js';
import { getAgentConfig } from './agentConfig.js';
import { mkdir, writeFile, copyFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { minimatch } from 'minimatch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUCKET_NAME = 'agent-files';
const SHARED_PREFIX = 'shared';

// Base directory for agent configs (relative to server src)
const AGENT_CONFIGS_DIR = process.env.AGENT_CONFIGS_DIR || path.resolve(__dirname, '../../../../agent/configs');

interface SharedFile {
  name: string;
  id: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * List all shared files for an agent type
 */
export async function listSharedFiles(agentId: string): Promise<SharedFile[]> {
  const sharedPath = `${SHARED_PREFIX}/${agentId}`;

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .list(sharedPath, {
      limit: 1000,
      sortBy: { column: 'name', order: 'asc' },
    });

  if (error) {
    console.error('[SHARED_FILES] Error listing shared files:', error);
    return [];
  }

  return data || [];
}

/**
 * Recursively list all files in a storage path
 */
async function listAllFilesRecursively(
  basePath: string,
  currentPath: string = ''
): Promise<string[]> {
  const fullPath = currentPath ? `${basePath}/${currentPath}` : basePath;

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .list(fullPath, { limit: 1000 });

  if (error || !data) {
    return [];
  }

  const files: string[] = [];

  for (const item of data) {
    const itemPath = currentPath ? `${currentPath}/${item.name}` : item.name;

    // Check if it's a folder (no id means it's a folder placeholder)
    if (item.id === null) {
      // It's a folder, recurse
      const subFiles = await listAllFilesRecursively(basePath, itemPath);
      files.push(...subFiles);
    } else {
      // It's a file
      files.push(itemPath);
    }
  }

  return files;
}

/**
 * Check if a file path matches any of the include patterns
 */
function matchesPatterns(filePath: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) {
    return true; // No patterns means include all
  }

  return patterns.some(pattern => minimatch(filePath, pattern));
}

/**
 * Load shared files into a session workspace
 */
export async function loadSharedFilesIntoSession(
  sessionName: string,
  agentId: string
): Promise<{ loaded: number; skipped: number; errors: number }> {
  const config = getAgentConfig(agentId);

  if (config.fileLoading.sharedFiles === 'none') {
    console.log('[SHARED_FILES] Shared file loading disabled for agent:', agentId);
    return { loaded: 0, skipped: 0, errors: 0 };
  }

  const sessionDir = await ensureSessionDir(sessionName);
  const sharedDir = path.join(sessionDir, 'shared');

  // Create shared directory
  if (!existsSync(sharedDir)) {
    await mkdir(sharedDir, { recursive: true });
  }

  const sharedStoragePath = `${SHARED_PREFIX}/${agentId}`;
  const allFiles = await listAllFilesRecursively(sharedStoragePath);

  console.log(`[SHARED_FILES] Found ${allFiles.length} shared files for agent ${agentId}`);

  const includePatterns = config.fileLoading.includePatterns || [];
  const excludePatterns = config.fileLoading.excludePatterns || [];
  const maxBytes = config.fileLoading.maxSharedBytes || 100 * 1024 * 1024; // 100MB default

  let loaded = 0;
  let skipped = 0;
  let errors = 0;
  let totalBytes = 0;

  for (const relativePath of allFiles) {
    // Check include patterns
    if (includePatterns.length > 0 && !matchesPatterns(relativePath, includePatterns)) {
      skipped++;
      continue;
    }

    // Check exclude patterns
    if (excludePatterns.length > 0 && matchesPatterns(relativePath, excludePatterns)) {
      skipped++;
      continue;
    }

    // Download file from storage
    const storagePath = `${sharedStoragePath}/${relativePath}`;
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(storagePath);

    if (error || !data) {
      console.error('[SHARED_FILES] Error downloading file:', storagePath, error);
      errors++;
      continue;
    }

    // Check size limit
    const fileSize = data.size;
    if (totalBytes + fileSize > maxBytes) {
      console.warn('[SHARED_FILES] Size limit reached, stopping file loading');
      break;
    }

    // Write to local filesystem
    const localPath = path.join(sharedDir, relativePath);
    const localDir = path.dirname(localPath);

    if (!existsSync(localDir)) {
      await mkdir(localDir, { recursive: true });
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    await writeFile(localPath, buffer);

    totalBytes += fileSize;
    loaded++;
    console.log('[SHARED_FILES] Loaded:', relativePath);
  }

  console.log(`[SHARED_FILES] Loading complete: ${loaded} loaded, ${skipped} skipped, ${errors} errors`);
  return { loaded, skipped, errors };
}

/**
 * Get total size of shared files for an agent
 */
export async function getSharedFilesSize(agentId: string): Promise<number> {
  const { data, error } = await supabase
    .from('agent_files')
    .select('file_size')
    .eq('agent_id', agentId)
    .eq('is_shared', true);

  if (error || !data) {
    return 0;
  }

  return data.reduce((sum, file) => sum + (file.file_size || 0), 0);
}

/**
 * Recursively copy a directory
 */
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  if (!existsSync(src)) {
    return;
  }

  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

/**
 * Load agent configuration (CLAUDE.md and .claude folder) into session directory
 * This sets up the agent's personality, skills, and prompts for the session
 */
export async function loadAgentConfigIntoSession(
  sessionName: string,
  agentId: string
): Promise<{ success: boolean; configDir: string }> {
  const config = getAgentConfig(agentId);
  const configDir = config.configDir;

  const srcConfigDir = path.join(AGENT_CONFIGS_DIR, configDir);
  const sessionDir = await ensureSessionDir(sessionName);

  console.log(`[AGENT_CONFIG] Loading config for agent ${agentId} from ${srcConfigDir}`);

  if (!existsSync(srcConfigDir)) {
    console.error(`[AGENT_CONFIG] Config directory not found: ${srcConfigDir}`);
    return { success: false, configDir: srcConfigDir };
  }

  try {
    // Copy CLAUDE.md if it exists
    const claudeMdSrc = path.join(srcConfigDir, 'CLAUDE.md');
    const claudeMdDest = path.join(sessionDir, 'CLAUDE.md');

    if (existsSync(claudeMdSrc)) {
      await copyFile(claudeMdSrc, claudeMdDest);
      console.log('[AGENT_CONFIG] Copied CLAUDE.md');
    }

    // Copy .claude directory if it exists
    const dotClaudeSrc = path.join(srcConfigDir, '.claude');
    const dotClaudeDest = path.join(sessionDir, '.claude');

    if (existsSync(dotClaudeSrc)) {
      await copyDirRecursive(dotClaudeSrc, dotClaudeDest);
      console.log('[AGENT_CONFIG] Copied .claude directory');
    }

    console.log(`[AGENT_CONFIG] Successfully loaded config for ${agentId}`);
    return { success: true, configDir: srcConfigDir };
  } catch (error) {
    console.error('[AGENT_CONFIG] Error loading config:', error);
    return { success: false, configDir: srcConfigDir };
  }
}
