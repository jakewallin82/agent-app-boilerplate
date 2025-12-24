const SESSION_STORAGE_PREFIX = 'session-state-';

export interface StoredSessionState {
  sessionId: string;
  rawMessages: unknown[];
  subagentRawMessages: Record<string, unknown[]>; // Map serialized as object
  lastUpdated: number;
  isStreaming?: boolean; // True when actively streaming, cleared on completion
}

/**
 * Persist session state to localStorage after every message.
 * Called from SSE message handler to survive mid-run refreshes.
 */
export function persistSessionState(
  sessionId: string,
  rawMessages: unknown[],
  subagentRawMessages: Map<string, unknown[]>,
  isStreaming: boolean = false
): void {
  const key = `${SESSION_STORAGE_PREFIX}${sessionId}`;
  const state: StoredSessionState = {
    sessionId,
    rawMessages,
    subagentRawMessages: Object.fromEntries(subagentRawMessages),
    lastUpdated: Date.now(),
    isStreaming,
  };

  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch (error) {
    // localStorage might be full or disabled
    console.warn('Failed to persist session state to localStorage:', error);
  }
}

/**
 * Mark a session as no longer streaming (completed or errored).
 * Called when SSE stream ends.
 */
export function markSessionComplete(sessionId: string): void {
  const key = `${SESSION_STORAGE_PREFIX}${sessionId}`;

  try {
    const stored = localStorage.getItem(key);
    if (!stored) return;

    const state: StoredSessionState = JSON.parse(stored);
    state.isStreaming = false;
    state.lastUpdated = Date.now();

    localStorage.setItem(key, JSON.stringify(state));
  } catch (error) {
    console.warn('Failed to mark session complete:', error);
  }
}

/**
 * Check if a session was streaming when last persisted.
 * Used to detect interrupted sessions on page load.
 */
export function wasSessionStreaming(sessionId: string): boolean {
  const state = loadSessionStateFromLocal(sessionId);
  return state?.isStreaming === true;
}

/**
 * Load session state from localStorage.
 * Returns null if not found or expired.
 */
export function loadSessionStateFromLocal(sessionId: string): StoredSessionState | null {
  const key = `${SESSION_STORAGE_PREFIX}${sessionId}`;

  try {
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const state: StoredSessionState = JSON.parse(stored);

    // Expire after 24 hours
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;
    if (Date.now() - state.lastUpdated > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }

    return state;
  } catch (error) {
    console.warn('Failed to load session state from localStorage:', error);
    return null;
  }
}

/**
 * Clear session state from localStorage (e.g., when session is deleted).
 */
export function clearSessionState(sessionId: string): void {
  const key = `${SESSION_STORAGE_PREFIX}${sessionId}`;
  localStorage.removeItem(key);
}

/**
 * Cleanup old session states to prevent localStorage from filling up.
 * Keep only the N most recent sessions.
 */
export function cleanupOldSessionStates(keepCount: number = 10): void {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(SESSION_STORAGE_PREFIX));

  if (keys.length <= keepCount) return;

  // Sort by lastUpdated, remove oldest
  const states = keys
    .map(key => {
      try {
        const state: StoredSessionState = JSON.parse(localStorage.getItem(key) || '{}');
        return { key, lastUpdated: state.lastUpdated || 0 };
      } catch {
        return { key, lastUpdated: 0 };
      }
    })
    .sort((a, b) => b.lastUpdated - a.lastUpdated);

  // Remove oldest beyond keepCount
  states.slice(keepCount).forEach(({ key }) => {
    localStorage.removeItem(key);
  });
}
