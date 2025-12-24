/**
 * In-memory message buffer and pub/sub for SSE reconnection.
 *
 * Pattern: When a query starts, create a stream buffer keyed by sdkSessionId.
 * Messages are published to the buffer AND streamed to the original client.
 * Reconnecting clients subscribe and receive buffered messages first,
 * then live messages as they arrive.
 */

export interface SessionStream {
  sessionId: string;
  userId: string;
  messages: unknown[];
  isComplete: boolean;
  subscribers: Set<(message: unknown) => Promise<void>>;
  createdAt: number;
  completedAt?: number;
}

const sessionStreams = new Map<string, SessionStream>();

/**
 * Create a new session stream for buffering messages.
 * Called when we receive the SDK session ID from the init message.
 */
export function createSessionStream(sessionId: string, userId: string): SessionStream {
  const stream: SessionStream = {
    sessionId,
    userId,
    messages: [],
    isComplete: false,
    subscribers: new Set(),
    createdAt: Date.now(),
  };
  sessionStreams.set(sessionId, stream);
  console.log('[STREAMS] Created stream for session:', sessionId);
  return stream;
}

/**
 * Publish a message to the session stream buffer.
 * Also notifies all subscribers (reconnected clients).
 */
export async function publishMessage(sessionId: string, message: unknown): Promise<void> {
  const stream = sessionStreams.get(sessionId);
  if (!stream) return;

  // Buffer the message
  stream.messages.push(message);

  // Notify all subscribers (reconnected clients)
  const notifyPromises = Array.from(stream.subscribers).map(async (callback) => {
    try {
      await callback(message);
    } catch (error) {
      // Subscriber disconnected, will be cleaned up
      console.warn('[STREAMS] Subscriber notification failed:', error);
      stream.subscribers.delete(callback);
    }
  });

  await Promise.all(notifyPromises);
}

/**
 * Subscribe to a session stream for new messages.
 * Returns buffered messages and an unsubscribe function.
 * Returns null if no active stream exists.
 */
export function subscribeToSession(
  sessionId: string,
  callback: (message: unknown) => Promise<void>
): { bufferedMessages: unknown[]; unsubscribe: () => void } | null {
  const stream = sessionStreams.get(sessionId);
  if (!stream) return null;

  stream.subscribers.add(callback);
  console.log('[STREAMS] Subscriber added for session:', sessionId, 'total:', stream.subscribers.size);

  return {
    bufferedMessages: [...stream.messages],
    unsubscribe: () => {
      stream.subscribers.delete(callback);
      console.log('[STREAMS] Subscriber removed for session:', sessionId, 'remaining:', stream.subscribers.size);
    },
  };
}

/**
 * Mark a session stream as complete (no more messages coming).
 */
export function markStreamComplete(sessionId: string): void {
  const stream = sessionStreams.get(sessionId);
  if (stream) {
    stream.isComplete = true;
    stream.completedAt = Date.now();
    console.log('[STREAMS] Stream completed for session:', sessionId);
  }
}

/**
 * Check if a session stream is complete.
 */
export function isStreamComplete(sessionId: string): boolean {
  return sessionStreams.get(sessionId)?.isComplete ?? true;
}

/**
 * Get a session stream by ID.
 */
export function getSessionStream(sessionId: string): SessionStream | undefined {
  return sessionStreams.get(sessionId);
}

/**
 * Check if user owns the session stream (for authorization).
 */
export function isStreamOwner(sessionId: string, userId: string): boolean {
  const stream = sessionStreams.get(sessionId);
  return stream?.userId === userId;
}

/**
 * Get stream statistics (for debugging).
 */
export function getStreamStats(): {
  activeStreams: number;
  completedStreams: number;
  totalMessages: number;
  totalSubscribers: number;
} {
  let activeStreams = 0;
  let completedStreams = 0;
  let totalMessages = 0;
  let totalSubscribers = 0;

  for (const stream of sessionStreams.values()) {
    if (stream.isComplete) {
      completedStreams++;
    } else {
      activeStreams++;
    }
    totalMessages += stream.messages.length;
    totalSubscribers += stream.subscribers.size;
  }

  return { activeStreams, completedStreams, totalMessages, totalSubscribers };
}

/**
 * Cleanup old completed streams to prevent memory leaks.
 * Call periodically (e.g., every minute).
 */
export function cleanupOldStreams(maxAgeMs: number = 10 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, stream] of sessionStreams) {
    // Only clean up completed streams older than maxAge
    if (stream.isComplete && stream.completedAt && now - stream.completedAt > maxAgeMs) {
      sessionStreams.delete(sessionId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log('[STREAMS] Cleaned up', cleaned, 'old streams');
  }

  return cleaned;
}

// Start cleanup interval (every minute)
setInterval(() => cleanupOldStreams(), 60 * 1000);
