/**
 * File filtering utilities for agent sessions.
 * Used by both backend (persistence) and frontend (display).
 */

/**
 * Agent config files - always hidden from all users (internal to agent operation)
 */
const AGENT_CONFIG_PATTERNS = [
  'CLAUDE.md',           // Agent config file
  '.claude',             // Agent config directory
];

/**
 * Shared files directory - hidden from regular users, visible to admins
 */
const SHARED_FILES_PATTERN = 'shared/';

/**
 * Check if a file path matches a pattern
 */
function matchesPattern(normalizedPath: string, pattern: string): boolean {
  // Exact match
  if (normalizedPath === pattern) {
    return true;
  }
  // Prefix match for directories ending with /
  if (pattern.endsWith('/') && normalizedPath.startsWith(pattern)) {
    return true;
  }
  // Prefix match for .claude directory
  if (pattern === '.claude' && (normalizedPath === '.claude' || normalizedPath.startsWith('.claude/'))) {
    return true;
  }
  return false;
}

/**
 * Check if a file is an agent config file (CLAUDE.md, .claude/)
 * These are always hidden from users.
 */
export function isAgentConfigFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return AGENT_CONFIG_PATTERNS.some(pattern => matchesPattern(normalizedPath, pattern));
}

/**
 * Check if a file is in the shared directory
 */
export function isSharedFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return matchesPattern(normalizedPath, SHARED_FILES_PATTERN);
}

/**
 * Check if a file path should be hidden from users.
 * @param filePath - Relative file path within session
 * @param canWriteShared - Whether the agent can write to shared storage (admin agents)
 * @returns true if the file should be hidden
 */
export function isHiddenFile(filePath: string, canWriteShared: boolean = false): boolean {
  // Agent config files are always hidden
  if (isAgentConfigFile(filePath)) {
    return true;
  }

  // Shared files are hidden unless agent can write to shared (admin)
  if (isSharedFile(filePath) && !canWriteShared) {
    return true;
  }

  return false;
}

/**
 * Filter an array of file objects to exclude hidden files.
 * @param files - Array of file objects with a filePath property
 * @param canWriteShared - Whether the agent can write to shared storage (admin agents)
 * @returns Filtered array with hidden files removed
 */
export function filterHiddenFiles<T extends { filePath: string }>(
  files: T[],
  canWriteShared: boolean = false
): T[] {
  return files.filter(file => !isHiddenFile(file.filePath, canWriteShared));
}
