interface WarmupEntry {
  sessionName: string;
  agentId: string;
  sessionDir: string;
  timestamp: number;
  filesLoaded: number;
}

// In-memory cache for warmed sessions
const warmupCache = new Map<string, WarmupEntry>();

// Default TTL: 5 minutes
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Generate a cache key for a user + agent combination
 */
function getCacheKey(userId: string, agentId: string): string {
  return `${userId}:${agentId}`;
}

/**
 * Store a warmed session in cache
 */
export function setWarmedSession(
  userId: string,
  agentId: string,
  entry: Omit<WarmupEntry, 'timestamp'>
): void {
  const key = getCacheKey(userId, agentId);
  warmupCache.set(key, {
    ...entry,
    timestamp: Date.now(),
  });
  console.log(`[WARMUP] Cached session for ${key}:`, entry.sessionName);
}

/**
 * Get and consume a warmed session (removes from cache)
 */
export function consumeWarmedSession(
  userId: string,
  agentId: string,
  ttlMs: number = DEFAULT_TTL_MS
): WarmupEntry | null {
  const key = getCacheKey(userId, agentId);
  const entry = warmupCache.get(key);

  if (!entry) {
    return null;
  }

  // Check if expired
  if (Date.now() - entry.timestamp > ttlMs) {
    warmupCache.delete(key);
    console.log(`[WARMUP] Expired session for ${key}`);
    return null;
  }

  // Consume (remove from cache)
  warmupCache.delete(key);
  console.log(`[WARMUP] Consumed warmed session for ${key}:`, entry.sessionName);
  return entry;
}

/**
 * Check if a warmed session exists (without consuming)
 */
export function hasWarmedSession(
  userId: string,
  agentId: string,
  ttlMs: number = DEFAULT_TTL_MS
): boolean {
  const key = getCacheKey(userId, agentId);
  const entry = warmupCache.get(key);

  if (!entry) {
    return false;
  }

  if (Date.now() - entry.timestamp > ttlMs) {
    warmupCache.delete(key);
    return false;
  }

  return true;
}

/**
 * Clear all cached entries (for testing)
 */
export function clearWarmupCache(): void {
  warmupCache.clear();
}

/**
 * Get cache stats (for monitoring)
 */
export function getWarmupCacheStats(): { size: number; entries: string[] } {
  return {
    size: warmupCache.size,
    entries: Array.from(warmupCache.keys()),
  };
}
